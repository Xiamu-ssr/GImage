export function fmt(n) { return n == null ? '-' : (+n).toFixed(2); }
export function fmtDate(s) { return s ? new Date(s).toLocaleDateString('zh-CN') : '-'; }
export function fmtTime(s) { return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '-'; }
export function paramStr(p) {
  return Object.entries(p || {})
    .filter(([k]) => k !== 'lyrics')
    .map(([k, v]) => `${k}:${v}`).join(' ');
}
export function modelShort(model) { return model?.split('/').pop() || ''; }

const MODALITY_LABELS = { image: '图片', video: '视频', music: '音乐' };
export function modalityLabel(m) { return MODALITY_LABELS[m] || m || ''; }

const STATUS_LABELS = { pending: '排队中', processing: '生成中', done: '已完成', failed: '失败' };
export function statusLabel(s) { return STATUS_LABELS[s] || s || ''; }
