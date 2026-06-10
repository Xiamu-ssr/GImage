// 按天配额:用量按日期分文件存储(usage/YYYY-MM-DD.json),新一天自然计数归零。
import path from 'path';
import { USAGE_DIR, readJSON, updateJSON } from './store.js';

/** 本地时区的今日日期串 YYYY-MM-DD。 */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function usageFile(date) {
  return path.join(USAGE_DIR, `${date}.json`);
}

/** 读取某用户今日已用次数。 */
export async function getUsedToday(username, date = todayStr()) {
  const usage = await readJSON(usageFile(date), {});
  return usage[username]?.count || 0;
}

/** 剩余次数 = 配额 - 今日已用(下限 0)。 */
export async function getRemaining(username, dailyQuota, date = todayStr()) {
  const used = await getUsedToday(username, date);
  return Math.max(0, dailyQuota - used);
}

/**
 * 在生图成功后扣减一次配额(串行更新保证不超额)。
 * 返回扣减后的 count。
 */
export async function consume(username, date = todayStr()) {
  const updated = await updateJSON(usageFile(date), {}, (usage) => {
    const cur = usage[username]?.count || 0;
    usage[username] = { count: cur + 1, lastAt: new Date().toISOString() };
    return usage;
  });
  return updated[username].count;
}

/** 管理端:返回某日各用户用量映射。 */
export async function getUsageByDate(date = todayStr()) {
  return readJSON(usageFile(date), {});
}
