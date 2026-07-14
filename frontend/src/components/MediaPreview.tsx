import { useRef, useState } from 'react';
import { Expand, Music2, Pause, Play } from 'lucide-react';
import type { Asset } from '../types';

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function AudioPreview({ asset, className, onOpen }: { asset: Asset; className: string; onOpen?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const toggle = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play(); else audio.pause();
  };
  const seek = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const next = Number(event.target.value);
    if (audioRef.current) audioRef.current.currentTime = next;
    setCurrent(next);
  };

  return <div className={`audio-preview ${className}`} onClick={stop} onPointerDown={stop}>
    <audio ref={audioRef} src={asset.assetUrl} preload="metadata" onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <div className="audio-preview-top">
      <span className="audio-icon"><Music2 size={20} /></span>
      <button type="button" className="audio-play" onClick={toggle} aria-label={playing ? '暂停音频' : '播放音频'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
      <span className="audio-time">{clock(current)} <i>/</i> {clock(duration)}</span>
      {onOpen && <button type="button" className="audio-expand" onClick={(event) => { event.stopPropagation(); onOpen(); }} aria-label="查看音频详情"><Expand size={16} /></button>}
    </div>
    <input className="audio-progress" aria-label="音频进度" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(current, duration || 0)} style={{ '--progress': `${duration ? (current / duration) * 100 : 0}%` } as React.CSSProperties} onChange={seek} onClick={stop} disabled={!duration} />
  </div>;
}

export function MediaPreview({ asset, className = '', onOpen }: { asset: Asset; className?: string; onOpen?: () => void }) {
  if (asset.status !== 'done') {
    return <div className={`media-placeholder ${asset.status === 'failed' ? 'is-error' : ''} ${className}`}>
      {asset.status === 'failed' ? <span>{asset.error || '任务未完成'}</span> : <><i className="spinner" /> <span>{asset.status === 'pending' ? '等待任务开始' : '正在生成内容'}</span></>}
    </div>;
  }
  if (asset.modality === 'video') return <button className={`media-preview is-video ${className}`} onClick={onOpen} aria-label="播放视频"><video src={asset.assetUrl} muted preload="metadata" /><span className="play-badge"><Play size={18} fill="currentColor" /></span></button>;
  if (asset.modality === 'music') return <AudioPreview asset={asset} className={className} onOpen={onOpen} />;
  return <button className={`media-preview ${className}`} onClick={onOpen} aria-label="查看图片"><img src={asset.assetUrl} alt={asset.prompt || 'AI 生成图片'} loading="lazy" /></button>;
}
