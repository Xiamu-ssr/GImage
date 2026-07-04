// 音乐生成:直连 MiniMax API(不经 zenmux,zenmux 不支持音乐模型)。
import { truncate, friendlyError } from './httpUtil.js';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
// MiniMax 分大陆(api.minimaxi.com)和海外(api.minimax.io)两套账号体系,key 不通用。
// 默认按大陆平台(platform.minimaxi.com 注册的 key),海外账号可用 MINIMAX_BASE 覆盖为 https://api.minimax.io/v1。
const MINIMAX_BASE = (process.env.MINIMAX_BASE || 'https://api.minimaxi.com/v1').replace(/\/$/, '');

/**
 * @param {object} p
 * @param {string} p.prompt          风格/情绪描述
 * @param {string} [p.lyrics]        歌词
 * @param {boolean} [p.isInstrumental] 纯音乐(无人声)
 * @param {string} [p.format]        mp3 | wav
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
export async function generateMusic({ prompt, lyrics = '', isInstrumental = false, format = 'mp3' }) {
  if (!MINIMAX_API_KEY) throw new Error('服务器未配置 MINIMAX_API_KEY');
  if (!prompt || !prompt.trim()) throw new Error('风格提示词不能为空');
  if (!isInstrumental && !lyrics.trim()) throw new Error('请填写歌词,或勾选「纯音乐」');

  const body = {
    model: 'music-2.6',
    prompt,
    lyrics: lyrics || '',
    is_instrumental: !!isInstrumental,
    audio_setting: { sample_rate: 44100, bitrate: 256000, format },
  };

  const resp = await fetch(`${MINIMAX_BASE}/music_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`返回非 JSON: ${truncate(text)}`); }

  // MiniMax 即使 HTTP 200 也可能携带业务错误,需读 base_resp.status_code(非 0 即失败)
  const baseResp = json?.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    throw new Error(`MiniMax 生成失败 (${baseResp.status_code}): ${baseResp.status_msg || '未知错误'}`);
  }

  const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const data = json?.data;
  const hex = data?.audio;
  if (hex) return { buffer: Buffer.from(hex, 'hex'), mimeType };

  const url = data?.audio_url || json?.audio_url;
  if (url) {
    const audioResp = await fetch(url);
    if (!audioResp.ok) throw new Error(`拉取音频失败 (${audioResp.status})`);
    const buffer = Buffer.from(await audioResp.arrayBuffer());
    return { buffer, mimeType: audioResp.headers.get('content-type') || mimeType };
  }
  throw new Error(`响应未包含音频: ${truncate(JSON.stringify(json))}`);
}
