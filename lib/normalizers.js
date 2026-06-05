/**
 * String and data normalization utilities
 * Handles normalization of providers, statuses, usernames, dates, etc.
 */

const SHOPEE_AD_ACCOUNT_NAME_PATTERN = /^XK\d+$/i;
const INVENTORY_SIZE_SET = new Set(['S', 'M', 'L', 'XL', 'FZ']);

// Provider normalization
function normalizeProvider(value) {
  const normalized = String(value || 'facebook').trim().toLowerCase();
  if (normalized === 'shopee') return 'shopee';
  if (normalized === 'oder') return 'oder';
  if (normalized === 'kho') return 'kho';
  return 'facebook';
}

function buildAccountProviderFilter(provider) {
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider === 'facebook') {
    return {
      $or: [
        { provider: 'facebook' },
        { provider: { $exists: false } },
        { provider: null },
        { provider: '' }
      ]
    };
  }
  return { provider: normalizedProvider };
}

// Username normalization
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

// Campaign status normalization
function normalizeCampaignStatus(value) {
  return String(value || '').trim().toUpperCase();
}

// Campaign date normalization
function normalizeCampaignDate(value) {
  const date = String(value || '').trim();
  return date || todayStr();
}

// Escape regex special characters
function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Shopee-specific normalizations
function isShopeeAdAccountName(name) {
  return SHOPEE_AD_ACCOUNT_NAME_PATTERN.test(String(name || '').trim());
}

function normalizeShopeeSubIdKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAdAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const numericId = raw.replace(/^act_/i, '');
  if (!/^\d+$/.test(numericId)) return raw;

  return `act_${numericId}`;
}

function normalizeBarcode(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeInventoryProductCode(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function normalizeInventorySize(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'FREE' || normalized === 'FREESIZE') return 'FZ';
  return INVENTORY_SIZE_SET.has(normalized) ? normalized : '';
}

function normalizeShopeeCallToActionType(value, defaultType = 'NO_BUTTON') {
  const SHOPEE_CALL_TO_ACTION_TYPES = new Set(['SHOP_NOW', 'NO_BUTTON']);
  const normalized = String(value || defaultType).trim().toUpperCase();
  return SHOPEE_CALL_TO_ACTION_TYPES.has(normalized) ? normalized : defaultType;
}

function normalizeAdNameStatus(value) {
  const raw = String(value || 'Test').trim();
  const allowed = ['Sale', 'Săn', 'Win', 'Test'];
  return allowed.find(item => item.toLowerCase() === raw.toLowerCase()) || 'Test';
}

// Helpers for date operations
function todayStr() {
  const d = new Date();
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split('T')[0];
}

function getVnDateKeyFromDateValue(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time)) return '';
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  return new Date(time + VN_OFFSET_MS).toISOString().split('T')[0];
}

module.exports = {
  normalizeProvider,
  buildAccountProviderFilter,
  normalizeUsername,
  normalizeCampaignStatus,
  normalizeCampaignDate,
  escapeRegExp,
  isShopeeAdAccountName,
  normalizeShopeeSubIdKey,
  normalizeAdAccountId,
  normalizeBarcode,
  normalizeInventoryProductCode,
  normalizeInventorySize,
  normalizeShopeeCallToActionType,
  normalizeAdNameStatus,
  todayStr,
  getVnDateKeyFromDateValue,
  INVENTORY_SIZE_SET
};
