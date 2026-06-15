// Provider 适配层:对外暴露统一的 generateImage(),内部按模型协议分发。
// Gemini 协议多轮:发送完整 contents 历史(user+model 多轮)。
import path from 'path';
import { readJSON, ROOT } from './store.js';

const OPENAI_BASE = (process.env.ZENMUX_OPENAI_BASE || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
const GEMINI_BASE = (process.env.ZENMUX_GEMINI_BASE || 'https://zenmux.ai/api/vertex-ai/v1').replace(/\/$/, '');
const API_KEY = process.env.ZENMUX_API_KEY || '';

let _modelsCache = null;
export async function loadModels() {
  if (!_modelsCache) {
    const cfg = await readJSON(path.join(ROOT, 'config', 'models.json'), { models: [] });
    _modelsCache = cfg.models || [];
  }
  return _modelsCache;
}

export async function getModel(modelId) {
  const models = await loadModels();
  return models.find((m) => m.id === modelId) || null;
}

/**
 * 统一生图入口。
 * @param {object} p
 * @param {string} p.model          模型 id
 * @param {string} p.prompt         当轮提示词
 * @param {Array<{mimeType:string, base64:string}>} [p.inputImages] 当轮上传的参考图
 * @param {object} [p.params]       模型参数
 * @param {Array}  [p.history]      之前的完整对话历史(gemini contents 格式)
 * @returns {Promise<{buffer: Buffer, mimeType: string, usage: object|null, historyEntry: object}>}
 *          historyEntry = 本轮要追加到 history 的 {user, model} contents
 */
export async function generateImage({ model, prompt, inputImages = [], params = {}, history = [] }) {
  if (!API_KEY) throw new Error('服务器未配置 ZENMUX_API_KEY');
  const m = await getModel(model);
  if (!m) throw new Error(`未知模型: ${model}`);
  if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

  if (m.protocol === 'gemini') {
    return generateViaGemini(m.id, prompt, inputImages, params, history);
  }
  if (m.protocol === 'imagen') {
    return generateViaImagen(m.id, prompt, inputImages, params);
  }
  if (m.protocol === 'openai-images') {
    return generateViaOpenAIImages(m.id, prompt, inputImages, params);
  }
  throw new Error(`不支持的协议: ${m.protocol}`);
}

// ---------- Gemini 协议(多轮完整历史) ----------
async function generateViaGemini(modelId, prompt, inputImages, params, history) {
  // 构建当轮 user parts
  const userParts = [];
  for (const img of inputImages) {
    userParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  userParts.push({ text: prompt });

  // 完整 contents = 历史 + 当轮
  const contents = [
    ...history,
    { role: 'user', parts: userParts },
  ];

  const imageConfig = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  if (params.imageSize) imageConfig.imageSize = params.imageSize;

  const generationConfig = { responseModalities: ['IMAGE', 'TEXT'] };
  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;

  const url = `${GEMINI_BASE}/models/${modelId}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(resp.status === 500 ? '请检查 API Key 是否有效' : `返回非 JSON: ${truncate(text)}`); }

  // 提取图片
  const candParts = json?.candidates?.[0]?.content?.parts || [];
  let imageBuffer = null, imageMime = 'image/png', modelTextParts = [];
  for (const part of candParts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data && !imageBuffer) {
      imageBuffer = Buffer.from(inline.data, 'base64');
      imageMime = inline.mimeType || inline.mime_type || 'image/png';
    }
    if (part.text && !part.thought) {
      modelTextParts.push({ text: part.text });
    }
  }
  if (!imageBuffer) throw new Error(`响应未包含图片: ${truncate(JSON.stringify(json))}`);

  // 构建本轮历史条目(供下一轮使用),model 部分只保留文本(图片太大不存历史,用 inlineData 引用)
  const modelParts = [];
  for (const part of candParts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      modelParts.push({ inlineData: { mimeType: inline.mimeType || inline.mime_type || 'image/png', data: inline.data } });
    } else if (part.text && !part.thought) {
      modelParts.push({ text: part.text });
    }
  }

  const historyEntry = {
    user: { role: 'user', parts: userParts },
    model: { role: 'model', parts: modelParts },
  };

  // token 用量(用于计算真实成本)
  const usage = json.usageMetadata || null;

  return { buffer: imageBuffer, mimeType: imageMime, usage, historyEntry };
}

// ---------- Imagen 协议(Qwen 等,走 vertex-ai :predict 端点) ----------
async function generateViaImagen(modelId, prompt, inputImages, params) {
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1 },
  };
  if (params.aspectRatio) body.parameters.aspectRatio = params.aspectRatio;

  const url = `${GEMINI_BASE}/models/${modelId}:predict`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`返回非 JSON: ${truncate(text)}`); }

  const prediction = json?.predictions?.[0];
  // Imagen 返回方式:gcsUri(URL)或 bytesBase64Encoded(base64)
  if (prediction?.bytesBase64Encoded) {
    return { buffer: Buffer.from(prediction.bytesBase64Encoded, 'base64'), mimeType: prediction.mimeType || 'image/png', usage: null, historyEntry: null };
  }
  if (prediction?.gcsUri) {
    const imgResp = await fetch(prediction.gcsUri);
    if (!imgResp.ok) throw new Error(`拉取图片失败 (${imgResp.status})`);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    return { buffer: buf, mimeType: imgResp.headers.get('content-type') || 'image/png', usage: null, historyEntry: null };
  }
  throw new Error(`响应未包含图片: ${truncate(JSON.stringify(json))}`);
}

// ---------- OpenAI Images 协议 ----------
async function generateViaOpenAIImages(modelId, prompt, inputImages, params) {
  let resp;
  if (inputImages.length > 0) {
    const form = new FormData();
    form.append('model', modelId);
    form.append('prompt', prompt);
    if (params.size) form.append('size', params.size);
    if (params.quality) form.append('quality', params.quality);
    if (params.background) form.append('background', params.background);
    inputImages.forEach((img, i) => {
      const bytes = Buffer.from(img.base64, 'base64');
      const blob = new Blob([bytes], { type: img.mimeType || 'image/png' });
      form.append('image[]', blob, `ref${i}.png`);
    });
    resp = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}` },
      body: form,
    });
  } else {
    const body = { model: modelId, prompt, n: 1 };
    if (params.size) body.size = params.size;
    if (params.quality) body.quality = params.quality;
    if (params.background) body.background = params.background;
    resp = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`返回非 JSON: ${truncate(text)}`); }

  const usage = json?.usage || null;
  const item = json?.data?.[0];
  if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', usage, historyEntry: null };
  if (item?.url) {
    const imgResp = await fetch(item.url);
    if (!imgResp.ok) throw new Error(`拉取图片 URL 失败 (${imgResp.status})`);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    return { buffer: buf, mimeType: imgResp.headers.get('content-type') || 'image/png', usage, historyEntry: null };
  }
  throw new Error(`响应未包含图片: ${truncate(JSON.stringify(json))}`);
}

function truncate(s, n = 500) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function friendlyError(status, raw) {
  try {
    const json = JSON.parse(raw);
    const msg = json?.error?.message || json?.message || '';
    if (msg.includes('safety') || msg.includes('rejected'))
      return '提示词触发了安全审核,请调整内容后重试';
    if (msg.includes('quota') || msg.includes('rate'))
      return '服务器请求频率超限或配额不足,请稍后重试';
    if (msg.includes('permission') || msg.includes('auth') || status === 401 || status === 403)
      return 'API Key 无效或无权限,请联系管理员';
    if (msg) return msg;
  } catch { /* not JSON */ }
  if (String(raw).startsWith('<!DOCTYPE') || String(raw).startsWith('<html'))
    return '请检查 API Key 是否有效(服务端返回了网页而非 API 响应)';
  return `生图失败 (${status})`;
}
