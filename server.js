// GImage 入口:Express + session + 路由。
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import multer from 'multer';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
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
  reserve, finalizeReservation, releaseReservation,
} from './src/quota.js';
import { requireLogin, requireAdmin } from './src/auth.js';
import { loadModels, getModel, generateImage, submitJob, checkJob, clearModelsCache } from './src/providers.js';
import { generateMusic, preprocessMusicCover } from './src/minimax.js';
import { getServerStatus } from './src/platform.js';
import { clearProviderRegistryCache } from './src/providerRegistry.js';
import { ensureRuntimeConfig, readRuntimeConfig, runtimeConfigPath, writeRuntimeConfig } from './src/runtimeConfig.js';
import { ensureKnowledgeBundle, listKnowledge, readKnowledge, validateKnowledgeContent, writeKnowledge } from './src/knowledge.js';
import {
  sanitize, loadUserMetas, decorateMeta, extFor, resolveOwnerDir, deleteAsset,
} from './src/assets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const FileStore = FileStoreFactory(session);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
// HTTPS 由反向代理终止时显式开启；裸 HTTP 部署不能下发 upgrade-insecure-requests，
// 否则浏览器会把同源静态资源升级到不存在的 https:// 地址。
const HTTPS_HARDENING = process.env.HTTPS_HARDENING === 'true';
const CLIENT_DIR = path.join(__dirname, 'dist');

if (IS_PRODUCTION && (!SESSION_SECRET || SESSION_SECRET === 'dev-secret-change-me' || SESSION_SECRET.length < 32)) {
  throw new Error('生产环境必须设置至少 32 位的 SESSION_SECRET');
}

const app = express();
app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.use(helmet({
  crossOriginOpenerPolicy: HTTPS_HARDENING ? { policy: 'same-origin' } : false,
  strictTransportSecurity: HTTPS_HARDENING ? { maxAge: 15552000, includeSubDomains: true } : false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'blob:', 'data:'],
      'media-src': ["'self'", 'blob:', 'https://d8j0ntlcm91z4.cloudfront.net'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.cdnfonts.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.cdnfonts.com'],
      'script-src': ["'self'"],
      upgradeInsecureRequests: HTTPS_HARDENING ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 17, fields: 24, parts: 43 },
  fileFilter: (_req, file, callback) => {
    const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const audioTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/ogg']);
    if (file.fieldname === 'refImages' && imageTypes.has(file.mimetype)) return callback(null, true);
    if (file.fieldname === 'refAudio' && audioTypes.has(file.mimetype)) return callback(null, true);
    return callback(new Error('参考图仅支持 PNG、JPEG、WebP；参考音频仅支持常见音频格式'));
  },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
});
const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 80,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '生成请求过于频繁，请稍后再试' },
});

function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!IS_PRODUCTION) return next();
  const origin = req.get('origin');
  if (!origin) {
    if (IS_PRODUCTION) return res.status(403).json({ error: '缺少请求来源信息' });
    return next();
  }
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: '请求来源不被允许' });
  } catch {
    return res.status(403).json({ error: '请求来源不合法' });
  }
  return next();
}

app.use('/api', apiLimiter, requireSameOrigin);

app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, retries: 1, ttl: 7 * 24 * 3600, logFn: () => {} }),
  name: 'gimage.sid',
  secret: SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: IS_PRODUCTION, maxAge: 7 * 24 * 3600 * 1000, sameSite: 'strict' },
}));

function publicError(err, fallback = '服务暂时不可用，请稍后再试') {
  const message = String(err?.message || '');
  if (message.includes('额度') || message.includes('提示词') || message.includes('参考图') || message.includes('参考音频') || message.includes('翻唱') || message.includes('歌词') || message.includes('无效模型') || message.includes('只支持') || message.includes('参数')) return message;
  return fallback;
}

