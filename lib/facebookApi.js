'use strict';

const axios = require('axios');
const {
  FACEBOOK_GRAPH_API_VERSION,
  FB_RATE_LIMIT_BACKOFF_MS,
  FB_RATE_LIMIT_RETRIES
} = require('../config/appConstants');

/**
 * Delay helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Error helpers ────────────────────────────────────────────────────────────

const FB_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const FB_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

/**
 * Kiểm tra response có phải rate limit không.
 * @param {object} data
 * @returns {boolean}
 */
function isFbRateLimitResponse(data) {
  const apiError = data?.error || {};
  const code = Number(apiError.code);
  const subcode = Number(apiError.error_subcode);
  return [4, 17, 32, 613, 80004].includes(code) || subcode === 2446079;
}

/**
 * Kiểm tra response có phải transient error không.
 * @param {number} status
 * @param {object} data
 * @returns {boolean}
 */
function isTransientFbResponse(status, data) {
  const code = Number(data?.error?.code);
  const subcode = Number(data?.error?.error_subcode);
  return !status || FB_TRANSIENT_STATUSES.has(Number(status)) || FB_TRANSIENT_CODES.has(code) || subcode === 99 || isFbRateLimitResponse(data);
}

/**
 * Tính delay retry.
 * @param {Error} error
 * @param {number} attempt
 * @returns {number}
 */
function getFbRetryDelayMs(error, attempt) {
  if (error.rateLimited) {
    return Math.min(FB_RATE_LIMIT_BACKOFF_MS * Math.max(1, attempt + 1), 300000);
  }
  return 700 * Math.pow(2, attempt);
}

/**
 * Tạo error object chuẩn cho FB request.
 * @param {string} method
 * @param {number} status
 * @param {object} data
 * @param {string} fallbackMessage
 * @returns {Error}
 */
function buildFbRequestError(method, status, data, fallbackMessage) {
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
    ? `FB ${method} bi gioi han API cua tai khoan quang cao. Da tu cho va thu lai; neu van loi hay doi vai phut roi nhan tiep.`
    : `FB ${method} ${status || 'ERR'}: ${JSON.stringify(data) || fallbackMessage}`);
  error.status = status;
  error.fbData = data;
  error.transient = isTransientFbResponse(status, data);
  error.rateLimited = rateLimited;
  return error;
}

/**
 * Kiểm tra lỗi messaging purchase optimization.
 * @param {Error} error
 * @returns {boolean}
 */
function isMessagingPurchaseOptimizationError(error) {
  const data = error.fbData || error.response?.data || {};
  const apiError = data.error || {};
  const blameSpecs = JSON.stringify(apiError.error_data || '').toLowerCase();

  return Number(apiError.code) === 100 &&
    Number(apiError.error_subcode) === 2490408 &&
    blameSpecs.includes('optimization_goal');
}

/**
 * Kiểm tra lỗi standard enhancements creative.
 * @param {Error} error
 * @returns {boolean}
 */
function isStandardEnhancementsCreativeError(error) {
  const apiError = (error.fbData || error.response?.data || {}).error || {};
  return Number(apiError.code) === 100 && Number(apiError.error_subcode) === 3858504;
}

// ─── HTTP Clients ─────────────────────────────────────────────────────────────

/**
 * GET tới Facebook Graph API với retry.
 * @param {string} token
 * @param {string} resourcePath
 * @param {object} params
 * @param {object} options
 */
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
      lastError = buildFbRequestError('GET', error.response?.status, error.response?.data, error.message);
      const retryLimit = lastError.rateLimited ? rateLimitRetries : retries;
      if (!lastError.transient || attempt >= retryLimit) break;
      await sleep(getFbRetryDelayMs(lastError, attempt));
    }
  }

  throw lastError;
}

/**
 * GET từ URL đầy đủ (dùng cho pagination).
 * @param {string} url
 * @param {object} options
 */
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
      lastError = buildFbRequestError('GET', error.response?.status, error.response?.data, error.message);
      const retryLimit = lastError.rateLimited ? rateLimitRetries : retries;
      if (!lastError.transient || attempt >= retryLimit) break;
      await sleep(getFbRetryDelayMs(lastError, attempt));
    }
  }

  throw lastError;
}

/**
 * POST tới Facebook Graph API với retry.
 * @param {string} token
 * @param {string} resourcePath
 * @param {object} body
 * @param {object} options
 */
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
      lastError = buildFbRequestError('POST', error.response?.status, error.response?.data, error.message);
      const retryLimit = lastError.rateLimited ? rateLimitRetries : retries;
      if (!lastError.transient || attempt >= retryLimit) break;
      await sleep(getFbRetryDelayMs(lastError, attempt));
    }
  }

  throw lastError;
}

/**
 * Fetch tất cả items qua pagination của một FB edge.
 * @param {string} token
 * @param {string} resourcePath
 * @param {object} params
 * @param {object} options
 */
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

/**
 * Đổi short-lived token sang long-lived token.
 * @param {string} shortToken
 * @param {string} appId
 * @param {string} appSecret
 * @returns {Promise<string>}
 */
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

module.exports = {
  sleep,
  FB_TRANSIENT_STATUSES,
  FB_TRANSIENT_CODES,
  isFbRateLimitResponse,
  isTransientFbResponse,
  getFbRetryDelayMs,
  buildFbRequestError,
  isMessagingPurchaseOptimizationError,
  isStandardEnhancementsCreativeError,
  fbGet,
  fbGetUrl,
  fbPost,
  fetchAllFbEdge,
  exchangeToken
};
