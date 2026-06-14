// 账户管理:CRUD + bcrypt 密码校验。账户存于 data/accounts.json。
// dailyBudget 单位为美元,默认 $1.50/天/人。
import path from 'path';
import bcrypt from 'bcryptjs';
import { DATA_DIR, readJSON, updateJSON } from './store.js';

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const DEFAULT_BUDGET = 1.5; // $1.50/天

export async function listAccounts() {
  return readJSON(ACCOUNTS_FILE, []);
}

export async function findAccount(username) {
  const accounts = await listAccounts();
  return accounts.find((a) => a.username === username) || null;
}

export function publicView(acc) {
  if (!acc) return null;
  const { passwordHash, ...rest } = acc;
  return rest;
}

export async function ensureAdmin(adminUser, adminPass) {
  const accounts = await listAccounts();
  if (accounts.length > 0) return;
  if (!adminUser || !adminPass) {
    console.warn('[accounts] 无账户且未配置 ADMIN_USER/ADMIN_PASS,跳过管理员创建');
    return;
  }
  await createAccount({ username: adminUser, password: adminPass, role: 'admin', dailyBudget: DEFAULT_BUDGET });
  console.log(`[accounts] 已创建管理员账号: ${adminUser}`);
}

export async function verifyPassword(username, password) {
  const acc = await findAccount(username);
  if (!acc) return null;
  const ok = await bcrypt.compare(password, acc.passwordHash);
  return ok ? acc : null;
}

export async function createAccount({ username, password, role = 'user', dailyBudget = DEFAULT_BUDGET }) {
  username = String(username || '').trim();
  if (!username) throw new Error('用户名不能为空');
  if (!password || String(password).length < 4) throw new Error('密码至少 4 位');
  const passwordHash = await bcrypt.hash(String(password), 10);
  const budget = Number.isFinite(+dailyBudget) ? Math.max(0, +Number(+dailyBudget).toFixed(2)) : DEFAULT_BUDGET;

  await updateJSON(ACCOUNTS_FILE, [], (accounts) => {
    if (accounts.some((a) => a.username === username)) throw new Error('用户名已存在');
    accounts.push({
      username, passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
      dailyBudget: budget,
      createdAt: new Date().toISOString(),
    });
    return accounts;
  });
  return publicView(await findAccount(username));
}

export async function updateAccount(username, { password, dailyBudget, role }) {
  let passwordHash;
  if (password) {
    if (String(password).length < 4) throw new Error('密码至少 4 位');
    passwordHash = await bcrypt.hash(String(password), 10);
  }
  await updateJSON(ACCOUNTS_FILE, [], (accounts) => {
    const acc = accounts.find((a) => a.username === username);
    if (!acc) throw new Error('账户不存在');
    if (passwordHash) acc.passwordHash = passwordHash;
    if (dailyBudget !== undefined && dailyBudget !== null && dailyBudget !== '') {
      acc.dailyBudget = Math.max(0, +Number(+dailyBudget).toFixed(2));
    }
    if (role && (role === 'admin' || role === 'user')) acc.role = role;
    return accounts;
  });
  return publicView(await findAccount(username));
}

export async function deleteAccount(username) {
  await updateJSON(ACCOUNTS_FILE, [], (accounts) => {
    const idx = accounts.findIndex((a) => a.username === username);
    if (idx === -1) throw new Error('账户不存在');
    if (accounts[idx].role === 'admin' && accounts.filter((a) => a.role === 'admin').length <= 1) {
      throw new Error('不能删除最后一个管理员');
    }
    accounts.splice(idx, 1);
    return accounts;
  });
}
