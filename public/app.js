// 工作台逻辑
const $ = (id) => document.getElementById(id);
let models = [];
let pendingRefs = []; // { kind:'file', file } | { kind:'id', id, url }
let lastImageId = null;

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  return r;
}

async function init() {
  // 用户信息 + 配额
  const me = await (await api('/api/me')).json();
  $('who').textContent = me.user.username;
  $('remaining').textContent = me.remaining;
  $('quota').textContent = me.dailyQuota;
  if (me.user.role === 'admin') $('adminLink').style.display = 'inline';

  // 模型
  models = await (await api('/api/models')).json();
  $('model').innerHTML = models.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  updateModelNote();

  await loadHistory();
}

function updateModelNote() {
  const m = models.find((x) => x.id === $('model').value);
  $('modelNote').textContent = m?.note || '';
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
  for (const r of pendingRefs) {
    if (r.kind === 'file') fd.append('refImages', r.file);
    else if (r.kind === 'id') fd.append('prevImageId', r.id); // 取最后一个 id 引用
  }

  $('genBtn').disabled = true;
  $('resultBox').innerHTML = '<div class="spinner"></div>';
  try {
    const r = await api('/api/generate', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) { $('err').textContent = data.error || '生成失败'; $('resultBox').innerHTML = '<span class="muted">生成失败</span>'; return; }
    lastImageId = data.id;
    showResult(data.imageUrl);
    $('remaining').textContent = data.remaining;
    await loadHistory();
  } catch (e) {
    $('err').textContent = e.message || '网络错误';
    $('resultBox').innerHTML = '<span class="muted">生成失败</span>';
  } finally {
    $('genBtn').disabled = false;
  }
}

function showResult(url) {
  $('resultBox').innerHTML = `<img src="${url}" />`;
  $('useAsRefBtn').disabled = false;
  const dl = $('downloadBtn');
  dl.href = url; dl.style.display = 'inline-block';
}

async function loadHistory() {
  const list = await (await api('/api/history')).json();
  $('history').innerHTML = list.map((h) =>
    `<img src="${h.imageUrl}" title="${(h.prompt||'').replace(/"/g,'&quot;')}" data-id="${h.id}" data-url="${h.imageUrl}"/>`
  ).join('');
  $('history').querySelectorAll('img').forEach((img) => {
    img.onclick = () => { lastImageId = img.dataset.id; showResult(img.dataset.url); };
  });
}

// 事件
$('model').onchange = updateModelNote;
$('genBtn').onclick = generate;
$('refFile').onchange = (e) => {
  for (const f of e.target.files) pendingRefs.push({ kind: 'file', file: f });
  e.target.value = '';
  renderRefs();
};
$('clearRefBtn').onclick = () => { pendingRefs = []; renderRefs(); };
$('useAsRefBtn').onclick = () => {
  if (!lastImageId) return;
  // 用当前结果作为参考图(多轮编辑)
  pendingRefs = [{ kind: 'id', id: lastImageId, url: `/api/image/${lastImageId}` }];
  renderRefs();
  $('prompt').focus();
};
$('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
};

init().catch((e) => console.error(e));
