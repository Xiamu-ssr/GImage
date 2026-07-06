import { $, esc, on } from './shared/dom.js';
import { api, apiJson } from './shared/api.js';
import { fmtTime, modelShort, paramStr, statusLabel } from './shared/format.js';
import { openLightbox } from './shared/lightbox.js';
import { loadMe, wireLogout } from './shared/user.js';

let models = [];
let currentModality = 'image';
let selectedModelId = null;
let pendingRefs = []; // [{kind:'file', file}] | [{kind:'asset', id, url}]
let currentSessionId = null;
let history = [];
let libraryAssets = null; // 懒加载缓存:资产库中的图片(供参考图选择器使用)

const QUICK_PROMPTS = {
  image: ['一只在雪地里奔跑的柯基,电影感光影,浅景深', '赛博朋克风格的城市夜景,霓虹灯反光,下雨天', '极简主义产品摄影,纯白背景,柔和阴影'],
  video: ['海浪拍打礁石,慢镜头,阳光洒在水面上', '宇航员在火星表面行走,红色沙尘,广角镜头', '一朵花从含苞到盛开,延时摄影'],
  music: ['轻快的城市流行乐,适合咖啡馆播放', '史诗感的电影配乐,恢弘的管弦乐团', '安静的钢琴独奏曲,适合深夜聆听'],
};
const MODE_TITLE = { image: '图片生成', video: '视频生成', music: '音乐生成' };
const MODE_ICON = { image: '🖼️', video: '🎬', music: '🎵' };

// ---- Init ----
async function init() {
  const me = await loadMe();
  $('who').textContent = me.user.username;
  $('whoAvatar').textContent = me.user.username.slice(0, 1).toUpperCase();
  $('whoAvatar').title = me.user.username;
  $('remaining').textContent = `$${me.remaining}`;
  $('quota').textContent = `$${me.dailyBudget}`;

  models = await apiJson('/api/models');
  await loadSessions();
  switchModality('image');
}

// ---- Modality ----
function modelsForModality(mod) { return models.filter((m) => m.modality === mod); }
function currentModel() { return models.find((m) => m.id === selectedModelId); }
function currentModelMaxRef() { return currentModel()?.maxRefImages ?? 0; }

function switchModality(mod, { resetChat = true } = {}) {
  currentModality = mod;
  $('modeBtn').innerHTML = `${MODE_ICON[mod]} ${esc(MODE_TITLE[mod])} <span class="care">⌵</span>`;
  renderModeDropdown();
  const list = modelsForModality(mod);
  const def = list.find((m) => m.default) || list[0];
  selectModel(def?.id);
  updatePlaceholder();
  if (resetChat) newChat();
}

function renderModeDropdown() {
  $('modeDropdown').innerHTML = '<div class="dd-title">创作类型</div>' + Object.keys(MODE_TITLE).map((mod) =>
    `<div class="mode-opt${mod === currentModality ? ' active' : ''}" data-mode="${mod}">
      <span>${MODE_ICON[mod]} ${esc(MODE_TITLE[mod])}</span>${mod === currentModality ? '<span class="check">✓</span>' : ''}
    </div>`
  ).join('');
}
on($('modeDropdown'), 'click', '.mode-opt', (e, el) => { e.stopPropagation(); switchModality(el.dataset.mode); closeModeDropdown(); });
function closeModeDropdown() { $('modeDropdown').classList.remove('open'); }
$('modeBtn').addEventListener('click', (e) => { e.stopPropagation(); closeDropdown(); $('modeDropdown').classList.toggle('open'); });
document.addEventListener('click', closeModeDropdown);

function updatePlaceholder() {
  const ph = { image: '描述你想要的画面…', video: '描述你想要的视频画面与运镜…', music: '描述音乐风格、情绪、场景…' }[currentModality];
  $('prompt').placeholder = ph;
}

// ---- Model selector (dropdown with prices) ----
function selectModel(id) {
  selectedModelId = id;
  $('model').value = id || '';
  const m = currentModel();
  if (m) $('modelBtn').innerHTML = `<span>${esc(m.label)}</span> <span style="color:var(--accent);margin-left:auto">$${m.costUSD ?? '?'}</span>`;
  renderDropdown();
  renderParams();
  renderExtraFields();
  renderModelHint(m);
  updateAttachVisibility();
  closeDropdown();
}

