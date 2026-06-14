// 图集逻辑
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  return r;
}

async function init() {
  const me = await (await api('/api/me')).json();
  if (me.user.role === 'admin') document.getElementById('adminLink').style.display = 'inline';

  const items = await (await api('/api/gallery')).json();
  const gallery = document.getElementById('gallery');

  if (!items.length) {
    gallery.innerHTML = '<span class="muted" style="padding:40px">还没有生成过图片,去<a href="/app.html">工作台</a>试试</span>';
    return;
  }

  // 按 session 分组
  const sessions = new Map();
  for (const item of items) {
    const sid = item.sessionId || item.id;
    if (!sessions.has(sid)) sessions.set(sid, []);
    sessions.get(sid).push(item);
  }

  let html = '';
  for (const [sid, group] of sessions) {
    if (sessions.size > 1) {
      const firstTime = group[group.length - 1]?.createdAt;
      html += `<div class="session-sep">会话 · ${fmtTime(firstTime)} · ${group.length} 张</div>`;
    }
    for (const item of group) {
      html += `<div class="g-card">
        <img src="${item.imageUrl}" onclick="openLightbox('${item.imageUrl}')" />
        <div class="meta">
          <div class="prompt">${esc(item.prompt)}</div>
          <div class="info">${item.model?.split('/').pop() || ''} · ${fmtTime(item.createdAt)}${item.cost ? ' · $' + item.cost : ''}${item.params ? ' · ' + paramStr(item.params) : ''}</div>
        </div>
        <div class="actions">
          <a href="${item.downloadUrl}" class="btn ghost" style="font-size:12px;padding:5px 10px" download>下载原图</a>
        </div>
      </div>`;
    }
  }
  gallery.innerHTML = html;
}

function openLightbox(url) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<span class="close">&times;</span><img src="${url}" />`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtTime(s) { return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : ''; }
function paramStr(p) { return Object.entries(p || {}).map(([k,v]) => `${k}:${v}`).join(' '); }

document.getElementById('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
};

init().catch(console.error);
