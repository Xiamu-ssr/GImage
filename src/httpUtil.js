// 各 provider 适配层(providers.js / minimax.js)共用的错误处理小工具。
export function truncate(s, n = 500) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function friendlyError(status, raw) {
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
  return `请求失败 (${status})`;
}

/** 为所有上游调用设置上限，避免慢连接长期占用 Node 请求与内存。 */
export async function fetchWithTimeout(url, init = {}, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('上游服务响应超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 模型返回的下载地址必须是绝对 HTTP(S) URL，避免接受意外协议。 */
export function assertHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('上游返回了无效的文件地址'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('上游返回了不支持的文件地址');
  return url.toString();
}
