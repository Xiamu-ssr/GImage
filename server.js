// GImage 入口:Express + session + 路由。
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { ensureDirs, ASSETS_DIR, SESSIONS_DIR } from './src/store.js';
import {
  ensureAdmin, verifyPassword, publicView, findAccount,
  listAccounts, createAccount, updateAccount, deleteAccount,
} from './src/accounts.js';
import {
  todayStr, getSpentToday, getRemaining, getUsageByDate, consume,
} from './src/quota.js';
import { requireLogin, requireAdmin } from './src/auth.js';
import { loadModels, getModel, generateImage, submitJob, checkJob } from './src/providers.js';
import { generateMusic } from './src/minimax.js';
import { getServerStatus } from './src/platform.js';
import {
  sanitize, loadUserMetas, decorateMeta, extFor, resolveOwnerDir, getPendingCostToday, deleteAsset,
} from './src/assets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const FileStore = FileStoreFactory(session);

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, retries: 1, ttl: 7 * 24 * 3600, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000, sameSite: 'lax' },
}));

// ---------- 请求日志(生图相关) ----------
app.use('/api/login', (req, res, next) => {
  console.log(`[REQ] login attempt: ${req.body?.username || '?'}`);
  next();
});

// ---------- 认证 ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const acc = await verifyPassword(username, password);
    if (!acc) return res.status(401).json({ error: '用户名或密码错误' });
    req.session.user = { username: acc.username, role: acc.role };
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireLogin, async (req, res) => {
  const acc = await findAccount(req.session.user.username);
  if (!acc) {
    return req.session.destroy(() => res.status(401).json({ error: '账户已不存在' }));
  }
  const remaining = await getRemaining(acc.username, acc.dailyBudget);
  const spent = await getSpentToday(acc.username);
  res.json({
    user: { username: acc.username, role: acc.role },
    dailyBudget: acc.dailyBudget,
    spent: +spent.toFixed(2),
    remaining: +remaining.toFixed(2),
  });
});

// ---------- 模型列表(含参数定义) ----------
app.get('/api/models', requireLogin, async (req, res) => {
  const models = await loadModels();
  res.json(models.map((m) => ({
    id: m.id, label: m.label, modality: m.modality || 'image', protocol: m.protocol,
    supportsEdit: m.supportsEdit, maxRefImages: m.maxRefImages ?? 0, default: !!m.default,
    note: m.note, params: m.params || {}, costUSD: m.costUSD || 0,
  })));
});

// ---------- 生成(图片同步 / 视频异步任务 / 音乐同步直连 MiniMax) ----------
// Gemini 图片协议多轮:发送完整 contents 历史(限最近 3 轮避免 context 爆炸)
// 非 gemini 图片协议:同一会话自动把上一轮输出图作为输入传回
const sessionHistories = new Map(); // gemini: {contents:[...], updatedAt}
const sessionLastImage = new Map(); // 非 gemini: {buffer, mimeType, updatedAt}
const SESSION_HISTORY_TTL = 2 * 60 * 60 * 1000;

function pruneSessionMaps() {
  const cutoff = Date.now() - SESSION_HISTORY_TTL;
  for (const [sid, v] of sessionHistories) if ((v.updatedAt || 0) < cutoff) sessionHistories.delete(sid);
  for (const [sid, v] of sessionLastImage) if ((v.updatedAt || 0) < cutoff) sessionLastImage.delete(sid);
}

