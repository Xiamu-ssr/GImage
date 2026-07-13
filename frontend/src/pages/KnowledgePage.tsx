import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle, BookOpenText, Braces, CheckCircle2, CircleDot, Database,
  FileCode2, GitBranch, LoaderCircle, Network, RefreshCw, Save, Search, ShieldCheck,
} from 'lucide-react';
import { api, json } from '../lib/api';
import type {
  KnowledgeDiagnostic, KnowledgeDocument, KnowledgeGraphEdge, KnowledgeGraphNode,
  KnowledgeKind, KnowledgeListEntry, KnowledgeProjection, Me,
} from '../types';

type View = 'read' | 'edit' | 'graph';

const kindMeta: Record<KnowledgeKind, { label: string; icon: typeof BookOpenText }> = {
  okf: { label: 'OKF 叙述', icon: BookOpenText },
  contract: { label: '单一 DSL', icon: Braces },
  catalog: { label: '模型目录', icon: Database },
};

function kindLabel(kind: KnowledgeKind) { return kindMeta[kind].label; }

export function KnowledgePage() {
  const me = useOutletContext<Me>();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<{ kind: KnowledgeKind; id: string } | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KnowledgeKind | 'all'>('all');
  const [view, setView] = useState<View>('read');
  const [draft, setDraft] = useState('');
  const [localDiagnostics, setLocalDiagnostics] = useState<KnowledgeDiagnostic[] | null>(null);
  const listQuery = useQuery({ queryKey: ['knowledge'], queryFn: () => api<{ documents: KnowledgeListEntry[] }>('/api/admin/knowledge') });
  const selectedKey = selected ? `${selected.kind}/${selected.id}` : '';
  const documentQuery = useQuery({
    queryKey: ['knowledge', selectedKey],
    enabled: !!selected,
    queryFn: () => api<KnowledgeDocument>(`/api/admin/knowledge/${selected!.kind}/${selected!.id}`),
  });
  const document = documentQuery.data;

  useEffect(() => {
    const documents = listQuery.data?.documents || [];
    if (selected || !documents.length) return;
    const preferred = documents.find((item) => item.kind === 'contract') || documents[0];
    setSelected({ kind: preferred.kind, id: preferred.id });
  }, [listQuery.data, selected]);

  useEffect(() => {
    if (!document) return;
    setDraft(document.content);
    setLocalDiagnostics(document.diagnostics);
  }, [document?.updatedAt]); // 仅在服务端版本切换时替换编辑草稿

  const validate = useMutation({
    mutationFn: () => api<{ valid: boolean; diagnostics: KnowledgeDiagnostic[]; projection: KnowledgeProjection | null }>('/api/admin/knowledge/validate', {
      method: 'POST', ...json({ kind: selected?.kind, id: selected?.id, content: draft }),
    }),
    onSuccess: (result) => setLocalDiagnostics(result.diagnostics),
  });
  const save = useMutation({
    mutationFn: () => api<{ ok: true; document: KnowledgeDocument }>(`/api/admin/knowledge/${selected!.kind}/${selected!.id}`, {
      method: 'PUT', ...json({ content: draft, expectedUpdatedAt: document?.updatedAt }),
    }),
    onSuccess: (result) => {
      setLocalDiagnostics(result.document.diagnostics);
      queryClient.setQueryData(['knowledge', selectedKey], result.document);
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && selected && draft !== document?.content) {
        event.preventDefault();
        save.mutate();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [draft, document?.content, save, selected]);

  const filtered = useMemo(() => (listQuery.data?.documents || []).filter((item) => {
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    const haystack = `${item.title} ${item.id} ${kindLabel(item.kind)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [kindFilter, listQuery.data, query]);
  const diagnostics = localDiagnostics ?? document?.diagnostics ?? [];
  const dirty = !!document && draft !== document.content;
  const projection = document?.kind === 'contract' ? document.projection : null;

  if (me.user.role !== 'admin') return <Navigate to="/studio" replace />;
  return <section className="knowledge-page">
    <header className="knowledge-header">
      <div><span className="eyebrow">KNOWLEDGE OPERATING FORMAT</span><h1>知识与契约工作台</h1><p>一份 DSL，实时投影为流程、关系、规则和模型目录；所有修改保存到本地 <code>data/</code>。</p></div>
      <div className="knowledge-principle"><Network size={18} /><span>单一事实来源</span></div>
    </header>
    <div className="knowledge-workspace">
      <aside className="knowledge-browser" aria-label="知识目录">
        <label className="knowledge-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查询 OKF、DSL、模型…" /></label>
        <div className="knowledge-filters" role="tablist">
          {(['all', 'okf', 'contract', 'catalog'] as const).map((kind) => <button key={kind} role="tab" aria-selected={kindFilter === kind} onClick={() => setKindFilter(kind)} className={kindFilter === kind ? 'is-active' : ''}>{kind === 'all' ? '全部' : kindLabel(kind)}</button>)}
        </div>
        <div className="knowledge-document-list">
          {listQuery.isPending ? <div className="knowledge-list-status"><LoaderCircle className="spin" size={18} />读取本地知识包</div> : filtered.map((item) => {
            const Icon = kindMeta[item.kind].icon;
            const active = selected?.kind === item.kind && selected?.id === item.id;
            return <button key={`${item.kind}-${item.id}`} onClick={() => { setSelected({ kind: item.kind, id: item.id }); setView(item.kind === 'contract' ? 'graph' : 'read'); }} className={`knowledge-document${active ? ' is-active' : ''}`}>
              <span className="knowledge-document-icon"><Icon size={16} /></span><span><b>{item.title}</b><small>{item.id}</small></span>{item.valid ? <CheckCircle2 size={14} className="knowledge-status-ok" /> : <AlertTriangle size={14} className="knowledge-status-error" />}
            </button>;
          })}
          {!listQuery.isPending && !filtered.length && <div className="knowledge-list-status">没有匹配的知识对象</div>}
        </div>
        <div className="knowledge-browser-foot"><ShieldCheck size={14} /><span>仅管理员可修改 · 本地版本历史</span></div>
      </aside>

      <main className="knowledge-main">
        {!selected || documentQuery.isPending ? <div className="knowledge-empty"><LoaderCircle className="spin" size={24} /><span>装载知识对象</span></div> : documentQuery.isError || !document ? <div className="knowledge-empty error"><AlertTriangle size={24} /><span>无法读取该知识对象</span></div> : <>
          <div className="knowledge-document-head">
            <div><div className="knowledge-breadcrumb"><span>{kindLabel(document.kind)}</span><span>/</span><code>{document.id}</code></div><h2>{document.title}</h2></div>
            <div className="knowledge-actions"><button className="button secondary" onClick={() => documentQuery.refetch()} disabled={documentQuery.isFetching}><RefreshCw size={15} className={documentQuery.isFetching ? 'spin' : ''} />刷新</button><button className="button secondary" onClick={() => validate.mutate()} disabled={validate.isPending}><FileCode2 size={15} />校验</button><button className="button primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存{dirty ? ' · 未保存' : ''}</button></div>
          </div>
          <div className="knowledge-view-tabs" role="tablist">
            {([['read', '阅读', BookOpenText], ['edit', '编辑', FileCode2], ...(document.kind === 'contract' ? [['graph', '图谱', GitBranch]] : [])] as Array<[View, string, typeof BookOpenText]>).map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'is-active' : ''} onClick={() => setView(id)}><Icon size={15} />{label}</button>)}
          </div>
          <div className="knowledge-view">
            {view === 'read' && <Reader document={document} />}
            {view === 'edit' && <Editor draft={draft} kind={document.kind} onChange={(value) => { setDraft(value); setLocalDiagnostics(null); }} />}
            {view === 'graph' && projection && <ContractGraph projection={projection} />}
          </div>
          {(validate.error || save.error) && <div className="knowledge-save-error"><AlertTriangle size={15} />{validate.error?.message || save.error?.message}</div>}
        </>}
      </main>

      <aside className="knowledge-inspector" aria-label="结构检查器">
        <div className="inspector-heading"><CircleDot size={16} /><span>结构检查</span></div>
        {document?.kind === 'contract' && projection && <ProjectionSummary projection={projection} />}
        {document?.kind === 'catalog' && <div className="catalog-notice"><Database size={18} /><div><b>运行时目录</b><p>此 JSON 直接控制可用模型和供应商。密钥只能写环境变量名。</p></div></div>}
        {document?.kind === 'okf' && <div className="catalog-notice"><BookOpenText size={18} /><div><b>叙述层</b><p>记录背景、决策与链接；流程事实请放在单一 DSL。</p></div></div>}
        <div className="diagnostic-heading"><span>诊断</span><small>{diagnostics.length ? `${diagnostics.length} 项` : '通过'}</small></div>
        <div className="diagnostic-list">{diagnostics.length ? diagnostics.map((item, index) => <Diagnostic key={`${item.path}-${index}`} item={item} />) : <div className="diagnostic-empty"><CheckCircle2 size={20} /><b>结构校验通过</b><span>未发现需要处理的引用或状态问题。</span></div>}</div>
        <div className="inspector-footer"><small>上次保存</small><b>{document ? new Date(document.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</b></div>
      </aside>
    </div>
  </section>;
}

function Reader({ document }: { document: KnowledgeDocument }) {
  if (document.kind === 'okf') return <article className="knowledge-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{document.content.replace(/^---[\s\S]*?\n---\n?/, '')}</ReactMarkdown></article>;
  return <pre className="knowledge-code read-only"><code>{document.content}</code></pre>;
}

function Editor({ draft, kind, onChange }: { draft: string; kind: KnowledgeKind; onChange: (value: string) => void }) {
  return <div className="knowledge-editor"><div className="editor-label"><span>{kind === 'catalog' ? 'JSON' : kind === 'contract' ? 'YAML · gimage/1' : 'Markdown · OKF'}</span><span>⌘/Ctrl + S 保存</span></div><textarea spellCheck={false} aria-label={`${kindLabel(kind)} 编辑器`} value={draft} onChange={(event) => onChange(event.target.value)} /></div>;
}

function ProjectionSummary({ projection }: { projection: KnowledgeProjection }) {
  const items = [
    ['实体', projection.summary.entities], ['段落', projection.summary.paragraphs], ['规则', projection.summary.rules], ['外部', projection.summary.externals], ['关系', projection.summary.relations],
  ];
  return <div className="projection-summary">{items.map(([label, value]) => <div key={String(label)}><span>{label}</span><b>{value}</b></div>)}</div>;
}

function Diagnostic({ item }: { item: KnowledgeDiagnostic }) {
  return <div className={`diagnostic ${item.level}`}><span>{item.level === 'error' ? <AlertTriangle size={14} /> : <CircleDot size={14} />}</span><div><b>{item.level === 'error' ? '错误' : '建议'} · {item.path}</b><p>{item.message}</p></div></div>;
}

function ContractGraph({ projection }: { projection: KnowledgeProjection }) {
  const nodes = useMemo(() => {
    const positions: Record<KnowledgeGraphNode['type'], number> = { paragraph: 0, entity: 0, external: 0, rule: 0 };
    return projection.nodes.map((item) => {
      const withinType = positions[item.type];
      positions[item.type] += 1;
      return toFlowNode(item, withinType);
    });
  }, [projection.nodes]);
  const edges = useMemo(() => projection.edges.map(toFlowEdge), [projection.edges]);
  return <div className="contract-graph"><ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.25} maxZoom={1.7} nodesDraggable panOnDrag><MiniMap pannable zoomable nodeColor={(node) => nodeColor(String(node.type))} /><Controls showInteractive={false} /><Background gap={19} size={1} color="rgba(255,255,255,.13)" /></ReactFlow><div className="graph-legend"><span><i className="paragraph" />段落</span><span><i className="entity" />实体</span><span><i className="rule" />规则</span><span><i className="external" />外部能力</span></div></div>;
}

function toFlowNode(item: KnowledgeGraphNode, withinType: number): Node {
  const typeIndex = { paragraph: 0, entity: 1, external: 2, rule: 3 }[item.type];
  return { id: item.id, type: 'default', position: { x: withinType * 245 + (typeIndex === 0 ? 20 : 70), y: typeIndex * 170 + 40 }, data: { label: <div className={`flow-node-label ${item.type}`}><span>{item.type}</span><b>{item.label}</b><small>{item.subtitle || item.id}</small></div> } };
}

function toFlowEdge(item: KnowledgeGraphEdge): Edge {
  return { id: item.id, source: item.source, target: item.target, label: item.label, animated: item.type === 'exception', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: item.type === 'exception' ? '#d28d8d' : 'rgba(240,240,240,.56)', strokeWidth: item.type === 'relation' ? 1 : 1.4 }, labelStyle: { fill: '#c7c7c0', fontSize: 10 }, labelBgStyle: { fill: '#171717', fillOpacity: .92 } };
}

function nodeColor(type: string) { return ({ paragraph: '#c9c2ae', entity: '#8fa6c6', rule: '#c89191', external: '#93b39a' } as Record<string, string>)[type] || '#aaa'; }
