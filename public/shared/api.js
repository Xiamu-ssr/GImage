export async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/'; throw new Error('未登录'); }
  return r;
}

export async function apiJson(url, opts) {
  return (await api(url, opts)).json();
}

export const ct = { 'Content-Type': 'application/json' };