app.post('/api/generate', requireLogin, upload.array('refImages', 16), async (req, res) => {
  const username = req.session.user.username;
  try {
    pruneSessionMaps();
    console.log(`[GEN] ${username} model=${req.body?.model} files=${(req.files || []).length}`);
    const acc = await findAccount(username);
    if (!acc) return res.status(401).json({ error: '账户已不存在' });

    const { model, prompt, sessionId: reqSessionId, refAssetIds: refAssetIdsRaw } = req.body || {};
    const modelDef = await getModel(model);
    if (!modelDef) return res.status(400).json({ error: '无效模型' });
    const modality = modelDef.modality || 'image';

    const estimatedCost = modelDef.costUSD || 0.05;
    let params = {};
    try { params = JSON.parse(req.body.params || '{}'); } catch { /* ignore */ }

    const remaining0 = await getRemaining(username, acc.dailyBudget);
    const pendingReserved = modality === 'video' ? await getPendingCostToday(username) : 0;
    if (estimatedCost > remaining0 - pendingReserved) {
      return res.status(429).json({ error: `今日额度已用完(每日 $${acc.dailyBudget}),请明天再试` });
    }

    // 收集参考图:本次上传 + 从资产库选取(仅图片模态资产可作为参考)
    const inputImages = [];
    for (const f of req.files || []) {
      inputImages.push({ mimeType: f.mimetype || 'image/png', base64: f.buffer.toString('base64') });
    }
    let refAssetIds = [];
    try { refAssetIds = JSON.parse(refAssetIdsRaw || '[]'); } catch { /* ignore */ }
    for (const refId of refAssetIds) {
      const ownerDir = await resolveOwnerDir(refId, req.session.user);
      if (!ownerDir) continue;
      try {
        const safeRefId = sanitize(refId);
        const refMeta = JSON.parse(await fs.readFile(path.join(ownerDir, `${safeRefId}.json`), 'utf8'));
        if ((refMeta.modality || 'image') !== 'image') continue;
        const buf = await fs.readFile(path.join(ownerDir, `${safeRefId}.${extFor(refMeta)}`));
        inputImages.push({ mimeType: refMeta.mimeType || 'image/png', base64: buf.toString('base64') });
      } catch { /* skip missing/corrupt */ }
    }
    const maxRef = modelDef.maxRefImages ?? 0;
    if (inputImages.length > maxRef) {
      return res.status(400).json({ error: `该模型最多支持 ${maxRef} 张参考图` });
    }

    const sessionId = reqSessionId || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const userDir = path.join(ASSETS_DIR, sanitize(username));
    await fs.mkdir(userDir, { recursive: true });

    // ---- 音乐:直连 MiniMax,同步返回 ----
    if (modality === 'music') {
      const { buffer, mimeType } = await generateMusic({
        prompt, lyrics: params.lyrics, isInstrumental: !!params.isInstrumental, format: params.format || 'mp3',
      });
      const meta = {
        id, sessionId, username, model, modality, prompt, params,
        status: 'done', mimeType, cost: estimatedCost, usage: null, inputRefs: [], error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(userDir, `${id}.${extFor(meta)}`), buffer);
      await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(meta, null, 2));
      const spent = await consume(username, model, modality, estimatedCost);
      const remaining = await getRemaining(username, acc.dailyBudget);
      console.log(`[GEN] ${username} OK id=${id} modality=music cost=$${estimatedCost}`);
      return res.json({
        ok: true, id, sessionId, modality, status: 'done', cost: estimatedCost,
        assetUrl: `/api/asset/${id}`, mimeType,
        spent: +spent.toFixed(2), remaining: +remaining.toFixed(2),
      });
    }

    // ---- 视频:提交异步任务,前端轮询 /api/jobs/:id,完成后才扣费 ----
    if (modality === 'video') {
      const { providerJobId, providerSurface } = await submitJob({ model, prompt, inputImages, params });
      const inputRefs = [];
      for (let i = 0; i < inputImages.length; i++) {
        const refName = `${id}_input${i}.png`;
        await fs.writeFile(path.join(userDir, refName), Buffer.from(inputImages[i].base64, 'base64'));
        inputRefs.push(refName);
      }
      const meta = {
        id, sessionId, username, model, modality, prompt, params,
        status: 'pending', providerJobId, providerSurface,
        cost: estimatedCost, usage: null, inputRefs, error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(meta, null, 2));
      console.log(`[GEN] ${username} SUBMIT id=${id} modality=video job=${providerJobId}`);

      const spentNow = await getSpentToday(username);
      const remainingNow = await getRemaining(username, acc.dailyBudget);
      const pendingNow = await getPendingCostToday(username); // 含本次刚写入的任务
      return res.json({
        ok: true, id, sessionId, modality, status: 'pending', cost: estimatedCost,
        pollUrl: `/api/jobs/${id}`,
        spent: +spentNow.toFixed(2), remaining: +Math.max(0, remainingNow - pendingNow).toFixed(2),
      });
    }

    // ---- 图片:原有同步逻辑 ----
    let history = [];
    if (modelDef.protocol === 'gemini') {
      const full = sessionHistories.get(sessionId)?.contents || [];
      history = full.slice(-6); // 最多 3 轮
    } else if (inputImages.length === 0) {
      // 非 gemini(openai-images/imagen):无 history 支持,但同一会话自动带上一轮输出图
      const lastImg = sessionLastImage.get(sessionId);
      if (lastImg) inputImages.push({ mimeType: lastImg.mimeType, base64: lastImg.buffer.toString('base64') });
    }

    const { buffer, mimeType, usage, historyEntry } = await generateImage({ model, prompt, inputImages, params, history });

    if (historyEntry && modelDef.protocol === 'gemini') {
      const prev = sessionHistories.get(sessionId)?.contents || [];
      const newContents = [...prev, historyEntry.user, historyEntry.model].slice(-6);
      sessionHistories.set(sessionId, { contents: newContents, updatedAt: Date.now() });
    }
    sessionLastImage.set(sessionId, { buffer, mimeType, updatedAt: Date.now() });

    const meta = {
      id, sessionId, username, model, modality, prompt, params,
      status: 'done', mimeType, cost: estimatedCost,
      usage: usage ? { input: usage.promptTokenCount, output: usage.candidatesTokenCount, total: usage.totalTokenCount } : null,
      inputRefs: [], error: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(userDir, `${id}.${extFor(meta)}`), buffer);
    for (let i = 0; i < inputImages.length; i++) {
      const refName = `${id}_input${i}.png`;
      await fs.writeFile(path.join(userDir, refName), Buffer.from(inputImages[i].base64, 'base64'));
      meta.inputRefs.push(refName);
    }
    await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(meta, null, 2));
    console.log(`[GEN] ${username} OK id=${id} modality=image cost=$${estimatedCost} tokens=${usage?.totalTokenCount || '?'}`);

    const spent = await consume(username, model, modality, estimatedCost);
    const remaining = await getRemaining(username, acc.dailyBudget);
    res.json({
      ok: true, id, sessionId, modality, status: 'done', cost: estimatedCost,
      assetUrl: `/api/asset/${id}`, mimeType,
      spent: +spent.toFixed(2), remaining: +remaining.toFixed(2),
    });
  } catch (err) {
    console.error(`[ERR] generate ${username}:`, err.message);
    res.status(500).json({ error: err.message || '生成失败' });
  }
});

