// 按天额度:从"次数"改为"美元额度"。
// 每次生图按模型的 costPerImage 扣费。额度按日期分文件,新一天自动重置。
import path from 'path';
import { USAGE_DIR, readJSON, updateJSON } from './store.js';

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function usageFile(date) {
  return path.join(USAGE_DIR, `${date}.json`);
}

/**
 * 每个用户的用量格式:
 * { "alice": { spent, reserved, count, history, reservations } }
 *
 * `reserved` 是尚未完成的生成任务预留金额。它让“检查额度 → 调用上游”成为
 * 单个原子操作，避免同一用户并发请求绕过每日额度。
 */

export async function getSpentToday(username, date = todayStr()) {
  const usage = await readJSON(usageFile(date), {});
  return usage[username]?.spent || 0;
}

export async function getCountToday(username, date = todayStr()) {
  const usage = await readJSON(usageFile(date), {});
  return usage[username]?.count || 0;
}

/** 剩余额度(美元)。dailyBudget 是美元额度上限。 */
export async function getRemaining(username, dailyBudget, date = todayStr()) {
  const usage = await readJSON(usageFile(date), {});
  const current = usage[username] || {};
  const used = (current.spent || 0) + (current.reserved || 0);
  return Math.max(0, +(dailyBudget - used).toFixed(4));
}

/** 检查是否有足够额度(生图前调用)。 */
export async function canAfford(username, dailyBudget, cost, date = todayStr()) {
  const remaining = await getRemaining(username, dailyBudget, date);
  return remaining >= cost;
}

/** 生成成功后扣费(图片/视频/音乐共用)。返回扣费后的 spent。 */
export async function consume(username, model, modality, cost, date = todayStr()) {
  const updated = await updateJSON(usageFile(date), {}, (usage) => {
    const cur = usage[username] || { spent: 0, reserved: 0, count: 0, history: [], reservations: {} };
    cur.spent = +(cur.spent + cost).toFixed(4);
    cur.count += 1;
    cur.history.push({ model, modality, cost, at: new Date().toISOString() });
    usage[username] = cur;
    return usage;
  });
  return updated[username].spent;
}

/** 原子预扣额度。返回 false 表示当前可用额度不足。 */
export async function reserve(username, dailyBudget, { id, model, modality, cost }, date = todayStr()) {
  let result = { ok: false, remaining: 0 };
  await updateJSON(usageFile(date), {}, (usage) => {
    const cur = usage[username] || { spent: 0, reserved: 0, count: 0, history: [], reservations: {} };
    cur.reserved ||= 0;
    cur.reservations ||= {};
    const available = dailyBudget - cur.spent - cur.reserved;
    if (cost > available) {
      result = { ok: false, remaining: Math.max(0, +available.toFixed(4)) };
      usage[username] = cur;
      return usage;
    }
    cur.reserved = +(cur.reserved + cost).toFixed(4);
    cur.reservations[id] = { model, modality, cost, at: new Date().toISOString() };
    usage[username] = cur;
    result = { ok: true, remaining: Math.max(0, +(available - cost).toFixed(4)) };
    return usage;
  });
  return result;
}

/** 将已完成的预扣额度转为实际消耗，且只会结算一次。 */
export async function finalizeReservation(username, id, date = todayStr()) {
  let spent = null;
  await updateJSON(usageFile(date), {}, (usage) => {
    const cur = usage[username] || { spent: 0, reserved: 0, count: 0, history: [], reservations: {} };
    const reservation = cur.reservations?.[id];
    if (!reservation) { spent = cur.spent || 0; return usage; }
    cur.reserved = Math.max(0, +((cur.reserved || 0) - reservation.cost).toFixed(4));
    cur.spent = +((cur.spent || 0) + reservation.cost).toFixed(4);
    cur.count = (cur.count || 0) + 1;
    cur.history ||= [];
    cur.history.push({ ...reservation, at: new Date().toISOString() });
    delete cur.reservations[id];
    usage[username] = cur;
    spent = cur.spent;
    return usage;
  });
  return spent ?? 0;
}

/** 上游调用失败时释放预扣额度；不存在的（旧）任务可安全忽略。 */
export async function releaseReservation(username, id, date = todayStr()) {
  await updateJSON(usageFile(date), {}, (usage) => {
    const cur = usage[username];
    const reservation = cur?.reservations?.[id];
    if (!reservation) return usage;
    cur.reserved = Math.max(0, +((cur.reserved || 0) - reservation.cost).toFixed(4));
    delete cur.reservations[id];
    usage[username] = cur;
    return usage;
  });
}

export async function getUsageByDate(date = todayStr()) {
  return readJSON(usageFile(date), {});
}
