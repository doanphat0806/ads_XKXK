/**
 * Authentication and authorization utilities
 * Handles token creation, verification, password hashing, and user validation
 */

const crypto = require('crypto');
const { normalizeUsername } = require('./normalizers');

const AUTH_TOKEN_TTL_MS = parseInt(process.env.AUTH_TOKEN_TTL_MS || (7 * 24 * 60 * 60 * 1000));
const AUTH_SECRET = String(process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.FB_APP_SECRET || 'adsctrl-local-auth-secret');

// Password hashing
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash = '') {
  const [salt, expectedHash] = String(storedHash || '').split(':');
  if (!salt || !expectedHash) return false;
  const actualHash = hashPassword(password, salt).split(':')[1];
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

// Auth token handling
function signAuthPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
}

function createAuthToken(user) {
  const payload = Buffer.from(JSON.stringify({
    userId: String(user._id),
    username: user.username,
    provider: user.provider || 'facebook',
    exp: Date.now() + AUTH_TOKEN_TTL_MS
  })).toString('base64url');
  return `${payload}.${signAuthPayload(payload)}`;
}

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

// User admin checks
function isAdminUser(user = {}) {
  return normalizeUsername(user.username) === 'admin';
}

function requireAdminUser(req, res) {
  if (!isAdminUser(req.currentUser)) {
    res.status(403).json({ error: 'Chi admin moi co quyen quan ly users' });
    return false;
  }
  return true;
}

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

// Bearer token extraction
function getBearerToken(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

// Signed state for OAuth flows
function createSignedState(prefix, data = {}) {
  const payload = Buffer.from(JSON.stringify({
    ...data,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(12).toString('hex')
  })).toString('base64url');
  return `${payload}.${signAuthPayload(`${prefix}:${payload}`)}`;
}

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

module.exports = {
  hashPassword,
  verifyPassword,
  signAuthPayload,
  createAuthToken,
  parseAuthToken,
  isAdminUser,
  requireAdminUser,
  serializeAdminUser,
  getBearerToken,
  createSignedState,
  parseSignedState,
  AUTH_TOKEN_TTL_MS,
  AUTH_SECRET
};
