/**
 * Caching utilities for read optimization
 * Provides TTL-based caching for frequently accessed data
 */

const READ_CACHE_TTL_MS = 30 * 1000;
const PURCHASE_ORDER_READ_CACHE_TTL_MS = parseInt(process.env.PURCHASE_ORDER_READ_CACHE_TTL_MS || (60 * 1000));

// Generic read cache management
class CacheManager {
  constructor(ttlMs = READ_CACHE_TTL_MS, maxSize = 100) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return cached.value;
  }

  set(key, value) {
    this.cache.set(key, { value, createdAt: Date.now() });
    if (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    return value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  clearByPattern(predicate) {
    for (const key of this.cache.keys()) {
      if (predicate(key)) {
        this.cache.delete(key);
      }
    }
  }

  size() {
    return this.cache.size;
  }
}

// Global cache instances
const readCache = new CacheManager(READ_CACHE_TTL_MS, 100);
const purchaseOrderReadCache = new CacheManager(PURCHASE_ORDER_READ_CACHE_TTL_MS, 100);

// Helper functions for campaign-specific cache operations
function clearCampaignReadCache() {
  readCache.clearByPattern(key => 
    key.includes(':campaigns:') || 
    key.includes(':stats:') || 
    key.startsWith('campaigns:') || 
    key.startsWith('stats:')
  );
}

function clearAllReadCache() {
  readCache.clear();
}

function userScopedCacheKey(req, key) {
  return `${req.currentUser?._id || 'public'}:${key}`;
}

module.exports = {
  CacheManager,
  readCache,
  purchaseOrderReadCache,
  clearCampaignReadCache,
  clearAllReadCache,
  userScopedCacheKey,
  READ_CACHE_TTL_MS,
  PURCHASE_ORDER_READ_CACHE_TTL_MS
};