// ---------- 视频任务轮询 ----------
const JOB_POLL_MIN_INTERVAL_MS = 3000;

app.get('/api/jobs/:id', requireLogin, async (req, res) => {
  const id = sanitize(req.params.id);
  const requester = req.session.user;
  try {
    const ownerDir = await resolveOwnerDir(id, requester);
    if (!ownerDir) return res.status(404).json({ error: '任务不存在' });
    const metaPath = path.join(ownerDir, `${id}.json`);
    let meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

    if (meta.status === 'done' || meta.status === 'failed') {
      return res.json({
        id, status: meta.status, error: meta.error || null,
        assetUrl: meta.status === 'done' ? `/api/asset/${id}` : null,
        mimeType: meta.mimeType || null,
      });
    }

    // 防止前端轮询过于频繁时对上游发起过多请求:未到最小间隔直接回缓存状态
    const lastCheck = new Date(meta.updatedAt || meta.createdAt).getTime();
    if (Date.now() - lastCheck < JOB_POLL_MIN_INTERVAL_MS) {
      return res.json({ id, status: meta.status });
    }

    const result = await checkJob({ model: meta.model, providerJobId: meta.providerJobId, providerSurface: meta.providerSurface });

    if (result.status === 'processing') {
      meta.updatedAt = new Date().toISOString();
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
      return res.json({ id, status: 'processing' });
    }
    if (result.status === 'failed') {
      meta = { ...meta, status: 'failed', error: result.error, updatedAt: new Date().toISOString() };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
      return res.json({ id, status: 'failed', error: result.error });
    }

    // 完成:落盘 + 结算配额(此前一直是 pending,从未扣费)
    meta = { ...meta, status: 'done', mimeType: result.mimeType, updatedAt: new Date().toISOString() };
    await fs.writeFile(path.join(ownerDir, `${id}.${extFor(meta)}`), result.buffer);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    const acc = await findAccount(meta.username);
    let spent = null, remaining = null;
    if (acc) {
      spent = await consume(meta.username, meta.model, meta.modality || 'video', meta.cost);
      remaining = await getRemaining(meta.username, acc.dailyBudget);
    }
    res.json({
      id, status: 'done', assetUrl: `/api/asset/${id}`, mimeType: meta.mimeType,
      spent: spent != null ? +spent.toFixed(2) : null,
      remaining: remaining != null ? +remaining.toFixed(2) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || '查询任务状态失败' });
  }
});

