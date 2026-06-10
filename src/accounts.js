// 账户管理:CRUD + bcrypt 密码校验。账户存于 data/accounts.json。
import path from 'path';
import bcrypt from 'bcryptjs';
import { DATA_DIR, readJSON, updateJSON } from './store.js';

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const DEFAULT_QUOTA = 10;

export async function listAccounts() {
  return readJSON(ACCOUNTS_FILE, []);
}

export async function findAccount(username) {
  const accounts = await listAccounts();
  return accounts.find((a) => a.username === username) || null;
}

/** 不含 passwordHash 的安全视图,用于返回给前端。 */
export function publicView(acc) {
  if (!acc) return null;
  const { passwordHash, ...rest } = acc;
  return rest;
}

/** 首次启动:若无任何账户,用环境变量创建管理员。 */
export async function ensureAdmin(adminUser, adminPass) {
  const accounts = await listAccounts();
  if (accounts.length > 0) return;
  if (!adminUser || !adminPass) {
    console.warn('[accounts] 无账户且未配置 ADMIN_USER/ADMIN_PASS,跳过管理员创建');
    return;
  }
  await createAccount({ username: adminUser, password: adminPass, role: 'admin', dailyQuota: DEFAULT_QUOTA });
  console.log(`[accounts] 已创建管理员账号: ${adminUser}`);
}

export async function verifyPassword(username, password) {
  const acc = await findAccount(username);
  if (!acc) return null;
  const ok = await bcrypt.compare(password, acc.passwordHash);
  return ok ? acc : null;
}

export async function createAccount({ username, password, role = 'user', dailyQuota = DEFAULT_QUOTA }) {
  username = String(username || '').trim();
  if (!username) throw new Error('用户名不能为空');
  if (!password || String(password).length < 4) throw new Error('密码至少 4 位');
  const passwordHash = await bcrypt.hash(String(password), 10);
  const quota = Number.isFinite(+dailyQuota) ? Math.max(0, Math.floor(+dailyQuota)) : DEFAULT_QUOTA;

  await updateJSON(ACCOUNTS_FILE, [], (accounts) => {
    if (accounts.some((a) => a.username === username)) throw new Error('用户名已存在');
    accounts.push({
      username,
      passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
      dailyQuota: quota,
      createdAt: new Date().toISOString(),
    });
    return accounts;
  });
  return publicView(await findAccount(username));
}

/** 更新账户:支持改密码、配额、角色。 */
export async function updateAccount(username, { password, dailyQuota, role }) {
  let passwordHash;
  if (password) {
    if (String(password).length < 4) throw new Error('密码至少 4 位');
    passwordHash = await bcrypt.hash(String(password), 10);
  }
  await updateJSON(ACCOUNTS_FILE, [], (accounts) => {
    const acc = accounts.find((a) => a.username === username);
    if (!acc) throw new Error('账户不存在');
    if (passwordHash) acc.passwordHash = passwordHash;
    if (dailyQuota !== undefined && dailyQuota !== null && dailyQuota !== '') {
      acc.dailyQuota = Math.max(0, Math.floor(+dailyQuota));
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
