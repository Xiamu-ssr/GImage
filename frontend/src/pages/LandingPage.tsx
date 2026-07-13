import { useEffect, useState } from 'react';
import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CinematicBackdrop } from '../components/CinematicBackdrop';

export function LandingPage() {
  const [entered, setEntered] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(id); }, []);
  const reveal = entered ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0';

  return <main className="min-h-screen overflow-x-hidden bg-black text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
    <CinematicBackdrop />
    <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-6 sm:px-10 sm:py-8">
      <Link to="/" className="relative z-10 text-[17px] font-semibold tracking-tight">GImage<sup className="ml-0.5 text-[8px] font-medium">AI</sup></Link>
      <nav aria-label="游客导航" className="liquid-glass relative hidden items-center gap-1 rounded-full px-2 py-2 md:flex">
        <a href="#create" className="rounded-full px-4 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white">CREATE</a>
        <a href="#workflow" className="rounded-full px-4 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white">WORKFLOW</a>
        <a href="#assets" className="rounded-full px-4 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white">ASSETS</a>
        <a href="#guide" className="rounded-full px-4 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white">GUIDE</a>
      </nav>
      <Link to="/login" className="liquid-glass relative rounded-full px-4 py-2.5 text-[10px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white sm:px-5 sm:text-[11px]">SIGN IN</Link>
    </header>

    <section id="create" className={`fixed left-1/2 top-[120px] z-20 w-[min(100%-32px,1100px)] -translate-x-1/2 text-center transition-all duration-1000 ${reveal}`}>
      <p className="mb-5 flex items-center justify-center gap-2 text-[10px] font-medium tracking-[0.22em] text-white/60"><Sparkles size={13} strokeWidth={1.5} /> PRIVATE MULTIMODAL STUDIO</p>
      <h1 className="font-display text-[clamp(40px,5.4vw,72px)] font-normal leading-[1.1] tracking-[-0.02em]">让灵感突破边界。</h1>
      <p className="font-display text-[clamp(40px,5.4vw,72px)] font-normal leading-[1.1] tracking-[-0.02em] text-white/55">以敏锐直觉，探索并创造。</p>
    </section>

    <section className={`fixed inset-x-0 bottom-10 z-20 mx-auto flex max-w-[680px] flex-col items-center gap-5 px-6 text-center transition-all delay-300 duration-1000 sm:bottom-14 sm:gap-6 ${reveal}`}>
      <p className="text-[14px] leading-relaxed text-white sm:text-[15px]">你的图像、视频与音乐创作围绕你展开——你的节奏、审美与探索欲。<span className="text-white/55"> 每一段作品都清晰、连续，并完全由你掌控。</span></p>
      <Link to="/login" className="group rounded-full bg-white px-7 py-3.5 text-[14px] font-medium text-black transition duration-200 hover:scale-[1.03] hover:shadow-[0_0_32px_4px_rgba(255,255,255,0.2)] active:scale-[0.97] sm:px-8 sm:text-[15px]">开始你的创作 <ArrowUpRight className="ml-1 inline-block transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" size={16} /></Link>
      <span className="flex items-center gap-2 text-[10px] font-medium tracking-[0.14em] text-white/70 sm:text-[11px]"><LockKeyhole size={13} strokeWidth={1.5} /> SECURE BY DESIGN. YOUR DATA STAYS YOURS.</span>
    </section>
  </main>;
}
