const axios = require('axios');
const { parseBoundedInt } = require('./number');
const {
  FB_RATE_LIMIT_BACKOFF_MS,
  FB_RATE_LIMIT_RETRIES,
  FACEBOOK_GRAPH_API_VERSION
} = require('../config/appConstants');

const ACCOUNT_RATE_LIMIT_COOLDOWN_MS = parseBoundedInt(process.env.ACCOUNT_RATE_LIMIT_COOLDOWN_MS, 10 * 60 * 1000, 60 * 1000, 60 * 60 * 1000);
const accountRateLimitUntil = new Map();

const FB_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const FB_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const FB_CAMPAIGN_CREATE_REQUEST_OPTIONS = { retries: 1, rateLimitRetries: 1 };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cac loai gioi han cua Facebook - moi loai tinh RIENG, nen trang "Gioi han toc do" cua app
// con han muc (vd app 59%) van co the bi chan o cap khac (user/token, tung TKQC, Insights...).
const FB_RATE_LIMIT_LABELS = {
  4: 'gioi han cap UNG DUNG (#4)',
  17: 'gioi han cap NGUOI DUNG / token VIA (#17)',
  32: 'gioi han cap TRANG (#32)',
  613: 'goi qua nhieu lan trong thoi gian ngan (#613)',
  80000: 'gioi han Ads Insights cua TKQC (#80000)',
  80003: 'gioi han Custom Audience cua TKQC (#80003)',
  80004: 'gioi han Ads Management cua TKQC (#80004)',
  80014: 'gioi han Catalog batch (#80014)'
};

function isFbRateLimitResponse(data) {
  const apiError = data?.error || {};
  const code = Number(apiError.code);
  const subcode = Number(apiError.error_subcode);
  return Object.prototype.hasOwnProperty.call(FB_RATE_LIMIT_LABELS, code) || subcode === 2446079;
}

// Header x-business-use-case-usage / x-ad-account-usage cho biet bao lau mo lai (phut)
function getRegainAccessMinutes(headers = {}) {
  let minutes = 0;
  try {
    const buc = headers['x-business-use-case-usage'];
    if (buc) {
      const parsed = typeof buc === 'string' ? JSON.parse(buc) : buc;
      for (const items of Object.values(parsed || {})) {
        for (const item of Array.isArray(items) ? items : []) {
          minutes = Math.max(minutes, Number(item?.estimated_time_to_regain_access) || 0);
        }
      }
    }
    const adAccount = headers['x-ad-account-usage'];
    if (adAccount) {
      const parsed = typeof adAccount === 'string' ? JSON.parse(adAccount) : adAccount;
      const resetSeconds = Number(parsed?.reset_time_duration) || 0;
      minutes = Math.max(minutes, Math.ceil(resetSeconds / 60));
    }
  } catch {
    // header la -> bo qua
  }
  return minutes;
}

function describeFbRateLimit(data, headers) {
  const apiError = data?.error || {};
  const code = Number(apiError.code);
  const label = FB_RATE_LIMIT_LABELS[code] || `gioi han API (#${code || '?'}${apiError.error_subcode ? `/${apiError.error_subcode}` : ''})`;
  const minutes = getRegainAccessMinutes(headers);
  return `${label}${minutes ? `, Facebook bao mo lai sau ~${minutes} phut` : ''}`;
}

function isTransientFbResponse(status, data) {
  const code = Number(data?.error?.code);
  const subcode = Number(data?.error?.error_subcode);
  return !status || FB_TRANSIENT_STATUSES.has(Number(status)) || FB_TRANSIENT_CODES.has(code) || subcode === 99 || isFbRateLimitResponse(data);
}

function getFbRetryDelayMs(error, attempt) {
  if (error.rateLimited) {
    return Math.min(FB_RATE_LIMIT_BACKOFF_MS * Math.max(1, attempt + 1), 300000);
  }
  return 700 * Math.pow(2, attempt);
}

function buildFbRequestError(method, status, data, fallbackMessage, headers = {}) {
  const message = data?.error?.message || fallbackMessage;
  if (Number(status) === 400 && Number(data?.error?.code) === 190) {
    const tokenError = new Error(`Token het han hoac khong hop le: ${message}`);
    tokenError.status = status;
    tokenError.fbData = data;
    tokenError.transient = false;
    return tokenError;
  }

  const rateLimited = isFbRateLimitResponse(data);
  const error = new Error(rateLimited
    ? `FB ${method} bi ${describeFbRateLimit(data, headers)}. Da tu cho va thu lai; neu van loi hay doi roi thu tiep.`
    : `FB ${method} ${status || 'ERR'}: ${JSON.stringify(data) || fallbackMessage}`);
  error.status = status;
  error.fbData = data;
  error.fbCode = Number(data?.error?.code) || null;
  error.transient = isTransientFbResponse(status, data);
  error.rateLimited = rateLimited;
  return error;
}

