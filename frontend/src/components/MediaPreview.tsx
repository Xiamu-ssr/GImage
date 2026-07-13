import { Music2, Play } from 'lucide-react';
import type { Asset } from '../types';

export function MediaPreview({ asset, className = '', onOpen }: { asset: Asset; className?: string; onOpen?: () => void }) {
  if (asset.status !== 'done') {
    return <div className={`media-placeholder ${asset.status === 'failed' ? 'is-error' : ''} ${className}`}>
      {asset.status === 'failed' ? <span>{asset.error || '任务未完成'}</span> : <><i className="spinner" /> <span>{asset.status === 'pending' ? '等待任务开始' : '正在生成内容'}</span></>}
    </div>;
  }
  if (asset.modality === 'video') {
    return <button className={`media-preview is-video ${className}`} onClick={onOpen} aria-label="播放视频"><video src={asset.assetUrl} muted preload="metadata" /><span className="play-badge"><Play size={18} fill="currentColor" /></span></button>;
  }
  if (asset.modality === 'music') {
    return <div className={`audio-preview ${className}`}><span className="audio-icon"><Music2 size={21} /></span><audio src={asset.assetUrl} controls preload="metadata" /></div>;
  }
  return <button className={`media-preview ${className}`} onClick={onOpen} aria-label="查看图片"><img src={asset.assetUrl} alt={asset.prompt || 'AI 生成图片'} loading="lazy" /></button>;
}
