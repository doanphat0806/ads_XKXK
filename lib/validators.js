/**
 * Data validation and error handling utilities
 */

const { normalizeAdAccountId, normalizeProvider } = require('./normalizers');

// Ad account validation
function getAdAccountNumericId(value = {}) {
  const directId = String(value.account_id || '').trim();
  if (/^\d+$/.test(directId)) return directId;

  const nodeId = String(value.id || '').trim().replace(/^act_/i, '');
  if (/^\d+$/.test(nodeId)) return nodeId;

  const normalized = normalizeAdAccountId(directId || value.id);
  return normalized.replace(/^act_/i, '');
}

function isValidAdAccountId(value, provider = 'facebook') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (provider === 'facebook') {
    return /^act_\d+$/.test(raw) || /^\d+$/.test(raw);
  }
  return true; // Shopee ad account / shop id can be free-form
}

// Provider and account name validation
function getAccountProviderNameError(provider, name) {
  const { isShopeeAdAccountName } = require('./normalizers');
  if (provider === 'shopee' && !isShopeeAdAccountName(name)) {
    return 'Tai khoan Shopee chi cho phep ten bat dau bang XK lien sau la so (vi du: XK11).';
  }
  if (provider === 'facebook' && isShopeeAdAccountName(name)) {
    return 'Tai khoan bat dau bang XK lien sau la so (vi du: XK11) chi duoc them vao role Shopee.';
  }
  return '';
}

// Parse bounded integers with min/max constraints
function parseBoundedInt(value, defaultVal = 0, minVal = 0, maxVal = 100) {
  const num = parseInt(value || defaultVal, 10);
  if (!Number.isFinite(num)) return defaultVal;
  if (num < minVal) return minVal;
  if (num > maxVal) return maxVal;
  return num;
}

// Helper to pick first defined value
function pickDefinedValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

// Convert value to plain object with fallback
function toPlainObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

module.exports = {
  getAdAccountNumericId,
  isValidAdAccountId,
  getAccountProviderNameError,
  parseBoundedInt,
  pickDefinedValue,
  toPlainObject
};