function parseParams(raw, modelDef) {
  let incoming = {};
  try { incoming = JSON.parse(raw || '{}'); } catch { throw new Error('参数格式不正确'); }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('参数格式不正确');
  const params = {};
  for (const [key, cfg] of Object.entries(modelDef.params || {})) {
    const value = incoming[key];
    if (cfg.type === 'select') {
      const finalValue = value ?? cfg.default;
      if (finalValue !== undefined && !cfg.options?.includes(finalValue)) throw new Error(`参数 ${cfg.label} 不合法`);
      if (finalValue !== undefined) params[key] = finalValue;
    } else if (cfg.type === 'boolean') {
      if (value !== undefined && typeof value !== 'boolean') throw new Error(`参数 ${cfg.label} 不合法`);
      params[key] = value ?? !!cfg.default;
    } else if (cfg.type === 'textarea') {
      if (value !== undefined && (typeof value !== 'string' || value.length > 10_000)) throw new Error(`参数 ${cfg.label} 不合法`);
      params[key] = value ?? cfg.default ?? '';
    }
  }
  return params;
}

// ---------- 认证 ----------
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  try {
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const acc = await verifyPassword(username, password);
    if (!acc) return res.status(401).json({ error: '用户名或密码错误' });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: '登录会话创建失败，请重试' });
      req.session.user = { username: acc.username, role: acc.role };
      return res.json({ ok: true, user: req.session.user });
    });
  } catch (err) {
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('gimage.sid');
    res.json({ ok: true });
  });
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
    id: m.id, label: m.label, provider: m.provider, modality: m.modality || 'image', protocol: m.protocol,
    supportsEdit: m.supportsEdit, maxRefImages: m.maxRefImages ?? 0, default: !!m.default,
    note: m.note, params: m.params || {}, costUSD: m.costUSD || 0,
  })));
});

