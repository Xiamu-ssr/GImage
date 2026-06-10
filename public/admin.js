// 管理后台逻辑
const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  if (r.status === 403) { location.href = '/app.html'; throw new Error('无权限'); }
  return r;
}

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

(async () => {
  await loadUsage();
  await loadAccounts();
})().catch((e) => console.error(e));