function getAccountRateLimitDelayMs(accountId) {
  const until = accountRateLimitUntil.get(String(accountId)) || 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    accountRateLimitUntil.delete(String(accountId));
    return 0;
  }
  return remaining;
}

function markAccountRateLimited(accountId) {
  accountRateLimitUntil.set(String(accountId), Date.now() + ACCOUNT_RATE_LIMIT_COOLDOWN_MS);
}

async function exchangeToken(shortToken, appId, appSecret) {
  try {
    const response = await axios.get('https://graph.facebook.com/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken
      }
    });
    return response.data.access_token;
  } catch (error) {
    throw new Error(`Khong the doi token: ${error.response?.data?.error?.message || error.message}`);
  }
}

async function fbGet(token, resourcePath, params = {}, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 4;
  const rateLimitRetries = Number.isFinite(options.rateLimitRetries) ? options.rateLimitRetries : FB_RATE_LIMIT_RETRIES;
  const maxAttempts = Math.max(retries, rateLimitRetries);
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${resourcePath}`;
  let lastError;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(url, { params: { access_token: token, ...params }, timeout: 30000 });
      return response.data;
    } catch (error) {
      lastError = buildFbRequestError('GET', error.response?.status, error.response?.data, error.message, error.response?.headers);
      const retryLimit = lastError.rateLimited ? rateLimitRetries : retries;
      if (!lastError.transient || attempt >= retryLimit) break;
      await sleep(getFbRetryDelayMs(lastError, attempt));
    }
  }

  throw lastError;
}

async function fbGetUrl(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 4;
  const rateLimitRetries = Number.isFinite(options.rateLimitRetries) ? options.rateLimitRetries : FB_RATE_LIMIT_RETRIES;
  const maxAttempts = Math.max(retries, rateLimitRetries);
  const timeout = Number.isFinite(options.timeout) ? options.timeout : 30000;
  let lastError;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(url, { timeout });
      return response.data;
    } catch (error) {
      lastError = buildFbRequestError('GET', error.response?.status, error.response?.data, error.message, error.response?.headers);
      const retryLimit = lastError.rateLimited ? rateLimitRetries : retries;
      if (!lastError.transient || attempt >= retryLimit) break;
      await sleep(getFbRetryDelayMs(lastError, attempt));
    }
  }

  throw lastError;
}

async function fbPost(token, resourcePath, body = {}, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 4;
  const rateLimitRetries = Number.isFinite(options.rateLimitRetries) ? options.rateLimitRetries : FB_RATE_LIMIT_RETRIES;
  const maxAttempts = Math.max(retries, rateLimitRetries);
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${resourcePath}`;
  let lastError;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(url, { access_token: token, ...body }, { timeout: 30000 });
      return response.data;
    } catch (error) {
      lastError = buildFbRequestError('POST', error.response?.status, error.response?.data, error.message, error.response?.headers);
      const retryLimit = lastError.rateLimited ? rateLimitRetries : retries;
      if (!lastError.transient || attempt >= retryLimit) break;
      await sleep(getFbRetryDelayMs(lastError, attempt));
    }
  }

  throw lastError;
}

async function fetchAllFbEdge(token, resourcePath, params = {}, options = {}) {
  const items = [];
  const requestOptions = options.requestOptions || {};
  const pageTimeoutMs = Number.isFinite(options.pageTimeoutMs) ? options.pageTimeoutMs : 30000;
  const firstPage = await fbGet(token, resourcePath, params, requestOptions);
  if (Array.isArray(firstPage.data)) items.push(...firstPage.data);

  let nextUrl = firstPage.paging?.next || null;
  let pageCount = 1;
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 1000;
  while (nextUrl) {
    if (pageCount >= maxPages) break;

    const data = await fbGetUrl(nextUrl, { ...requestOptions, timeout: pageTimeoutMs });
    if (Array.isArray(data?.data)) items.push(...data.data);
    nextUrl = data?.paging?.next || null;
    pageCount += 1;

    if (pageCount > maxPages) {
      throw new Error(`Dung dong bo ${resourcePath} sau ${maxPages} trang vi Facebook pagination bat thuong`);
    }
  }

  return { items, pageCount };
}

async function mapWithConcurrency(inputs, mapper, concurrency = 4) {
  const results = new Array(inputs.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await mapper(inputs[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = { error };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

module.exports = {
  accountRateLimitUntil,
  FB_CAMPAIGN_CREATE_REQUEST_OPTIONS,
  sleep,
  isFbRateLimitResponse,
  isTransientFbResponse,
  getFbRetryDelayMs,
  buildFbRequestError,
  getAccountRateLimitDelayMs,
  markAccountRateLimited,
  exchangeToken,
  fbGet,
  fbGetUrl,
  fbPost,
  fetchAllFbEdge,
  mapWithConcurrency,
  chunkArray
};