function renderModelHint(m) {
  let hint = '';
  if (!m) hint = '';
  else if (m.modality === 'video') hint = '异步任务,生成需要一些时间';
  else if (m.modality === 'music') hint = '直接生成,不支持多轮修改';
  else if (m.supportsEdit === false) hint = '仅单轮生图';
  else if (m.protocol === 'gemini') hint = '支持多轮对话编辑';
  else if (m.protocol === 'openai-images') hint = '多轮基于上一张图';
  $('modelHint').textContent = hint;
}

function renderDropdown() {
  $('modelDropdown').innerHTML = modelsForModality(currentModality).map((m) =>
    `<div class="model-opt${m.id === selectedModelId ? ' active' : ''}" data-id="${m.id}">
      <div>
        <div class="m-name">${esc(m.label)}</div>
        <div class="m-note">${esc(m.note || '')}</div>
      </div>
      <div class="m-price">$${m.costUSD ?? '?'}</div>
    </div>`
  ).join('');
}
on($('modelDropdown'), 'click', '.model-opt', (e, el) => { e.stopPropagation(); selectModel(el.dataset.id); });

function closeDropdown() { $('modelDropdown').classList.remove('open'); }
$('modelBtn').addEventListener('click', (e) => { e.stopPropagation(); closeModeDropdown(); $('modelDropdown').classList.toggle('open'); });
document.addEventListener('click', closeDropdown);

// ---- Params (select / boolean 显示为紧凑 chip;textarea 单独占一行) ----
function renderParams() {
  const m = currentModel();
  const bar = $('paramsBar');
  bar.innerHTML = '';
  if (!m?.params) return;
  for (const [key, cfg] of Object.entries(m.params)) {
    const chip = document.createElement('span');
    chip.className = 'param-chip';
    if (cfg.type === 'select') {
      chip.innerHTML = `${esc(cfg.label)} <select data-param-key="${key}" class="model-param">${cfg.options.map((o) =>
        `<option value="${o}"${o === cfg.default ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      bar.appendChild(chip);
    } else if (cfg.type === 'boolean') {
      chip.innerHTML = `<label><input type="checkbox" data-param-key="${key}" data-type="boolean" class="model-param"${cfg.default ? ' checked' : ''}/> ${esc(cfg.label)}</label>`;
      bar.appendChild(chip);
    }
  }
}

function renderExtraFields() {
  const m = currentModel();
  const box = $('extraFields');
  box.innerHTML = '';
  const textareaEntries = Object.entries(m?.params || {}).filter(([, cfg]) => cfg.type === 'textarea');
  box.style.display = textareaEntries.length ? 'flex' : 'none';
  for (const [key, cfg] of textareaEntries) {
    const wrap = document.createElement('div');
    wrap.className = 'extra-field';
    wrap.innerHTML = `<label>${esc(cfg.label)}</label><textarea data-param-key="${key}" class="model-param" rows="3" placeholder="不填则由模型自动生成"></textarea>`;
    box.appendChild(wrap);
  }
}

function collectParams() {
  const p = {};
  document.querySelectorAll('.model-param').forEach((el) => {
    p[el.dataset.paramKey] = el.dataset.type === 'boolean' ? el.checked : el.value;
  });
  return p;
}

// ---- Refs:本地上传 + 从资产库选择 ----
function renderRefs() {
  $('refPreview').innerHTML = pendingRefs.map((r, i) => {
    const url = r.kind === 'file' ? URL.createObjectURL(r.file) : r.url;
    return `<span class="chip"><img src="${url}"/><span class="x" data-i="${i}">✕</span></span>`;
  }).join('');
}
on($('refPreview'), 'click', '.x', (e, el) => { pendingRefs.splice(+el.dataset.i, 1); renderRefs(); });

function updateAttachVisibility() {
  $('attachBtn').style.display = currentModelMaxRef() > 0 ? '' : 'none';
}

$('attachBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAttachMenu(); });

function toggleAttachMenu() {
  const existing = document.getElementById('attachMenu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.id = 'attachMenu';
  menu.className = 'attach-menu';
  menu.innerHTML = `
    <div class="attach-opt" data-action="upload">📁 本地上传</div>
    <div class="attach-opt" data-action="library">🖼️ 从资产库选择</div>`;
  document.querySelector('.input-inner').appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeAttachMenuOnce), 0);
}
function closeAttachMenuOnce(ev) {
  const menu = document.getElementById('attachMenu');
  if (menu && !menu.contains(ev.target) && ev.target.id !== 'attachBtn') {
    menu.remove();
    document.removeEventListener('click', closeAttachMenuOnce);
  }
}
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.attach-opt');
  if (!opt) return;
  if (opt.dataset.action === 'upload') $('refFile').click();
  if (opt.dataset.action === 'library') openLibraryPicker();
  document.getElementById('attachMenu')?.remove();
});

