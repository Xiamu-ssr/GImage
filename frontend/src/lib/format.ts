import type { Modality } from '../types';

export const modalityLabel: Record<Modality, string> = {
  image: '图片',
  video: '视频',
  music: '音乐',
};

export const statusLabel: Record<string, string> = {
  pending: '已提交',
  processing: '生成中',
  done: '已完成',
  failed: '生成失败',
};

export function money(value: number | undefined) {
  return `$${(value || 0).toFixed(2)}`;
}

export function shortModel(model = '') {
  return model.split('/').pop()?.replace(/-/g, ' ') || '未知模型';
}

export function dateTime(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function dateHeading(value: string) {
  const date = new Date(value);
  const now = new Date();
  const day = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
  return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}年${day}`;
}
