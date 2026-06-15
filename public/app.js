const $ = (id) => document.getElementById(id);
let models = [];
let pendingRefs = [];
let lastImageId = null;
let currentSessionId = null;
let history = [];

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  return r;
}

// ---- Init ----
async function init() {
  const me = await (await api('/api/me')).json();
  $('who').textContent = me.user.username;
  $('remaining').textContent = `$${me.remaining}`;
  $('quota').textContent = `$${me.dailyBudget}`;
  if (me.user.role === 'admin') $('adminLink').style.display = '';

  models = await (await api('/api/models')).json();
  selectModel(models[0]?.id);
  await loadSessions();
}

// ---- Model selector (dropdown with prices) ----
let selectedModelId = null;

function selectModel(id) {
  selectedModelId = id;
  $('model').value = id;
  const m = models.find((x) => x.id === id);
  if (m) {
    $('modelBtn').innerHTML = `<span>${m.label}</span> <span style="color:var(--accent);margin-left:auto">$${m.costPerImage || '?'}</span>`;
  }
  renderDropdown();
  renderParams();
  renderModelHint(m);
  closeDropdown();
}

function renderModelHint(m) {
  let hint = '';
  if (m && m.supportsEdit === false) {
    hint = '<span style="color:var(--muted);font-size:11px;margin-left:8px">仅单轮生图</span>';
  } else if (m && m.protocol === 'openai-images') {
    hint = '<span style="color:var(--muted);font-size:11px;margin-left:8px">多轮基于上一张图</span>';
  } else if (m && m.protocol === 'gemini') {
    hint = '<span style="color:var(--muted);font-size:11px;margin-left:8px">支持多轮对话编辑</span>';
  }
  const el = document.getElementById('modelHint');
  if (el) el.innerHTML = hint;
}

function renderDropdown() {
  $('modelDropdown').innerHTML = models.map((m) =>
    `<div class="model-opt${m.id === selectedModelId ? ' active' : ''}" data-id="${m.id}">
      <div>
        <div class="m-name">${m.label}</div>
        <div class="m-note">${m.note || ''}</div>
      </div>
      <div class="m-price">$${m.costPerImage || '?'}</div>
    </div>`
  ).join('');
  $('modelDropdown').querySelectorAll('.model-opt').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); selectModel(el.dataset.id); };
  });
}

function closeDropdown() { $('modelDropdown').classList.remove('open'); }
$('modelBtn').onclick = (e) => {
  e.stopPropagation();
  $('modelDropdown').classList.toggle('open');
};
document.addEventListener('click', closeDropdown);

