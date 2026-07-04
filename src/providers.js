// Provider 适配层:对外暴露统一的 generateImage(),内部按模型协议分发。
// Gemini 协议多轮:发送完整 contents 历史(user+model 多轮)。
import path from 'path';
import { readJSON, ROOT } from './store.js';
import { truncate, friendlyError } from './httpUtil.js';

const OPENAI_BASE = (process.env.ZENMUX_OPENAI_BASE || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
const GEMINI_BASE = (process.env.ZENMUX_GEMINI_BASE || 'https://zenmux.ai/api/vertex-ai/v1').replace(/\/$/, '');
const VIDEO_BASE = (process.env.ZENMUX_VIDEO_BASE || OPENAI_BASE).replace(/\/$/, '');
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

// ---------- 视频任务(zenmux videos 任务接口:提交 → 轮询) ----------
// 注:zenmux 视频接口未公开完整文档,以下按 OpenAI 风格任务资源假设实现,
// 字段名(status/url 等)接入真实环境后如有出入需相应调整。
export async function submitJob({ model, prompt, inputImages = [], params = {} }) {
  if (!API_KEY) throw new Error('服务器未配置 ZENMUX_API_KEY');
  const m = await getModel(model);
  if (!m) throw new Error(`未知模型: ${model}`);
  if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');
  if (m.protocol === 'zenmux-video') return submitVideoJob(m.id, prompt, inputImages, params);
  throw new Error(`不支持的异步协议: ${m.protocol}`);
}

export async function checkJob({ model, providerJobId, providerSurface }) {
  const m = await getModel(model);
  if (!m) throw new Error(`未知模型: ${model}`);
  if (m.protocol === 'zenmux-video') return checkVideoJob(providerJobId, providerSurface);
  throw new Error(`不支持的异步协议: ${m.protocol}`);
}

async function submitVideoJob(modelId, prompt, inputImages, params) {
  // 豆包 Seedance 走火山方舟风格的 content 数组(而非纯 prompt 字符串);实测 zenmux 会校验 content 是否存在。
  const content = [{ type: 'text', text: prompt }];
  for (const img of inputImages) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` }, role: 'reference_image' });
  }
  const body = { model: modelId, prompt, content };
  if (params.duration) body.duration = Number(params.duration);
  if (params.resolution) body.resolution = params.resolution;
  if (params.aspectRatio) { body.ratio = params.aspectRatio; body.aspect_ratio = params.aspectRatio; }
  if (inputImages.length > 0) {
    body.reference_images = inputImages.map((img) => `data:${img.mimeType};base64,${img.base64}`);
  }

  const resp = await fetch(`${VIDEO_BASE}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`返回非 JSON: ${truncate(text)}`); }
  const jobId = json?.id || json?.task_id;
  if (!jobId) throw new Error(`响应未包含任务 ID: ${truncate(text)}`);
  return { providerJobId: jobId, providerSurface: 'videos' };
}

async function checkVideoJob(providerJobId, providerSurface) {
  const surface = providerSurface || 'videos';
  const resp = await fetch(`${VIDEO_BASE}/${surface}/${providerJobId}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`返回非 JSON: ${truncate(text)}`); }

  const status = json?.status;
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', error: json?.error?.message || json?.error || '视频生成失败' };
  }
  if (status !== 'completed' && status !== 'succeeded' && status !== 'done') {
    return { status: 'processing' };
  }

  const url = json?.content?.video_url || json?.video_url || json?.url || json?.video?.url || json?.output?.url;
  if (!url) return { status: 'failed', error: '生成完成但响应未包含视频地址' };
  const videoResp = await fetch(url);
  if (!videoResp.ok) throw new Error(`拉取视频失败 (${videoResp.status})`);
  const buffer = Buffer.from(await videoResp.arrayBuffer());
  return { status: 'done', buffer, mimeType: videoResp.headers.get('content-type') || 'video/mp4' };
}