$('refFile').addEventListener('change', (e) => {
  const max = currentModelMaxRef();
  for (const f of e.target.files) {
    if (pendingRefs.length >= max) { showError(`该模型最多支持 ${max} 张参考图`); break; }
    pendingRefs.push({ kind: 'file', file: f });
  }
  e.target.value = '';
  renderRefs();
});

async function ensureLibraryAssets() {
  if (libraryAssets) return libraryAssets;
  const all = await apiJson('/api/assets');
  libraryAssets = all.filter((a) => a.modality === 'image' && a.status === 'done');
  return libraryAssets;
}

async function openLibraryPicker() {
  const remaining = currentModelMaxRef() - pendingRefs.length;
  if (remaining <= 0) { showError(`该模型最多支持 ${currentModelMaxRef()} 张参考图`); return; }
  const assets = await ensureLibraryAssets();
  const selected = new Set();
  const modal = document.createElement('div');
  modal.className = 'picker-modal';
  modal.innerHTML = `
    <div class="picker-box">
      <div class="picker-head">
        <span>从资产库选择参考图(最多 ${remaining} 张)</span>
        <span class="close" data-action="close">&times;</span>
      </div>
      <div class="picker-grid">
        ${assets.length ? assets.map((a) => `<div class="picker-item" data-id="${a.id}"><img src="${a.assetUrl}" /></div>`).join('')
          : '<span class="muted">资产库暂无图片,可先在工作台生成或上传</span>'}
      </div>
      <div class="picker-foot">
        <span class="muted" data-role="count">已选 0/${remaining}</span>
        <button data-action="confirm">添加</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    const item = e.target.closest('.picker-item');
    if (item) {
      const id = item.dataset.id;
      if (selected.has(id)) { selected.delete(id); item.classList.remove('picked'); }
      else if (selected.size < remaining) { selected.add(id); item.classList.add('picked'); }
      modal.querySelector('[data-role="count"]').textContent = `已选 ${selected.size}/${remaining}`;
      return;
    }
    if (e.target.dataset.action === 'close' || e.target === modal) { modal.remove(); return; }
    if (e.target.dataset.action === 'confirm') {
      for (const id of selected) {
        const a = assets.find((x) => x.id === id);
        if (a) pendingRefs.push({ kind: 'asset', id: a.id, url: a.assetUrl });
      }
      renderRefs();
      modal.remove();
    }
  });
}

// ---- Chat messages ----
function addMsg(type, contentHTML, bubbleId) {
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  if (bubbleId) el.dataset.bubbleId = bubbleId;
  const avatar = type === 'ai' ? '✦' : '⧫';
  el.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble">${contentHTML}</div>`;
  $('chatBody').appendChild(el);
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  return el;
}

function addUserMsg(prompt, refUrls) {
  let content = '';
  if (refUrls?.length) content += `<div class="ref-imgs">${refUrls.map((u) => `<img src="${u}"/>`).join('')}</div>`;
  content += esc(prompt);
  addMsg('user', content);
}

