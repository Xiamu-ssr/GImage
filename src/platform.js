// ZenMux 平台管理 API:查询服务器侧的余额与订阅配额。
// 用 Management API Key(只读,不能调用模型)。端点经实测确认:
//   GET {base}/management/payg/balance        → PAYG 余额
//   GET {base}/management/subscription/detail → 订阅档位 + Flow 配额(5h/7d/月)
//
// 「订阅有没有额度」看的是 subscription.quota_5_hour / quota_7_day 的 remaining_flows。
const BASE = (process.env.ZENMUX_OPENAI_BASE || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
const MGMT_KEY = process.env.ZENMUX_MANAGEMENT_KEY || '';

let cache = { at: 0, data: null };
const TTL = 60 * 1000; // 60s 缓存,避免频繁请求平台

async function getJSON(path) {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${MGMT_KEY}` },
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`平台接口返回非 JSON(${resp.status}),请检查 base 与 management key`); }
  if (!resp.ok || json.success === false) {
    throw new Error(json.message || `平台接口错误 (${resp.status})`);
  }
  return json.data;
}

/** 聚合服务器状态;有 60s 缓存。未配置 management key 时返回 {configured:false}。 */
export async function getServerStatus({ force = false } = {}) {
  if (!MGMT_KEY) return { configured: false };
  if (!force && cache.data && Date.now() - cache.at < TTL) {
    return { ...cache.data, cached: true };
  }

  const result = { configured: true, fetchedAt: new Date().toISOString() };
  // 两个端点独立容错:某个挂了不影响另一个
  const [balanceRes, subRes] = await Promise.allSettled([
    getJSON('/management/payg/balance'),
    getJSON('/management/subscription/detail'),
  ]);

  if (balanceRes.status === 'fulfilled') {
    result.payg = balanceRes.value; // {currency,total_credits,top_up_credits,bonus_credits}
  } else {
    result.paygError = balanceRes.reason.message;
  }

  if (subRes.status === 'fulfilled') {
    result.subscription = subRes.value; // {plan, account_status, quota_5_hour, quota_7_day, ...}
  } else {
    result.subscriptionError = subRes.reason.message;
  }

  cache = { at: Date.now(), data: result };
  return result;
}
