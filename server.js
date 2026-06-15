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
  todayStr, getSpentToday, getRemaining, canAfford, consume, getUsageByDate,
} from './src/quota.js';
import { requireLogin, requireAdmin } from './src/auth.js';
import { loadModels, getModel, generateImage } from './src/providers.js';
import { getServerStatus } from './src/platform.js';

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
    id: m.id, label: m.label, supportsEdit: m.supportsEdit, note: m.note,
    params: m.params || {}, costPerImage: m.costPerImage || 0, protocol: m.protocol,
  })));
});

// ---------- 生图(多轮完整历史) ----------
// Gemini 用 contents 历史(限最近 3 轮避免 context 爆炸)
// 非 gemini 模型:同一会话自动把上一轮输出图作为输入传回
const sessionHistories = new Map(); // gemini: {contents:[...]}
const sessionLastImage = new Map(); // 非 gemini: {buffer, mimeType}
const SESSION_HISTORY_TTL = 2 * 60 * 60 * 1000;

app.post('/api/generate', requireLogin, upload.array('refImages', 4), async (req, res) => {
  const username = req.session.user.username;
  try {
    console.log(`[GEN] ${username} model=${req.body?.model} files=${(req.files||[]).length}`);
    const acc = await findAccount(username);
    if (!acc) return res.status(401).json({ error: '账户已不存在' });

    const { model, prompt, sessionId: reqSessionId } = req.body || {};
    const modelDef = await getModel(model);
    if (!modelDef) return res.status(400).json({ error: '无效模型' });

    const estimatedCost = modelDef.costPerImage || 0.05;

    let params = {};
    try { params = JSON.parse(req.body.params || '{}'); } catch { /* ignore */ }

    if (!(await canAfford(username, acc.dailyBudget, estimatedCost))) {
      return res.status(429).json({ error: `今日额度已用完(每日 $${acc.dailyBudget}),请明天再试` });
    }

    // 收集当轮上传的参考图
    const inputImages = [];
    for (const f of req.files || []) {
      inputImages.push({ mimeType: f.mimetype || 'image/png', base64: f.buffer.toString('base64') });
    }

    const sessionId = reqSessionId || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // 多轮逻辑:按协议分别处理
    let history = [];
    if (modelDef.protocol === 'gemini') {
      // Gemini: 发送完整 contents 历史,但限制最近 3 轮(6 条 user/model)
      const full = sessionHistories.get(sessionId)?.contents || [];
      history = full.slice(-6); // 最多 3 轮
    } else {
      // 非 gemini(openai-images/imagen):无 history 支持,但同一会话自动带上一轮输出图
      if (inputImages.length === 0) {
        const lastImg = sessionLastImage.get(sessionId);
        if (lastImg) {
          inputImages.push({ mimeType: lastImg.mimeType, base64: lastImg.buffer.toString('base64') });
        }
      }
    }

    const { buffer, mimeType, usage, historyEntry } = await generateImage({
      model, prompt, inputImages, params, history,
    });

    // 更新会话缓存
    if (historyEntry && modelDef.protocol === 'gemini') {
      const prev = sessionHistories.get(sessionId)?.contents || [];
      const newContents = [...prev, historyEntry.user, historyEntry.model];
      sessionHistories.set(sessionId, { contents: newContents, updatedAt: Date.now() });
    }
    // 所有协议都保存最后一张输出图(用于非 gemini 的多轮回传)
    sessionLastImage.set(sessionId, { buffer, mimeType });

    // 计算真实成本(用 API 返回的 token 数 × ZenMux 标价)
    let realCost = estimatedCost;
    if (usage) {
      const prices = modelDef.tokenPricing || {};
      let inputTokens = 0, outputTokens = 0;
      if (modelDef.protocol === 'gemini') {
        inputTokens = usage.promptTokenCount || 0;
        outputTokens = usage.candidatesTokenCount || 0;
      } else {
        inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
        outputTokens = usage.output_tokens || usage.completion_tokens || 0;
      }
      const inputPrice = prices.input || 0;
      const outputPrice = prices.output || 0;
      if (inputPrice || outputPrice) {
        realCost = +((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000).toFixed(4);
        if (realCost < 0.001) realCost = 0.001;
      }
    }

    // 落盘
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const userDir = path.join(IMAGES_DIR, sanitize(username));
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, `${id}.png`), buffer);

    const inputRefs = [];
    for (let i = 0; i < inputImages.length; i++) {
      const refName = `${id}_input${i}.png`;
      await fs.writeFile(path.join(userDir, refName), Buffer.from(inputImages[i].base64, 'base64'));
      inputRefs.push(refName);
    }

    const meta = {
      id, sessionId, username, model, prompt, params,
      cost: realCost,
      usage: usage ? { input: usage.promptTokenCount, output: usage.candidatesTokenCount, total: usage.totalTokenCount } : null,
      inputRefs,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(meta, null, 2));
    console.log(`[GEN] ${username} OK id=${id} cost=$${realCost} tokens=${usage?.totalTokenCount || '?'}`);

    const spent = await consume(username, model, realCost);
    const remaining = await getRemaining(username, acc.dailyBudget);
    res.json({
      ok: true, id, sessionId, cost: realCost,
      imageUrl: `/api/image/${id}`,
      mimeType,
      spent: +spent.toFixed(2),
      remaining: +remaining.toFixed(2),
    });
  } catch (err) {
    console.error(`[ERR] generate ${username}:`, err.message);
    res.status(500).json({ error: err.message || '生图失败' });
  }
});

