import { useEffect, useRef } from 'react';
import gsap from 'gsap';

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260510_060007_60275ce7-030c-4668-a160-8f364ec537d3.mp4';

export function CinematicBackdrop({ dimmed = false }: { dimmed?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let targetX = 0; let targetY = 0; let currentX = 0; let currentY = 0; let frame = 0;
    const onMove = (event: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      targetX = ((event.clientX - centerX) / centerX) * 20;
      targetY = ((event.clientY - centerY) / centerY) * 20;
    };
    const animate = () => {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      if (videoRef.current) gsap.set(videoRef.current, { x: currentX, y: currentY });
      frame = requestAnimationFrame(animate);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    frame = requestAnimationFrame(animate);
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(frame); };
  }, []);

  return <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden bg-black">
    <video ref={videoRef} src={VIDEO_URL} autoPlay muted loop playsInline onLoadedMetadata={(event) => { event.currentTarget.playbackRate = 1.25; }} className="h-full w-full scale-[1.08] origin-center object-cover" />
    <div className={`absolute inset-0 ${dimmed ? 'bg-black/60' : 'bg-black/35'}`} />
    <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-black/70" />
  </div>;
}
