// Shared parsing/classification helpers for the Shopee Social Affiliate module.

export function normalizeHeaderText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value).trim();
  if (!text) return 0;
  const negative = /^-|\(.*\)$/.test(text);
  text = text.replace(/[^\d.,]/g, '');
  if (!text) return 0;
  if (/,\d{1,2}$/.test(text) && !/\.\d{1,2}$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return 0;
  return negative && n > 0 ? -n : n;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function parseDateTime(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(EXCEL_EPOCH_MS + value * 86400000);
  }
  const text = String(value).trim();
  if (!text) return null;

  const isoLike = Date.parse(text.replace(' ', 'T'));
  if (!Number.isNaN(isoLike) && /\d{4}-\d{2}-\d{2}/.test(text)) {
    return new Date(isoLike);
  }

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const [, d, m, y, h = '0', min = '0', s = '0'] = dmy;
    const year = y.length === 2 ? Number(y) + 2000 : Number(y);
    const date = new Date(year, Number(m) - 1, Number(d), Number(h), Number(min), Number(s));
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return new Date(EXCEL_EPOCH_MS + Number(text) * 86400000);
  }

  return null;
}

const PLATFORM_RULES = [
  { key: 'facebook', label: 'Facebook', match: /\b(fb|facebook|face)\b/ },
  { key: 'tiktok', label: 'TikTok', match: /\b(tiktok|tt|tik)\b/ },
  { key: 'telegram', label: 'Telegram', match: /\b(tele|telegram|tg)\b/ },
  { key: 'zalo', label: 'Zalo', match: /\bzalo\b/ },
  { key: 'threads', label: 'Threads', match: /\bthreads?\b/ },
  { key: 'youtube', label: 'YouTube', match: /\b(yt|youtube)\b/ },
  { key: 'instagram', label: 'Instagram', match: /\b(ig|instagram|insta)\b/ }
];

export function detectPlatform(subId1) {
  const text = normalizeHeaderText(subId1);
  if (!text) return { key: 'khac', label: 'Khác / Chưa gắn' };
  for (const rule of PLATFORM_RULES) {
    if (rule.match.test(text)) return { key: rule.key, label: rule.label };
  }
  return { key: 'khac', label: 'Khác' };
}

export const PLATFORM_ORDER = ['facebook', 'tiktok', 'telegram', 'zalo', 'threads', 'youtube', 'instagram', 'khac'];

export function classifyChannel(channelRaw, platformKey) {
  const text = normalizeHeaderText(channelRaw);
  if (/video/.test(text)) return 'video';
  if (/live/.test(text)) return 'live';
  if (/social|mang xa hoi|mxh|affiliate|kol|koc/.test(text)) return 'social';
  if (!text && platformKey && platformKey !== 'khac') return 'social';
  return 'other';
}

export function classifyStatus(statusRaw) {
  const text = normalizeHeaderText(statusRaw);
  if (/huy|cancel|hoan tien|refund/.test(text)) return 'cancelled';
  if (/hoan thanh|completed|thanh cong|da nhan|success/.test(text)) return 'completed';
  if (/cho|pending|dang xu ly|processing|xac nhan/.test(text)) return 'pending';
  return 'other';
}

export const STATUS_LABELS = {
  completed: 'Hoàn thành',
  pending: 'Đang chờ',
  cancelled: 'Đã hủy',
  other: 'Khác'
};

export const CHANNEL_LABELS = {
  social: 'Mạng xã hội',
  video: 'Shopee Video',
  live: 'Shopee Live',
  other: 'Khác'
};

export function buildSubIdKey(subIds) {
  const parts = subIds.map(v => (v || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' / ') : '(Không gắn SubID)';
}

export function downloadTextFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function toCsvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(headers, rows) {
  const lines = [headers.map(toCsvValue).join(',')];
  for (const row of rows) {
    lines.push(row.map(toCsvValue).join(','));
  }
  return lines.join('\r\n');
}
