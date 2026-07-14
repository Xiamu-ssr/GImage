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

  // 完整翻唱最长可接近 6 分钟，音乐渲染明显长于图像接口；不能沿用通用 90 秒超时。
  const resp = await fetchWithTimeout(`${base}/music_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, model === 'music-cover' ? 8 * 60_000 : 5 * 60_000);

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

/**
 * MiniMax music-01 的旧版“片段重演”流程。
 *
 * 与 music-cover 不同，它先把上传的歌曲片段拆成声轨与伴奏轨，再只凭这两份
 * 参考和歌词合成最多约 60 秒的作品。该模型没有 prompt 字段，不能把风格指导
 * 混入请求；因此适合复现“短片段 + 改写/原歌词”的旧工作流。
 */
export async function generateMusic01({ referenceAudio, lyrics = '', format = 'mp3' }) {
  if (!referenceAudio) throw new Error('片段重演需要上传一段参考音频');
  if (!['mp3', 'wav'].includes(format)) throw new Error('不支持的音频格式');
  const cleanLyrics = lyrics.trim();
  if (!cleanLyrics) throw new Error('片段重演需要填写对应歌词');
  // ## 会在未显式填写时自动补齐，给伴奏留出首尾边界。
  const musicLyrics = cleanLyrics.startsWith('##') && cleanLyrics.endsWith('##') ? cleanLyrics : `##${cleanLyrics}##`;
  if (musicLyrics.length > 200) throw new Error('music-01 单次歌词（含伴奏边界）不能超过 200 个字符');

  const provider = await getProvider('minimax');
  const apiKey = providerApiKey(provider);
  const base = providerValue(provider, 'base');
  if (!apiKey) throw new Error(`服务器未配置 ${provider.apiKeyEnv || 'MINIMAX_API_KEY'}`);

  // music-01 的上传接口会从混合歌曲中分离出人声与伴奏；这一过程不需要文本提示词。
  const form = new FormData();
  form.append('purpose', 'song');
  form.append('file', new Blob([referenceAudio], { type: 'audio/mpeg' }), 'reference.mp3');
  const uploadResp = await fetchWithTimeout(`${base}/music_upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, 3 * 60_000);
  const uploadText = await uploadResp.text();
  if (!uploadResp.ok) throw new Error(friendlyError(uploadResp.status, uploadText));
  let uploadJson;
  try { uploadJson = JSON.parse(uploadText); } catch { throw new Error(`上传返回非 JSON: ${truncate(uploadText)}`); }
  const uploadBaseResp = uploadJson?.base_resp;
  if (uploadBaseResp && uploadBaseResp.status_code !== 0) {
    throw new Error(`MiniMax 片段解析失败 (${uploadBaseResp.status_code}): ${uploadBaseResp.status_msg || '未知错误'}`);
  }
  const referVoice = uploadJson?.voice_id;
  const referInstrumental = uploadJson?.instrumental_id;
  if (!referVoice || !referInstrumental) throw new Error('片段解析未返回人声与伴奏参考');

  // ## 是 music-01 的伴奏边界标记，不属于歌词本身；使用它可保留片段前后的伴奏。
  const generationResp = await fetchWithTimeout(`${base}/music_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'music-01',
      refer_voice: referVoice,
      refer_instrumental: referInstrumental,
      lyrics: musicLyrics,
      audio_setting: { sample_rate: 44100, bitrate: 256000, format },
    }),
  }, 4 * 60_000);
  const generationText = await generationResp.text();
  if (!generationResp.ok) throw new Error(friendlyError(generationResp.status, generationText));
  let generationJson;
  try { generationJson = JSON.parse(generationText); } catch { throw new Error(`生成返回非 JSON: ${truncate(generationText)}`); }
  const generationBaseResp = generationJson?.base_resp;
  if (generationBaseResp && generationBaseResp.status_code !== 0) {
    throw new Error(`MiniMax 片段重演失败 (${generationBaseResp.status_code}): ${generationBaseResp.status_msg || '未知错误'}`);
  }
  const hex = generationJson?.data?.audio;
  if (!hex) throw new Error(`响应未包含音频: ${truncate(JSON.stringify(generationJson))}`);
  return { buffer: Buffer.from(hex, 'hex'), mimeType: format === 'wav' ? 'audio/wav' : 'audio/mpeg' };
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
  }, 3 * 60_000);
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
