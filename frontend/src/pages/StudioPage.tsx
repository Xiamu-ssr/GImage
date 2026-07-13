import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Check, ChevronDown, ImagePlus, Layers3, LoaderCircle, Music2, Plus, Send, Sparkles, Video, Wand2, X } from 'lucide-react';
import { api } from '../lib/api';
import { money, shortModel, statusLabel } from '../lib/format';
import type { Asset, GenerateResult, Me, Model, Modality } from '../types';
import { MediaPreview } from '../components/MediaPreview';
import { Modal } from '../components/Modal';

type Reference = { id: string; kind: 'file'; file: File } | { id: string; kind: 'asset'; asset: Asset };

const modes: Array<{ id: Modality; title: string; description: string; icon: typeof Sparkles }> = [
  { id: 'image', title: '图片', description: '视觉与编辑', icon: ImagePlus },
  { id: 'video', title: '视频', description: '动态与运镜', icon: Video },
  { id: 'music', title: '音乐', description: '氛围与旋律', icon: Music2 },
];

const quickPrompts: Record<Modality, string[]> = {
  image: ['编辑感产品静物，通透玻璃与柔和晨光', '雨后城市街角，胶片颗粒，低饱和电影感', '一只奔跑的柯基，雪地逆光，浅景深'],
  video: ['海浪拍打礁石，慢镜头，日落金色光线', '宇航员漫步在火星表面，广角，红色尘埃', '花朵从含苞到盛开，延时摄影，纯色背景'],
  music: ['克制而温暖的钢琴独奏，适合雨夜阅读', '城市感流行音乐，轻快节拍与清透女声', '史诗电影配乐，渐进式弦乐与恢弘鼓点'],
};

function defaults(model?: Model) {
  return Object.fromEntries(Object.entries(model?.params || {}).map(([key, config]) => [key, config.default ?? (config.type === 'boolean' ? false : '')]));
}

function assetSession(asset: Asset) { return asset.sessionId || asset.id; }

