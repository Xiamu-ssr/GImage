import { $ } from './dom.js';
import { api, apiJson } from './api.js';

/** 加载当前用户信息;若页面上有 #adminLink,管理员自动显示。 */
export async function loadMe() {
  const me = await apiJson('/api/me');
  const adminLink = $('adminLink');
  if (adminLink && me.user.role === 'admin') adminLink.style.display = '';
  return me;
}

export function wireLogout(id = 'logoutBtn') {
  const btn = $(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/';
  });
}
