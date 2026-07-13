// 运行时配置只写入 data/config。仓库内 config/ 是首次部署的只读种子。
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_HISTORY_DIR, ROOT, readJSON, writeJSON } from './store.js';

const names = new Set(['models', 'providers']);

function assertName(name) {
  if (!names.has(name)) throw new Error('未知配置目录');
}

export function runtimeConfigPath(name) {
  assertName(name);
  return path.join(CONFIG_DIR, `${name}.json`);
}

export async function ensureRuntimeConfig(name) {
  const target = runtimeConfigPath(name);
  try {
    await fs.access(target);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const seed = path.join(ROOT, 'config', `${name}.json`);
    try {
      await fs.copyFile(seed, target, fs.constants.COPYFILE_EXCL);
    } catch (copyErr) {
      // 多请求同时首次启动时，其中一个复制成功即可。
      if (copyErr.code !== 'EEXIST') throw copyErr;
    }
  }
  return target;
}

export async function readRuntimeConfig(name, fallback) {
  return readJSON(await ensureRuntimeConfig(name), fallback);
}

export async function writeRuntimeConfig(name, value) {
  const target = runtimeConfigPath(name);
  const previous = await readJSON(target, null);
  if (previous !== null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeJSON(path.join(CONFIG_HISTORY_DIR, name, `${timestamp}.json`), previous);
  }
  return writeJSON(target, value);
}
