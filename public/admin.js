// 管理后台逻辑
const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  if (r.status === 403) { location.href = '/app.html'; throw new Error('无权限'); }
  return r;
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-bar button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-bar button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  };
});

// ---------- 服务器状态 ----------
async function loadServerStatus(force) {
  $('serverBody').innerHTML = '<span class="muted">加载中…</span>';
  let s;
  try { s = await (await api('/api/admin/server-status' + (force ? '?force=1' : ''))).json(); } catch (e) {
    $('serverBody').innerHTML = `<span class="error">加载失败:${e.message}</span>`; return;
  }
  if (!s.configured) {
    $('serverBody').innerHTML = '<span class="muted">未配置 ZENMUX_MANAGEMENT_KEY,无法显示服务器余额。</span>'; return;
  }
  const cards = [];
  const sub = s.subscription;
  if (sub) {
    const status = sub.account_status === 'healthy'
      ? '<span class="pill ok">健康</span>' : `<span class="pill bad">${sub.account_status || '异常'}</span>`;
    cards.push(`<div class="stat"><div class="t">订阅档位 ${status}</div><div class="v">${(sub.plan?.tier || '-').toUpperCase()}</div><div class="sub">$${sub.plan?.amount_usd}/${sub.plan?.interval} · 到期 ${fmtDate(sub.plan?.expires_at)}</div></div>`);
    if (sub.quota_5_hour) cards.push(quotaCard('5 小时配额', sub.quota_5_hour));
    if (sub.quota_7_day) cards.push(quotaCard('7 天配额', sub.quota_7_day));
  } else if (s.subscriptionError) {
    cards.push(`<div class="stat"><div class="t">订阅</div><div class="sub error">${s.subscriptionError}</div></div>`);
  }
  if (s.payg) {
    cards.push(`<div class="stat"><div class="t">按量付费余额 (PAYG)</div><div class="v">$${fmt(s.payg.total_credits)}</div><div class="sub">充值 $${fmt(s.payg.top_up_credits)} · 赠送 $${fmt(s.payg.bonus_credits)}</div></div>`);
  } else if (s.paygError) {
    cards.push(`<div class="stat"><div class="t">PAYG 余额</div><div class="sub error">${s.paygError}</div></div>`);
  }
  $('serverBody').innerHTML = `<div class="stat-grid">${cards.join('')}</div><div class="muted" style="margin-top:10px">数据更新于 ${fmtTime(s.fetchedAt)}${s.cached ? '(缓存)' : ''}</div>`;
}
function quotaCard(title, q) {
  const pct = Math.round((q.usage_percentage || 0) * 100);
  const cls = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : '';
  return `<div class="stat"><div class="t">${title} · 已用 ${pct}%</div><div class="v">剩 ${fmt(q.remaining_flows)} <span style="font-size:13px;color:var(--muted)">flows</span></div><div class="sub">≈ 剩 $${fmt(q.max_value_usd - q.used_value_usd)} / $${fmt(q.max_value_usd)} · 重置 ${fmtTime(q.resets_at)}</div><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div></div>`;
}
$('refreshServer').onclick = () => loadServerStatus(true);

// ---------- 用量 ----------
async function loadUsage() {
  const u = await (await api('/api/admin/usage')).json();
  $('usageDate').textContent = u.date;
  $('totalImages').textContent = u.totalImages;
  $('estCost').textContent = u.estCostUSD;
  $('costNote').textContent = u.note;
}

