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

import { ensureDirs, IMAGES_DIR, SESSIONS_DIR } from './src/store.js';
import {
  ensureAdmin, verifyPassword, publicView, findAccount,
  listAccounts, createAccount, updateAccount, deleteAccount,
} from './src/accounts.js';
import {
  todayStr, getUsedToday, getRemaining, consume, getUsageByDate,
} from './src/quota.js';
import { requireLogin, requireAdmin } from './src/auth.js';
import { loadModels, getModel, generateImage } from './src/providers.js';

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
  const remaining = await getRemaining(acc.username, acc.dailyQuota);
  res.json({
    user: { username: acc.username, role: acc.role },
    dailyQuota: acc.dailyQuota,
    used: acc.dailyQuota - remaining,
    remaining,
  });
});

// ---------- 模型列表 ----------
app.get('/api/models', requireLogin, async (req, res) => {
  const models = await loadModels();
  // 不暴露内部成本细节给普通用户(管理员另有用量页),但显示名/能力可见
  res.json(models.map((m) => ({
    id: m.id, label: m.label, supportsEdit: m.supportsEdit, note: m.note,
  })));
});

// ---------- 生图 ----------
app.post('/api/generate', requireLogin, upload.array('refImages', 4), async (req, res) => {
  const username = req.session.user.username;
  try {
    const acc = await findAccount(username);
    if (!acc) return res.status(401).json({ error: '账户已不存在' });

    const { model, prompt, prevImageId } = req.body || {};
    const modelDef = await getModel(model);
    if (!modelDef) return res.status(400).json({ error: '无效模型' });

    // 配额检查(扣减在成功之后)
    const remaining = await getRemaining(username, acc.dailyQuota);
    if (remaining <= 0) {
      return res.status(429).json({ error: '今日生图次数已用完,请明天再试' });
    }

    // 收集参考图:上传的文件 + 引用的历史图
    const inputImages = [];
    for (const f of req.files || []) {
      inputImages.push({ mimeType: f.mimetype || 'image/png', base64: f.buffer.toString('base64') });
    }
    if (prevImageId) {
      const prev = await loadUserImage(username, prevImageId);
      if (prev) inputImages.push({ mimeType: 'image/png', base64: prev.toString('base64') });
    }

    const { buffer, mimeType } = await generateImage({ model, prompt, inputImages });

    // 落盘
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const userDir = path.join(IMAGES_DIR, sanitize(username));
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, `${id}.png`), buffer);
    await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify({
      id, model, prompt, createdAt: new Date().toISOString(),
      hadInput: inputImages.length > 0,
    }, null, 2));

    // 成功后扣减配额
    const used = await consume(username);
    res.json({
      ok: true,
      id,
      imageUrl: `/api/image/${id}`,
      mimeType,
      remaining: Math.max(0, acc.dailyQuota - used),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || '生图失败' });
  }
});

// ---------- 历史 ----------
app.get('/api/history', requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const userDir = path.join(IMAGES_DIR, sanitize(username));
  try {
    const files = await fs.readdir(userDir);
    const metas = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const meta = JSON.parse(await fs.readFile(path.join(userDir, f), 'utf8'));
      metas.push({ ...meta, imageUrl: `/api/image/${meta.id}` });
    }
    metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(metas);
  } catch (err) {
    if (err.code === 'ENOENT') return res.json([]);
    res.status(500).json({ error: err.message });
  }
});

// 回传图片(仅本人或管理员)
app.get('/api/image/:id', requireLogin, async (req, res) => {
  const id = sanitize(req.params.id);
  const requester = req.session.user;
  // 先在本人目录找;管理员可跨用户找
  const owners = requester.role === 'admin'
    ? await fs.readdir(IMAGES_DIR).catch(() => [])
    : [sanitize(requester.username)];
  for (const owner of owners) {
    const fp = path.join(IMAGES_DIR, owner, `${id}.png`);
    try {
      const buf = await fs.readFile(fp);
      res.set('Content-Type', 'image/png');
      return res.send(buf);
    } catch { /* 继续找 */ }
  }
  res.status(404).json({ error: '图片不存在' });
});

// ---------- 管理端 ----------
app.get('/api/admin/accounts', requireLogin, requireAdmin, async (req, res) => {
  const accounts = await listAccounts();
  const date = todayStr();
  const withUsage = await Promise.all(accounts.map(async (a) => ({
    ...publicView(a),
    usedToday: await getUsedToday(a.username, date),
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

// 用量统计(含成本估算)
app.get('/api/admin/usage', requireLogin, requireAdmin, async (req, res) => {
  const date = req.query.date || todayStr();
  const usage = await getUsageByDate(date);
  const models = await loadModels();
  // 简单成本估算:无法精确归因到模型,按总张数 * 平均价区间给个范围
  const prices = models.map((m) => m.costPerImageUSD).filter((x) => Number.isFinite(x));
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const total = Object.values(usage).reduce((s, u) => s + (u.count || 0), 0);
  res.json({
    date,
    usage,
    totalImages: total,
    estCostUSD: +(total * avg).toFixed(2),
    note: '成本为按各模型均价的粗略估算',
  });
});

// ---------- 静态资源 ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// 工具
function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_.@-]/g, '_');
}
async function loadUserImage(username, id) {
  const fp = path.join(IMAGES_DIR, sanitize(username), `${sanitize(id)}.png`);
  try { return await fs.readFile(fp); } catch { return null; }
}

// ---------- 启动 ----------
(async () => {
  await ensureDirs();
  await ensureAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASS);
  app.listen(PORT, () => {
    console.log(`GImage 已启动: http://localhost:${PORT}`);
  });
})();
