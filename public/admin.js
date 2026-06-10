// 管理后台逻辑
const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  if (r.status === 403) { location.href = '/app.html'; throw new Error('无权限'); }
  return r;
}

async function loadServerStatus(force) {
  $('serverBody').innerHTML = '<span class="muted">加载中…</span>';
  let s;
  try {
    s = await (await api('/api/admin/server-status' + (force ? '?force=1' : ''))).json();
  } catch (e) {
    $('serverBody').innerHTML = `<span class="error">加载失败:${e.message}</span>`;
    return;
  }
  if (!s.configured) {
    $('serverBody').innerHTML = '<span class="muted">未配置 ZENMUX_MANAGEMENT_KEY,无法显示服务器余额。在 .env 中填入 sk-mg-v1-... 的管理密钥即可。</span>';
    return;
  }

  const cards = [];

  // 订阅配额(最关键:反映"还能不能生图")
  const sub = s.subscription;
  if (sub) {
    const status = sub.account_status === 'healthy'
      ? '<span class="pill ok">健康</span>' : `<span class="pill bad">${sub.account_status || '异常'}</span>`;
    cards.push(`<div class="stat">
      <div class="t">订阅档位 ${status}</div>
      <div class="v">${(sub.plan?.tier || '-').toUpperCase()}</div>
      <div class="sub">$${sub.plan?.amount_usd}/${sub.plan?.interval} · 到期 ${fmtDate(sub.plan?.expires_at)}</div>
    </div>`);
    if (sub.quota_5_hour) cards.push(quotaCard('5 小时配额', sub.quota_5_hour));
    if (sub.quota_7_day) cards.push(quotaCard('7 天配额', sub.quota_7_day));
  } else if (s.subscriptionError) {
    cards.push(`<div class="stat"><div class="t">订阅</div><div class="sub error">${s.subscriptionError}</div></div>`);
  }

  // PAYG 余额
  if (s.payg) {
    cards.push(`<div class="stat">
      <div class="t">按量付费余额 (PAYG)</div>
      <div class="v">$${fmt(s.payg.total_credits)}</div>
      <div class="sub">充值 $${fmt(s.payg.top_up_credits)} · 赠送 $${fmt(s.payg.bonus_credits)}</div>
    </div>`);
  } else if (s.paygError) {
    cards.push(`<div class="stat"><div class="t">PAYG 余额</div><div class="sub error">${s.paygError}</div></div>`);
  }

  $('serverBody').innerHTML = `<div class="stat-grid">${cards.join('')}</div>
    <div class="muted" style="margin-top:10px">数据更新于 ${fmtTime(s.fetchedAt)}${s.cached ? '(缓存)' : ''}</div>`;
}

function quotaCard(title, q) {
  const pct = Math.round((q.usage_percentage || 0) * 100);
  const cls = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : '';
  return `<div class="stat">
    <div class="t">${title} · 已用 ${pct}%</div>
    <div class="v">剩 ${fmt(q.remaining_flows)} <span style="font-size:13px;color:var(--muted)">flows</span></div>
    <div class="sub">≈ 剩 $${fmt(q.max_value_usd - q.used_value_usd)} / $${fmt(q.max_value_usd)} · 重置 ${fmtTime(q.resets_at)}</div>
    <div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>
  </div>`;
}

function fmt(n) { return n == null ? '-' : (+n).toFixed(2); }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('zh-CN') : '-'; }
function fmtTime(s) { return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '-'; }

async function loadUsage() {
  const u = await (await api('/api/admin/usage')).json();
  $('usageDate').textContent = u.date;
  $('totalImages').textContent = u.totalImages;
  $('estCost').textContent = u.estCostUSD;
  $('costNote').textContent = u.note;
}

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
      const dailyQuota = tr.querySelector('.q').value;
      const r = await api(`/api/admin/accounts/${encodeURIComponent(user)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyQuota }),
      });
      if (r.ok) { alert('已保存'); } else { alert((await r.json()).error); }
    };
    tr.querySelector('.resetPass').onclick = async () => {
      const password = prompt(`为 ${user} 设置新密码(至少 4 位):`);
      if (!password) return;
      const r = await api(`/api/admin/accounts/${encodeURIComponent(user)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) { alert('密码已更新'); } else { alert((await r.json()).error); }
    };
    tr.querySelector('.del').onclick = async () => {
      if (!confirm(`确认删除账户 ${user}?`)) return;
      const r = await api(`/api/admin/accounts/${encodeURIComponent(user)}`, { method: 'DELETE' });
      if (r.ok) { loadAccounts(); } else { alert((await r.json()).error); }
    };
  });
}

$('createBtn').onclick = async () => {
  $('createErr').textContent = '';
  const body = {
    username: $('newUser').value.trim(),
    password: $('newPass').value,
    dailyQuota: $('newQuota').value,
    role: $('newRole').value,
  };
  const r = await api('/api/admin/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) { $('createErr').textContent = data.error || '创建失败'; return; }
  $('newUser').value = ''; $('newPass').value = ''; $('newQuota').value = '10';
  loadAccounts();
};

$('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
};

$('refreshServer').onclick = () => loadServerStatus(true);

(async () => {
  await loadServerStatus(false);
  await loadUsage();
  await loadAccounts();
})().catch((e) => console.error(e));