function renderMediaHTML(item) {
  const modelDef = models.find((x) => x.id === item.model);
  const paramText = paramStr(item.params);
  const costStr = item.cost ? ` · $${item.cost}` : '';
  const metaLine = `<div class="meta">${esc(modelShort(item.model))}${paramText ? ' · ' + esc(paramText) : ''}${costStr}</div>`;

  let media;
  if (item.status === 'pending' || item.status === 'processing') {
    media = `<div class="job-pending"><span class="spinner sm"></span><span>${statusLabel(item.status)}…</span></div>`;
  } else if (item.status === 'failed') {
    media = `<div class="job-failed">✕ 生成失败${item.error ? ':' + esc(item.error) : ''}</div>`;
  } else if (item.modality === 'video') {
    media = `<video src="${item.assetUrl}" controls data-lightbox="video"></video>`;
  } else if (item.modality === 'music') {
    media = `<audio src="${item.assetUrl}" controls></audio>`;
  } else {
    media = `<img src="${item.assetUrl}" data-lightbox="image" />`;
  }

  const showContinue = item.modality === 'image' && modelDef?.supportsEdit !== false;
  const actions = item.status === 'done' ? `
    <div class="img-actions">
      ${showContinue ? `<button class="ghost sm" data-action="continue">继续修改</button>` : ''}
      <a href="${item.downloadUrl || `/api/asset/${item.id}/download`}" class="btn ghost sm" download>下载</a>
    </div>` : '';

  return `${media}${metaLine}${actions}`;
}

on($('chatBody'), 'click', '[data-lightbox]', (e, el) => openLightbox(el.getAttribute('src'), el.dataset.lightbox));
on($('chatBody'), 'click', '[data-action="continue"]', () => {
  $('prompt').focus();
  $('prompt').placeholder = '基于上一张图继续修改…';
});

function addAiTyping() {
  const el = addMsg('ai', '<div class="typing"><span></span><span></span><span></span></div>');
  el.id = 'typing';
  return el;
}

// ---- Job polling(视频异步任务) ----
function pollJob(id, pollUrl, bubbleEl, ctx) {
  const tick = async () => {
    if (!document.body.contains(bubbleEl)) return; // 会话已切走,气泡不在了,停止轮询
    let data;
    try { data = await apiJson(pollUrl); } catch { setTimeout(tick, 5000); return; }
    if (data.status === 'pending' || data.status === 'processing') { setTimeout(tick, 4000); return; }
    const item = { id, modality: 'video', status: data.status, assetUrl: data.assetUrl, mimeType: data.mimeType, error: data.error, ...ctx };
    const body = bubbleEl.querySelector('.bubble');
    if (body) body.innerHTML = renderMediaHTML(item);
    if (data.remaining != null) $('remaining').textContent = `$${data.remaining}`;
    loadSessions().catch(() => {});
  };
  setTimeout(tick, 4000);
}

// ---- Generate ----
async function generate() {
  $('err').textContent = '';
  const prompt = $('prompt').value.trim();
  if (!prompt) return;

  const welcome = $('chatBody').querySelector('.welcome');
  if (welcome) welcome.remove();

  const refUrls = pendingRefs.map((r) => r.kind === 'file' ? URL.createObjectURL(r.file) : r.url);
  addUserMsg(prompt, refUrls);

  const model = selectedModelId;
  const params = collectParams();

  const fd = new FormData();
  fd.append('model', model);
  fd.append('prompt', prompt);
  fd.append('params', JSON.stringify(params));
  if (currentSessionId) fd.append('sessionId', currentSessionId);
  const assetRefIds = pendingRefs.filter((r) => r.kind === 'asset').map((r) => r.id);
  if (assetRefIds.length) fd.append('refAssetIds', JSON.stringify(assetRefIds));
  for (const r of pendingRefs) { if (r.kind === 'file') fd.append('refImages', r.file); }

  $('prompt').value = '';
  $('prompt').style.height = 'auto';
  pendingRefs = [];
  renderRefs();
  $('genBtn').disabled = true;

  const typing = addAiTyping();
  try {
    const r = await api('/api/generate', { method: 'POST', body: fd });
    const data = await r.json();
    typing.remove();
    if (!r.ok) { showError(data.error || '生成失败'); return; }

    currentSessionId = data.sessionId;
    $('remaining').textContent = `$${data.remaining}`;

    const item = { id: data.id, modality: data.modality, status: data.status, assetUrl: data.assetUrl, mimeType: data.mimeType, model, params, cost: data.cost };
    const bubble = addMsg('ai', renderMediaHTML(item), data.id);
    if (data.status === 'pending') pollJob(data.id, data.pollUrl, bubble, { model, params, cost: data.cost });
    await loadSessions();
  } catch (e) {
    typing.remove();
    showError(e.message || '网络错误');
  } finally {
    $('genBtn').disabled = false;
    $('prompt').focus();
  }
}

