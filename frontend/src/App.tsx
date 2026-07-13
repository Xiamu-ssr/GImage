import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import type { Me } from './types';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';
import { StudioPage } from './pages/StudioPage';
import { LibraryPage } from './pages/LibraryPage';
import { AdminPage } from './pages/AdminPage';

const KnowledgePage = lazy(async () => ({ default: (await import('./pages/KnowledgePage')).KnowledgePage }));

function ProtectedLayout() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me') });
  if (me.isPending) return <div className="boot-screen"><LoaderCircle className="spin" size={26} /><span>正在加载工作台</span></div>;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  return <AppShell me={me.data} />;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedLayout />}>
      <Route path="/studio" element={<StudioPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/knowledge" element={<Suspense fallback={<div className="boot-screen"><LoaderCircle className="spin" size={26} /><span>正在打开知识工作台</span></div>}><KnowledgePage /></Suspense>} />
    </Route>
    <Route path="*" element={<Navigate to="/studio" replace />} />
  </Routes>;
}
