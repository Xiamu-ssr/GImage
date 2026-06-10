// 认证中间件:基于 express-session。
export function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: '未登录' });
}

export function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ error: '需要管理员权限' });
}
