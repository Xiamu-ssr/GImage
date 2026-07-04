import { $, esc, on } from './shared/dom.js';
import { api, apiJson, ct } from './shared/api.js';
import { fmt, fmtDate, fmtTime, modelShort, modalityLabel, statusLabel } from './shared/format.js';
import { openLightbox } from './shared/lightbox.js';
import { wireLogout } from './shared/user.js';

const enc = encodeURIComponent;

// ---------- Tabs ----------
on(document.querySelector('.tab-bar'), 'click', 'button', (e, btn) => {
  document.querySelectorAll('.tab-bar button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  $('tab-' + btn.dataset.tab).classList.add('active');
});

// ---------- 服务器状态 ----------
async function loadServerStatus(force) {
  $('serverBody').innerHTML = '<span class="muted">加载中…</span>';
  let s;
  try { s = await apiJson('/api/admin/server-status' + (force ? '?force=1' : '')); } catch (e) {
    $('serverBody').innerHTML = `<span class="error">加载失败:${esc(e.message)}</span>`; return;
  }
  if (!s.configured) {
    $('serverBody').innerHTML = '<span class="muted">未配置 ZENMUX_MANAGEMENT_KEY,无法显示服务器余额。</span>'; return;
  }
  const cards = [];
  const sub = s.subscription;
  if (sub) {
    const status = sub.account_status === 'healthy'
      ? '<span class="pill ok">健康</span>' : `<span class="pill bad">${esc(sub.account_status || '异常')}</span>`;
    cards.push(`<div class="stat"><div class="t">订阅档位 ${status}</div><div class="v">${esc((sub.plan?.tier || '-').toUpperCase())}</div><div class="sub">$${sub.plan?.amount_usd}/${esc(sub.plan?.interval || '')} · 到期 ${fmtDate(sub.plan?.expires_at)}</div></div>`);
    if (sub.quota_5_hour) cards.push(quotaCard('5 小时配额', sub.quota_5_hour));
    if (sub.quota_7_day) cards.push(quotaCard('7 天配额', sub.quota_7_day));
  } else if (s.subscriptionError) {
    cards.push(`<div class="stat"><div class="t">订阅</div><div class="sub error">${esc(s.subscriptionError)}</div></div>`);
  }
  if (s.payg) {
    cards.push(`<div class="stat"><div class="t">按量付费余额 (PAYG)</div><div class="v">$${fmt(s.payg.total_credits)}</div><div class="sub">充值 $${fmt(s.payg.top_up_credits)} · 赠送 $${fmt(s.payg.bonus_credits)}</div></div>`);
  } else if (s.paygError) {
    cards.push(`<div class="stat"><div class="t">PAYG 余额</div><div class="sub error">${esc(s.paygError)}</div></div>`);
  }
  $('serverBody').innerHTML = `<div class="stat-grid">${cards.join('')}</div><div class="muted" style="margin-top:10px">数据更新于 ${fmtTime(s.fetchedAt)}${s.cached ? '(缓存)' : ''}</div>`;
}
function quotaCard(title, q) {
  const pct = Math.round((q.usage_percentage || 0) * 100);
  const cls = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : '';
  return `<div class="stat"><div class="t">${title} · 已用 ${pct}%</div><div class="v">剩 ${fmt(q.remaining_flows)} <span style="font-size:13px;color:var(--muted)">flows</span></div><div class="sub">≈ 剩 $${fmt(q.max_value_usd - q.used_value_usd)} / $${fmt(q.max_value_usd)} · 重置 ${fmtTime(q.resets_at)}</div><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div></div>`;
}
$('refreshServer').addEventListener('click', () => loadServerStatus(true));

// ---------- 用量(按模态拆分) ----------
async function loadUsage() {
  const u = await apiJson('/api/admin/usage');
  $('usageDate').textContent = u.date;
  $('totalCount').textContent = u.totalCount;
  $('totalSpent').textContent = fmt(u.totalSpentUSD);
  $('modalityStats').innerHTML = ['image', 'video', 'music'].map((mod) => {
    const s = u.byModality?.[mod] || { count: 0, spentUSD: 0 };
    return `<div class="stat"><div class="t">${modalityLabel(mod)}</div><div class="v">${s.count}</div><div class="sub">≈ $${fmt(s.spentUSD)}</div></div>`;
  }).join('');
}

// ---------- 账户管理 ----------
async function loadAccounts() {
  const accs = await apiJson('/api/admin/accounts');
  $('accBody').innerHTML = accs.map((a) => `
    <tr data-user="${esc(a.username)}">
      <td>${esc(a.username)}</td>
      <td>${a.role === 'admin' ? '管理员' : '普通'}</td>
      <td><input type="number" value="${a.dailyBudget || 1.5}" min="0" step="0.1" style="width:90px" class="q"/></td>
      <td>$${a.spentToday || 0}</td>
      <td class="row" style="gap:6px">
        <button class="ghost sm saveQuota">保存额度</button>
        <button class="ghost sm resetPass">改密码</button>
        <button class="danger sm del">删除</button>
      </td>
    </tr>`).join('');
}
on($('accBody'), 'click', '.saveQuota', async (e, btn) => {
  const user = btn.closest('tr').dataset.user;
  const q = btn.closest('tr').querySelector('.q').value;
  const r = await api(`/api/admin/accounts/${enc(user)}`, { method: 'PATCH', headers: ct, body: JSON.stringify({ dailyBudget: q }) });
  alert(r.ok ? '已保存' : (await r.json()).error);
});
on($('accBody'), 'click', '.resetPass', async (e, btn) => {
  const user = btn.closest('tr').dataset.user;
  const pw = prompt(`为 ${user} 设置新密码(至少 4 位):`);
  if (!pw) return;
  const r = await api(`/api/admin/accounts/${enc(user)}`, { method: 'PATCH', headers: ct, body: JSON.stringify({ password: pw }) });
  alert(r.ok ? '密码已更新' : (await r.json()).error);
});
on($('accBody'), 'click', '.del', async (e, btn) => {
  const user = btn.closest('tr').dataset.user;
  if (!confirm(`确认删除账户 ${user}?`)) return;
  const r = await api(`/api/admin/accounts/${enc(user)}`, { method: 'DELETE' });
  if (r.ok) loadAccounts(); else alert((await r.json()).error);
});
$('createBtn').addEventListener('click', async () => {
  $('createErr').textContent = '';
  const body = { username: $('newUser').value.trim(), password: $('newPass').value, dailyBudget: $('newBudget').value, role: $('newRole').value };
  const r = await api('/api/admin/accounts', { method: 'POST', headers: ct, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) { $('createErr').textContent = data.error || '创建失败'; return; }
  $('newUser').value = ''; $('newPass').value = ''; $('newBudget').value = '1.5';
  loadAccounts();
});

// ---------- 会话与内容审阅(图片/视频/音乐) ----------
async function loadUserList() {
  const users = await apiJson('/api/admin/users');
  $('recUser').innerHTML = '<option value="__all">全部用户</option>' +
    users.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
}

function statusPill(status) {
  if (!status || status === 'done') return '';
  return ` <span class="pill ${status === 'failed' ? 'bad' : 'warn'}">${statusLabel(status)}</span>`;
}

function recordHTML(r) {
  let outputHTML;
  if (r.status && r.status !== 'done') {
    outputHTML = r.status === 'failed'
      ? `<div style="color:var(--danger);font-size:12px">✕ ${esc(r.error || '生成失败')}</div>`
      : `<div class="muted" style="font-size:12px">${statusLabel(r.status)}…</div>`;
  } else if (r.modality === 'video') {
    outputHTML = `<video src="${r.assetUrl}" controls data-open="video"></video>`;
  } else if (r.modality === 'music') {
    outputHTML = `<audio src="${r.assetUrl}" controls></audio>`;
  } else {
    outputHTML = `<img src="${r.assetUrl}" data-open="image" />`;
  }

  const paramEntries = Object.entries(r.params || {}).filter(([k, v]) => k !== 'lyrics' && v !== '' && v !== false);

  return `<div class="record">
    <div class="r-head">
      <span class="user">${esc(r.username || '?')}${statusPill(r.status)}</span>
      <span class="muted">${modalityLabel(r.modality)} · ${esc(modelShort(r.model))} · ${fmtTime(r.createdAt)}</span>
    </div>
    <div class="r-prompt">${esc(r.prompt)}</div>
    <div class="r-images">
      ${(r.inputUrls || []).map((u) => `<div><div class="input-label">输入</div><img src="${u}" data-open="image" /></div>`).join('')}
      <div><div class="input-label" style="color:var(--accent)">输出</div>${outputHTML}</div>
    </div>
    ${paramEntries.length ? `<div class="r-params">参数: ${esc(paramEntries.map(([k, v]) => `${k}=${v}`).join(' · '))}</div>` : ''}
  </div>`;
}

async function loadRecords() {
  const user = $('recUser').value;
  $('recordsBody').innerHTML = '<span class="muted">加载中…</span>';
  let records;
  if (user === '__all') {
    const data = await apiJson('/api/admin/all-records?limit=200');
    records = data.records || [];
  } else {
    records = await apiJson(`/api/admin/records/${enc(user)}`);
  }
  if (!records.length) { $('recordsBody').innerHTML = '<span class="muted">暂无记录</span>'; return; }

  const sessions = new Map();
  for (const r of records) {
    const sid = r.sessionId || r.id;
    if (!sessions.has(sid)) sessions.set(sid, []);
    sessions.get(sid).push(r);
  }

  let html = '';
  for (const [sid, group] of sessions) {
    html += `<div class="session-header">会话 ${esc(sid.slice(0, 16))}… · ${group.length} 轮 · 开始于 ${fmtTime(group[group.length - 1]?.createdAt)}</div>`;
    for (const r of group.reverse()) html += recordHTML(r);
  }
  $('recordsBody').innerHTML = html;
}
on($('recordsBody'), 'click', '[data-open]', (e, el) => openLightbox(el.getAttribute('src'), el.dataset.open));
$('loadRecBtn').addEventListener('click', loadRecords);

// ---------- 初始化 ----------
wireLogout();

(async () => {
  await loadServerStatus(false);
  await loadUsage();
  await loadAccounts();
  await loadUserList();
})().catch(console.error);
