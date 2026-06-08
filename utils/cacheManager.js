const { parseBoundedInt } = require('./number');

const READ_CACHE_TTL_MS = 30 * 1000;
const readCache = new Map();

const PURCHASE_ORDER_READ_CACHE_TTL_MS = parseBoundedInt(process.env.PURCHASE_ORDER_READ_CACHE_TTL_MS, 60 * 1000, 5000, 10 * 60 * 1000);
const purchaseOrderReadCache = new Map();

function getReadCache(key) {
  const cached = readCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > READ_CACHE_TTL_MS) {
    readCache.delete(key);
    return null;
  }
  return cached.value;
}

function setReadCache(key, value) {
  readCache.set(key, { value, createdAt: Date.now() });
  if (readCache.size > 100) {
    const oldestKey = readCache.keys().next().value;
    readCache.delete(oldestKey);
  }
  return value;
}

function clearCampaignReadCache() {
  for (const key of readCache.keys()) {
    if (key.includes(':campaigns:') || key.includes(':stats:') || key.startsWith('campaigns:') || key.startsWith('stats:')) {
      readCache.delete(key);
    }
  }
}

function clearAllReadCache() {
  readCache.clear();
}

function getPurchaseOrderReadCache(key) {
  const cached = purchaseOrderReadCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > PURCHASE_ORDER_READ_CACHE_TTL_MS) {
    purchaseOrderReadCache.delete(key);
    return null;
  }
  return cached.data;
}

function setPurchaseOrderReadCache(key, data) {
  purchaseOrderReadCache.set(key, { data, createdAt: Date.now() });
  if (purchaseOrderReadCache.size > 100) {
    const oldestKey = purchaseOrderReadCache.keys().next().value;
    purchaseOrderReadCache.delete(oldestKey);
  }
  return data;
}

function clearPurchaseOrderReadCache() {
  purchaseOrderReadCache.clear();
}

const DEAL_STOP_CAMPAIGN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const dealStopCampaignCache = new Map();

function getDealStopCampaignCache(key) {
  const cached = dealStopCampaignCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > DEAL_STOP_CAMPAIGN_CACHE_TTL_MS) {
    dealStopCampaignCache.delete(key);
    return null;
  }
  return cached.data;
}

function setDealStopCampaignCache(key, data) {
  dealStopCampaignCache.set(key, { data, createdAt: Date.now() });
  if (dealStopCampaignCache.size > 20) {
    const oldestKey = dealStopCampaignCache.keys().next().value;
    dealStopCampaignCache.delete(oldestKey);
  }
  return data;
}

function clearDealStopCampaignCache() {
  dealStopCampaignCache.clear();
}

module.exports = {
  readCache,
  purchaseOrderReadCache,
  getReadCache,
  setReadCache,
  clearCampaignReadCache,
  clearAllReadCache,
  getPurchaseOrderReadCache,
  setPurchaseOrderReadCache,
  clearPurchaseOrderReadCache,
  getDealStopCampaignCache,
  setDealStopCampaignCache,
  clearDealStopCampaignCache
};
