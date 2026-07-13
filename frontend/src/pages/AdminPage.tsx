import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useOutletContext } from 'react-router-dom';
import { Activity, ChevronRight, CircleDollarSign, LoaderCircle, Plus, RefreshCw, Settings2, ShieldCheck, Trash2, UserCog, UsersRound, X } from 'lucide-react';
import { api, json } from '../lib/api';
import { dateTime, modalityLabel, money, shortModel } from '../lib/format';
import type { Account, Asset, Me, ServerStatus, Usage } from '../types';
import { Modal } from '../components/Modal';
import { MediaPreview } from '../components/MediaPreview';

type Tab = 'overview' | 'accounts' | 'records';
type AccountDraft = { username: string; password: string; dailyBudget: string; role: 'user' | 'admin' };
const blankAccount: AccountDraft = { username: '', password: '', dailyBudget: '1.50', role: 'user' };

export function AdminPage() {
  const me = useOutletContext<Me>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [accountModal, setAccountModal] = useState<{ mode: 'create' | 'edit'; account?: Account } | null>(null);
  const [selectedUser, setSelectedUser] = useState('__all');
  const [preview, setPreview] = useState<Asset | null>(null);
  const usageQuery = useQuery({ queryKey: ['admin', 'usage'], queryFn: () => api<Usage>('/api/admin/usage') });
  const statusQuery = useQuery({ queryKey: ['admin', 'status'], queryFn: () => api<ServerStatus>('/api/admin/server-status') });
  const accountsQuery = useQuery({ queryKey: ['admin', 'accounts'], queryFn: () => api<Account[]>('/api/admin/accounts') });
  const usersQuery = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<string[]>('/api/admin/users') });
  const recordsQuery = useQuery({
    queryKey: ['admin', 'records', selectedUser],
    enabled: tab === 'records',
    queryFn: async () => selectedUser === '__all' ? (await api<{ records: Asset[] }>('/api/admin/all-records?limit=200')).records : api<Asset[]>(`/api/admin/records/${encodeURIComponent(selectedUser)}`),
  });
  const deleteAccount = useMutation({ mutationFn: (username: string) => api<{ ok: true }>(`/api/admin/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] }) });

  if (me.user.role !== 'admin') return <Navigate to="/studio" replace />;
  const usage = usageQuery.data;
  const server = statusQuery.data;
  const records = recordsQuery.data || [];
  return <section className="admin-page page-shell">
    <header className="page-heading"><div><span className="eyebrow">OPERATIONS CONSOLE</span><h1>工作区管理</h1><p>查看消耗、管理访问权限，并审阅团队的创作记录。</p></div><div className="admin-shield"><ShieldCheck size={21} /><span>管理员空间</span></div></header>
    <div className="admin-tabs" role="tablist">{([['overview', '运行概览', Activity], ['accounts', '账户与额度', UsersRound], ['records', '内容审阅', Settings2]] as const).map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</div>
    {tab === 'overview' && <Overview usage={usage} server={server} refreshing={statusQuery.isFetching} onRefresh={() => { statusQuery.refetch(); usageQuery.refetch(); }} />}
    {tab === 'accounts' && <Accounts accounts={accountsQuery.data || []} loading={accountsQuery.isPending} onCreate={() => setAccountModal({ mode: 'create' })} onEdit={(account) => setAccountModal({ mode: 'edit', account })} onDelete={(account) => { if (window.confirm(`确认删除账户「${account.username}」？资产不会自动删除。`)) deleteAccount.mutate(account.username); }} />}
    {tab === 'records' && <Records users={usersQuery.data || []} selectedUser={selectedUser} onUserChange={setSelectedUser} records={records} loading={recordsQuery.isLoading} onPreview={setPreview} />}
    {accountModal && <AccountEditor modal={accountModal} onClose={() => setAccountModal(null)} onSaved={() => { queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] }); queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); setAccountModal(null); }} />}
    {preview && <Modal title={preview.modality === 'video' ? '视频预览' : preview.modality === 'music' ? '音频预览' : '图片预览'} onClose={() => setPreview(null)} className="media-modal"><MediaPreview asset={preview} /></Modal>}
  </section>;
}

function Overview({ usage, server, refreshing, onRefresh }: { usage?: Usage; server?: ServerStatus; refreshing: boolean; onRefresh: () => void }) {
  const stats = usage ? [
    { label: '今日生成', value: String(usage.totalCount), note: '累计作品数', icon: Activity },
    { label: '今日花费', value: money(usage.totalSpentUSD), note: usage.date, icon: CircleDollarSign },
    ...(['image', 'video', 'music'] as const).map((mode) => ({ label: modalityLabel[mode], value: String(usage.byModality[mode]?.count || 0), note: money(usage.byModality[mode]?.spentUSD || 0), icon: mode === 'image' ? Settings2 : mode === 'video' ? Activity : CircleDollarSign })),
  ] : [];
  return <div className="admin-content"><section className="server-card"><div><span className="eyebrow">PROVIDER STATUS</span><h2>上游服务状态</h2></div><button className="button secondary" onClick={onRefresh} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}刷新数据</button><div className="server-grid">{!server ? <span className="form-hint">正在获取服务状态…</span> : !server.configured ? <span className="form-hint">未配置管理密钥，无法获取上游账户状态。</span> : <><Metric label="订阅计划" value={server.subscription?.plan?.tier?.toUpperCase() || '未知'} note={server.subscription?.account_status === 'healthy' ? '账户状态正常' : server.subscription?.account_status || '状态未知'} /><Metric label="按量余额" value={money(server.payg?.total_credits)} note={server.paygError || `充值 ${money(server.payg?.top_up_credits)}`} /><Metric label="5 小时配额" value={`剩 ${server.subscription?.quota_5_hour?.remaining_flows ?? '—'}`} note={server.subscription?.quota_5_hour ? `已用 ${Math.round((server.subscription.quota_5_hour.usage_percentage || 0) * 100)}%` : '暂无数据'} /></>}</div></section><section><div className="section-heading"><div><span className="eyebrow">TODAY</span><h2>今日使用情况</h2></div>{usage && <p>{usage.date}</p>}</div>{!stats.length ? <div className="loading-block"><LoaderCircle className="spin" size={20} />加载用量中</div> : <div className="metric-grid">{stats.map((stat) => <Metric key={stat.label} {...stat} />)}</div>}</section></div>;
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon?: typeof Activity }) { return <article className="metric-card">{Icon && <span className="metric-icon"><Icon size={18} /></span>}<span>{label}</span><b>{value}</b><small>{note}</small></article>; }

function Accounts({ accounts, loading, onCreate, onEdit, onDelete }: { accounts: Account[]; loading: boolean; onCreate: () => void; onEdit: (account: Account) => void; onDelete: (account: Account) => void }) {
  return <div className="admin-content"><div className="section-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h2>账户与额度</h2><p>密码不会在界面或接口中返回。</p></div><button className="button primary" onClick={onCreate}><Plus size={17} />新建账户</button></div><div className="table-card"><table><thead><tr><th>账户</th><th>角色</th><th>每日额度</th><th>今日花费</th><th aria-label="操作" /></tr></thead><tbody>{loading ? <tr><td colSpan={5}>正在加载账户…</td></tr> : accounts.map((account) => <tr key={account.username}><td><b>{account.username}</b><small>创建于 {dateTime(account.createdAt)}</small></td><td><span className={`role-chip ${account.role}`}>{account.role === 'admin' ? '管理员' : '普通成员'}</span></td><td>{money(account.dailyBudget)}</td><td>{money(account.spentToday)}</td><td><div className="table-actions"><button className="text-action" onClick={() => onEdit(account)}><UserCog size={15} />编辑</button><button className="icon-button danger-text" onClick={() => onDelete(account)} aria-label="删除账户"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div></div>;
}

function AccountEditor({ modal, onClose, onSaved }: { modal: { mode: 'create' | 'edit'; account?: Account }; onClose: () => void; onSaved: () => void }) {
  const account = modal.account;
  const [draft, setDraft] = useState<AccountDraft>(account ? { username: account.username, password: '', dailyBudget: String(account.dailyBudget), role: account.role } : blankAccount);
  const save = useMutation({
    mutationFn: () => modal.mode === 'create'
      ? api('/api/admin/accounts', { method: 'POST', ...json({ ...draft, dailyBudget: Number(draft.dailyBudget) }) })
      : api(`/api/admin/accounts/${encodeURIComponent(account!.username)}`, { method: 'PATCH', ...json({ password: draft.password || undefined, dailyBudget: Number(draft.dailyBudget), role: draft.role }) }),
    onSuccess: onSaved,
  });
  return <Modal title={modal.mode === 'create' ? '新建账户' : `编辑 ${account?.username}`} onClose={onClose} className="account-modal"><div className="modal-form">{modal.mode === 'create' && <label className="field"><span>用户名</span><div className="field-input"><input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} maxLength={64} /></div></label>}<label className="field"><span>{modal.mode === 'create' ? '初始密码' : '新密码（留空则不修改）'}</span><div className="field-input"><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></div></label><div className="form-row"><label className="field"><span>每日额度（USD）</span><div className="field-input"><input type="number" min="0" step="0.01" value={draft.dailyBudget} onChange={(event) => setDraft({ ...draft, dailyBudget: event.target.value })} /></div></label><label className="field"><span>角色</span><div className="field-input"><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as AccountDraft['role'] })}><option value="user">普通成员</option><option value="admin">管理员</option></select></div></label></div>{save.error && <p className="form-error">{save.error.message}</p>}</div><footer className="modal-footer"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={save.isPending || !draft.dailyBudget || (modal.mode === 'create' && (!draft.username || draft.password.length < 4))} onClick={() => save.mutate()}>{save.isPending ? <LoaderCircle className="spin" size={16} /> : '保存账户'}</button></footer></Modal>;
}

function Records({ users, selectedUser, onUserChange, records, loading, onPreview }: { users: string[]; selectedUser: string; onUserChange: (user: string) => void; records: Asset[]; loading: boolean; onPreview: (asset: Asset) => void }) {
  return <div className="admin-content"><div className="section-heading"><div><span className="eyebrow">CONTENT REVIEW</span><h2>创作记录</h2><p>管理员可按成员审阅所有输出与提示词。</p></div><label className="select-control record-user"><span>创作者</span><select value={selectedUser} onChange={(event) => onUserChange(event.target.value)}><option value="__all">全部用户</option>{users.map((user) => <option key={user}>{user}</option>)}</select></label></div>{loading ? <div className="loading-block"><LoaderCircle className="spin" size={20} />加载记录中</div> : !records.length ? <div className="empty-state"><Settings2 size={28} /><h2>暂无记录</h2><p>当前筛选条件下没有可审阅的内容。</p></div> : <div className="review-list">{records.map((record) => <article className="review-card" key={record.id}><div className="review-meta"><span className="role-chip user">{record.username || '未知用户'}</span><span>{modalityLabel[record.modality]}</span><span>{shortModel(record.model)}</span><span>{dateTime(record.createdAt)}</span></div><div className="review-content"><div><h3>{record.prompt}</h3><p>{record.cost ? money(record.cost) : '—'} · {record.status === 'done' ? '已完成' : record.status}</p></div><MediaPreview asset={record} onOpen={() => onPreview(record)} /></div></article>)}</div>}</div>;
}
