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
