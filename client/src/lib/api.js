export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export function apiUrl(path) {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

const responseCache = new Map();
const RESPONSE_CACHE_PREFIX = 'adsctrl:api-cache:';
const RESPONSE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

export function readResponseCache(key, maxAgeMs = RESPONSE_CACHE_MAX_AGE_MS) {
  const memoryItem = responseCache.get(key);
  if (memoryItem && Date.now() - memoryItem.createdAt <= maxAgeMs) return memoryItem.data;

  try {
    const raw = sessionStorage.getItem(RESPONSE_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.createdAt > maxAgeMs) {
      sessionStorage.removeItem(RESPONSE_CACHE_PREFIX + key);
      return null;
    }
    responseCache.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeResponseCache(key, data) {
  const item = { data, createdAt: Date.now() };
  responseCache.set(key, item);
  try {
    sessionStorage.setItem(RESPONSE_CACHE_PREFIX + key, JSON.stringify(item));
  } catch {
    // Ignore quota errors; memory cache still helps during the current tab session.
  }
  return data;
}

export async function api(method, path, body = null, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120000;
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal
  };

  if (body !== null && body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(apiUrl(path), opts);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request qua lau, vui long thu lai hoac cap nhat it du lieu hon', { cause: error });
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const text = await res.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const error = new Error(data?.error || `API error ${res.status}`);
    error.status = res.status;
    if (data && typeof data === 'object') {
      Object.assign(error, data);
    }
    throw error;
  }

  return data;
}

export async function cachedApi(method, path, body = null, options = {}) {
  const cacheKey = options.cacheKey || `${method}:${path}`;
  const data = await api(method, path, body, options);
  if (method === 'GET') writeResponseCache(cacheKey, data);
  return data;
}

export const formatVND = (n) => Number(n || 0).toLocaleString('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0
});

export const formatNumber = (n) => Number(n || 0).toLocaleString('vi-VN');

export const todayString = () => {
  const d = new Date();
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split('T')[0];
};

export const timeString = (d) => new Date(d).toLocaleTimeString('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Ho_Chi_Minh'
});

export const dateTimeString = (d) => new Date(d).toLocaleString('vi-VN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Ho_Chi_Minh'
});