// ---------- 资产服务(图片/视频/音乐统一) ----------
async function serveAsset(req, res, { download }) {
  const id = sanitize(req.params.id);
  const requester = req.session.user;

  // 参考图伪资产(<id>_input<N>),没有独立 json,恒为 png
  if (id.includes('_input')) {
    const owners = requester.role === 'admin' ? await fs.readdir(ASSETS_DIR).catch(() => []) : [sanitize(requester.username)];
    for (const owner of owners) {
      const fp = path.join(ASSETS_DIR, owner, `${id}.png`);
      try {
        await fs.access(fp);
        res.set('Content-Type', 'image/png');
        res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${id}.png"`);
        return res.sendFile(fp);
      } catch { /* try next owner */ }
    }
    return res.status(404).json({ error: '参考图不存在' });
  }

  const ownerDir = await resolveOwnerDir(id, requester);
  if (!ownerDir) return res.status(404).json({ error: '资源不存在' });
  let meta;
  try { meta = JSON.parse(await fs.readFile(path.join(ownerDir, `${id}.json`), 'utf8')); }
  catch { return res.status(404).json({ error: '资源不存在' }); }
  if (meta.status && meta.status !== 'done') {
    return res.status(409).json({ error: '资源尚未生成完成', status: meta.status });
  }
  const ext = extFor(meta);
  const fp = path.join(ownerDir, `${id}.${ext}`);
  res.set('Content-Type', meta.mimeType || 'image/png');
  res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${id}.${ext}"`);
  res.sendFile(fp, (err) => { if (err && !res.headersSent) res.status(404).json({ error: '文件不存在' }); });
}

app.get('/api/asset/:id', requireLogin, (req, res) => serveAsset(req, res, { download: false }));
app.get('/api/asset/:id/download', requireLogin, (req, res) => serveAsset(req, res, { download: true }));

app.delete('/api/asset/:id', requireLogin, async (req, res) => {
  const id = sanitize(req.params.id);
  try {
    const ownerDir = await resolveOwnerDir(id, req.session.user);
    if (!ownerDir) return res.status(404).json({ error: '资源不存在' });
    const meta = JSON.parse(await fs.readFile(path.join(ownerDir, `${id}.json`), 'utf8'));
    await deleteAsset(ownerDir, meta);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || '删除失败' });
  }
});

