export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export function apiUrl(path) {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getAuthToken() {
  return localStorage.getItem('adsctrl-token') || '';
}

function isHtmlResponse(text) {
  return /<\s*(html|head|body|title|center|h1)\b/i.test(String(text || ''));
}

function getHttpErrorMessage(status, text) {
  if (status === 502 || status === 503 || status === 504) {
    return 'May chu xu ly qua lau hoac tam thoi khong phan hoi. Vui long kiem tra lai du lieu sau it phut.';
  }
  if (isHtmlResponse(text)) {
    return `May chu tra ve loi HTML (HTTP ${status}). Vui long thu lai sau.`;
  }
  return text || `API error ${status}`;
}

const responseCache = new Map();
const inFlightCacheRequests = new Map();
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
  const token = getAuthToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;

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
      data = { error: getHttpErrorMessage(res.status, text) };
    }
  }

  if (!res.ok) {
    const error = new Error(data?.error || getHttpErrorMessage(res.status, text));
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
  if (method === 'GET' && inFlightCacheRequests.has(cacheKey)) {
    return inFlightCacheRequests.get(cacheKey);
  }

  const request = api(method, path, body, options)
    .then(data => {
      if (method === 'GET') writeResponseCache(cacheKey, data);
      return data;
    })
    .finally(() => {
      if (method === 'GET') inFlightCacheRequests.delete(cacheKey);
    });

  if (method === 'GET') inFlightCacheRequests.set(cacheKey, request);
  return request;
}

export async function downloadFile(path, filenameFallback = 'download.csv') {
  const controller = new AbortController();
  const opts = {
    method: 'GET',
    headers: {},
    signal: controller.signal
  };
  const token = getAuthToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl(path), opts);
  if (!res.ok) {
    const text = await res.text();
    let errorMessage = getHttpErrorMessage(res.status, text);
    try {
      const data = text ? JSON.parse(text) : null;
      if (data?.error) errorMessage = data.error;
    } catch {
      // Keep fallback message from HTTP response text.
    }
    const error = new Error(errorMessage);
    error.status = res.status;
    throw error;
  }

  const blob = await res.blob();
  const contentDisposition = res.headers.get('Content-Disposition') || '';
  const matchedFilename = contentDisposition.match(/filename="?([^"]+)"?/i);
  const filename = matchedFilename?.[1] || filenameFallback;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
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

export const displayDateTime24 = (value) => String(value || '').replace('T', ' ');

export const normalizeDateTime24Input = (value) => String(value || '')
  .replace(/^\s+/, '')
  .replace(/\s+/, 'T')
  .replace(/\s+$/, '');

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