// ---------- 图片服务 ----------
app.get('/api/image/:id', requireLogin, async (req, res) => {
  const id = sanitize(req.params.id);
  const requester = req.session.user;
  const owners = requester.role === 'admin'
    ? await fs.readdir(IMAGES_DIR).catch(() => [])
    : [sanitize(requester.username)];
  for (const owner of owners) {
    const fp = path.join(IMAGES_DIR, owner, `${id}.png`);
    try {
      const buf = await fs.readFile(fp);
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `inline; filename="${id}.png"`);
      return res.send(buf);
    } catch { /* next */ }
  }
  res.status(404).json({ error: '图片不存在' });
});

// 原图下载(带 download 头)
app.get('/api/image/:id/download', requireLogin, async (req, res) => {
  const id = sanitize(req.params.id);
  const requester = req.session.user;
  const owners = requester.role === 'admin'
    ? await fs.readdir(IMAGES_DIR).catch(() => [])
    : [sanitize(requester.username)];
  for (const owner of owners) {
    const fp = path.join(IMAGES_DIR, owner, `${id}.png`);
    try {
      const buf = await fs.readFile(fp);
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `attachment; filename="${id}.png"`);
      return res.send(buf);
    } catch { /* next */ }
  }
  res.status(404).json({ error: '图片不存在' });
});

// ---------- 用户图集(gallery) ----------
app.get('/api/gallery', requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const metas = await loadUserMetas(username);
  res.json(metas.map((m) => ({
    ...m,
    imageUrl: `/api/image/${m.id}`,
    downloadUrl: `/api/image/${m.id}/download`,
    inputUrls: (m.inputRefs || []).map((r) => `/api/image/${r.replace('.png', '')}`),
  })));
});

// 用户历史(供工作台侧边栏,含 inputUrls)
app.get('/api/history', requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const metas = await loadUserMetas(username);
  res.json(metas.slice(0, 50).map((m) => ({
    ...m,
    imageUrl: `/api/image/${m.id}`,
    downloadUrl: `/api/image/${m.id}/download`,
    inputUrls: (m.inputRefs || []).map((r) => `/api/image/${r.replace('.png', '')}`),
  })));
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
  const models = await loadModels();
  const prices = models.map((m) => m.costPerImageUSD).filter((x) => Number.isFinite(x));
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const total = Object.values(usage).reduce((s, u) => s + (u.count || 0), 0);
  res.json({ date, usage, totalImages: total, estCostUSD: +(total * avg).toFixed(2), note: '成本为按各模型均价的粗略估算' });
});

app.get('/api/admin/server-status', requireLogin, requireAdmin, async (req, res) => {
  try {
    const status = await getServerStatus({ force: req.query.force === '1' });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理端:查看所有用户列表(for gallery dropdown)
app.get('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
  const accounts = await listAccounts();
  res.json(accounts.map((a) => a.username));
});

// 管理端:查看指定用户的所有记录(含输入图+会话)
app.get('/api/admin/records/:username', requireLogin, requireAdmin, async (req, res) => {
  const metas = await loadUserMetas(req.params.username);
  res.json(metas.map((m) => ({
    ...m,
    imageUrl: `/api/image/${m.id}`,
    downloadUrl: `/api/image/${m.id}/download`,
    inputUrls: (m.inputRefs || []).map((r) => `/api/image/${r.replace('.png', '')}`),
  })));
});

// 管理端:查看全部输出(跨用户汇总,分页)
app.get('/api/admin/all-records', requireLogin, requireAdmin, async (req, res) => {
  const limit = Math.min(+req.query.limit || 100, 500);
  const offset = +req.query.offset || 0;
  let dirs;
  try { dirs = await fs.readdir(IMAGES_DIR); } catch { return res.json([]); }
  let all = [];
  for (const d of dirs) {
    const metas = await loadUserMetas(d);
    all.push(...metas.map((m) => ({
      ...m,
      imageUrl: `/api/image/${m.id}`,
      downloadUrl: `/api/image/${m.id}/download`,
      inputUrls: (m.inputRefs || []).map((r) => `/api/image/${r.replace('.png', '')}`),
    })));
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

// 工具函数
function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_.@-]/g, '_');
}

async function loadUserMetas(username) {
  const userDir = path.join(IMAGES_DIR, sanitize(username));
  let files;
  try { files = await fs.readdir(userDir); } catch { return []; }
  const metas = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    if (f.includes('_input')) continue; // 跳过输入图的 json(如果有)
    try {
      const meta = JSON.parse(await fs.readFile(path.join(userDir, f), 'utf8'));
      metas.push(meta);
    } catch { /* skip corrupt */ }
  }
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

// ---------- 启动 ----------
(async () => {
  await ensureDirs();
  await ensureAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASS);
  app.listen(PORT, () => {
    console.log(`GImage 已启动: http://localhost:${PORT}`);
  });
})();
