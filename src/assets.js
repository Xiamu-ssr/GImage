// 资产(图片/视频/音乐)元数据的共用读写逻辑,server.js 的各路由都经这里。
import fs from 'fs/promises';
import path from 'path';
import { ASSETS_DIR } from './store.js';

export function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_.@-]/g, '_');
}

/** 根据 mimeType 选择落盘/读取用的文件扩展名;旧数据没有 mimeType 字段,一律是 png。 */
export function extFor(meta) {
  switch (meta.mimeType) {
    case 'video/mp4': return 'mp4';
    case 'audio/wav': return 'wav';
    case 'audio/mpeg': return 'mp3';
    default: return 'png';
  }
}

export async function loadUserMetas(username) {
  const userDir = path.join(ASSETS_DIR, sanitize(username));
  let files;
  try { files = await fs.readdir(userDir); } catch { return []; }
  const metas = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    if (f.includes('_input')) continue; // 跳过参考图的伪文件(没有独立 json)
    try {
      const meta = JSON.parse(await fs.readFile(path.join(userDir, f), 'utf8'));
      metas.push(meta);
    } catch { /* skip corrupt */ }
  }
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

/** 补齐对外字段:assetUrl/downloadUrl/inputUrls,并为旧记录填充 modality/status 默认值。 */
export function decorateMeta(m) {
  return {
    ...m,
    modality: m.modality || 'image',
    status: m.status || 'done',
    assetUrl: `/api/asset/${m.id}`,
    downloadUrl: `/api/asset/${m.id}/download`,
    inputUrls: (m.inputRefs || []).map((r) => `/api/asset/${r.replace(/\.\w+$/, '')}`),
  };
}

/** 找到某个资产 id 所属的用户目录;admin 可跨用户查找,普通用户只能查自己。 */
export async function resolveOwnerDir(id, requester) {
  const safeId = sanitize(id);
  const owners = requester.role === 'admin'
    ? await fs.readdir(ASSETS_DIR).catch(() => [])
    : [sanitize(requester.username)];
  for (const owner of owners) {
    const dir = path.join(ASSETS_DIR, owner);
    try {
      await fs.access(path.join(dir, `${safeId}.json`));
      return dir;
    } catch { /* try next */ }
  }
  return null;
}

/** 该用户今天所有「未结算」(pending/processing)任务的预估成本之和,用于视频任务的额度预扣检查。 */
export async function getPendingCostToday(username) {
  const metas = await loadUserMetas(username);
  return metas
    .filter((m) => m.status === 'pending' || m.status === 'processing')
    .reduce((sum, m) => sum + (m.cost || 0), 0);
}

export async function deleteAsset(ownerDir, meta) {
  const ext = extFor(meta);
  await fs.rm(path.join(ownerDir, `${meta.id}.${ext}`), { force: true });
  await fs.rm(path.join(ownerDir, `${meta.id}.json`), { force: true });
  for (const ref of meta.inputRefs || []) {
    await fs.rm(path.join(ownerDir, ref), { force: true });
  }
}
