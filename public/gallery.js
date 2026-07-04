import { $, esc, on } from './shared/dom.js';
import { api, apiJson } from './shared/api.js';
import { fmtTime, fmtDate, modelShort, paramStr, modalityLabel, statusLabel } from './shared/format.js';
import { openLightbox } from './shared/lightbox.js';
import { loadMe, wireLogout } from './shared/user.js';

let allAssets = [];
let currentTab = 'all';
let batchMode = false;
const selected = new Set();
const pollingIds = new Set();

async function init() {
  await loadMe();
  wireLogout();
  allAssets = await apiJson('/api/assets');
  render();
}

function applyFilters() {
  let items = allAssets;
  if (currentTab !== 'all') items = items.filter((a) => a.modality === currentTab);
  const q = $('searchInput').value.trim().toLowerCase();
  if (q) items = items.filter((a) => (a.prompt || '').toLowerCase().includes(q));
  if ($('sortSel').value === 'oldest') items = [...items].reverse();
  return items;
}

function groupByDate(items) {
  const groups = new Map();
  for (const item of items) {
    const key = fmtDate(item.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function cardHTML(item) {
  const picked = selected.has(item.id) ? ' picked' : '';
  let mediaHTML;
  if (item.status === 'pending' || item.status === 'processing') {
    mediaHTML = `<div class="g-status"><span class="spinner sm"></span>${statusLabel(item.status)}…</div>`;
  } else if (item.status === 'failed') {
    mediaHTML = `<div class="g-status failed">✕ 生成失败${item.error ? '<br>' + esc(item.error) : ''}</div>`;
  } else if (item.modality === 'video') {
    mediaHTML = `<video class="g-img" src="${item.assetUrl}" muted preload="metadata" data-open="video"></video><div class="g-play">▶</div>`;
  } else if (item.modality === 'music') {
    mediaHTML = `<div class="g-note">🎵</div><audio src="${item.assetUrl}" controls></audio>`;
  } else {
    mediaHTML = `<img class="g-img" src="${item.assetUrl}" data-open="image" />`;
  }

  const actions = item.status === 'done'
    ? `<a href="${item.downloadUrl}" class="btn ghost sm" download>下载</a><button class="ghost sm" data-action="delete">删除</button>`
    : `<button class="ghost sm" data-action="delete">删除</button>`;

  return `<div class="g-card${item.modality === 'music' ? ' music' : ''}${picked}" data-id="${item.id}">
    <span class="g-check">✓</span>
    <div class="g-media-wrap">${mediaHTML}</div>
    <div class="meta">
      <div class="prompt">${esc(item.prompt)}</div>
      <div class="info"><span>${modalityLabel(item.modality)}</span> · ${esc(modelShort(item.model))} · ${fmtTime(item.createdAt)}${item.cost ? ' · $' + item.cost : ''}</div>
      ${paramStr(item.params) ? `<div class="info">${esc(paramStr(item.params))}</div>` : ''}
    </div>
    <div class="actions">${actions}</div>
  </div>`;
}

function render() {
  const items = applyFilters();
  const gallery = $('gallery');
  gallery.classList.toggle('batch-mode', batchMode);

  if (!items.length) {
    gallery.innerHTML = `<span class="muted" style="padding:40px">${allAssets.length ? '没有匹配的内容' : '还没有生成过内容,去<a href="/app.html">工作台</a>试试'}</span>`;
    updateBatchBar();
    return;
  }

  const groups = groupByDate(items);
  let html = '';
  for (const [date, group] of groups) {
    if (groups.size > 1) html += `<div class="date-sep">${date} · ${group.length} 项</div>`;
    for (const item of group) html += cardHTML(item);
  }
  gallery.innerHTML = html;

  for (const item of items) {
    if (item.status === 'pending' || item.status === 'processing') ensurePolling(item);
  }
  updateBatchBar();
}

function updateBatchBar() {
  $('batchCount').textContent = selected.size;
}

// ---- 单卡交互:打开大图/播放、单个删除、批量模式下的勾选 ----
on($('gallery'), 'click', '.g-card', (e, card) => {
  const id = card.dataset.id;
  if (batchMode) {
    if (e.target.tagName === 'AUDIO') return;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render();
    return;
  }
  const openEl = e.target.closest('[data-open]');
  if (openEl) { openLightbox(openEl.getAttribute('src'), openEl.dataset.open); return; }
  if (e.target.closest('[data-action="delete"]')) deleteOne(id);
});

async function deleteOne(id) {
  if (!confirm('确认删除这个内容?此操作不可撤销。')) return;
  const r = await api(`/api/asset/${id}`, { method: 'DELETE' });
  if (!r.ok) { alert((await r.json()).error || '删除失败'); return; }
  allAssets = allAssets.filter((a) => a.id !== id);
  selected.delete(id);
  render();
}

// ---- 工具栏:模态 tab / 搜索 / 排序 ----
on($('modalityTabs'), 'click', 'button', (e, btn) => {
  currentTab = btn.dataset.tab;
  document.querySelectorAll('#modalityTabs button').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});
$('searchInput').addEventListener('input', render);
$('sortSel').addEventListener('change', render);

// ---- 批量管理 ----
$('batchToggle').addEventListener('click', () => {
  batchMode = !batchMode;
  $('batchToggle').textContent = batchMode ? '退出批量' : '批量管理';
  $('batchBar').classList.toggle('active', batchMode);
  if (!batchMode) selected.clear();
  render();
});
$('batchCancel').addEventListener('click', () => $('batchToggle').click());
$('batchSelectAll').addEventListener('click', () => {
  const items = applyFilters();
  const allPicked = items.length > 0 && items.every((i) => selected.has(i.id));
  if (allPicked) items.forEach((i) => selected.delete(i.id));
  else items.forEach((i) => selected.add(i.id));
  render();
});
$('batchDelete').addEventListener('click', async () => {
  if (!selected.size) return;
  if (!confirm(`确认删除已选的 ${selected.size} 项?此操作不可撤销。`)) return;
  for (const id of [...selected]) {
    try { await api(`/api/asset/${id}`, { method: 'DELETE' }); } catch { /* 单个失败不阻塞其余删除 */ }
  }
  allAssets = allAssets.filter((a) => !selected.has(a.id));
  selected.clear();
  render();
});
$('batchDownload').addEventListener('click', () => {
  [...selected].forEach((id, i) => {
    const item = allAssets.find((a) => a.id === id);
    if (!item || item.status !== 'done') return;
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = item.downloadUrl;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 400);
  });
});

// ---- 异步任务(视频)轮询:资产库里也要能看到从排队到完成的状态变化 ----
function ensurePolling(item) {
  if (pollingIds.has(item.id)) return;
  pollingIds.add(item.id);
  const tick = async () => {
    const idx = allAssets.findIndex((a) => a.id === item.id);
    if (idx === -1) { pollingIds.delete(item.id); return; }
    let data;
    try { data = await apiJson(`/api/jobs/${item.id}`); } catch { setTimeout(tick, 5000); return; }
    if (data.status === 'pending' || data.status === 'processing') { setTimeout(tick, 4000); return; }
    pollingIds.delete(item.id);
    allAssets[idx] = { ...allAssets[idx], status: data.status, assetUrl: data.assetUrl, mimeType: data.mimeType, error: data.error };
    render();
  };
  setTimeout(tick, 4000);
}

init().catch(console.error);