// ---- Params ----
function renderParams() {
  const m = models.find((x) => x.id === selectedModelId);
  const bar = $('paramsBar');
  bar.innerHTML = '';
  if (!m?.params) return;
  for (const [key, cfg] of Object.entries(m.params)) {
    if (cfg.type !== 'select') continue;
    const chip = document.createElement('span');
    chip.className = 'param-chip';
    chip.innerHTML = `${cfg.label} <select data-param-key="${key}" class="model-param">${cfg.options.map((o) =>
      `<option value="${o}"${o === cfg.default ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
    bar.appendChild(chip);
  }
}
function collectParams() {
  const p = {};
  document.querySelectorAll('.model-param').forEach((el) => { p[el.dataset.paramKey] = el.value; });
  return p;
}


// ---- Refs ----
function renderRefs() {
  $('refPreview').innerHTML = pendingRefs.map((r, i) => {
    const url = r.kind === 'file' ? URL.createObjectURL(r.file) : r.url;
    return `<span class="chip"><img src="${url}"/><span class="x" data-i="${i}">✕</span></span>`;
  }).join('');
  $('refPreview').querySelectorAll('.x').forEach((el) => {
    el.onclick = () => { pendingRefs.splice(+el.dataset.i, 1); renderRefs(); };
  });
}
$('attachBtn').onclick = () => $('refFile').click();
$('refFile').onchange = (e) => {
  for (const f of e.target.files) pendingRefs.push({ kind: 'file', file: f });
  e.target.value = '';
  renderRefs();
};

// ---- Chat messages ----
function addMsg(type, content) {
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  const avatar = type === 'ai' ? '✦' : '⧫';
  el.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble">${content}</div>`;
  $('chatBody').appendChild(el);
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  return el;
}

function addUserMsg(prompt, refUrls) {
  let content = '';
  if (refUrls.length) {
    content += `<div class="ref-imgs">${refUrls.map((u) => `<img src="${u}"/>`).join('')}</div>`;
  }
  content += esc(prompt);
  addMsg('user', content);
}

function addAiImage(imageUrl, imageId, model, params, cost) {
  const paramStr = Object.entries(params || {}).map(([k, v]) => `${k}:${v}`).join(' ');
  const costStr = cost ? ` · $${cost}` : '';
  const m = models.find((x) => x.id === model);
  const showContinue = m?.supportsEdit !== false;
  const content = `<img src="${imageUrl}" onclick="openLightbox('${imageUrl}')" />
    <div class="meta">${model?.split('/').pop() || ''}${paramStr ? ' · ' + paramStr : ''}${costStr}</div>
    <div class="img-actions">
      ${showContinue ? `<button class="ghost sm" onclick="useAsRef('${imageId}','${imageUrl}')">继续修改</button>` : ''}
      <a href="/api/image/${imageId}/download" class="btn ghost sm" download>下载</a>
    </div>`;
  addMsg('ai', content);
}

function addAiTyping() {
  const el = addMsg('ai', '<div class="typing"><span></span><span></span><span></span></div>');
  el.id = 'typing';
  return el;
}

// ---- Generate ----
async function generate() {
  $('err').textContent = '';
  const prompt = $('prompt').value.trim();
  if (!prompt) return;

  // 清除 welcome
  const welcome = $('chatBody').querySelector('.welcome');
  if (welcome) welcome.remove();

  // 展示用户消息
  const refUrls = pendingRefs.map((r) => r.kind === 'file' ? URL.createObjectURL(r.file) : r.url);
  addUserMsg(prompt, refUrls);

  const fd = new FormData();
  fd.append('model', $('model').value);
  fd.append('prompt', prompt);
  fd.append('params', JSON.stringify(collectParams()));
  if (currentSessionId) fd.append('sessionId', currentSessionId);
  for (const r of pendingRefs) {
    if (r.kind === 'file') fd.append('refImages', r.file);
  }

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
    if (!r.ok) {
      showError(data.error || '生成失败');
      return;
    }
    lastImageId = data.id;
    currentSessionId = data.sessionId;
    $('remaining').textContent = `$${data.remaining}`;
    addAiImage(data.imageUrl, data.id, $('model').value, collectParams(), data.cost);
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

// ---- Use as ref (now just focuses input, server handles history) ----
window.useAsRef = (id, url) => {
  // 在同一 session 里,服务端已经有完整对话历史,用户只需要输入下一轮 prompt
  $('prompt').focus();
  $('prompt').placeholder = '基于上一张图继续修改…';
};

// ---- Sessions sidebar ----
async function loadSessions() {
  history = await (await api('/api/history')).json();
  const sessions = new Map();
  for (const h of history) {
    const sid = h.sessionId || h.id;
    if (!sessions.has(sid)) sessions.set(sid, { prompt: h.prompt, time: h.createdAt, count: 0 });
    sessions.get(sid).count++;
  }
  $('sessionList').innerHTML = [...sessions.entries()].map(([sid, s]) =>
    `<div class="s-item${sid === currentSessionId ? ' active' : ''}" data-sid="${sid}" title="${esc(s.prompt)}">
      ${esc(s.prompt?.slice(0, 40) || '未命名')}
      <span style="font-size:11px;color:var(--muted);margin-left:auto">${s.count}</span>
    </div>`
  ).join('');
  $('sessionList').querySelectorAll('.s-item').forEach((el) => {
    el.onclick = () => loadSession(el.dataset.sid);
  });
}

async function loadSession(sid) {
  currentSessionId = sid;
  $('chatBody').innerHTML = '';
  const items = history.filter((h) => (h.sessionId || h.id) === sid).reverse();
  for (const h of items) {
    const inputImgUrls = (h.inputUrls || []).slice(0, 4);
    addUserMsg(h.prompt, inputImgUrls);
    addAiImage(h.imageUrl, h.id, h.model, h.params, h.cost);
  }
  if (items.length) lastImageId = items[items.length - 1].id;
  document.querySelectorAll('.s-item').forEach((el) => el.classList.toggle('active', el.dataset.sid === sid));
}

// ---- New chat ----
$('newChatBtn').onclick = () => {
  currentSessionId = null;
  lastImageId = null;
  pendingRefs = [];
  renderRefs();
  $('prompt').value = '';
  $('chatBody').innerHTML = '<div class="welcome"><h2>GImage</h2><p>选择模型,输入提示词,开始创作</p></div>';
  document.querySelectorAll('.s-item').forEach((el) => el.classList.remove('active'));
};

// ---- Events ----
$('genBtn').onclick = generate;
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); }
});
$('prompt').addEventListener('input', () => {
  $('prompt').style.height = 'auto';
  $('prompt').style.height = Math.min($('prompt').scrollHeight, 120) + 'px';
});
$('logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; };
$('openSidebar').onclick = () => $('sidebar').classList.remove('collapsed');
$('closeSidebar').onclick = () => $('sidebar').classList.add('collapsed');

window.openLightbox = (url) => {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<span class="close">&times;</span><img src="${url}" />`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
};

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

init().catch(console.error);
