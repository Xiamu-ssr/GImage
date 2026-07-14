import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { CheckSquare, Download, ImageOff, LoaderCircle, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { dateHeading, dateTime, modalityLabel, money, shortModel, statusLabel } from '../lib/format';
import type { Asset, Me, Modality } from '../types';
import { MediaPreview } from '../components/MediaPreview';
import { Modal } from '../components/Modal';

const filters: Array<{ value: 'all' | Modality; label: string }> = [{ value: 'all', label: '全部' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }, { value: 'music', label: '音乐' }];

export function LibraryPage() {
  useOutletContext<Me>();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | Modality>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState(false);
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  const assetsQuery = useQuery({
    queryKey: ['assets'],
    queryFn: () => api<Asset[]>('/api/assets'),
    refetchInterval: (query) => query.state.data?.some((asset) => asset.status === 'pending' || asset.status === 'processing') ? 4_000 : false,
  });
  const assets = assetsQuery.data || [];
  const visible = useMemo(() => assets.filter((asset) => (filter === 'all' || asset.modality === filter) && asset.prompt.toLowerCase().includes(search.trim().toLowerCase())), [assets, filter, search]);
  const groups = useMemo(() => Object.values(visible.reduce<Record<string, Asset[]>>((result, asset) => { const key = new Date(asset.createdAt).toISOString().slice(0, 10); (result[key] ||= []).push(asset); return result; }, {})), [visible]);
  const remove = useMutation({ mutationFn: (id: string) => api<{ ok: true }>(`/api/asset/${id}`, { method: 'DELETE' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assets'] }) });
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const openAsset = (asset: Asset) => batch ? toggle(asset.id) : setLightbox(asset);
  const downloadSelected = () => [...selected].forEach((id, index) => { const asset = assets.find((item) => item.id === id); if (!asset || asset.status !== 'done') return; setTimeout(() => { const anchor = document.createElement('a'); anchor.href = asset.downloadUrl; anchor.download = ''; anchor.click(); }, index * 350); });
  const deleteSelected = async () => { if (!selected.size || !window.confirm(`确认删除 ${selected.size} 个资产？此操作不可撤销。`)) return; await Promise.all([...selected].map((id) => remove.mutateAsync(id).catch(() => undefined))); setSelected(new Set()); };

  return <section className="library-page page-shell">
    <header className="page-heading"><div><span className="eyebrow">ASSET LIBRARY</span><h1>作品资产库</h1><p>所有生成结果都在这里，可按类型检索、预览与导出。</p></div><div className="heading-stat"><b>{assets.length}</b><span>全部资产</span></div></header>
    <div className="library-toolbar"><div className="filter-tabs">{filters.map((item) => <button key={item.value} className={filter === item.value ? 'is-active' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索提示词或模型" /></label><button className={`button secondary${batch ? ' is-selected' : ''}`} onClick={() => { setBatch((current) => !current); setSelected(new Set()); }}><CheckSquare size={16} />{batch ? '完成选择' : '批量管理'}</button></div>
    {assetsQuery.isPending ? <div className="loading-block"><LoaderCircle className="spin" size={22} /> 正在加载资产</div> : !visible.length ? <div className="empty-state"><ImageOff size={28} /><h2>{assets.length ? '没有匹配的资产' : '还没有创作资产'}</h2><p>{assets.length ? '试试调整筛选条件或关键词。' : '前往创作工作台完成第一件作品。'}</p></div> : <div className="asset-groups">{groups.map((group) => <section key={group[0].createdAt}><div className="date-divider"><span>{dateHeading(group[0].createdAt)}</span><small>{group.length} 个资产</small></div><div className="asset-grid">{group.map((asset) => <article className={`asset-card${selected.has(asset.id) ? ' is-selected' : ''}`} key={asset.id} tabIndex={0} role="button" onClick={() => openAsset(asset)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAsset(asset); } }} aria-label={`${asset.prompt || '未命名创作'}详情`}>{batch && <button className="selection-check" onClick={(event) => { event.stopPropagation(); toggle(asset.id); }} aria-label="选择资产">{selected.has(asset.id) && <CheckSquare size={17} />}</button>}<MediaPreview asset={asset} className="asset-media" onOpen={() => setLightbox(asset)} /><div className="asset-body"><div className="asset-card-top"><span>{modalityLabel[asset.modality]}</span><span className={`status-chip ${asset.status}`}>{statusLabel[asset.status]}</span></div><h2 title={asset.prompt}>{asset.prompt || '未命名创作'}</h2><p>{shortModel(asset.model)} · {dateTime(asset.createdAt)}</p><footer><span>{asset.cost ? money(asset.cost) : '—'}</span>{!batch && <span className="asset-actions">{asset.status === 'done' && <a href={asset.downloadUrl} download onClick={(event) => event.stopPropagation()} aria-label="下载"><Download size={16} /></a>}<button onClick={(event) => { event.stopPropagation(); if (window.confirm('确认删除此资产？')) remove.mutate(asset.id); }} aria-label="删除"><Trash2 size={16} /></button></span>}</footer></div></article>)}</div></section>)}</div>}
    {batch && <div className="batch-bar"><span><b>{selected.size}</b> 个已选择</span><button className="text-action" onClick={() => setSelected(new Set(visible.map((asset) => asset.id)))}>全选当前结果</button><span className="batch-space" /><button className="button secondary" onClick={downloadSelected} disabled={!selected.size}><Download size={16} />下载</button><button className="button danger" onClick={deleteSelected} disabled={!selected.size || remove.isPending}><Trash2 size={16} />删除</button></div>}
    {lightbox && <Modal title={lightbox.modality === 'video' ? '视频详情' : lightbox.modality === 'music' ? '音频详情' : '图片详情'} onClose={() => setLightbox(null)} className="media-modal"><MediaPreview asset={lightbox} className="asset-detail-media" /><div className="asset-detail"><p>{lightbox.prompt || '未命名创作'}</p><span>{shortModel(lightbox.model)} · {dateTime(lightbox.createdAt)}</span><a className="button secondary" href={lightbox.downloadUrl} download><Download size={16} />下载原文件</a></div></Modal>}
  </section>;
}
