// Provider 适配层:对外暴露统一的 generateImage(),内部按模型协议分发。
//
// zenmux 不同生图模型走不同协议:
//   - gemini 协议(banana 系列): POST {base}/{model}:generateContent
//   - openai-images 协议(gpt-image-2): POST {base}/images/generations | /images/edits
//
// 注意:zenmux 文档部分页 404,以下端点路径与字段以社区/OpenAI/Gemini 通用约定实现,
// 首次联调若报错,优先核对 base URL 与端点路径(集中在本文件,便于调整)。
import path from 'path';
import { readJSON, ROOT } from './store.js';

const OPENAI_BASE = (process.env.ZENMUX_OPENAI_BASE || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
const GEMINI_BASE = (process.env.ZENMUX_GEMINI_BASE || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
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
 * @param {string} p.model       模型 id(须在 config/models.json 中)
 * @param {string} p.prompt      提示词
 * @param {Array<{mimeType:string, base64:string}>} [p.inputImages] 参考图(以图改图/多轮)
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
export async function generateImage({ model, prompt, inputImages = [] }) {
  if (!API_KEY) throw new Error('服务器未配置 ZENMUX_API_KEY');
  const m = await getModel(model);
  if (!m) throw new Error(`未知模型: ${model}`);
  if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

  if (m.protocol === 'gemini') {
    return generateViaGemini(m.id, prompt, inputImages);
  }
  if (m.protocol === 'openai-images') {
    return generateViaOpenAIImages(m.id, prompt, inputImages);
  }
  throw new Error(`不支持的协议: ${m.protocol}`);
}

// ---------- Gemini 协议(banana 系列) ----------
async function generateViaGemini(modelId, prompt, inputImages) {
  const parts = [];
  for (const img of inputImages) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  parts.push({ text: prompt });

  // zenmux gemini 协议端点: {base}/models/{model}:generateContent
  const url = `${GEMINI_BASE}/models/${modelId}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`生图失败 (${resp.status}): ${truncate(text)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`返回非 JSON: ${truncate(text)}`);
  }

  // 从 candidates[].content.parts[] 中找出 inlineData 图片
  const candParts = json?.candidates?.[0]?.content?.parts || [];
  for (const part of candParts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      return {
        buffer: Buffer.from(inline.data, 'base64'),
        mimeType: inline.mimeType || inline.mime_type || 'image/png',
      };
    }
  }
  throw new Error(`响应未包含图片: ${truncate(JSON.stringify(json))}`);
}

// ---------- OpenAI Images 协议(gpt-image-2) ----------
async function generateViaOpenAIImages(modelId, prompt, inputImages) {
  let resp;
  if (inputImages.length > 0) {
    // 以图改图:走 /images/edits(multipart)
    const form = new FormData();
    form.append('model', modelId);
    form.append('prompt', prompt);
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
    resp = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelId, prompt, n: 1 }),
    });
  }

  const text = await resp.text();
  if (!resp.ok) throw new Error(`生图失败 (${resp.status}): ${truncate(text)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`返回非 JSON: ${truncate(text)}`);
  }

  const item = json?.data?.[0];
  if (item?.b64_json) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' };
  }
  // 部分实现返回 url,需二次拉取
  if (item?.url) {
    const imgResp = await fetch(item.url);
    if (!imgResp.ok) throw new Error(`拉取图片 URL 失败 (${imgResp.status})`);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    return { buffer: buf, mimeType: imgResp.headers.get('content-type') || 'image/png' };
  }
  throw new Error(`响应未包含图片: ${truncate(JSON.stringify(json))}`);
}

function truncate(s, n = 500) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
