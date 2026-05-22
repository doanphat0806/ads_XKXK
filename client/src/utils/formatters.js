export function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2).replace('.', ',')}%`;
}

export function formatInt(value) {
  if (value === '' || value === null || value === undefined) return '';
  return Number(value).toLocaleString('vi-VN');
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('vi-VN').format(date);
}

export function formatCompactInt(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

export function formatCurrency(value) {
  const amount = Number(value || 0);
  if (amount <= 0) return '-';
  return amount.toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  });
}

export function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
