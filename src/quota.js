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
 * { "alice": { spent: 0.26, count: 2, history: [{model,cost,at}] } }
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
  const spent = await getSpentToday(username, date);
  return Math.max(0, +(dailyBudget - spent).toFixed(4));
}

/** 检查是否有足够额度(生图前调用)。 */
export async function canAfford(username, dailyBudget, cost, date = todayStr()) {
  const remaining = await getRemaining(username, dailyBudget, date);
  return remaining >= cost;
}

/** 生图成功后扣费。返回扣费后的 spent。 */
export async function consume(username, model, cost, date = todayStr()) {
  const updated = await updateJSON(usageFile(date), {}, (usage) => {
    const cur = usage[username] || { spent: 0, count: 0, history: [] };
    cur.spent = +(cur.spent + cost).toFixed(4);
    cur.count += 1;
    cur.history.push({ model, cost, at: new Date().toISOString() });
    usage[username] = cur;
    return usage;
  });
  return updated[username].spent;
}

export async function getUsageByDate(date = todayStr()) {
  return readJSON(usageFile(date), {});
}
