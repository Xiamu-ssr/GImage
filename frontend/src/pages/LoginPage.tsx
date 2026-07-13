import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, KeyRound, LoaderCircle, LockKeyhole, Sparkles, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../lib/api';
import type { Me } from '../types';
import { CinematicBackdrop } from '../components/CinematicBackdrop';

const schema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [entered, setEntered] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const login = useMutation({
    mutationFn: (values: FormValues) => api<{ ok: true; user: Me['user'] }>('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['me'] }); navigate('/studio', { replace: true }); },
  });
  useEffect(() => { const id = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(id); }, []);

  if (queryClient.getQueryData(['me'])) return <Navigate to="/studio" replace />;
  return <main className="min-h-screen overflow-x-hidden bg-black text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
    <CinematicBackdrop dimmed />
    <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-6 sm:px-10 sm:py-8"><Link to="/" className="text-[17px] font-semibold tracking-tight">GImage<sup className="ml-0.5 text-[8px] font-medium">AI</sup></Link><Link to="/" className="liquid-glass rounded-full px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white">BACK HOME</Link></header>
    <div className={`relative z-20 mx-auto flex min-h-screen w-full max-w-[1160px] items-center px-5 pb-8 pt-24 transition-all duration-1000 sm:px-10 ${entered ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
      <section className="grid w-full items-end gap-12 lg:grid-cols-[1fr_430px] lg:gap-24">
        <div className="hidden max-w-[560px] lg:block"><p className="mb-5 flex items-center gap-2 text-[10px] font-medium tracking-[0.22em] text-white/60"><Sparkles size={13} strokeWidth={1.5} /> PRIVATE MULTIMODAL STUDIO</p><h1 className="font-display text-[clamp(48px,5.2vw,72px)] leading-[1.03] tracking-[-0.04em]">创作无需<br /><span className="text-white/55">妥协或绕路。</span></h1><p className="mt-7 max-w-[410px] text-[15px] leading-relaxed text-white/70">一个安静、专属且可靠的空间，让图像、视频与音乐自然汇聚为完整的作品。</p></div>
        <form className="liquid-glass mx-auto w-full max-w-[430px] rounded-[24px] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.26)] backdrop-blur-[9px] sm:p-8" onSubmit={form.handleSubmit((values) => login.mutate(values))} noValidate>
          <p className="text-[10px] font-medium tracking-[0.18em] text-white/60">WELCOME BACK</p><h2 className="mt-3 text-[29px] font-medium tracking-[-0.05em]">进入工作台</h2><p className="mt-2 text-[13px] leading-relaxed text-white/60">使用管理员创建的账号继续你的创作。</p>
          <div className="mt-8 grid gap-5"><label className="grid gap-2 text-[11px] font-medium text-white/85"><span>用户名</span><span className="flex h-12 items-center gap-3 rounded-xl border border-white/15 bg-black/15 px-4 text-white/50 transition focus-within:border-white/45 focus-within:bg-black/25"><UserRound size={17} strokeWidth={1.5} /><input autoComplete="username" {...form.register('username')} placeholder="输入用户名" className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35" /></span>{form.formState.errors.username && <em className="not-italic text-[11px] text-red-200">{form.formState.errors.username.message}</em>}</label>
            <label className="grid gap-2 text-[11px] font-medium text-white/85"><span>密码</span><span className="flex h-12 items-center gap-3 rounded-xl border border-white/15 bg-black/15 px-4 text-white/50 transition focus-within:border-white/45 focus-within:bg-black/25"><KeyRound size={17} strokeWidth={1.5} /><input type="password" autoComplete="current-password" {...form.register('password')} placeholder="输入密码" className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35" /></span>{form.formState.errors.password && <em className="not-italic text-[11px] text-red-200">{form.formState.errors.password.message}</em>}</label></div>
          {login.error && <div className="mt-5 text-[12px] text-red-200" role="alert">{login.error.message}</div>}
          <button className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[13px] font-medium text-black transition duration-200 hover:scale-[1.02] hover:shadow-[0_0_32px_4px_rgba(255,255,255,0.18)] active:scale-[0.98]" disabled={login.isPending}>{login.isPending ? <LoaderCircle className="spin" size={18} /> : <>进入工作台 <ArrowRight size={17} /></>}</button>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-[10px] font-medium tracking-[0.12em] text-white/55"><LockKeyhole size={12} strokeWidth={1.5} /> SESSION PROTECTED · LOCAL ASSETS</p>
        </form>
      </section>
    </div>
  </main>;
}