export function StudioPage() {
  const me = useOutletContext<Me>();
  const queryClient = useQueryClient();
  const [modality, setModality] = useState<Modality>('image');
  const [modelId, setModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const [references, setReferences] = useState<Reference[]>([]);
  const [referenceAudio, setReferenceAudio] = useState<File | null>(null);
  const [coverFeatureId, setCoverFeatureId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [assetPicker, setAssetPicker] = useState(false);
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  const [notice, setNotice] = useState('');

  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: () => api<Model[]>('/api/models') });
  const historyQuery = useQuery({
    queryKey: ['history'],
    queryFn: () => api<Asset[]>('/api/history'),
    refetchInterval: (query) => query.state.data?.some((asset) => asset.status === 'pending' || asset.status === 'processing') ? 4_000 : false,
  });
  const assetsQuery = useQuery({ queryKey: ['assets'], queryFn: () => api<Asset[]>('/api/assets'), staleTime: 30_000 });
  const models = modelsQuery.data || [];
  const modalityModels = models.filter((model) => model.modality === modality);
  const selectedModel = modalityModels.find((model) => model.id === modelId) || modalityModels[0];
  const maxReferences = selectedModel?.maxRefImages || 0;
  const isCoverModel = selectedModel?.protocol === 'minimax-cover';

  useEffect(() => {
    const model = modalityModels.find((item) => item.id === modelId) || modalityModels.find((item) => item.default) || modalityModels[0];
    if (model?.id !== modelId) setModelId(model?.id || '');
    if (model) setParams(defaults(model));
    setReferences([]);
    setReferenceAudio(null);
    setCoverFeatureId(null);
  // Switching modality intentionally resets model-specific state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modality, modelsQuery.data]);

  const previewUrls = useMemo(() => references.map((reference) => reference.kind === 'asset' ? reference.asset.assetUrl : URL.createObjectURL(reference.file)), [references]);
  useEffect(() => () => previewUrls.forEach((url, index) => { if (references[index]?.kind === 'file') URL.revokeObjectURL(url); }), [previewUrls, references]);

  const sessions = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of historyQuery.data || []) {
      const id = assetSession(asset);
      map.set(id, [...(map.get(id) || []), asset]);
    }
    return [...map.entries()].map(([id, items]) => ({ id, items: items.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)) }));
  }, [historyQuery.data]);
  const activeSession = sessions.find((session) => session.id === sessionId)?.items || [];

  const generate = useMutation({
    mutationFn: async () => {
      if (!selectedModel) throw new Error('请先选择模型');
      if (selectedModel.protocol === 'minimax-cover' && !referenceAudio) throw new Error('翻唱模式需要上传参考音频');
      const data = new FormData();
      data.append('model', selectedModel.id);
      data.append('prompt', prompt.trim());
      data.append('params', JSON.stringify(params));
      if (sessionId) data.append('sessionId', sessionId);
      const assetIds = references.filter((reference): reference is Extract<Reference, { kind: 'asset' }> => reference.kind === 'asset').map((reference) => reference.asset.id);
      if (assetIds.length) data.append('refAssetIds', JSON.stringify(assetIds));
      references.forEach((reference) => { if (reference.kind === 'file') data.append('refImages', reference.file); });
      if (coverFeatureId) data.append('coverFeatureId', coverFeatureId);
      if (referenceAudio && !coverFeatureId) data.append('refAudio', referenceAudio);
      return api<GenerateResult>('/api/generate', { method: 'POST', body: data });
    },
    onSuccess: async (result) => {
      setSessionId(result.sessionId);
      setPrompt(''); setReferences([]); setReferenceAudio(null); setCoverFeatureId(null);
      setNotice(result.status === 'pending' ? '视频任务已提交，完成后会自动更新。' : '创作已保存到当前会话。');
      queryClient.setQueryData<Me>(['me'], (current) => current ? { ...current, spent: result.spent, remaining: result.remaining } : current);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['history'] }), queryClient.invalidateQueries({ queryKey: ['assets'] })]);
    },
  });
  const preprocessCover = useMutation({
    mutationFn: async () => {
      if (!referenceAudio) throw new Error('请先上传参考音频');
      const data = new FormData();
      data.append('refAudio', referenceAudio);
      return api<{ ok: true; coverFeatureId: string; lyrics: string }>('/api/music-cover/preprocess', { method: 'POST', body: data });
    },
    onSuccess: (result) => {
      setCoverFeatureId(result.coverFeatureId);
      if (result.lyrics) setParams((current) => ({ ...current, lyrics: result.lyrics }));
      setNotice('已提取可编辑歌词与翻唱特征；该高级特征 24 小时内有效。');
    },
  });

  const chooseSession = (target: { id: string; items: Asset[] }) => {
    const last = target.items.at(-1);
    setSessionId(target.id);
    if (last) {
      setModality(last.modality);
      setModelId(last.model);
      setParams(defaults(models.find((model) => model.id === last.model)));
    }
  };
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = Math.max(0, maxReferences - references.length);
    const accepted = [...files].filter((file) => file.type.startsWith('image/')).slice(0, room);
    setReferences((current) => [...current, ...accepted.map((file) => ({ id: crypto.randomUUID(), kind: 'file' as const, file }))]);
    if (accepted.length < files.length) setNotice(`当前模型最多添加 ${maxReferences} 张参考图。`);
  };

  return <div className="studio-page">
    <aside className="session-panel">
      <button className="button new-session" onClick={() => { setSessionId(null); setPrompt(''); setReferences([]); setReferenceAudio(null); setCoverFeatureId(null); setNotice(''); }}><Plus size={17} /> 新建创作</button>
      <div className="session-label">近期会话</div>
      <div className="session-list">
        {sessions.map((session) => { const first = session.items[0]; const mode = modes.find((item) => item.id === first.modality)!; const Icon = mode.icon; return <button key={session.id} className={`session-item${session.id === sessionId ? ' is-active' : ''}`} onClick={() => chooseSession(session)}><Icon size={15} /><span>{first.prompt || '未命名创作'}</span><small>{session.items.length}</small></button>; })}
        {!sessions.length && <p className="quiet-copy">尚无历史创作。开始第一条灵感吧。</p>}
      </div>
    </aside>

    <section className="studio-main">
      <header className="studio-header"><div><span className="eyebrow">CREATIVE STUDIO</span><h1>{sessionId ? '继续你的创作' : '把灵感变成作品'}</h1></div><div className="credit-card"><span>今日可用额度</span><b>{money(me.remaining)}</b><small>共 {money(me.dailyBudget)}</small></div></header>
      <div className="canvas-scroll">
        {!sessionId && !activeSession.length && <section className="studio-welcome"><span className="welcome-orb"><Sparkles size={26} /></span><h2>从一个清晰的想法开始</h2><p>选择创作类型，描述你想看到、听到或感受到的内容。</p><div className="quick-prompt-grid">{quickPrompts[modality].map((item) => <button key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div></section>}
        {activeSession.map((asset) => <article className="creation-turn" key={asset.id}><div className="prompt-turn"><span className="turn-label">你的描述</span><p>{asset.prompt}</p>{asset.inputUrls?.length ? <div className="inline-references">{asset.inputUrls.map((url) => <img src={url} alt="参考图" key={url} />)}</div> : null}</div><div className="result-turn"><div className="result-meta"><span>{shortModel(asset.model)}</span><span>{asset.cost ? money(asset.cost) : '—'}</span><span className={`status-dot ${asset.status}`}>{statusLabel[asset.status]}</span></div><MediaPreview asset={asset} onOpen={() => setLightbox(asset)} /><div className="result-actions">{asset.status === 'done' && <a href={asset.downloadUrl} className="text-action" download>下载原文件</a>}</div></div></article>)}
      </div>

      <form className="composer" onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) generate.mutate(); }}>
        <div className="mode-tabs" role="tablist">{modes.map((mode) => { const Icon = mode.icon; return <button type="button" role="tab" aria-selected={mode.id === modality} className={mode.id === modality ? 'is-active' : ''} onClick={() => setModality(mode.id)}><Icon size={16} /> {mode.title}</button>; })}</div>
        <div className="composer-top"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={modality === 'video' ? '描述画面、动作、镜头与节奏…' : isCoverModel ? '描述希望转换出的翻唱风格、情绪与编配…' : modality === 'music' ? '描述音乐的风格、情绪与场景…' : '描述你想要创作的画面…'} rows={3} maxLength={4000} />{maxReferences > 0 && <label className="add-reference"><ImagePlus size={18} /><span>本地参考图</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} /></label>}{isCoverModel && <label className="add-reference"><Music2 size={18} /><span>参考音频</span><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg" hidden onChange={(event) => { setReferenceAudio(event.target.files?.[0] || null); setCoverFeatureId(null); event.currentTarget.value = ''; }} /></label>}</div>
        {isCoverModel && <div className="audio-reference-row">{referenceAudio ? <><Music2 size={16} /><span>{referenceAudio.name}</span><small>{(referenceAudio.size / 1024 / 1024).toFixed(1)} MB</small>{coverFeatureId ? <small className="cover-ready">高级特征已就绪</small> : <button type="button" className="cover-preprocess" onClick={() => preprocessCover.mutate()} disabled={preprocessCover.isPending}>{preprocessCover.isPending ? <LoaderCircle className="spin" size={13} /> : <><Wand2 size={13} /> 提取歌词</>}</button>}<button type="button" onClick={() => { setReferenceAudio(null); setCoverFeatureId(null); }} aria-label="移除参考音频"><X size={14} /></button></> : <span>请上传 6 秒到 6 分钟、最大 50MB 的参考音频。</span>}</div>}
        {references.length > 0 && <div className="reference-row">{references.map((reference, index) => <div className="reference-thumb" key={reference.id}><img src={previewUrls[index]} alt="待提交参考图" /><button type="button" onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))} aria-label="移除参考图"><X size={13} /></button></div>)}<button type="button" className="asset-picker-button" onClick={() => setAssetPicker(true)} disabled={references.length >= maxReferences}><Layers3 size={16} /> 从资产库添加</button></div>}
        <div className="composer-controls"><label className="select-control"><span>模型</span><select value={selectedModel?.id || ''} onChange={(event) => { const next = models.find((model) => model.id === event.target.value); setModelId(event.target.value); setParams(defaults(next)); setReferences([]); setReferenceAudio(null); setCoverFeatureId(null); }}><option value="" disabled>选择模型</option>{modalityModels.map((model) => <option value={model.id} key={model.id}>{model.label} · {money(model.costUSD)}</option>)}</select><ChevronDown size={15} /></label>
          {Object.entries(selectedModel?.params || {}).filter(([, config]) => config.type !== 'textarea').map(([key, config]) => config.type === 'boolean' ? <label className="check-control" key={key}><input type="checkbox" checked={Boolean(params[key])} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.checked }))} />{config.label}</label> : <label className="select-control compact" key={key}><span>{config.label}</span><select value={String(params[key] ?? '')} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))}>{config.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={14} /></label>)}
          <span className="composer-spacer" /><span className="model-cost">{selectedModel ? money(selectedModel.costUSD) : '—'} / 次</span><button className="button primary generate-button" disabled={generate.isPending || !prompt.trim() || (isCoverModel && !referenceAudio)}>{generate.isPending ? <LoaderCircle className="spin" size={18} /> : <><span>生成</span><Send size={16} /></>}</button></div>
        {Object.entries(selectedModel?.params || {}).filter(([, config]) => config.type === 'textarea').map(([key, config]) => <label className="secondary-textarea" key={key}><span>{config.label}</span><textarea rows={3} value={String(params[key] || '')} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))} placeholder={isCoverModel ? '留空时 MiniMax 会从参考音频识别歌词' : '留空时可通过“自动写词”由 MiniMax 生成'} /></label>)}
        {(generate.error || notice) && <p className={generate.error ? 'composer-message error' : 'composer-message'}>{generate.error?.message || notice}</p>}
      </form>
    </section>

    {assetPicker && <AssetPicker assets={(assetsQuery.data || []).filter((asset) => asset.modality === 'image' && asset.status === 'done')} max={maxReferences - references.length} selected={references.filter((reference): reference is Extract<Reference, { kind: 'asset' }> => reference.kind === 'asset').map((reference) => reference.asset.id)} onClose={() => setAssetPicker(false)} onAdd={(assets) => { setReferences((current) => [...current, ...assets.map((asset) => ({ id: crypto.randomUUID(), kind: 'asset' as const, asset }))]); setAssetPicker(false); }} />}
    {lightbox && <Modal title={lightbox.modality === 'video' ? '视频预览' : '图片预览'} onClose={() => setLightbox(null)} className="media-modal"><MediaPreview asset={lightbox} /></Modal>}
  </div>;
}

function AssetPicker({ assets, max, selected, onClose, onAdd }: { assets: Asset[]; max: number; selected: string[]; onClose: () => void; onAdd: (assets: Asset[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return <Modal title="从资产库选择参考图" onClose={onClose} className="asset-picker-modal"><p className="form-hint">还可添加 {max} 张。已添加的资产不会重复显示。</p><div className="asset-picker-grid">{assets.filter((asset) => !selected.includes(asset.id)).map((asset) => <button key={asset.id} className={picked.includes(asset.id) ? 'is-picked' : ''} onClick={() => setPicked((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : current.length < max ? [...current, asset.id] : current)}><img src={asset.assetUrl} alt={asset.prompt} /><span><Check size={15} /></span></button>)}{!assets.length && <p className="quiet-copy">资产库中还没有可用的图片。</p>}</div><footer className="modal-footer"><span className="form-hint">已选择 {picked.length} / {max}</span><button className="button primary" onClick={() => onAdd(assets.filter((asset) => picked.includes(asset.id)))} disabled={!picked.length}>添加参考图</button></footer></Modal>;
}
