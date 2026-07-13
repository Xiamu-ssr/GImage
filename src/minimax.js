// 音乐生成:直连 MiniMax API(不经 zenmux,zenmux 不支持音乐模型)。
import { assertHttpUrl, fetchWithTimeout, truncate, friendlyError } from './httpUtil.js';
import { getProvider, providerApiKey, providerValue } from './providerRegistry.js';

/**
 * @param {object} p
 * @param {string} p.prompt          风格/情绪描述
 * @param {string} [p.lyrics]        歌词
 * @param {boolean} [p.isInstrumental] 纯音乐(无人声)
 * @param {boolean} [p.lyricsOptimizer] 自动生成歌词
 * @param {Buffer} [p.referenceAudio] 快速翻唱参考音频
 * @param {string} [p.coverFeatureId] 高级翻唱预处理特征 ID
 * @param {string} [p.format]        mp3 | wav
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
export async function generateMusic({ model = 'music-2.6', prompt, lyrics = '', isInstrumental = false, lyricsOptimizer = false, format = 'mp3', referenceAudio = null, coverFeatureId = '' }) {
  const provider = await getProvider('minimax');
  const apiKey = providerApiKey(provider);
  const base = providerValue(provider, 'base');
  if (!apiKey) throw new Error(`服务器未配置 ${provider.apiKeyEnv || 'MINIMAX_API_KEY'}`);
  if (!prompt || !prompt.trim() || prompt.length > (model === 'music-cover' ? 300 : 2000)) throw new Error('风格提示词长度不符合模型要求');
  if (!['mp3', 'wav'].includes(format)) throw new Error('不支持的音频格式');
  if (model === 'music-cover' && !referenceAudio && !coverFeatureId) throw new Error('翻唱模式需要上传参考音频或完成高级预处理');
  if (model !== 'music-cover' && !isInstrumental && !lyrics.trim() && !lyricsOptimizer) throw new Error('请填写歌词、开启自动写词，或勾选纯音乐');
  if (lyrics.length > (model === 'music-cover' ? 1000 : 3500)) throw new Error('歌词长度超出模型限制');

  const body = {
    model,
    prompt,
    lyrics: lyrics || '',
    audio_setting: { sample_rate: 44100, bitrate: 256000, format },
    output_format: 'hex',
  };
  if (model === 'music-cover') {
    if (coverFeatureId) body.cover_feature_id = coverFeatureId;
    else body.audio_base64 = referenceAudio.toString('base64');
  } else {
    body.is_instrumental = !!isInstrumental;
    body.lyrics_optimizer = !!lyricsOptimizer;
  }

  const resp = await fetchWithTimeout(`${base}/music_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
    const audioResp = await fetchWithTimeout(assertHttpUrl(url), {}, 120_000);
    if (!audioResp.ok) throw new Error(`拉取音频失败 (${audioResp.status})`);
    const buffer = Buffer.from(await audioResp.arrayBuffer());
    return { buffer, mimeType: audioResp.headers.get('content-type') || mimeType };
  }
  throw new Error(`响应未包含音频: ${truncate(JSON.stringify(json))}`);
}

/** MiniMax 高级翻唱第一步：从参考音频提取音色特征与结构化歌词。 */
export async function preprocessMusicCover(referenceAudio) {
  if (!referenceAudio) throw new Error('请先上传参考音频');
  const provider = await getProvider('minimax');
  const apiKey = providerApiKey(provider);
  const base = providerValue(provider, 'base');
  if (!apiKey) throw new Error(`服务器未配置 ${provider.apiKeyEnv || 'MINIMAX_API_KEY'}`);
  const resp = await fetchWithTimeout(`${base}/music_cover_preprocess`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'music-cover', audio_base64: referenceAudio.toString('base64') }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(friendlyError(resp.status, text));
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`返回非 JSON: ${truncate(text)}`); }
  const baseResp = json?.base_resp;
  if (baseResp && baseResp.status_code !== 0) throw new Error(`MiniMax 预处理失败: ${baseResp.status_msg || '未知错误'}`);
  const coverFeatureId = json?.cover_feature_id || json?.data?.cover_feature_id;
  if (!coverFeatureId) throw new Error('预处理未返回 cover_feature_id');
  return { coverFeatureId, lyrics: json?.formatted_lyrics || json?.data?.formatted_lyrics || '' };
}