// ---------- 账户管理 ----------
async function loadAccounts() {
  const accs = await (await api('/api/admin/accounts')).json();
  $('accBody').innerHTML = accs.map((a) => `
    <tr data-user="${a.username}">
      <td>${a.username}</td>
      <td>${a.role === 'admin' ? '管理员' : '普通'}</td>
      <td><input type="number" value="${a.dailyQuota}" min="0" style="width:80px" class="q"/></td>
      <td>${a.usedToday}</td>
      <td class="row" style="gap:6px">
        <button class="ghost saveQuota">保存配额</button>
        <button class="ghost resetPass">改密码</button>
        <button class="danger del">删除</button>
      </td>
    </tr>`).join('');
  $('accBody').querySelectorAll('tr').forEach((tr) => {
    const user = tr.dataset.user;
    tr.querySelector('.saveQuota').onclick = async () => {
      const r = await api(`/api/admin/accounts/${enc(user)}`, { method: 'PATCH', headers: ct, body: JSON.stringify({ dailyQuota: tr.querySelector('.q').value }) });
      alert(r.ok ? '已保存' : (await r.json()).error);
    };
    tr.querySelector('.resetPass').onclick = async () => {
      const pw = prompt(`为 ${user} 设置新密码(至少 4 位):`);
      if (!pw) return;
      const r = await api(`/api/admin/accounts/${enc(user)}`, { method: 'PATCH', headers: ct, body: JSON.stringify({ password: pw }) });
      alert(r.ok ? '密码已更新' : (await r.json()).error);
    };
    tr.querySelector('.del').onclick = async () => {
      if (!confirm(`确认删除账户 ${user}?`)) return;
      const r = await api(`/api/admin/accounts/${enc(user)}`, { method: 'DELETE' });
      if (r.ok) loadAccounts(); else alert((await r.json()).error);
    };
  });
}
$('createBtn').onclick = async () => {
  $('createErr').textContent = '';
  const body = { username: $('newUser').value.trim(), password: $('newPass').value, dailyQuota: $('newQuota').value, role: $('newRole').value };
  const r = await api('/api/admin/accounts', { method: 'POST', headers: ct, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) { $('createErr').textContent = data.error || '创建失败'; return; }
  $('newUser').value = ''; $('newPass').value = ''; $('newQuota').value = '10';
  loadAccounts();
};

// ---------- 会话与图片审阅 ----------
async function loadUserList() {
  const users = await (await api('/api/admin/users')).json();
  $('recUser').innerHTML = '<option value="__all">全部用户</option>' +
    users.map((u) => `<option value="${u}">${u}</option>`).join('');
}

async function loadRecords() {
  const user = $('recUser').value;
  $('recordsBody').innerHTML = '<span class="muted">加载中…</span>';
  let records;
  if (user === '__all') {
    const data = await (await api('/api/admin/all-records?limit=200')).json();
    records = data.records || [];
  } else {
    records = await (await api(`/api/admin/records/${enc(user)}`)).json();
  }
  if (!records.length) {
    $('recordsBody').innerHTML = '<span class="muted">暂无记录</span>'; return;
  }
  // 按 session 分组
  const sessions = new Map();
  for (const r of records) {
    const sid = r.sessionId || r.id;
    if (!sessions.has(sid)) sessions.set(sid, []);
    sessions.get(sid).push(r);
  }

  let html = '';
  for (const [sid, group] of sessions) {
    html += `<div class="session-header">会话 ${sid.slice(0, 16)}… · ${group.length} 轮 · 开始于 ${fmtTime(group[group.length - 1]?.createdAt)}</div>`;
    for (const r of group.reverse()) {
      html += `<div class="record">
        <div class="r-head">
          <span class="user">${r.username || '?'}</span>
          <span class="muted">${r.model?.split('/').pop() || ''} · ${fmtTime(r.createdAt)}</span>
        </div>
        <div class="r-prompt">${esc(r.prompt)}</div>
        <div class="r-images">
          ${(r.inputUrls || []).map((u) => `<div><div class="input-label">输入</div><img src="${u}" onclick="openLB('${u}')" /></div>`).join('')}
          <div><div class="input-label" style="color:var(--accent)">输出</div><img src="${r.imageUrl}" onclick="openLB('${r.imageUrl}')" /></div>
        </div>
        ${r.params && Object.keys(r.params).length ? `<div class="r-params">参数: ${Object.entries(r.params).map(([k,v]) => `${k}=${v}`).join(' · ')}</div>` : ''}
      </div>`;
    }
  }
  $('recordsBody').innerHTML = html;
}

$('loadRecBtn').onclick = loadRecords;

function openLB(url) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<span class="close">&times;</span><img src="${url}" />`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

// ---------- 初始化 ----------
const ct = { 'Content-Type': 'application/json' };
const enc = encodeURIComponent;
function fmt(n) { return n == null ? '-' : (+n).toFixed(2); }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('zh-CN') : '-'; }
function fmtTime(s) { return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '-'; }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

$('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
};

(async () => {
  await loadServerStatus(false);
  await loadUsage();
  await loadAccounts();
  await loadUserList();
})().catch(console.error);