function showError(msg) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---- Welcome / quick prompts ----
function renderWelcome() {
  const prompts = QUICK_PROMPTS[currentModality] || [];
  // 音乐没有可展示的画面,只在图片/视频模式下用真实历史生成内容填充「最近创作」
  const recents = currentModality === 'music' ? [] :
    history.filter((h) => h.modality === currentModality && h.status === 'done').slice(0, 6);
  const recentHTML = recents.length ? `
    <div class="recent-row">
      <div class="recent-title">最近创作</div>
      <div class="recent-grid">${recents.map((r) => `<div class="recent-item">${
        r.modality === 'video'
          ? `<video src="${r.assetUrl}" data-lightbox="video" muted loop autoplay playsinline></video>`
          : `<img src="${r.assetUrl}" data-lightbox="image" loading="lazy" />`
      }</div>`).join('')}</div>
    </div>` : '';
  $('chatBody').innerHTML = `<div class="welcome">
    <h2>你好,想创作什么?</h2>
    <div class="quick-cards">${prompts.map((p) => `<button class="quick-card" data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    ${recentHTML}
  </div>`;
}
on($('chatBody'), 'click', '.quick-card', (e, el) => {
  $('prompt').value = el.dataset.prompt;
  $('prompt').dispatchEvent(new Event('input'));
  $('prompt').focus();
});

// ---- Sessions sidebar ----
async function loadSessions() {
  history = await apiJson('/api/history');
  const sessions = new Map();
  for (const h of history) {
    const sid = h.sessionId || h.id;
    if (!sessions.has(sid)) sessions.set(sid, { prompt: h.prompt, time: h.createdAt, count: 0, modality: h.modality });
    sessions.get(sid).count++;
  }
  $('sessionList').innerHTML = [...sessions.entries()].map(([sid, s]) =>
    `<div class="s-item${sid === currentSessionId ? ' active' : ''}" data-sid="${sid}" title="${esc(s.prompt)}">
      <span class="s-text">${MODE_ICON[s.modality] || ''} ${esc(s.prompt?.slice(0, 36) || '未命名')}</span>
      <span class="s-count">${s.count}</span>
    </div>`
  ).join('');
}
on($('sessionList'), 'click', '.s-item', (e, el) => loadSession(el.dataset.sid));

async function loadSession(sid) {
  currentSessionId = sid;
  pendingRefs = [];
  renderRefs();
  $('chatBody').innerHTML = '';
  const items = history.filter((h) => (h.sessionId || h.id) === sid).reverse();
  if (items.length) {
    const last = items[items.length - 1];
    switchModality(last.modality || 'image', { resetChat: false });
    if (last.model) selectModel(last.model);
  }
  for (const h of items) {
    addUserMsg(h.prompt, (h.inputUrls || []).slice(0, 9));
    const bubble = addMsg('ai', renderMediaHTML(h), h.id);
    if (h.status === 'pending' || h.status === 'processing') {
      pollJob(h.id, `/api/jobs/${h.id}`, bubble, { model: h.model, params: h.params, cost: h.cost });
    }
  }
  document.querySelectorAll('.s-item').forEach((el) => el.classList.toggle('active', el.dataset.sid === sid));
}

// ---- New chat ----
function newChat() {
  currentSessionId = null;
  pendingRefs = [];
  renderRefs();
  $('prompt').value = '';
  renderWelcome();
  document.querySelectorAll('.s-item').forEach((el) => el.classList.remove('active'));
}
$('newChatBtn').addEventListener('click', () => newChat());

// ---- Events ----
$('genBtn').addEventListener('click', generate);
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); }
});
$('prompt').addEventListener('input', () => {
  $('prompt').style.height = 'auto';
  $('prompt').style.height = Math.min($('prompt').scrollHeight, 120) + 'px';
});
$('openSidebar').addEventListener('click', () => $('sidebar').classList.remove('collapsed'));
$('closeSidebar').addEventListener('click', () => $('sidebar').classList.add('collapsed'));
wireLogout();

init().catch(console.error);
