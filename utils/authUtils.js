'use strict';

const crypto = require('crypto');
const { parseBoundedInt } = require('./number');

const AUTH_TOKEN_TTL_MS = parseBoundedInt(process.env.AUTH_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000, 60 * 1000, 30 * 24 * 60 * 60 * 1000);
const AUTH_SECRET = String(process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.FB_APP_SECRET || 'adsctrl-local-auth-secret');

/**
 * Hash mật khẩu với PBKDF2. Trả về "salt:hash".
 * @param {string} password
 * @param {string} [salt]
 * @returns {string}
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Xác minh mật khẩu so với storedHash (dạng "salt:hash").
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash = '') {
  const [salt, expectedHash] = String(storedHash || '').split(':');
  if (!salt || !expectedHash) return false;
  const actualHash = hashPassword(password, salt).split(':')[1];
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

/**
 * Ký một payload string bằng HMAC-SHA256.
 * @param {string} payload
 * @returns {string}
 */
function signAuthPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
}

/**
 * Tạo auth token cho user.
 * @param {object} user
 * @returns {string}
 */
function createAuthToken(user) {
  const payload = Buffer.from(JSON.stringify({
    userId: String(user._id),
    username: user.username,
    provider: user.provider || 'facebook',
    exp: Date.now() + AUTH_TOKEN_TTL_MS
  })).toString('base64url');
  return `${payload}.${signAuthPayload(payload)}`;
}

/**
 * Parse và xác minh auth token. Trả về data hoặc null nếu không hợp lệ.
 * @param {string} token
 * @returns {object|null}
 */
function parseAuthToken(token = '') {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || signAuthPayload(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.userId || !data?.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Tạo signed state cho OAuth flow.
 * @param {string} prefix
 * @param {object} data
 * @returns {string}
 */
function createSignedState(prefix, data = {}) {
  const payload = Buffer.from(JSON.stringify({
    ...data,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(12).toString('hex')
  })).toString('base64url');
  return `${payload}.${signAuthPayload(`${prefix}:${payload}`)}`;
}

/**
 * Parse và xác minh signed state. Trả về data hoặc null.
 * @param {string} prefix
 * @param {string} state
 * @returns {object|null}
 */
function parseSignedState(prefix, state = '') {
  const [payload, signature] = String(state || '').split('.');
  if (!payload || !signature || signAuthPayload(`${prefix}:${payload}`) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Chuẩn hóa username về lowercase.
 * @param {string} value
 * @returns {string}
 */
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Kiểm tra có phải admin user không.
 * @param {object} user
 * @returns {boolean}
 */
function isAdminUser(user = {}) {
  return normalizeUsername(user.username) === 'admin';
}

/**
 * Middleware helper: kiểm tra quyền admin và trả lỗi nếu không.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
function requireAdminUser(req, res) {
  if (!isAdminUser(req.currentUser)) {
    res.status(403).json({ error: 'Chi admin moi co quyen quan ly users' });
    return false;
  }
  return true;
}

/**
 * Serialize user object để trả về client (bỏ password).
 * @param {object} user
 * @returns {object}
 */
function serializeAdminUser(user = {}) {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName || user.username,
    provider: user.provider || 'facebook',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

/**
 * Lấy bearer token từ request header.
 * @param {import('express').Request} req
 * @returns {string}
 */
function getBearerToken(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

/**
 * Chuẩn hóa provider string.
 * @param {string} value
 * @returns {string}
 */
function normalizeProvider(value) {
  const normalized = String(value || 'facebook').trim().toLowerCase();
  if (normalized === 'shopee') return 'shopee';
  if (normalized === 'oder') return 'oder';
  if (normalized === 'kho') return 'kho';
  return 'facebook';
}

module.exports = {
  AUTH_TOKEN_TTL_MS,
  AUTH_SECRET,
  hashPassword,
  verifyPassword,
  signAuthPayload,
  createAuthToken,
  parseAuthToken,
  createSignedState,
  parseSignedState,
  normalizeUsername,
  normalizeProvider,
  isAdminUser,
  requireAdminUser,
  serializeAdminUser,
  getBearerToken
};
