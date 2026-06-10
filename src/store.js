// 本地 JSON 存储:所有写操作经过串行队列,避免单进程下的并发写损坏。
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const USAGE_DIR = path.join(DATA_DIR, 'usage');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

// 写队列:每个文件路径一条 Promise 链,保证同一文件的写入串行执行。
const writeChains = new Map();

export async function ensureDirs() {
  for (const dir of [DATA_DIR, IMAGES_DIR, USAGE_DIR, SESSIONS_DIR]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/** 读取 JSON 文件;不存在时返回 fallback。 */
export async function readJSON(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/** 原子写 JSON:先写临时文件再 rename,经串行队列防并发。 */
export async function writeJSON(filePath, data) {
  const prev = writeChains.get(filePath) || Promise.resolve();
  const next = prev
    .catch(() => {}) // 前一次失败不阻断后续
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, filePath);
    });
  writeChains.set(filePath, next);
  return next;
}

/**
 * 对某文件做「读-改-写」的串行更新,避免读写竞态。
 * mutator(current) 返回要写入的新值;并把该返回值传回调用方。
 */
export async function updateJSON(filePath, fallback, mutator) {
  const prev = writeChains.get(filePath) || Promise.resolve();
  let result;
  const next = prev
    .catch(() => {})
    .then(async () => {
      const current = await readJSON(filePath, fallback);
      const updated = await mutator(current);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
      await fs.rename(tmp, filePath);
      result = updated;
    });
  writeChains.set(filePath, next);
  await next;
  return result;
}
