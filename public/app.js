// 工作台逻辑
const $ = (id) => document.getElementById(id);
let models = [];
let pendingRefs = []; // { kind:'file', file } | { kind:'id', id, url }
let lastImageId = null;
let currentSessionId = null;

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  return r;
}

async function init() {
  const me = await (await api('/api/me')).json();
  $('who').textContent = me.user.username;
  $('remaining').textContent = me.remaining;
  $('quota').textContent = me.dailyQuota;
  if (me.user.role === 'admin') $('adminLink').style.display = 'inline';

  models = await (await api('/api/models')).json();
  $('model').innerHTML = models.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  updateModelUI();
  await loadHistory();
}

function updateModelUI() {
  const m = models.find((x) => x.id === $('model').value);
  $('modelNote').textContent = m?.note || '';
  renderParams(m);
}

function renderParams(m) {
  const area = $('paramsArea');
  area.innerHTML = '';
  if (!m || !m.params) return;
  for (const [key, cfg] of Object.entries(m.params)) {
    const label = document.createElement('label');
    label.textContent = cfg.label || key;
    area.appendChild(label);
    if (cfg.type === 'select' && cfg.options) {
      const sel = document.createElement('select');
      sel.dataset.paramKey = key;
      sel.className = 'model-param';
      sel.innerHTML = cfg.options.map((o) =>
        `<option value="${o}"${o === cfg.default ? ' selected' : ''}>${o}</option>`
      ).join('');
      area.appendChild(sel);
    }
  }
}

function collectParams() {
  const params = {};
  document.querySelectorAll('.model-param').forEach((el) => {
    params[el.dataset.paramKey] = el.value;
  });
  return params;
}

function renderRefs() {
  $('refStrip').innerHTML = pendingRefs.map((r, i) => {
    const url = r.kind === 'file' ? URL.createObjectURL(r.file) : r.url;
    const name = r.kind === 'file' ? r.file.name : '历史图';
    return `<span class="chip"><img src="${url}"/>${name}<span class="x" data-i="${i}">✕</span></span>`;
  }).join('');
  $('refStrip').querySelectorAll('.x').forEach((el) => {
    el.onclick = () => { pendingRefs.splice(+el.dataset.i, 1); renderRefs(); };
  });
}

async function generate() {
  $('err').textContent = '';
  const prompt = $('prompt').value.trim();
  if (!prompt) { $('err').textContent = '请输入提示词'; return; }

  const fd = new FormData();
  fd.append('model', $('model').value);
  fd.append('prompt', prompt);
  fd.append('params', JSON.stringify(collectParams()));
  if (currentSessionId) fd.append('sessionId', currentSessionId);
  for (const r of pendingRefs) {
    if (r.kind === 'file') fd.append('refImages', r.file);
    else if (r.kind === 'id') fd.append('prevImageId', r.id);
  }

  $('genBtn').disabled = true;
  $('resultBox').innerHTML = '<div class="spinner"></div>';
  try {
    const r = await api('/api/generate', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) { $('err').textContent = data.error || '生成失败'; $('resultBox').innerHTML = '<span class="muted">生成失败</span>'; return; }
    lastImageId = data.id;
    currentSessionId = data.sessionId;
    showResult(data.imageUrl, data.id);
    $('remaining').textContent = data.remaining;
    await loadHistory();
  } catch (e) {
    $('err').textContent = e.message || '网络错误';
    $('resultBox').innerHTML = '<span class="muted">生成失败</span>';
  } finally {
    $('genBtn').disabled = false;
  }
}

function showResult(url, id) {
  $('resultBox').innerHTML = `<img src="${url}" />`;
  $('useAsRefBtn').disabled = false;
  $('newSessionBtn').disabled = false;
  const dl = $('downloadBtn');
  dl.href = `/api/image/${id}/download`; dl.style.display = 'inline-block';
}

async function loadHistory() {
  const list = await (await api('/api/history')).json();
  $('history').innerHTML = list.map((h) =>
    `<img src="${h.imageUrl}" title="${esc(h.prompt)}" data-id="${h.id}" data-url="${h.imageUrl}"/>`
  ).join('');
  $('history').querySelectorAll('img').forEach((img) => {
    img.onclick = () => { lastImageId = img.dataset.id; showResult(img.dataset.url, img.dataset.id); };
  });
}

function esc(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// Events
$('model').onchange = updateModelUI;
$('genBtn').onclick = generate;
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) generate(); });
$('refFile').onchange = (e) => {
  for (const f of e.target.files) pendingRefs.push({ kind: 'file', file: f });
  e.target.value = '';
  renderRefs();
};
$('clearRefBtn').onclick = () => { pendingRefs = []; renderRefs(); };
$('useAsRefBtn').onclick = () => {
  if (!lastImageId) return;
  pendingRefs = [{ kind: 'id', id: lastImageId, url: `/api/image/${lastImageId}` }];
  renderRefs();
  $('prompt').focus();
};
$('newSessionBtn').onclick = () => {
  currentSessionId = null;
  pendingRefs = [];
  renderRefs();
  $('prompt').value = '';
  $('resultBox').innerHTML = '<span class="muted">新会话已开始</span>';
  $('useAsRefBtn').disabled = true;
  $('newSessionBtn').disabled = true;
  $('downloadBtn').style.display = 'none';
};
$('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
};

init().catch((e) => console.error(e));