// ---------- 用户资产库 ----------
app.get('/api/assets', requireLogin, async (req, res) => {
  const metas = await loadUserMetas(req.session.user.username);
  res.json(metas.map(decorateMeta));
});

// 用户历史(供工作台侧边栏,含 inputUrls)
app.get('/api/history', requireLogin, async (req, res) => {
  const metas = await loadUserMetas(req.session.user.username);
  res.json(metas.slice(0, 50).map(decorateMeta));
});

// ---------- 管理端 ----------
app.get('/api/admin/accounts', requireLogin, requireAdmin, async (req, res) => {
  const accounts = await listAccounts();
  const date = todayStr();
  const withUsage = await Promise.all(accounts.map(async (a) => ({
    ...publicView(a),
    spentToday: +(await getSpentToday(a.username, date)).toFixed(2),
  })));
  res.json(withUsage);
});

app.post('/api/admin/accounts', requireLogin, requireAdmin, async (req, res) => {
  try {
    const acc = await createAccount(req.body || {});
    res.json({ ok: true, account: acc });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/accounts/:username', requireLogin, requireAdmin, async (req, res) => {
  try {
    const acc = await updateAccount(req.params.username, req.body || {});
    res.json({ ok: true, account: acc });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/accounts/:username', requireLogin, requireAdmin, async (req, res) => {
  try {
    await deleteAccount(req.params.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/usage', requireLogin, requireAdmin, async (req, res) => {
  const date = req.query.date || todayStr();
  const usage = await getUsageByDate(date);
  let totalCount = 0;
  let totalSpentUSD = 0;
  const byModality = { image: { count: 0, spentUSD: 0 }, video: { count: 0, spentUSD: 0 }, music: { count: 0, spentUSD: 0 } };
  for (const u of Object.values(usage)) {
    totalCount += u.count || 0;
    totalSpentUSD += u.spent || 0;
    for (const h of u.history || []) {
      const mod = h.modality || 'image';
      if (!byModality[mod]) byModality[mod] = { count: 0, spentUSD: 0 };
      byModality[mod].count += 1;
      byModality[mod].spentUSD += h.cost || 0;
    }
  }
  for (const k of Object.keys(byModality)) byModality[k].spentUSD = +byModality[k].spentUSD.toFixed(2);
  res.json({ date, usage, totalCount, totalSpentUSD: +totalSpentUSD.toFixed(2), byModality });
});

app.get('/api/admin/server-status', requireLogin, requireAdmin, async (req, res) => {
  try {
    const status = await getServerStatus({ force: req.query.force === '1' });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理端:查看所有用户列表(for 资产库用户下拉)
app.get('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
  const accounts = await listAccounts();
  res.json(accounts.map((a) => a.username));
});

// 管理端:查看指定用户的所有记录(含输入图+会话)
app.get('/api/admin/records/:username', requireLogin, requireAdmin, async (req, res) => {
  const metas = await loadUserMetas(req.params.username);
  res.json(metas.map(decorateMeta));
});

// 管理端:查看全部输出(跨用户汇总,分页)
app.get('/api/admin/all-records', requireLogin, requireAdmin, async (req, res) => {
  const limit = Math.min(+req.query.limit || 100, 500);
  const offset = +req.query.offset || 0;
  let dirs;
  try { dirs = await fs.readdir(ASSETS_DIR); } catch { return res.json({ total: 0, records: [] }); }
  let all = [];
  for (const d of dirs) {
    const metas = await loadUserMetas(d);
    all.push(...metas.map(decorateMeta));
  }
  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ total: all.length, records: all.slice(offset, offset + limit) });
});

// ---------- 静态资源(禁止缓存 html/js,保证更新即时生效) ----------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ---------- 启动 ----------
(async () => {
  await ensureDirs();
  await ensureAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASS);
  app.listen(PORT, () => {
    console.log(`GImage 已启动: http://localhost:${PORT}`);
  });
})();