// ---------- MiniMax 高级翻唱预处理（免费步骤，不占用每日生成额度） ----------
app.post('/api/music-cover/preprocess', requireLogin, generationLimiter, upload.single('refAudio'), async (req, res) => {
  try {
    const audio = req.file;
    if (!audio) return res.status(400).json({ error: '请上传参考音频' });
    if (audio.size > 50 * 1024 * 1024) return res.status(400).json({ error: '参考音频不能超过 50MB' });
    const result = await preprocessMusicCover(audio.buffer);
    return res.json({ ok: true, coverFeatureId: result.coverFeatureId, lyrics: result.lyrics });
  } catch (err) {
    console.error('[ERR] music cover preprocess:', err.message);
    return res.status(500).json({ error: publicError(err, '参考音频预处理失败，请稍后再试') });
  }
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

app.post('/api/generate', requireLogin, generationLimiter, upload.fields([{ name: 'refImages', maxCount: 16 }, { name: 'refAudio', maxCount: 1 }]), async (req, res) => {
  const username = req.session.user.username;
  let reservationId = null;
  let reservationDate = null;
  let keepReservation = false;
  try {
    pruneSessionMaps();
    const uploadedImages = req.files?.refImages || [];
    const referenceAudio = req.files?.refAudio?.[0] || null;
    console.log(`[GEN] ${username} model=${req.body?.model} images=${uploadedImages.length} audio=${referenceAudio ? 1 : 0}`);
    const acc = await findAccount(username);
    if (!acc) return res.status(401).json({ error: '账户已不存在' });

    const { model, prompt: promptRaw, sessionId: reqSessionId, refAssetIds: refAssetIdsRaw, coverFeatureId: coverFeatureIdRaw } = req.body || {};
    const prompt = String(promptRaw || '').trim();
    if (!prompt || prompt.length > 4_000) return res.status(400).json({ error: '提示词长度需在 1 到 4000 个字符之间' });
    if (typeof model !== 'string' || model.length > 200) return res.status(400).json({ error: '无效模型' });
    const modelDef = await getModel(model);
    if (!modelDef) return res.status(400).json({ error: '无效模型' });
    const modality = modelDef.modality || 'image';

    const estimatedCost = modelDef.costUSD || 0.05;
    const params = parseParams(req.body.params, modelDef);

    if (uploadedImages.some((file) => file.size > 15 * 1024 * 1024)) {
      return res.status(400).json({ error: '单张参考图不能超过 15MB' });
    }
    if (referenceAudio && referenceAudio.size > 50 * 1024 * 1024) {
      return res.status(400).json({ error: '参考音频不能超过 50MB' });
    }
    if (modelDef.protocol === 'minimax-cover' && !referenceAudio) {
      if (typeof coverFeatureIdRaw !== 'string' || !coverFeatureIdRaw.trim() || coverFeatureIdRaw.length > 256) {
        return res.status(400).json({ error: '翻唱模式需要上传 6 秒到 6 分钟的参考音频，或完成高级预处理' });
      }
    }
    if (modelDef.protocol !== 'minimax-cover' && (referenceAudio || coverFeatureIdRaw)) {
      return res.status(400).json({ error: '当前模型不支持参考音频' });
    }

    // 收集参考图:本次上传 + 从资产库选取(仅图片模态资产可作为参考)
    const inputImages = [];
    for (const f of uploadedImages) {
      inputImages.push({ mimeType: f.mimetype || 'image/png', base64: f.buffer.toString('base64') });
    }
    let refAssetIds = [];
    try { refAssetIds = JSON.parse(refAssetIdsRaw || '[]'); } catch { return res.status(400).json({ error: '参考图参数格式不正确' }); }
    if (!Array.isArray(refAssetIds) || refAssetIds.length > 16 || refAssetIds.some((id) => typeof id !== 'string' || id.length > 160)) {
      return res.status(400).json({ error: '参考图参数不合法' });
    }
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

    reservationId = crypto.randomUUID();
    reservationDate = todayStr();
    const reservation = await reserve(username, acc.dailyBudget, { id: reservationId, model, modality, cost: estimatedCost }, reservationDate);
    if (!reservation.ok) {
      reservationId = null;
      reservationDate = null;
      return res.status(429).json({ error: `今日额度已用完(每日 $${acc.dailyBudget}),请明天再试` });
    }

    const sessionId = typeof reqSessionId === 'string' && reqSessionId.length <= 160 ? reqSessionId : crypto.randomUUID();
    const id = crypto.randomUUID();
    const userDir = path.join(ASSETS_DIR, sanitize(username));
    await fs.mkdir(userDir, { recursive: true });

    // ---- 音乐:直连 MiniMax,同步返回 ----
    if (modality === 'music') {
      const { buffer, mimeType } = await generateMusic({
        model: modelDef.protocol === 'minimax-cover' ? 'music-cover' : 'music-2.6',
        prompt, lyrics: params.lyrics, isInstrumental: !!params.isInstrumental,
        lyricsOptimizer: !!params.lyricsOptimizer, format: params.format || 'mp3',
        referenceAudio: referenceAudio?.buffer, coverFeatureId: String(coverFeatureIdRaw || '').trim(),
      });
      const meta = {
        id, sessionId, username, model, modality, prompt, params,
        status: 'done', mimeType, cost: estimatedCost, usage: null, inputRefs: [], error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(userDir, `${id}.${extFor(meta)}`), buffer);
      await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(meta, null, 2));
      const spent = await finalizeReservation(username, reservationId, reservationDate);
      reservationId = null;
      reservationDate = null;
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
        cost: estimatedCost, reservationId, reservationDate, usage: null, inputRefs, error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(meta, null, 2));
      keepReservation = true;
      console.log(`[GEN] ${username} SUBMIT id=${id} modality=video job=${providerJobId}`);

      const spentNow = await getSpentToday(username);
      const remainingNow = await getRemaining(username, acc.dailyBudget);
      return res.json({
        ok: true, id, sessionId, modality, status: 'pending', cost: estimatedCost,
        pollUrl: `/api/jobs/${id}`,
        spent: +spentNow.toFixed(2), remaining: +remainingNow.toFixed(2),
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

    const spent = await finalizeReservation(username, reservationId, reservationDate);
    reservationId = null;
    reservationDate = null;
    const remaining = await getRemaining(username, acc.dailyBudget);
    res.json({
      ok: true, id, sessionId, modality, status: 'done', cost: estimatedCost,
      assetUrl: `/api/asset/${id}`, mimeType,
      spent: +spent.toFixed(2), remaining: +remaining.toFixed(2),
    });
  } catch (err) {
    console.error(`[ERR] generate ${username}:`, err.message);
    if (reservationId && !keepReservation) await releaseReservation(username, reservationId, reservationDate || todayStr()).catch(() => {});
    res.status(500).json({ error: publicError(err, '生成失败，请稍后再试') });
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
      if (meta.reservationId) await releaseReservation(meta.username, meta.reservationId, meta.reservationDate || todayStr());
      return res.json({ id, status: 'failed', error: result.error });
    }

    // 完成:落盘 + 结算配额(此前一直是 pending,从未扣费)
    meta = { ...meta, status: 'done', mimeType: result.mimeType, updatedAt: new Date().toISOString() };
    await fs.writeFile(path.join(ownerDir, `${id}.${extFor(meta)}`), result.buffer);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    const acc = await findAccount(meta.username);
    let spent = null, remaining = null;
    if (acc) {
      spent = meta.reservationId
        ? await finalizeReservation(meta.username, meta.reservationId, meta.reservationDate || todayStr())
        : await consume(meta.username, meta.model, meta.modality || 'video', meta.cost);
      remaining = await getRemaining(meta.username, acc.dailyBudget);
    }
    res.json({
      id, status: 'done', assetUrl: `/api/asset/${id}`, mimeType: meta.mimeType,
      spent: spent != null ? +spent.toFixed(2) : null,
      remaining: remaining != null ? +remaining.toFixed(2) : null,
    });
  } catch (err) {
    console.error('[ERR] job polling:', err.message);
    res.status(500).json({ error: publicError(err, '查询任务状态失败，请稍后再试') });
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
    console.error('[ERR] asset delete:', err.message);
    res.status(500).json({ error: '删除失败，请稍后再试' });
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
    console.error('[ERR] server status:', err.message);
    res.status(500).json({ error: '暂时无法获取上游服务状态' });
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

// ---------- 管理端：OKF + 单一 DSL 知识工作台 ----------
// Markdown 负责叙述，contracts/*.yaml 是业务流程、规则与图投影的唯一事实来源。
function catalogTitle(id) {
  return id === 'models' ? '运行时模型目录' : '运行时供应商目录';
}

function validateCatalog(id, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('目录必须是 JSON 对象');
  if (id === 'models') {
    if (!Array.isArray(value.models)) throw new Error('models 必须是数组');
    const seen = new Set();
    for (const model of value.models) {
      if (!model || typeof model !== 'object' || typeof model.id !== 'string' || !model.id || typeof model.label !== 'string' || typeof model.protocol !== 'string') {
        throw new Error('每个模型需要 id、label 和 protocol');
      }
      if (seen.has(model.id)) throw new Error(`模型 ID 重复：${model.id}`);
      seen.add(model.id);
      if (model.params !== undefined && (!model.params || typeof model.params !== 'object' || Array.isArray(model.params))) throw new Error(`模型 ${model.id} 的 params 必须是对象`);
    }
    return;
  }
  if (!value.providers || typeof value.providers !== 'object' || Array.isArray(value.providers)) throw new Error('providers 必须是对象');
  for (const [providerId, provider] of Object.entries(value.providers)) {
    if (!providerId || !provider || typeof provider !== 'object' || Array.isArray(provider)) throw new Error('供应商目录格式不正确');
    if ('apiKey' in provider || 'token' in provider || 'secret' in provider) throw new Error('供应商目录不得保存真实密钥；请引用环境变量名');
    if (provider.apiKeyEnv !== undefined && typeof provider.apiKeyEnv !== 'string') throw new Error(`供应商 ${providerId} 的 apiKeyEnv 必须是字符串`);
  }
}

async function readCatalogDocument(id) {
  if (!['models', 'providers'].includes(id)) throw new Error('目录不存在');
  const value = await readRuntimeConfig(id, id === 'models' ? { models: [] } : { providers: {} });
  const stat = await fs.stat(runtimeConfigPath(id));
  return {
    kind: 'catalog', id, title: catalogTitle(id), content: JSON.stringify(value, null, 2),
    updatedAt: stat.mtime.toISOString(), valid: true, diagnostics: [], projection: null,
  };
}

app.get('/api/admin/knowledge', requireLogin, requireAdmin, async (_req, res) => {
  try {
    const [documents, models, providers] = await Promise.all([listKnowledge(), readCatalogDocument('models'), readCatalogDocument('providers')]);
    res.json({ documents: [...documents, models, providers] });
  } catch (err) {
    console.error('[ERR] knowledge list:', err.message);
    res.status(500).json({ error: '知识工作台暂时不可用' });
  }
});

app.get('/api/admin/knowledge/:kind/:id', requireLogin, requireAdmin, async (req, res) => {
  try {
    const document = req.params.kind === 'catalog'
      ? await readCatalogDocument(req.params.id)
      : await readKnowledge(req.params.kind, req.params.id);
    res.json(document);
  } catch (err) {
    res.status(err.message.includes('不存在') ? 404 : 400).json({ error: err.message });
  }
});

app.post('/api/admin/knowledge/validate', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { kind, content } = req.body || {};
    if (typeof content !== 'string') throw new Error('content 必须是字符串');
    if (kind === 'catalog') {
      const value = JSON.parse(content);
      validateCatalog(req.body?.id, value);
      return res.json({ valid: true, diagnostics: [], projection: null });
    }
    const result = validateKnowledgeContent(kind, content);
    return res.json({ valid: result.valid, diagnostics: result.diagnostics, projection: result.projection });
  } catch (err) {
    return res.json({ valid: false, diagnostics: [{ level: 'error', path: 'document', message: err.message }], projection: null });
  }
});

app.put('/api/admin/knowledge/:kind/:id', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { content, expectedUpdatedAt } = req.body || {};
    if (typeof content !== 'string') throw new Error('content 必须是字符串');
    let document;
    if (req.params.kind === 'catalog') {
      const current = await readCatalogDocument(req.params.id);
      if (expectedUpdatedAt && expectedUpdatedAt !== current.updatedAt) throw new Error('目录已被其他修改更新，请刷新后再保存');
      const value = JSON.parse(content);
      validateCatalog(req.params.id, value);
      await writeRuntimeConfig(req.params.id, value);
      if (req.params.id === 'models') clearModelsCache();
      if (req.params.id === 'providers') clearProviderRegistryCache();
      document = await readCatalogDocument(req.params.id);
    } else {
      document = await writeKnowledge(req.params.kind, req.params.id, content, expectedUpdatedAt);
    }
    return res.json({ ok: true, document });
  } catch (err) {
    const diagnostics = err.diagnostics || [{ level: 'error', path: 'document', message: err.message }];
    return res.status(err.message.includes('其他修改') ? 409 : 400).json({ error: err.message, diagnostics });
  }
});

// ---------- 前端静态资源 ----------
// Vite 使用内容哈希资源；HTML 保持可重新验证，从而兼顾长期缓存与及时发布。
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(express.static(CLIENT_DIR, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache');
    }
  },
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(CLIENT_DIR, 'index.html'), (err) => {
    if (err && !res.headersSent) next(err);
  });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err?.message?.includes('支持') || err?.message?.includes('参考')) {
    return res.status(400).json({ error: err.message || '上传文件不合法' });
  }
  console.error('[ERR] unhandled request:', err?.message || err);
  return res.status(500).json({ error: '服务暂时不可用，请稍后再试' });
});

// ---------- 启动 ----------
(async () => {
  await ensureDirs();
  await Promise.all([ensureRuntimeConfig('models'), ensureRuntimeConfig('providers'), ensureKnowledgeBundle()]);
  await ensureAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASS);
  app.listen(PORT, () => {
    console.log(`GImage 已启动: http://localhost:${PORT}`);
  });
})();
