import { BookOpenText, FolderOpen, LogOut, Settings2, Sparkles } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Me } from '../types';
import { BrandMark } from './BrandMark';

export function AppShell({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await api<{ ok: true }>('/api/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    navigate('/login', { replace: true });
  };
  const initial = me.user.username.slice(0, 1).toUpperCase();

  return <div className="app-frame">
    <aside className="app-sidebar">
      <BrandMark />
      <nav className="primary-nav" aria-label="主导航">
        <NavLink to="/studio" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}><Sparkles size={19} /><span>创作</span></NavLink>
        <NavLink to="/library" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}><FolderOpen size={19} /><span>资产库</span></NavLink>
        {me.user.role === 'admin' && <NavLink to="/knowledge" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}><BookOpenText size={19} /><span>知识工作台</span></NavLink>}
        {me.user.role === 'admin' && <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}><Settings2 size={19} /><span>管理</span></NavLink>}
      </nav>
      <div className="sidebar-footer">
        <div className="account-chip" title={me.user.username}><span className="avatar">{initial}</span><span><b>{me.user.username}</b><small>{me.user.role === 'admin' ? '管理员' : '创作者'}</small></span></div>
        <button className="icon-button subtle" onClick={logout} aria-label="退出登录"><LogOut size={18} /></button>
      </div>
    </aside>
    <main className="app-content"><Outlet context={me} /></main>
  </div>;
}
