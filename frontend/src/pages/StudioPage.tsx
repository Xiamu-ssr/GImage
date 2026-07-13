import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import {
  ArrowUpRight, Check, ChevronDown, ImagePlus, Layers3, Library,
  LoaderCircle, Music2, Plus, Send, SlidersHorizontal, Sparkles, Upload, Video, Wand2, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { money, shortModel, statusLabel } from '../lib/format';
import type { Asset, GenerateResult, Me, Model, Modality } from '../types';
import { MediaPreview } from '../components/MediaPreview';
import { Modal } from '../components/Modal';

type Reference = { id: string; kind: 'file'; file: File } | { id: string; kind: 'asset'; asset: Asset };

const modes: Array<{ id: Modality; title: string; description: string; icon: typeof Sparkles }> = [
  { id: 'image', title: '静帧', description: '把一个构图、一束光或一次重写变得可见。', icon: ImagePlus },
  { id: 'video', title: '动态', description: '描述画面如何呼吸、移动与停留。', icon: Video },
  { id: 'music', title: '声场', description: '从情绪、歌词与参考旋律开始编排。', icon: Music2 },
];

const quickPrompts: Record<Modality, string[]> = {
  image: ['晨光穿过透明玻璃，极简产品静物', '雨后城市街角，低饱和胶片电影感', '雪地逆光中奔跑的柯基，浅景深'],
  video: ['海浪拍打礁石，慢镜头，日落金色光线', '宇航员漫步火星，广角与红色尘埃', '花朵从含苞到盛开，安静的延时摄影'],
  music: ['温暖的钢琴独奏，适合雨夜阅读', '城市感流行音乐，清透而克制的女声', '渐进式弦乐与鼓点，电影感配乐'],
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
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

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
  const selectedMode = modes.find((mode) => mode.id === modality)!;

  useEffect(() => {
    const model = modalityModels.find((item) => item.id === modelId) || modalityModels.find((item) => item.default) || modalityModels[0];
    if (model?.id !== modelId) setModelId(model?.id || '');
    if (model) setParams(defaults(model));
    setReferences([]);
    setReferenceAudio(null);
    setCoverFeatureId(null);
    setModelPickerOpen(false);
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
    return [...map.entries()]
      .map(([id, items]) => ({ id, items: items.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)) }))
      .sort((a, b) => +new Date(b.items.at(-1)?.createdAt || 0) - +new Date(a.items.at(-1)?.createdAt || 0));
  }, [historyQuery.data]);
  const activeSession = sessions.find((session) => session.id === sessionId)?.items || [];

  const generate = useMutation({
    mutationFn: async () => {
      if (!selectedModel) throw new Error('请先选择模型');
      if (isCoverModel && !referenceAudio) throw new Error('翻唱模式需要上传参考音频');
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
      setNotice(result.status === 'pending' ? '动态片段已经送入队列，完成后会自动回到这里。' : '作品已归档到当前创作线。');
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
      setNotice('参考音频已解析：歌词可编辑，翻唱特征会在 24 小时内保留。');
    },
  });

  const resetDraft = () => {
    setSessionId(null); setPrompt(''); setReferences([]); setReferenceAudio(null); setCoverFeatureId(null); setNotice('');
  };
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
  const changeModel = (nextId: string) => {
    const next = models.find((model) => model.id === nextId);
    setModelId(nextId); setParams(defaults(next)); setReferences([]); setReferenceAudio(null); setCoverFeatureId(null); setModelPickerOpen(false);
  };

  return <div className="atelier-page">
    <header className="atelier-header">
      <div><h1>{sessionId ? '沿着这条创作线，继续。' : '把一个感觉，做成作品。'}</h1></div>
      <div className="atelier-credit"><span>今日可用</span><b>{money(me.remaining)}</b><small>预算 {money(me.dailyBudget)}</small></div>
    </header>

    <div className="atelier-layout">
      <aside className="atelier-rail">
        <button className="atelier-new" onClick={resetDraft}><Plus size={17} />新建一条创作线</button>
        <div className="atelier-session-list">
          {sessions.map((session) => {
            const first = session.items[0];
            const mode = modes.find((item) => item.id === first.modality)!;
            const Icon = mode.icon;
            return <button key={session.id} className={`atelier-session${session.id === sessionId ? ' is-active' : ''}`} onClick={() => chooseSession(session)}>
              <span><Icon size={15} /></span><div><b>{first.prompt || '未命名创作'}</b><small>{mode.title} · {session.items.length} 个版本</small></div>
            </button>;
          })}
          {!sessions.length && <div className="atelier-rail-empty"><Library size={21} /><span>作品会按创作线留在这里。</span></div>}
        </div>
      </aside>

      <main className="atelier-workspace">
        <div className="atelier-mode-row" role="tablist" aria-label="创作类型">
          {modes.map((mode) => { const Icon = mode.icon; return <button key={mode.id} type="button" role="tab" aria-selected={mode.id === modality} className={`atelier-mode${mode.id === modality ? ' is-active' : ''}`} onClick={() => setModality(mode.id)}><Icon size={18} /><span><b>{mode.title}</b></span></button>; })}
        </div>

        <section className="atelier-brief">
          <div className="atelier-brief-head"><div><h2>{selectedMode.title}</h2><p>{selectedMode.description}</p></div><div className="atelier-model-menu"><button type="button" className="atelier-model-trigger" aria-haspopup="listbox" aria-expanded={modelPickerOpen} onClick={() => setModelPickerOpen((current) => !current)}><span>模型</span><b>{selectedModel?.label || '选择模型'}</b><ChevronDown size={16} /></button>{modelPickerOpen && <div className="atelier-model-options" role="listbox">{modalityModels.map((model) => <button type="button" key={model.id} role="option" aria-selected={model.id === selectedModel?.id} className={model.id === selectedModel?.id ? 'is-selected' : ''} onClick={() => changeModel(model.id)}><b>{model.label}</b><span>{model.note || money(model.costUSD)}</span></button>)}</div>}</div></div>
          {selectedModel?.note && <div className="atelier-model-note"><Sparkles size={14} /><span>{selectedModel.note}</span></div>}
          <textarea className="atelier-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} placeholder={modality === 'video' ? '说清楚镜头里的画面、运动、节奏与停顿…' : isCoverModel ? '说明希望保留什么旋律，以及想把唱法、情绪和编配带去哪里…' : modality === 'music' ? '从声音、情绪、场景或一句歌词开始描述…' : '描述构图、材质、光线、情绪，或你想要改写的地方…'} />
          <div className="atelier-suggestions">{quickPrompts[modality].map((item) => <button type="button" key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div>
        </section>

        <section className="atelier-materials">
          <div className="atelier-material-head"><div><span>创作设置</span></div><SlidersHorizontal size={18} /></div>
          <div className="atelier-material-grid">
            {maxReferences > 0 && <div className="atelier-material-card"><div className="atelier-card-title"><ImagePlus size={16} /><span>视觉参考</span><small>{references.length} / {maxReferences}</small></div><div className="atelier-reference-shelf">{references.map((reference, index) => <div className="atelier-reference" key={reference.id}><img src={previewUrls[index]} alt="待提交参考图" /><button type="button" onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))} aria-label="移除参考图"><X size={13} /></button></div>)}{references.length < maxReferences && <label className="atelier-upload-tile"><Upload size={17} /><span>上传</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} /></label>}<button type="button" className="atelier-library-tile" onClick={() => setAssetPicker(true)} disabled={references.length >= maxReferences}><Layers3 size={16} /><span>资产库</span></button></div></div>}
            {isCoverModel && <div className="atelier-material-card wide"><div className="atelier-card-title"><Music2 size={16} /><span>旋律参考</span>{coverFeatureId && <small className="is-ready">已解析</small>}</div>{referenceAudio ? <div className="atelier-audio-file"><Music2 size={16} /><div><b>{referenceAudio.name}</b><small>{(referenceAudio.size / 1024 / 1024).toFixed(1)} MB · 6 秒至 6 分钟</small></div>{!coverFeatureId && <button type="button" onClick={() => preprocessCover.mutate()} disabled={preprocessCover.isPending}>{preprocessCover.isPending ? <LoaderCircle className="spin" size={14} /> : <><Wand2 size={14} />解析歌词</>}</button>}<button type="button" className="remove" onClick={() => { setReferenceAudio(null); setCoverFeatureId(null); }} aria-label="移除参考音频"><X size={14} /></button></div> : <label className="atelier-audio-drop"><Music2 size={18} /><span>上传参考音频，保留旋律与节奏</span><small>MP3、WAV、FLAC、AAC、M4A 或 OGG · 最大 50MB</small><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg" hidden onChange={(event) => { setReferenceAudio(event.target.files?.[0] || null); setCoverFeatureId(null); event.currentTarget.value = ''; }} /></label>}</div>}
            {Object.entries(selectedModel?.params || {}).filter(([, config]) => config.type !== 'textarea').map(([key, config]) => config.type === 'boolean' ? <label className="atelier-toggle" key={key}><input type="checkbox" checked={Boolean(params[key])} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.checked }))} /><span>{config.label}</span><i /></label> : <label className="atelier-control" key={key}><span>{config.label}</span><select value={String(params[key] ?? '')} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))}>{config.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={14} /></label>)}
          </div>
          {Object.entries(selectedModel?.params || {}).filter(([, config]) => config.type === 'textarea').map(([key, config]) => <label className="atelier-lyrics" key={key}><span>{config.label}</span><textarea rows={5} value={String(params[key] || '')} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))} placeholder={isCoverModel ? '留空时会尝试从参考音频识别歌词；也可以在这里精修字词。' : '可填写歌词，或使用上方的自动写词选项。'} /></label>)}
        </section>

        <div className="atelier-submit-row"><div><span>{isCoverModel ? (referenceAudio ? '旋律参考已就绪' : '请添加旋律参考') : selectedModel ? shortModel(selectedModel.id) : '正在读取模型'}</span></div><button className="atelier-generate" onClick={() => prompt.trim() && generate.mutate()} disabled={generate.isPending || !prompt.trim() || (isCoverModel && !referenceAudio)}>{generate.isPending ? <LoaderCircle className="spin" size={18} /> : <><span>{modality === 'music' ? '生成这一段声音' : modality === 'video' ? '生成动态片段' : '生成视觉作品'}</span><ArrowUpRight size={18} /></>}</button></div>
        {(generate.error || notice) && <p className={`atelier-notice${generate.error ? ' error' : ''}`}>{generate.error?.message || notice}</p>}
      </main>

      <aside className="atelier-output">
        <div className="atelier-output-head"><div><h2>{sessionId ? '正在成形' : '你的作品会出现在这里'}</h2></div><span>{activeSession.length || '—'}</span></div>
        <div className="atelier-output-list">{activeSession.map((asset) => <article className="atelier-output-card" key={asset.id}><div className="atelier-output-meta"><span>{shortModel(asset.model)}</span><span className={`atelier-status ${asset.status}`}>{statusLabel[asset.status]}</span></div><MediaPreview asset={asset} onOpen={() => setLightbox(asset)} /><p>{asset.prompt}</p>{asset.status === 'done' && <a href={asset.downloadUrl} download>下载原文件 <ArrowUpRight size={13} /></a>}</article>)}{!activeSession.length && <div className="atelier-output-empty"><span><Sparkles size={22} /></span><h3>留一处空白。</h3><p>选好模型，写下方向，作品会沿着这条线出现。</p></div>}</div>
      </aside>
    </div>

    {assetPicker && <AssetPicker assets={(assetsQuery.data || []).filter((asset) => asset.modality === 'image' && asset.status === 'done')} max={maxReferences - references.length} selected={references.filter((reference): reference is Extract<Reference, { kind: 'asset' }> => reference.kind === 'asset').map((reference) => reference.asset.id)} onClose={() => setAssetPicker(false)} onAdd={(assets) => { setReferences((current) => [...current, ...assets.map((asset) => ({ id: crypto.randomUUID(), kind: 'asset' as const, asset }))]); setAssetPicker(false); }} />}
    {lightbox && <Modal title={lightbox.modality === 'video' ? '视频预览' : lightbox.modality === 'music' ? '音频预览' : '图片预览'} onClose={() => setLightbox(null)} className="media-modal"><MediaPreview asset={lightbox} /></Modal>}
  </div>;
}

function AssetPicker({ assets, max, selected, onClose, onAdd }: { assets: Asset[]; max: number; selected: string[]; onClose: () => void; onAdd: (assets: Asset[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return <Modal title="从资产库选择参考图" onClose={onClose} className="asset-picker-modal"><p className="form-hint">还可添加 {max} 张。已添加的资产不会重复显示。</p><div className="asset-picker-grid">{assets.filter((asset) => !selected.includes(asset.id)).map((asset) => <button key={asset.id} className={picked.includes(asset.id) ? 'is-picked' : ''} onClick={() => setPicked((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : current.length < max ? [...current, asset.id] : current)}><img src={asset.assetUrl} alt={asset.prompt} /><span><Check size={15} /></span></button>)}{!assets.length && <p className="quiet-copy">资产库中还没有可用的图片。</p>}</div><footer className="modal-footer"><span className="form-hint">已选择 {picked.length} / {max}</span><button className="button primary" onClick={() => onAdd(assets.filter((asset) => picked.includes(asset.id)))} disabled={!picked.length}>添加参考图</button></footer></Modal>;
}
