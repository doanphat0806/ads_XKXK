require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const registerPageRoutes = require('./routes/pageRoutes');
const { parseBoundedInt } = require('./utils/number');

const app = express();
const publicDir = path.join(__dirname, 'client', 'dist');
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

// ================= FACEBOOK LOGIN =================
const FB_REDIRECT_URI = 'https://xekoxukashop.id.vn/auth/facebook/callback';

app.get('/auth/facebook', (req, res) => {
  const url = `https://www.facebook.com/v24.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&scope=public_profile,email`;

  return res.redirect(url);
});

app.get('/auth/facebook/callback', async (req, res) => {
  const { code, error } = req.query;

  // ❌ user bấm huỷ
  if (error) {
    return res.redirect('https://xekoxukashop.id.vn/');
  }

  // ❌ không có code
  if (!code) {
    return res.send("No code");
  }

  try {
    // 👉 đổi code -> access_token
    const tokenRes = await axios.get(
      'https://graph.facebook.com/v24.0/oauth/access_token',
      {
        params: {
          client_id: process.env.FB_APP_ID,
          client_secret: process.env.FB_APP_SECRET,
          redirect_uri: FB_REDIRECT_URI,
          code
        }
      }
    );

    const access_token = tokenRes.data.access_token;

    // 👉 lấy info user
    const userRes = await axios.get('https://graph.facebook.com/me', {
      params: {
        access_token,
        fields: 'id,name,email'
      }
    });

    const user = userRes.data;
    console.log("FB USER:", user);

    // 👉 Lưu token vào DB
    const Config = require('./models/Config');
    
    // Thử đổi token sang loại dài hạn (long-lived)
    let longLivedToken = access_token;
    try {
      longLivedToken = await exchangeToken(access_token, process.env.FB_APP_ID, process.env.FB_APP_SECRET);
    } catch (e) {
      console.warn("Could not exchange for long lived token:", e.message);
    }

    // Lưu token dung chung
    await Config.findOneAndUpdate(
      { key: 'app' },
      { 
        $set: { 
          fbToken: longLivedToken,
          fbTokenLastRefreshTime: new Date()
        } 
      },
      { upsert: true }
    );

    // ✅ Đăng nhập thành công trên frontend và về lại Dash
    return res.send(`
      <script>
        localStorage.setItem('adsctrl-auth', '1');
        localStorage.setItem('adsctrl-provider', 'facebook');
        window.location.href = '/';
      </script>
    `);

  } catch (err) {
    console.error("FB LOGIN ERROR:", err.response?.data || err.message);
    return res.send(`
      <script>
        alert("Lỗi đăng nhập Facebook!");
        window.location.href = '/';
      </script>
    `);
  }
});
// Auto-pause rules time window check (Vietnam time, UTC+7)
function isWithinAutoRuleTimeWindow(startTime, endTime) {
  const now = new Date();
  const vnOffset = 7 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const vnMinutes = (utcMinutes + vnOffset) % (24 * 60);

  const [sh, sm] = (startTime || '00:00').split(':').map(Number);
  const [eh, em] = (endTime || '09:00').split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    return vnMinutes >= startMin && vnMinutes < endMin;
  } else {
    // Overnight range, e.g. 22:00 - 06:00
    return vnMinutes >= startMin || vnMinutes < endMin;
  }
}

const Account = require('./models/Account');
const Campaign = require('./models/Campaign');
const Log = require('./models/Log');
const Config = require('./models/Config');
const User = require('./models/User');
const FacebookToken = require('./models/FacebookToken');
const Order = require('./models/Order');
const InventoryItem = require('./models/InventoryItem');
const FacebookPost = require('./models/FacebookPost');
const {
  buildOrderQuery,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  useSheetOrders,
  normalizeStatusKey,
  buildOrderSkuStats,
  fetchOrderSheetRows,
  getOrderSheetOrders,
  getOrderStatsCacheKey,
  ordersSheetCache,
  orderStatsCache
} = require('./services/orderService');
const {
  configureFacebookToken,
  checkAndRefreshFacebookToken,
  bootstrapFacebookTokenFromEnv,
  sendTokenAlert,
  startFacebookTokenCron,
  FACEBOOK_TOKEN_KEY
} = require('./services/facebookTokenService');
const {
  fetchInventorySheetItems,
  fetchInventorySheetRowsWithGoogleAccess,
  fetchInventorySheetItemsWithGoogleAccess,
  updateInventorySheetSalePriceWithGoogleAccess
} = require('./services/inventorySheetService');
const {
  DEFAULT_CAMPAIGN_DAILY_BUDGET,
  SHOPEE_CAMPAIGN_DAILY_BUDGET,
  SHOPEE_AD_SET_BID_AMOUNT,
  SHOPEE_AGE_MIN,
  SHOPEE_AGE_MAX,
  DEFAULT_AD_SET_NAME,
  DEFAULT_AD_NAME_PREFIX,
  DEFAULT_POST_LABEL_PREFIX,
  DEFAULT_CAMPAIGN_OBJECTIVE,
  DEFAULT_CAMPAIGN_BID_STRATEGY,
  VN_OFFSET_MS,
  SHOPEE_CAMPAIGN_BID_STRATEGY,
  DEFAULT_AD_SET_DESTINATION_TYPE,
  DEFAULT_AD_SET_OPTIMIZATION_GOAL,
  META_POST_REQUEST_LIMIT,
  POSTS_PER_PAGE_LIMIT,
  SHOPEE_POSTS_PER_PAGE_LIMIT,
  ALL_POSTS_MAX_LIMIT,
  CAMPAIGN_CREATE_CONCURRENCY,
  CAMPAIGN_CREATE_ITEM_DELAY_MS,
  CAMPAIGN_DUPLICATE_QUEUE_DELAY_MS,
  CAMPAIGN_DUPLICATE_COPY_STATUS,
  FB_RATE_LIMIT_BACKOFF_MS,
  FB_RATE_LIMIT_RETRIES,
  SHOPEE_AD_ACCOUNT_NAME_PATTERN,
  FACEBOOK_GRAPH_API_VERSION,
  FINAL_SPEND_CRON,
  FINAL_SPEND_TIMEZONE,
  TODAY_CAMPAIGN_SYNC_INTERVAL_MS,
  REDIS_URL,
  REDIS_QUEUE_ENABLED,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  CAMPAIGN_DUPLICATE_QUEUE_NAME,
  CAMPAIGN_DUPLICATE_QUEUE_CONCURRENCY,
  CAMPAIGN_DUPLICATE_JOB_ATTEMPTS,
  CAMPAIGN_DUPLICATE_JOB_BACKOFF_MS,
  CAMPAIGN_SYNC_QUEUE_NAME,
  CAMPAIGN_SYNC_QUEUE_CONCURRENCY,
  CAMPAIGN_SYNC_JOB_ATTEMPTS,
  CAMPAIGN_SYNC_JOB_BACKOFF_MS,
  CAMPAIGN_SYNC_DAY_DELAY_MS,
  ORDER_SHEET_SYNC_QUEUE_NAME,
  ORDER_SHEET_SYNC_QUEUE_CONCURRENCY,
  ORDER_SHEET_SYNC_JOB_ATTEMPTS,
  ORDER_SHEET_SYNC_JOB_BACKOFF_MS
} = require('./config/appConstants');

const SHOPEE_DEFAULT_CALL_TO_ACTION_TYPE = 'NO_BUTTON';
const SHOPEE_CALL_TO_ACTION_TYPES = new Set(['SHOP_NOW', 'NO_BUTTON']);
const AUTO_PAUSE_CPO_LIMIT = 100000;

function normalizeProvider(value) {
  return String(value || 'facebook').trim().toLowerCase() === 'shopee' ? 'shopee' : 'facebook';
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

function isShopeeAdAccountName(name) {
  return SHOPEE_AD_ACCOUNT_NAME_PATTERN.test(String(name || '').trim());
}

function getAccountProviderNameError(provider, name) {
  if (provider === 'shopee' && !isShopeeAdAccountName(name)) {
    return 'Tai khoan Shopee chi cho phep ten bat dau bang XK11, XK12 hoac XK13.';
  }
  if (provider === 'facebook' && isShopeeAdAccountName(name)) {
    return 'Tai khoan bat dau bang XK11, XK12 hoac XK13 chi duoc them vao role Shopee.';
  }
  return '';
}

async function addLog(accountId, accountName, level, message) {
  try {
    if (isShuttingDown || mongoose.connection.readyState !== 1) return;
    await Log.create({ accountId, accountName, level, message });
  } catch { }
}

const READ_CACHE_TTL_MS = 30 * 1000;
const readCache = new Map();
const ACCOUNT_RATE_LIMIT_COOLDOWN_MS = parseBoundedInt(process.env.ACCOUNT_RATE_LIMIT_COOLDOWN_MS, 10 * 60 * 1000, 60 * 1000, 60 * 60 * 1000);
const AUTO_CHECK_MIN_INTERVAL_SECONDS = parseBoundedInt(process.env.AUTO_CHECK_MIN_INTERVAL_SECONDS, 180, 60, 60 * 60);
const accountRateLimitUntil = new Map();
const AUTH_TOKEN_TTL_MS = parseBoundedInt(process.env.AUTH_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000, 60 * 1000, 30 * 24 * 60 * 60 * 1000);
const AUTH_SECRET = String(process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.FB_APP_SECRET || 'adsctrl-local-auth-secret');
const DEFAULT_LOGIN_USERS = [
  { username: 'admin', password: process.env.USER_ADMIN_PASSWORD || 'admin', displayName: 'Admin', provider: 'facebook' },
  { username: 'admin1', password: process.env.USER_ADMIN1_PASSWORD || 'admin', displayName: 'Shopee Admin', provider: 'shopee' },
  { username: 'user2', password: process.env.USER2_PASSWORD || 'admin', displayName: 'User 2', provider: 'facebook' },
  { username: 'user3', password: process.env.USER3_PASSWORD || 'admin', displayName: 'User 3', provider: 'facebook' },
  { username: 'user4', password: process.env.USER4_PASSWORD || 'admin', displayName: 'User 4', provider: 'facebook' }
];

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

const META_PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.fb_pixel_purchase',
  'onsite_conversion.messaging_purchase',
  'onsite_conversion.purchase'
]);

function parseInsightMetricValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMetaPurchaseAction(action) {
  const actionType = String(action?.action_type || '').toLowerCase();
  return META_PURCHASE_ACTION_TYPES.has(actionType) || actionType.endsWith('_purchase');
}

function getMetaOrdersFromInsight(insight = {}) {
  const values = [];
  for (const source of [insight.conversions, insight.actions]) {
    if (!Array.isArray(source)) continue;
    for (const action of source) {
      if (isMetaPurchaseAction(action)) {
        values.push(parseInsightMetricValue(action.value));
      }
    }
  }
  return values.length ? Math.round(Math.max(...values)) : 0;
}

const META_MESSAGE_ACTION_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'omni_initiated_conversation'
];

function isMetaMessageAction(action = {}) {
  return META_MESSAGE_ACTION_TYPES.includes(String(action.action_type || '').toLowerCase());
}

function getMetaMessageActionFromInsight(insight = {}) {
  const actions = Array.isArray(insight.actions) ? insight.actions : [];
  for (const actionType of META_MESSAGE_ACTION_TYPES) {
    const found = actions.find(action => String(action.action_type || '').toLowerCase() === actionType);
    if (found) return found;
  }
  return null;
}

function getMetaCostPerMessageFromInsight(insight = {}) {
  const item = Array.isArray(insight.cost_per_action_type)
    ? insight.cost_per_action_type.find(isMetaMessageAction)
    : null;
  const value = Number(item?.value || 0);
  return Number.isFinite(value) ? value : 0;
}

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

const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

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

function getGoogleOAuthConfig(req) {
  const runtimeRedirectUri = `${req.protocol}://${req.get('host')}/api/google/oauth/callback`;
  const configuredRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  let redirectUri = runtimeRedirectUri;

  if (configuredRedirectUri) {
    try {
      const configuredUrl = new URL(configuredRedirectUri);
      const runtimeUrl = new URL(runtimeRedirectUri);
      const configuredHost = configuredUrl.host.toLowerCase();
      const runtimeHost = runtimeUrl.host.toLowerCase();
      const configuredIsLocalhost = ['localhost', '127.0.0.1'].includes(configuredUrl.hostname.toLowerCase());
      const runtimeIsLocalhost = ['localhost', '127.0.0.1'].includes(runtimeUrl.hostname.toLowerCase());

      if (
        configuredHost === runtimeHost ||
        (configuredIsLocalhost && runtimeIsLocalhost)
      ) {
        redirectUri = configuredRedirectUri;
      }
    } catch {
      redirectUri = runtimeRedirectUri;
    }
  }

  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUri
  };
}

function requireGoogleOAuthConfig(req) {
  const config = getGoogleOAuthConfig(req);
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Chua cau hinh GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET trong .env');
  }
  return config;
}

async function refreshGoogleAccessToken(user, req) {
  if (!user?.googleRefreshToken) {
    throw new Error('Chua dang nhap Google hoac thieu refresh token');
  }

  const { clientId, clientSecret } = requireGoogleOAuthConfig(req);
  const response = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: user.googleRefreshToken,
    grant_type: 'refresh_token'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const tokenData = response.data || {};
  const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000);
  await User.findByIdAndUpdate(user._id, {
    googleAccessToken: tokenData.access_token || '',
    googleTokenExpiresAt: expiresAt,
    googleTokenScope: tokenData.scope || user.googleTokenScope || '',
    updatedAt: new Date()
  });

  return tokenData.access_token;
}

async function getGoogleAccessToken(req) {
  const user = await User.findById(req.currentUser._id)
    .select('googleAccessToken googleRefreshToken googleTokenExpiresAt googleTokenScope')
    .lean();
  if (!user) throw new Error('Tai khoan khong hop le');

  const expiresAt = user.googleTokenExpiresAt ? new Date(user.googleTokenExpiresAt).getTime() : 0;
  if (user.googleAccessToken && expiresAt - Date.now() > 60 * 1000) {
    return user.googleAccessToken;
  }

  return refreshGoogleAccessToken(user, req);
}

function getBearerToken(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function getUserFilter(req) {
  return req.currentUser?._id ? { ownerUserId: req.currentUser._id } : {};
}

function withUserFilter(req, filter = {}) {
  return { ...filter, ...getUserFilter(req) };
}

function userScopedCacheKey(req, key) {
  return `${req.currentUser?._id || 'public'}:${key}`;
}

async function authenticateApiRequest(req, res, next) {
  if (req.path === '/auth/login' || req.path === '/facebook/oauth/callback' || req.path === '/google/oauth/callback' || req.path === '/webhooks/pancake') {
    return next();
  }

  const tokenData = parseAuthToken(getBearerToken(req));
  if (!tokenData || !mongoose.Types.ObjectId.isValid(tokenData.userId)) {
    return res.status(401).json({ error: 'Chua dang nhap hoac phien da het han' });
  }

  const user = await User.findOne({ _id: tokenData.userId, active: true }).select('-passwordHash').lean();
  if (!user) return res.status(401).json({ error: 'Tai khoan khong hop le' });
  req.currentUser = user;
  next();
}

async function getAppConfig() {
  return Config.findOne({ key: 'app' });
}

function pickDefinedValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function mergeAutoConfig(globalConfig = {}, userConfig = {}) {
  return {
    autoRuleStartTime: pickDefinedValue(userConfig.autoRuleStartTime, globalConfig.autoRuleStartTime, '00:00'),
    autoRuleEndTime: pickDefinedValue(userConfig.autoRuleEndTime, globalConfig.autoRuleEndTime, '09:00'),
    shopeeAutoRuleStartTime: pickDefinedValue(userConfig.shopeeAutoRuleStartTime, globalConfig.shopeeAutoRuleStartTime, userConfig.autoRuleStartTime, globalConfig.autoRuleStartTime, '00:00'),
    shopeeAutoRuleEndTime: pickDefinedValue(userConfig.shopeeAutoRuleEndTime, globalConfig.shopeeAutoRuleEndTime, userConfig.autoRuleEndTime, globalConfig.autoRuleEndTime, '09:00'),
    scheduledDuplicatePauseTime: pickDefinedValue(userConfig.scheduledDuplicatePauseTime, globalConfig.scheduledDuplicatePauseTime, '21:00'),
    dailyZeroMessageSpendLimit: pickDefinedValue(userConfig.dailyZeroMessageSpendLimit, globalConfig.dailyZeroMessageSpendLimit, 25000),
    dailyHighCostPerMessageLimit: pickDefinedValue(userConfig.dailyHighCostPerMessageLimit, globalConfig.dailyHighCostPerMessageLimit, 20000),
    dailyHighCostSpendLimit: pickDefinedValue(userConfig.dailyHighCostSpendLimit, globalConfig.dailyHighCostSpendLimit, 50000),
    dailyClickLimit: pickDefinedValue(userConfig.dailyClickLimit, globalConfig.dailyClickLimit, 0),
    dailyCpcLimit: pickDefinedValue(userConfig.dailyCpcLimit, globalConfig.dailyCpcLimit, 600),
    lifetimeZeroMessageSpendLimit: pickDefinedValue(userConfig.lifetimeZeroMessageSpendLimit, globalConfig.lifetimeZeroMessageSpendLimit, 25000),
    lifetimeHighCostPerMessageLimit: pickDefinedValue(userConfig.lifetimeHighCostPerMessageLimit, globalConfig.lifetimeHighCostPerMessageLimit, 20000),
    lifetimeHighCostSpendLimit: pickDefinedValue(userConfig.lifetimeHighCostSpendLimit, globalConfig.lifetimeHighCostSpendLimit, 50000),
    lifetimeClickLimit: pickDefinedValue(userConfig.lifetimeClickLimit, globalConfig.lifetimeClickLimit, 0),
    lifetimeCpcLimit: pickDefinedValue(userConfig.lifetimeCpcLimit, globalConfig.lifetimeCpcLimit, 600),
    autoPauseCpoLimit: pickDefinedValue(userConfig.autoPauseCpoLimit, globalConfig.autoPauseCpoLimit, AUTO_PAUSE_CPO_LIMIT)
  };
}

async function getUserAutoConfig(userId) {
  const [globalConfig, userConfig] = await Promise.all([
    getAppConfig(),
    userId ? User.findById(userId).select(
      'autoRuleStartTime autoRuleEndTime shopeeAutoRuleStartTime shopeeAutoRuleEndTime scheduledDuplicatePauseTime ' +
      'dailyZeroMessageSpendLimit dailyHighCostPerMessageLimit dailyHighCostSpendLimit ' +
      'dailyClickLimit dailyCpcLimit lifetimeZeroMessageSpendLimit lifetimeHighCostPerMessageLimit ' +
      'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit'
    ).lean() : null
  ]);
  return mergeAutoConfig(globalConfig || {}, userConfig || {});
}

async function getAccountAutoConfig(account) {
  return getUserAutoConfig(account?.ownerUserId || null);
}

async function getEffectiveSecrets(account) {
  const config = await getAppConfig();
  let ownerFbToken = '';
  if (account.ownerUserId) {
    const owner = await User.findById(account.ownerUserId).select('fbToken').lean();
    ownerFbToken = owner?.fbToken || '';
  }
  let fbToken = account.fbToken || ownerFbToken || config?.fbToken || '';
  let claudeKey = account.claudeKey || config?.claudeKey || '';
  return { fbToken, claudeKey };
}

function normalizeAdAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const numericId = raw.replace(/^act_/i, '');
  if (!/^\d+$/.test(numericId)) return raw;

  return `act_${numericId}`;
}

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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractShopeeShortLinkCode(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/https?:\/\/(?:www\.)?s\.shopee\.vn\/([A-Za-z0-9_-]+)/i);
  return match?.[1] || '';
}

function normalizeShopeeCallToActionType(value) {
  const normalized = String(value || SHOPEE_DEFAULT_CALL_TO_ACTION_TYPE).trim().toUpperCase();
  return SHOPEE_CALL_TO_ACTION_TYPES.has(normalized) ? normalized : SHOPEE_DEFAULT_CALL_TO_ACTION_TYPE;
}

function getDestinationUrlFromLookupTerm(value) {
  const raw = String(value || '').trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

function buildPostLookupTerms(value) {
  const raw = String(value || '').trim();
  const shortCode = extractShopeeShortLinkCode(raw);
  return [...new Set([raw, shortCode].map(item => item.trim()).filter(Boolean))];
}

function parseCampaignCreateItems(value) {
  const source = Array.isArray(value) ? value.join('\n') : String(value || '');
  const items = [];
  const seen = new Set();

  for (const rawLine of source.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.includes('|')) {
      const [namePart, ...lookupParts] = line.split('|');
      const campaignName = namePart.trim();
      const lookupTerm = lookupParts.join('|').trim();
      if (!campaignName || !lookupTerm) continue;

      const key = `${campaignName}\u0000${lookupTerm}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ campaignName, lookupTerm, destinationUrl: getDestinationUrlFromLookupTerm(lookupTerm) });
      }
      continue;
    }

    for (const part of line.split(/[,;]+/)) {
      const lookupTerm = part.trim();
      if (!lookupTerm) continue;

      const key = `${lookupTerm}\u0000${lookupTerm}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ campaignName: lookupTerm, lookupTerm, destinationUrl: getDestinationUrlFromLookupTerm(lookupTerm) });
      }
    }
  }

  return items;
}

function buildCampaignName(code, prefix = '') {
  const cleanCode = String(code || '').replace(/\s+/g, ' ').trim();
  const cleanPrefix = String(prefix || '').replace(/\s+/g, ' ').trim();
  return cleanPrefix ? `${cleanPrefix} ${cleanCode}` : cleanCode;
}

function getPostPageId(post = {}) {
  const pageId = String(post.pageId || '').trim();
  if (pageId) return pageId;

  const postId = String(post.postId || '').trim();
  if (postId.includes('_')) return postId.split('_')[0];
  return '';
}

function normalizeAdNameStatus(value) {
  const raw = String(value || 'Test').trim();
  const allowed = ['Sale', 'Săn', 'Win', 'Test'];
  return allowed.find(item => item.toLowerCase() === raw.toLowerCase()) || 'Test';
}

function buildAdName(code, prefix = DEFAULT_AD_NAME_PREFIX, status = 'Test') {
  const cleanCode = String(code || '').replace(/\s+/g, ' ').trim();
  const productLabel = `${DEFAULT_POST_LABEL_PREFIX} ${cleanCode}`;
  return `${String(prefix || DEFAULT_AD_NAME_PREFIX).trim()}__${productLabel}__${normalizeAdNameStatus(status)}`;
}

function normalizeBarcode(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeInventoryProductCode(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function extractInventoryProductCode(value) {
  const raw = String(value || '')
    .replace(/["']/g, ' ')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';

  let tokens = raw.split(' ').filter(Boolean);
  if (tokens[0] && String(tokens[0]).toUpperCase() === 'MS' && tokens[1] && /[A-Z]*\d/i.test(tokens[1])) {
    tokens = tokens.slice(1);
  }

  return normalizeInventoryProductCode(tokens[0] || '');
}

const INVENTORY_SIZE_SET = new Set(['S', 'M', 'L', 'XL', 'FZ']);

function normalizeInventorySize(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'FREE' || normalized === 'FREESIZE') return 'FZ';
  return INVENTORY_SIZE_SET.has(normalized) ? normalized : '';
}

function parseInventorySheetIdentity(value) {
  const raw = String(value || '')
    .replace(/["']/g, ' ')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return { productCode: '', size: '' };

  let tokens = raw.split(' ').filter(Boolean);
  if (tokens[0] && String(tokens[0]).toUpperCase() === 'MS' && tokens[1] && /[A-Z]*\d/i.test(tokens[1])) {
    tokens = tokens.slice(1);
  }

  const productCode = normalizeInventoryProductCode(tokens[0] || '');
  const size = tokens
    .slice(1)
    .map(normalizeInventorySize)
    .find(Boolean) || '';

  return { productCode, size };
}

function isPendingInventoryOrderStatus(value) {
  const status = normalizeStatusKey(value);
  return status.includes('cho hang');
}

async function buildInventoryPendingOrderCounts() {
  const orders = useSheetOrders()
    ? await getOrderSheetOrders({ limit: 200000 })
    : await Order.find(buildOrderQuery({})).select('rawData orderId status').limit(200000).lean();

  const byCode = new Map();
  const byCodeSize = new Map();

  for (const order of orders) {
    const rawStatus = order.status || order.rawData?.status_name || order.rawData?.status || '';
    if (!isPendingInventoryOrderStatus(rawStatus)) continue;

    for (const item of getOrderItemsFromRaw(order.rawData || {})) {
      const productCode = extractInventoryProductCode(getOrderItemSku(item));
      if (!productCode) continue;

      const size = normalizeInventorySize(
        item.size ||
        item.variation_value ||
        item.variation_info?.detail ||
        item.variation_info?.size
      );
      const quantity = getOrderItemQuantity(item);

      byCode.set(productCode, (byCode.get(productCode) || 0) + quantity);
      if (size) {
        const key = `${productCode}\u0000${size}`;
        byCodeSize.set(key, (byCodeSize.get(key) || 0) + quantity);
      }
    }
  }

  return { byCode, byCodeSize };
}

async function syncInventorySalePriceToSheet(req, items, salePrice, options = {}) {
  const rowNumbers = Array.from(new Set(
    (items || [])
      .flatMap(item => Array.isArray(item?.sheetRowNumbers) ? item.sheetRowNumbers : [])
      .map(value => Number(value))
      .filter(Number.isFinite)
  )).sort((a, b) => a - b);

  if (!rowNumbers.length) {
    return { updated: 0, skipped: true };
  }

  const googleAccessToken = await getGoogleAccessToken(req);
  return updateInventorySheetSalePriceWithGoogleAccess(googleAccessToken, rowNumbers, salePrice, options);
}

async function buildAccountPayload(input = {}) {
  const config = await getAppConfig();
  const owner = input.ownerUserId ? await User.findById(input.ownerUserId).select('fbToken').lean() : null;
  const provider = normalizeProvider(input.provider);
  const adAccountId = provider === 'facebook'
    ? normalizeAdAccountId(input.adAccountId)
    : String(input.adAccountId || '').trim();

  return {
    ownerUserId: input.ownerUserId,
    name: String(input.name || '').trim(),
    provider,
    fbToken: provider === 'facebook' ? String(input.fbToken || owner?.fbToken || config?.fbToken || '').trim() : '',
    adAccountId,
    claudeKey: String(input.claudeKey || config?.claudeKey || '').trim(),
    spendThreshold: Number(input.spendThreshold || 20000),
    checkInterval: Number(input.checkInterval || 60),
    autoEnabled: Boolean(input.autoEnabled),
    linkedPageIds: Array.isArray(input.linkedPageIds) ? input.linkedPageIds : []
  };
}

function todayStr() {
  const d = new Date();
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split('T')[0];
}

function dateKeyFromVnOffset(daysOffset = 0) {
  const d = new Date(Date.now() + VN_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().split('T')[0];
}

function buildVnDateRange(dateKey) {
  const normalized = normalizeCampaignDate(dateKey);
  const startUtc = new Date(`${normalized}T00:00:00+07:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { normalized, startUtc, endUtc };
}

function normalizeCampaignDate(value) {
  const date = String(value || '').trim();
  return date || todayStr();
}

async function upsertDailyCampaign(accountId, campaignId, date, fields = {}) {
  const dailyDate = normalizeCampaignDate(date);
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!accountId || !normalizedCampaignId) {
    throw new Error('Thieu accountId hoac campaignId khi luu camp');
  }

  const updateFields = { ...fields };
  delete updateFields.accountId;
  delete updateFields.campaignId;
  delete updateFields.date;

  const filter = { accountId, campaignId: normalizedCampaignId, date: dailyDate };
  const update = {
    $set: {
      ...updateFields,
      date: dailyDate,
      updatedAt: new Date()
    },
    $setOnInsert: {
      accountId,
      campaignId: normalizedCampaignId
    }
  };

  try {
    clearCampaignReadCache();
    return await Campaign.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error?.code === 11000) {
      return Campaign.findOneAndUpdate(filter, update, { new: true });
    }
    throw error;
  }
}

function buildVietnamCampaignStart(year, month, day, hour, minute) {
  const localDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const yyyy = localDate.getUTCFullYear();
  const mm = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(localDate.getUTCDate()).padStart(2, '0');
  const hh = String(localDate.getUTCHours()).padStart(2, '0');
  const mi = String(localDate.getUTCMinutes()).padStart(2, '0');
  const startUtc = new Date(Date.UTC(yyyy, localDate.getUTCMonth(), localDate.getUTCDate(), localDate.getUTCHours() - 7, localDate.getUTCMinutes(), 0));

  return {
    fbStartTime: `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+0700`,
    utc: startUtc.toISOString(),
    display: `${dd}/${mm}/${yyyy} ${hh}:${mi}`
  };
}

function getDefaultVietnamCampaignStart() {
  const vnNow = new Date(Date.now() + 10 * 60 * 1000 + 7 * 60 * 60 * 1000);
  return buildVietnamCampaignStart(
    vnNow.getUTCFullYear(),
    vnNow.getUTCMonth() + 1,
    vnNow.getUTCDate(),
    vnNow.getUTCHours(),
    vnNow.getUTCMinutes()
  );
}

function parseVietnamCampaignStart(value) {
  const raw = String(value || '').trim();
  if (!raw) return getDefaultVietnamCampaignStart();

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('Thoi gian bat dau khong hop le. Dung dang YYYY-MM-DDTHH:mm');
  }

  const [, year, month, day, hour, minute] = match.map(Number);
  const dateCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    dateCheck.getUTCFullYear() !== year ||
    dateCheck.getUTCMonth() + 1 !== month ||
    dateCheck.getUTCDate() !== day
  ) {
    throw new Error('Thoi gian bat dau khong hop le. Dung dang YYYY-MM-DDTHH:mm');
  }

  const scheduledStart = buildVietnamCampaignStart(year, month, day, hour, minute);
  if (new Date(scheduledStart.utc).getTime() < Date.now() - 60 * 1000) {
    throw new Error('Thoi gian bat dau phai la hien tai hoac tuong lai');
  }

  return scheduledStart;
}

function parseVietnamCampaignEnd(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('Thoi gian ket thuc khong hop le. Dung dang YYYY-MM-DDTHH:mm');
  }

  const [, year, month, day, hour, minute] = match.map(Number);
  const dateCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    dateCheck.getUTCFullYear() !== year ||
    dateCheck.getUTCMonth() + 1 !== month ||
    dateCheck.getUTCDate() !== day
  ) {
    throw new Error('Thoi gian ket thuc khong hop le. Dung dang YYYY-MM-DDTHH:mm');
  }

  return buildVietnamCampaignStart(year, month, day, hour, minute);
}

function campaignDateFromScheduledStart(scheduledStart) {
  const startUtc = new Date(scheduledStart?.utc || '');
  if (Number.isNaN(startUtc.getTime())) return todayStr();
  return new Date(startUtc.getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
}

function parseCampaignAgeRange(ageMinValue, ageMaxValue, defaultAgeMin = 22, defaultAgeMax = 45) {
  const ageMin = parseBoundedInt(ageMinValue, defaultAgeMin, 13, 65);
  const ageMax = parseBoundedInt(ageMaxValue, defaultAgeMax, 13, 65);
  if (ageMin > ageMax) {
    throw new Error('Tuoi tu phai nho hon hoac bang tuoi den');
  }
  return { ageMin, ageMax };
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

async function getAutoCheckIntervalSeconds(account) {
  const config = await getAccountAutoConfig(account);
  const isShopee = account.provider === 'shopee';
  const ruleStart = isShopee
    ? (config?.shopeeAutoRuleStartTime || config?.autoRuleStartTime || '00:00')
    : (config?.autoRuleStartTime || '00:00');
  const ruleEnd = isShopee
    ? (config?.shopeeAutoRuleEndTime || config?.autoRuleEndTime || '09:00')
    : (config?.autoRuleEndTime || '09:00');
  const minInterval = account.provider === 'shopee' ? 60 : AUTO_CHECK_MIN_INTERVAL_SECONDS;
  return isWithinAutoRuleTimeWindow(ruleStart, ruleEnd)
    ? Math.max(Number(account.checkInterval || minInterval), minInterval)
    : 300;
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

function getFacebookOAuthRedirectUri(req) {
  const host = req.get('host');
  if (host && host.includes('localhost')) {
    const protocol = req.protocol || 'http';
    return `${protocol}://${host}/api/facebook/oauth/callback`;
  }
  return 'https://xekoxukashop.id.vn/api/facebook/oauth/callback';
}

function getFacebookOAuthState(req) {
  const state = crypto.randomBytes(24).toString('hex');
  facebookOAuthStates.set(state, {
    createdAt: Date.now(),
    redirectUri: getFacebookOAuthRedirectUri(req),
    userId: req.currentUser?._id ? String(req.currentUser._id) : ''
  });

  if (facebookOAuthStates.size > 50) {
    const now = Date.now();
    for (const [key, value] of facebookOAuthStates.entries()) {
      if (now - value.createdAt > 10 * 60 * 1000) {
        facebookOAuthStates.delete(key);
      }
    }
  }

  return state;
}

function renderOAuthPopupResult(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Facebook Login</title></head>
  <body>
    <script>
      const payload = ${json};
      if (window.opener) {
        window.opener.postMessage({ type: 'adsctrl:facebook-oauth', payload }, '*');
      }
      window.close();
    </script>
    <p>Facebook login finished. You can close this window.</p>
  </body>
</html>`;
}

const FB_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const FB_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const FB_CAMPAIGN_CREATE_REQUEST_OPTIONS = { retries: 1, rateLimitRetries: 1 };
const FB_OAUTH_SCOPES = String(process.env.FB_OAUTH_SCOPES || [
  'public_profile',
  'ads_read',
  'ads_management',
  'business_management',
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement'
].join(',')).split(',').map(scope => scope.trim()).filter(Boolean);
const facebookOAuthStates = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientFbResponse(status, data) {
  const code = Number(data?.error?.code);
  const subcode = Number(data?.error?.error_subcode);
  return !status || FB_TRANSIENT_STATUSES.has(Number(status)) || FB_TRANSIENT_CODES.has(code) || subcode === 99 || isFbRateLimitResponse(data);
}

function isFbRateLimitResponse(data) {
  const apiError = data?.error || {};
  const code = Number(apiError.code);
  const subcode = Number(apiError.error_subcode);
  return [4, 17, 32, 613, 80004].includes(code) || subcode === 2446079;
}

function getFbRetryDelayMs(error, attempt) {
  if (error.rateLimited) {
    return Math.min(FB_RATE_LIMIT_BACKOFF_MS * Math.max(1, attempt + 1), 300000);
  }
  return 700 * Math.pow(2, attempt);
}

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

function isMessagingPurchaseOptimizationError(error) {
  const data = error.fbData || error.response?.data || {};
  const apiError = data.error || {};
  const blameSpecs = JSON.stringify(apiError.error_data || '').toLowerCase();

  return Number(apiError.code) === 100 &&
    Number(apiError.error_subcode) === 2490408 &&
    blameSpecs.includes('optimization_goal');
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
      lastError = buildFbRequestError('GET', error.response?.status, error.response?.data, error.message);
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
      lastError = buildFbRequestError('GET', error.response?.status, error.response?.data, error.message);
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
      lastError = buildFbRequestError('POST', error.response?.status, error.response?.data, error.message);
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

async function fetchAdAccountsWithSpend(token, adAccounts, options = {}) {
  const datePreset = String(options.datePreset || 'this_year').trim() || 'this_year';
  const batchSize = parseBoundedInt(options.batchSize, 50, 1, 50);
  const batchConcurrency = parseBoundedInt(options.concurrency, 3, 1, 5);
  const chunks = chunkArray(adAccounts, batchSize);
  const accountsWithSpend = [];
  const spendCheckErrors = [];

  const chunkResults = await mapWithConcurrency(chunks, async (chunk) => {
    const batch = chunk.map(adAccount => {
      const acctId = normalizeAdAccountId(adAccount.account_id || adAccount.id);
      const params = new URLSearchParams({
        fields: 'spend',
        date_preset: datePreset,
        level: 'account',
        limit: '1'
      });
      return {
        method: 'GET',
        relative_url: `${acctId}/insights?${params.toString()}`
      };
    });

    const response = await fbPost(token, '', { batch: JSON.stringify(batch) }, { retries: 2, rateLimitRetries: 2 });
    return { chunk, response };
  }, batchConcurrency);

  for (const result of chunkResults) {
    if (result?.error) {
      const message = result.error.message || String(result.error);
      spendCheckErrors.push({ error: message });
      continue;
    }

    const responses = Array.isArray(result.response) ? result.response : [];
    result.chunk.forEach((adAccount, index) => {
      const item = responses[index] || {};
      if (item.code < 200 || item.code >= 300) {
        spendCheckErrors.push({
          name: adAccount.name,
          accountId: adAccount.account_id,
          error: item.body || `HTTP ${item.code || 'ERR'}`
        });
        return;
      }

      try {
        const body = JSON.parse(item.body || '{}');
        const spend = Number(body.data?.[0]?.spend || 0);
        if (Number.isFinite(spend) && spend > 0) {
          accountsWithSpend.push({ ...adAccount, spend });
        }
      } catch (error) {
        spendCheckErrors.push({
          name: adAccount.name,
          accountId: adAccount.account_id,
          error: error.message
        });
      }
    });
  }

  return { accountsWithSpend, spendCheckErrors, datePreset };
}

function getCopiedObjectId(response = {}, objectType) {
  const keysByType = {
    campaign: ['copied_campaign_id', 'campaign_id'],
    adset: ['copied_adset_id', 'adset_id'],
    ad: ['copied_ad_id', 'ad_id']
  };

  for (const key of keysByType[objectType] || []) {
    if (response[key]) return String(response[key]);
  }

  const copiedObject = response[`copied_${objectType}`] || response[objectType];
  if (copiedObject?.id) return String(copiedObject.id);
  if (response.id) return String(response.id);
  return '';
}

function isStandardEnhancementsCreativeError(error) {
  const apiError = (error.fbData || error.response?.data || {}).error || {};
  return Number(apiError.code) === 100 && Number(apiError.error_subcode) === 3858504;
}

async function waitCampaignDuplicateQueue() {
  if (CAMPAIGN_DUPLICATE_QUEUE_DELAY_MS > 0) {
    await sleep(CAMPAIGN_DUPLICATE_QUEUE_DELAY_MS);
  }
}

async function createAdWithExistingCreative(fbToken, acctId, sourceAd, copiedAdSetId) {
  const creativeId = String(sourceAd.creative?.id || '').trim();
  if (!creativeId) {
    throw new Error(`Khong tim thay creative_id cua ad ${sourceAd.name || sourceAd.id}`);
  }

  return fbPost(fbToken, `${acctId}/ads`, {
    name: sourceAd.name || sourceAd.id,
    adset_id: copiedAdSetId,
    creative: { creative_id: creativeId },
    status: CAMPAIGN_DUPLICATE_COPY_STATUS
  }, { retries: 3 });
}

async function activateCopiedCampaignHierarchy(fbToken, copiedCampaignId, copiedAdSets = [], copiedAds = []) {
  try {
    await fbPost(fbToken, copiedCampaignId, { status: 'ACTIVE' }, { retries: 3 });
    await waitCampaignDuplicateQueue();

    for (const adSet of copiedAdSets) {
      await fbPost(fbToken, adSet.copiedAdSetId, { status: 'ACTIVE' }, { retries: 3 });
      await waitCampaignDuplicateQueue();
    }

    for (const ad of copiedAds) {
      await fbPost(fbToken, ad.copiedAdId, { status: 'ACTIVE' }, { retries: 3 });
      await waitCampaignDuplicateQueue();
    }
  } catch (error) {
    throw new Error(`Da copy xong nhung khong bat ACTIVE duoc: ${error.message}`);
  }
}

async function duplicateCampaignExactQueued(fbToken, campaign, copyOptions = {}) {
  const account = campaign.accountId || {};
  const acctId = normalizeAdAccountId(account.adAccountId || '');
  if (!acctId) {
    throw new Error('Khong xac dinh duoc tai khoan quang cao de tao ad moi');
  }

  const campaignName = campaign.name || campaign.campaignId;
  const campaignCopyResponse = await fbPost(fbToken, `${campaign.campaignId}/copies`, {
    deep_copy: '0',
    status_option: CAMPAIGN_DUPLICATE_COPY_STATUS,
    name: campaignName
  }, { retries: 3 });

  const copiedCampaignId = getCopiedObjectId(campaignCopyResponse, 'campaign');
  if (!copiedCampaignId) {
    throw new Error('Facebook khong tra ve ID campaign moi');
  }

  await waitCampaignDuplicateQueue();

  const { items: sourceAdSets } = await fetchAllFbEdge(fbToken, `${campaign.campaignId}/adsets`, {
    fields: 'id,name,status,optimization_goal',
    limit: 100
  });

  const copiedAdSets = [];
  const copiedAds = [];

  for (const sourceAdSet of sourceAdSets) {
    let adSetCopyResponse;
    let adSetCopyMode = 'copy';

    try {
      adSetCopyResponse = await fbPost(fbToken, `${sourceAdSet.id}/copies`, {
        deep_copy: '0',
        status_option: CAMPAIGN_DUPLICATE_COPY_STATUS,
        campaign_id: copiedCampaignId,
        name: sourceAdSet.name || undefined,
        ...copyOptions
      }, { retries: 3 });
    } catch (error) {
      if (!isMessagingPurchaseOptimizationError(error)) throw error;
      throw new Error(
        `Khong copy duoc adset "${sourceAdSet.name || sourceAdSet.id}" voi toi uu luot mua. ` +
        'Meta bao page/campaign chua du dieu kien dung MESSAGING_PURCHASE_CONVERSION. ' +
        'Can gui purchase events cho Meta va du dieu kien Purchases through Messaging roi moi copy duoc.'
      );
    }

    const copiedAdSetId = getCopiedObjectId(adSetCopyResponse, 'adset');
    if (!copiedAdSetId) {
      throw new Error(`Facebook khong tra ve ID adset moi cho ${sourceAdSet.name || sourceAdSet.id}`);
    }

    copiedAdSets.push({
      sourceAdSetId: sourceAdSet.id,
      copiedAdSetId,
      name: sourceAdSet.name || '',
      copyMode: adSetCopyMode,
      sourceOptimizationGoal: sourceAdSet.optimization_goal || '',
      copiedOptimizationGoal: sourceAdSet.optimization_goal || '',
      raw: adSetCopyResponse
    });

    await waitCampaignDuplicateQueue();

    const { items: sourceAds } = await fetchAllFbEdge(fbToken, `${sourceAdSet.id}/ads`, {
      fields: 'id,name,status,creative{id}',
      limit: 100
    });

    for (const sourceAd of sourceAds) {
      let adCopyResponse;
      let adCopyMode = 'copy';

      try {
        adCopyResponse = await fbPost(fbToken, `${sourceAd.id}/copies`, {
          status_option: CAMPAIGN_DUPLICATE_COPY_STATUS,
          adset_id: copiedAdSetId,
          name: sourceAd.name || undefined
        }, { retries: 3 });
      } catch (error) {
        if (!isStandardEnhancementsCreativeError(error)) throw error;
        adCopyResponse = await createAdWithExistingCreative(fbToken, acctId, sourceAd, copiedAdSetId);
        adCopyMode = 'reuse_creative';
      }

      const copiedAdId = getCopiedObjectId(adCopyResponse, 'ad');
      if (!copiedAdId) {
        throw new Error(`Facebook khong tra ve ID ad moi cho ${sourceAd.name || sourceAd.id}`);
      }

      copiedAds.push({
        sourceAdId: sourceAd.id,
        copiedAdId,
        sourceAdSetId: sourceAdSet.id,
        copiedAdSetId,
        name: sourceAd.name || '',
        copyMode: adCopyMode,
        raw: adCopyResponse
      });

      await waitCampaignDuplicateQueue();
    }
  }

  await activateCopiedCampaignHierarchy(fbToken, copiedCampaignId, copiedAdSets, copiedAds);

  const copiedCampaign = await fbGet(fbToken, copiedCampaignId, {
    fields: 'id,name,status'
  }, { retries: 3 }).catch(() => null);

  return {
    copiedCampaignId,
    copiedCampaignName: copiedCampaign?.name || campaignName,
    copiedCampaignStatus: copiedCampaign?.status || 'ACTIVE',
    copiedAdSets,
    copiedAds,
    raw: campaignCopyResponse
  };
}

function getPauseReason(provider, spend, messages, costPerMessage, clicks, costPerClick, limits, budgetType) {
  const normalizedProvider = normalizeProvider(provider);
  const isDaily = budgetType === 'DAILY';
  const limitZero = isDaily ? limits.dailyZeroMessageSpendLimit : limits.lifetimeZeroMessageSpendLimit;
  const limitHighCostPerMsg = isDaily ? limits.dailyHighCostPerMessageLimit : limits.lifetimeHighCostPerMessageLimit;
  const limitHighCostSpend = isDaily ? limits.dailyHighCostSpendLimit : limits.lifetimeHighCostSpendLimit;
  const limitClicks = isDaily ? limits.dailyClickLimit : limits.lifetimeClickLimit;
  const configuredLimitCpc = isDaily ? limits.dailyCpcLimit : limits.lifetimeCpcLimit;
  const limitCpc = normalizedProvider === 'shopee'
    ? Number(configuredLimitCpc || 600)
    : configuredLimitCpc;

  if (normalizedProvider === 'shopee') {
    if (limitCpc > 0 && costPerClick > limitCpc) {
      return `Chi phi moi click ${Math.round(costPerClick).toLocaleString()}d > ${limitCpc.toLocaleString()}d`;
    }
    return null;
  }

  if (normalizedProvider !== 'facebook') {
    return null;
  }

  if (limitClicks > 0 && clicks >= limitClicks) {
    return `Clicks tren lien ket >= ${limitClicks.toLocaleString()}`;
  }

  if (messages <= 1 && spend >= limitZero) {
    const messageText = messages <= 0 ? 'khong co tin nhan' : 'chi co 1 tin nhan';
    return `Campaign ${messageText} va da tieu tu ${limitZero.toLocaleString()}d`;
  }

  if (
    messages > 0 &&
    costPerMessage >= limitHighCostPerMsg &&
    spend >= limitHighCostSpend
  ) {
    return `Chi phi moi tin nhan tu ${limitHighCostPerMsg.toLocaleString()}d va da tieu tu ${limitHighCostSpend.toLocaleString()}d`;
  }

  return null;
}

function getCampaignSkuCandidates(campaignName) {
  const rawName = String(campaignName || '').toUpperCase().trim();
  const compactName = rawName.replace(/\s+/g, '');
  const firstNineChars = rawName.slice(0, 9).replace(/\s+/g, '');
  const firstToken = rawName.split(/\s+/)[0]?.replace(/\s+/g, '') || '';

  return [...new Set([firstNineChars, firstToken, compactName].filter(Boolean))]
    .map(code => `MS${code}`);
}

function getOrderCountForCampaignName(campaignName, skuCounts = {}) {
  for (const skuKey of getCampaignSkuCandidates(campaignName)) {
    const count = Number(skuCounts[skuKey] || 0);
    if (count > 0) return count;
  }
  return 0;
}

async function getTodayOrderSkuCountsForAuto(account) {
  if (normalizeProvider(account.provider) === 'shopee') return {};

  try {
    const today = todayStr();
    const orders = await getOrderSheetOrders({ fromDate: today, toDate: today, limit: 200000 });
    return buildOrderSkuStats(orders).counts || {};
  } catch (error) {
    await addLog(
      account._id,
      account.name,
      'warn',
      `Khong lay duoc don hang de tinh CPO auto: ${error.message}`
    );
    return {};
  }
}

function getAutoPauseDecision({ provider, campaignName, spend, messages, costPerMessage, clicks, costPerClick, limits, budgetType, skuCounts }) {
  const normalizedProvider = normalizeProvider(provider);
  const basePauseReason = getPauseReason(provider, spend, messages, costPerMessage, clicks, costPerClick, limits, budgetType);
  if (normalizedProvider !== 'facebook') {
    return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0 };
  }

  const cpoLimit = Number(limits?.autoPauseCpoLimit ?? AUTO_PAUSE_CPO_LIMIT);
  const orderCount = getOrderCountForCampaignName(campaignName, skuCounts);
  const costPerOrder = orderCount > 0 ? spend / orderCount : 0;
  if (cpoLimit > 0 && orderCount > 0 && costPerOrder > cpoLimit) {
    return {
      pauseReason: `CPO ${Math.round(costPerOrder).toLocaleString()}d > ${cpoLimit.toLocaleString()}d (${orderCount} don)`,
      orderCount,
      costPerOrder
    };
  }

  if (orderCount > 0) {
    return { pauseReason: null, orderCount, costPerOrder };
  }

  return { pauseReason: basePauseReason, orderCount, costPerOrder };
}

function getCampaignMessageStats(campaign) {
  const spend = parseFloat(campaign.insights?.data?.[0]?.spend || 0);
  const msgAction = getMetaMessageActionFromInsight(campaign.insights?.data?.[0] || {});
  const messages = parseInt(msgAction?.value || 0, 10);
  const costPerMessage = getMetaCostPerMessageFromInsight(campaign.insights?.data?.[0] || {});

  return { spend, messages, costPerMessage };
}

function getCampaignRuleStats(campaign) {
  const insight = campaign.insights?.data?.[0] || {};
  const spend = parseFloat(campaign.spend ?? insight.spend ?? 0);
  const messages = parseInt(campaign.messages ?? 0, 10);
  const clicks = parseInt(campaign.clicks ?? insight.clicks ?? 0, 10);
  const costPerMessage = Number(campaign.costPerMessage ?? insight.cost_per_message ?? 0);
  const costPerClick = clicks > 0 ? spend / clicks : 0;

  return { spend, messages, costPerMessage, clicks, costPerClick };
}

function normalizeCampaignDuplicateKey(campaign) {
  return String(campaign?.name || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

function hasScheduledCampaignStarted(campaign) {
  if (!campaign?.scheduledStartTimeUtc) return false;
  const startMs = new Date(campaign.scheduledStartTimeUtc).getTime();
  return Number.isFinite(startMs) && startMs <= Date.now();
}

function isAfterVietnamTime(hour = 21, minute = 0) {
  const now = new Date(Date.now() + VN_OFFSET_MS);
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const thresholdMinutes = hour * 60 + minute;
  return currentMinutes >= thresholdMinutes;
}

function parseHourMinute(value, fallback = '21:00') {
  const raw = String(value || fallback).trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return parseHourMinute(fallback, fallback);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function isLifetimeCampaign(campaign) {
  return String(campaign?.budgetType || '').toUpperCase() === 'LIFETIME'
    || Number(campaign?.lifetimeBudget || campaign?.lifetime_budget || 0) > 0;
}

function getCampaignCreatedTimeMs(campaign) {
  return new Date(campaign?.createdTime || campaign?.created_time || 0).getTime() || 0;
}

function compareCampaignPriority(a, b) {
  const lifetimeDiff = Number(isLifetimeCampaign(b)) - Number(isLifetimeCampaign(a));
  if (lifetimeDiff !== 0) return lifetimeDiff;

  const scheduledDiff = Number(Boolean(a?.isScheduled)) - Number(Boolean(b?.isScheduled));
  if (scheduledDiff !== 0) return scheduledDiff;

  return getCampaignCreatedTimeMs(a) - getCampaignCreatedTimeMs(b);
}

function buildScheduledPauseTargets(campaigns = [], options = {}) {
  const { hour, minute } = parseHourMinute(options.scheduledDuplicatePauseTime, '21:00');
  if (!isAfterVietnamTime(hour, minute)) return [];

  const groups = campaigns.reduce((map, campaign) => {
    const key = normalizeCampaignDuplicateKey(campaign);
    if (!key) return map;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(campaign);
    return map;
  }, new Map());

  const items = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const activeCampaigns = group.filter(campaign =>
      String(campaign.status || '').toUpperCase() === 'ACTIVE'
    );
    if (activeCampaigns.length <= 1) continue;

    const scheduledActive = activeCampaigns.filter(campaign =>
      campaign.isScheduled && hasScheduledCampaignStarted(campaign)
    );
    if (!scheduledActive.length) continue;

    const keeper = [...activeCampaigns].sort(compareCampaignPriority)[0];

    for (const campaign of scheduledActive) {
      if (String(campaign.campaignId || '') === String(keeper.campaignId || '')) continue;
      items.push({
        campaign,
        keeper,
        pauseReason: isLifetimeCampaign(keeper)
          ? `Camp len lich trung, uu tien giu camp tron doi ${keeper.name || keeper.campaignId}`
          : `Camp len lich trung voi camp dang chay ${keeper.name || keeper.campaignId}`
      });
    }
  }

  return items;
}

async function fetchCampaignMetaMap(fbToken, campaignIds = []) {
  const campaignMetaById = new Map();
  const normalizedIds = [...new Set((campaignIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  for (const chunk of chunkArray(normalizedIds, 50)) {
    const metaResponse = await fbGet(fbToken, '', {
      ids: chunk.join(','),
      fields: 'id,name,status,daily_budget,lifetime_budget,created_time'
    });
    for (const campaign of Object.values(metaResponse || {})) {
      if (!campaign?.id) continue;
      const isLifetime = !!campaign.lifetime_budget && parseFloat(campaign.lifetime_budget) > 0;
      const dailyBudget = parseFloat(campaign.daily_budget || 0);
      const lifetimeBudget = parseFloat(campaign.lifetime_budget || 0);
      campaignMetaById.set(String(campaign.id), {
        name: campaign.name,
        status: campaign.status,
        dailyBudget: isLifetime ? 0 : dailyBudget,
        lifetimeBudget: isLifetime ? lifetimeBudget : 0,
        budgetType: isLifetime ? 'LIFETIME' : 'DAILY',
        createdTime: campaign.created_time ? new Date(campaign.created_time) : undefined
      });
    }
  }
  return campaignMetaById;
}

async function fetchShopeeAccountData(account) {
  const today = todayStr();
  let campaigns = await Campaign.find({ accountId: account._id, date: today }).lean();
  const { fbToken } = await getEffectiveSecrets(account);
  if (fbToken) {
    const insights = await fetchAccountInsightsInRange(account, today, today);
    const metricInsights = [];
    const campaignIds = new Set();
    for (const insight of insights) {
      if (!insight.campaign_id) continue;
      const spend = parseFloat(insight.spend || 0);
      const impressions = parseInt(insight.impressions || 0, 10);
      const clicks = parseInt(insight.clicks || 0, 10);
      if (spend <= 0 && impressions <= 0 && clicks <= 0) continue;
      metricInsights.push({ ...insight, spend, impressions, clicks });
      campaignIds.add(String(insight.campaign_id));
    }

    const campaignMetaById = await fetchCampaignMetaMap(fbToken, [...campaignIds]);

    for (const insight of metricInsights) {
      const campaignId = String(insight.campaign_id);
      const meta = campaignMetaById.get(campaignId) || {};
      await upsertDailyCampaign(account._id, campaignId, today, {
        ...meta,
        name: insight.campaign_name,
        spend: insight.spend,
        impressions: insight.impressions,
        clicks: insight.clicks,
        messages: 0,
        costPerMessage: 0
      });
    }
    campaigns = await Campaign.find({ accountId: account._id, date: today }).lean();
  }

  const totalSpend = campaigns.reduce((sum, campaign) => sum + (campaign.spend || 0), 0);
  const totalMessages = campaigns.reduce((sum, campaign) => sum + (campaign.messages || 0), 0);
  const unreadMessages = 0;
  return { campaigns, totalSpend, totalMessages, unreadMessages };
}

async function fetchAccountData(account) {
  const today = todayStr();
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const existingCampaigns = await Campaign.find({ accountId: account._id, date: today }).lean();
  const todayInsights = await fetchAccountInsightsInRange(account, today, today);
  const seenCampaignIds = new Set();
  const metricInsights = [];

  for (const insight of todayInsights) {
    if (!insight.campaign_id) continue;
    const spend = parseFloat(insight.spend || 0);
    const impressions = parseInt(insight.impressions || 0, 10);
    const clicks = parseInt(insight.clicks || 0, 10);
    const msgAction = getMetaMessageActionFromInsight(insight);
    const messages = parseInt(msgAction?.value || 0, 10);
    const costPerMessage = getMetaCostPerMessageFromInsight(insight);
    const metaOrders = getMetaOrdersFromInsight(insight);
    if (spend <= 0 && impressions <= 0 && clicks <= 0 && messages <= 0) continue;
    metricInsights.push({ ...insight, spend, impressions, clicks, messages, costPerMessage, metaOrders });
    seenCampaignIds.add(String(insight.campaign_id));
  }

  const allCampaignIds = new Set([
    ...seenCampaignIds,
    ...existingCampaigns.map(campaign => String(campaign.campaignId || '').trim()).filter(Boolean)
  ]);
  const campaignMetaById = await fetchCampaignMetaMap(fbToken, [...allCampaignIds]);

  let insightTotalSpend = 0;
  let insightTotalMessages = 0;

  const campaigns = [];
  for (const insight of metricInsights) {
    const campaignId = String(insight.campaign_id);
    const actions = insight.actions || [];
    const { spend, impressions, clicks, messages, costPerMessage } = insight;
    insightTotalSpend += spend;
    insightTotalMessages += messages;
    const meta = campaignMetaById.get(campaignId) || {};
    const existingCampaign = existingCampaigns.find(campaign => String(campaign.campaignId || '').trim() === campaignId) || {};

    await upsertDailyCampaign(account._id, campaignId, today, {
      ...meta,
      name: insight.campaign_name,
      spend,
      impressions,
      clicks,
      messages,
      costPerMessage,
      metaOrders: insight.metaOrders || 0,
      isScheduled: Boolean(existingCampaign.isScheduled),
      scheduledStartTime: existingCampaign.scheduledStartTime || '',
      scheduledStartTimeUtc: existingCampaign.scheduledStartTimeUtc,
      scheduledStartTimeDisplay: existingCampaign.scheduledStartTimeDisplay || '',
      scheduledEndTime: existingCampaign.scheduledEndTime || '',
      scheduledEndTimeUtc: existingCampaign.scheduledEndTimeUtc,
      scheduledEndTimeDisplay: existingCampaign.scheduledEndTimeDisplay || ''
    });

    campaigns.push({
      id: campaignId,
      name: insight.campaign_name || meta.name,
      status: meta.status,
      daily_budget: meta.dailyBudget,
      lifetime_budget: meta.lifetimeBudget,
      created_time: meta.createdTime,
      spend,
      messages,
      clicks,
      impressions,
      isScheduled: Boolean(existingCampaign.isScheduled),
      scheduledStartTimeUtc: existingCampaign.scheduledStartTimeUtc,
      insights: {
        data: [{
          spend,
          impressions,
          clicks,
          actions
        }]
      }
    });
  }

  for (const storedCampaign of existingCampaigns) {
    const campaignId = String(storedCampaign.campaignId || '').trim();
    if (!campaignId || seenCampaignIds.has(campaignId)) continue;

    const meta = campaignMetaById.get(campaignId) || {};
    await upsertDailyCampaign(account._id, campaignId, today, {
      ...meta,
      spend: Number(storedCampaign.spend || 0),
      impressions: Number(storedCampaign.impressions || 0),
      clicks: Number(storedCampaign.clicks || 0),
      messages: Number(storedCampaign.messages || 0),
      costPerMessage: Number(storedCampaign.costPerMessage || 0),
      metaOrders: Number(storedCampaign.metaOrders || 0),
      isScheduled: Boolean(storedCampaign.isScheduled),
      scheduledStartTime: storedCampaign.scheduledStartTime || '',
      scheduledStartTimeUtc: storedCampaign.scheduledStartTimeUtc,
      scheduledStartTimeDisplay: storedCampaign.scheduledStartTimeDisplay || '',
      scheduledEndTime: storedCampaign.scheduledEndTime || '',
      scheduledEndTimeUtc: storedCampaign.scheduledEndTimeUtc,
      scheduledEndTimeDisplay: storedCampaign.scheduledEndTimeDisplay || ''
    });

    campaigns.push({
      id: campaignId,
      name: meta.name || storedCampaign.name,
      status: meta.status || storedCampaign.status,
      daily_budget: Number(meta.dailyBudget ?? storedCampaign.dailyBudget ?? 0),
      lifetime_budget: Number(meta.lifetimeBudget ?? storedCampaign.lifetimeBudget ?? 0),
      created_time: meta.createdTime || storedCampaign.createdTime,
      spend: Number(storedCampaign.spend || 0),
      messages: Number(storedCampaign.messages || 0),
      clicks: Number(storedCampaign.clicks || 0),
      impressions: Number(storedCampaign.impressions || 0),
      isScheduled: Boolean(storedCampaign.isScheduled),
      scheduledStartTimeUtc: storedCampaign.scheduledStartTimeUtc,
      insights: {
        data: [{
          spend: Number(storedCampaign.spend || 0),
          impressions: Number(storedCampaign.impressions || 0),
          clicks: Number(storedCampaign.clicks || 0),
          actions: []
        }]
      }
    });
  }

  const totalSpend = insightTotalSpend;

  return {
    campaigns,
    totalSpend,
    totalMessages: insightTotalMessages,
    unreadMessages: 0
  };
}

async function runAutoControl(account) {
  if (!isMongoReady()) return;

  try {
    const isShopee = account.provider === 'shopee';
    const { campaigns, totalSpend, totalMessages, unreadMessages } = isShopee
      ? await fetchShopeeAccountData(account)
      : await fetchAccountData(account);
    const { fbToken, claudeKey } = await getEffectiveSecrets(account);
    const today = todayStr();

    await Account.findByIdAndUpdate(account._id, {
      lastChecked: new Date(),
      status: 'connected'
    });

    await addLog(
      account._id,
      account.name,
      'info',
      `Kiem tra: chi tieu ${totalSpend.toLocaleString()}d · tin nhan camp: ${totalMessages} · inbox moi: ${unreadMessages}`
    );

    const config = await getAccountAutoConfig(account);
    const ruleStart = isShopee
      ? (config?.shopeeAutoRuleStartTime || config?.autoRuleStartTime || '00:00')
      : (config?.autoRuleStartTime || '00:00');
    const ruleEnd = isShopee
      ? (config?.shopeeAutoRuleEndTime || config?.autoRuleEndTime || '09:00')
      : (config?.autoRuleEndTime || '09:00');

    let campaignsToPause = [];
    if (isWithinAutoRuleTimeWindow(ruleStart, ruleEnd)) {
      const skuCounts = await getTodayOrderSkuCountsForAuto(account);
      campaignsToPause = campaigns
        .filter(campaign => campaign.status === 'ACTIVE')
        .map(campaign => {
          const { spend, messages, costPerMessage, clicks, costPerClick } = getCampaignRuleStats(campaign);
          const isLifetime = !!campaign.lifetimeBudget || !!campaign.lifetime_budget && parseFloat(campaign.lifetime_budget) > 0;
          const budgetType = isLifetime ? 'LIFETIME' : 'DAILY';
          const { pauseReason, orderCount, costPerOrder } = getAutoPauseDecision({
            provider: account.provider,
            campaignName: campaign.name,
            spend,
            messages,
            costPerMessage,
            clicks,
            costPerClick,
            limits: config,
            budgetType,
            skuCounts
          });
          return pauseReason ? { campaign, spend, messages, costPerMessage, clicks, costPerClick, orderCount, costPerOrder, pauseReason } : null;
        })
        .filter(Boolean);
    } else {
      await addLog(
        account._id,
        account.name,
        'info',
        `Ngoai khung gio auto-rule (${ruleStart}-${ruleEnd}), chi theo doi khong tat camp`
      );
    }

    const storedCampaigns = await Campaign.find({ accountId: account._id, date: today }).lean();
    const scheduledPauseTargets = buildScheduledPauseTargets(storedCampaigns, {
      scheduledDuplicatePauseTime: config?.scheduledDuplicatePauseTime
    });

    if (claudeKey) {
      try {
        const todayCampaigns = await Campaign.find({ accountId: account._id, date: today });
        const totalMsg = todayCampaigns.reduce((sum, campaign) => sum + campaign.messages, 0);
        const avgCPM = totalMsg > 0 ? totalSpend / totalMsg : 0;

        const response = await axios.post(
          'https://api.anthropic.com/v1/messages',
          {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: `Tai khoan "${account.name}": chi tieu ${totalSpend.toLocaleString()}d, tin nhan inbox: ${unreadMessages}, tong tin nhan camp: ${totalMsg}, CPM trung binh: ${avgCPM.toFixed(0)}d. Nen giu nguyen hay can luu y gi? 1 cau ngan gon.`
            }]
          },
          {
            headers: {
              'x-api-key': claudeKey,
              'anthropic-version': '2023-06-01'
            }
          }
        );

        const aiMsg = response.data.content?.[0]?.text || '';
        if (aiMsg) {
          await addLog(account._id, account.name, 'ai', `Claude: ${aiMsg}`);
        }
      } catch { }
    }

    if (campaignsToPause.length > 0) {
      for (const item of campaignsToPause) {
        const campaignGraphId = item.campaign.id || item.campaign.campaignId;
        if (isShopee) {
          await fbPost(fbToken, campaignGraphId, { status: 'PAUSED' });
          await Campaign.findOneAndUpdate(
            { accountId: account._id, campaignId: campaignGraphId, date: today },
            { $set: { status: 'PAUSED', updatedAt: new Date() } },
            { new: true }
          );
          clearCampaignReadCache();
          await addLog(
            account._id,
            account.name,
            'warn',
            `Shopee campaign cần tạm dừng: ${item.campaign.name} · ${item.pauseReason} · tieu ${item.spend.toLocaleString()}d`
          );
          continue;
        }

        try {
          await fbPost(fbToken, campaignGraphId, {
            status: 'PAUSED',
            budget_sharing_enabled: false,
            asset_based_budget_enabled: false
          });
        } catch (e) {
          // If budget fields fail, try simple status update
          if (e.message.includes('budget_sharing_enabled') || e.message.includes('asset_budget_sharing_enabled')) {
            await fbPost(fbToken, campaignGraphId, { status: 'PAUSED' });
          } else {
            throw e;
          }
        }
        await Campaign.findOneAndUpdate(
          { accountId: account._id, campaignId: campaignGraphId, date: today },
          { $set: { status: 'PAUSED', updatedAt: new Date() } },
          { new: true }
        );
        clearCampaignReadCache();
        await addLog(
          account._id,
          account.name,
          'warn',
          `Da tam dung: ${item.campaign.name} · ${item.pauseReason} · tieu ${item.spend.toLocaleString()}d · tin nhan ${item.messages} · don ${item.orderCount || 0}`
        );
      }

      await addLog(
        account._id,
        account.name,
        'warn',
        isShopee
          ? 'Shopee campaign cần tạm dừng theo rule mới'
          : `Tam dung ${campaignsToPause.length} chien dich theo rule moi`
      );
    }

    if (scheduledPauseTargets.length > 0) {
      for (const item of scheduledPauseTargets) {
        const campaignGraphId = item.campaign.id || item.campaign.campaignId;
        if (!campaignGraphId) continue;

        await fbPost(fbToken, campaignGraphId, { status: 'PAUSED' });
        await Campaign.findOneAndUpdate(
          { accountId: account._id, campaignId: campaignGraphId, date: today },
          { $set: { status: 'PAUSED', updatedAt: new Date() } },
          { new: true }
        );
        clearCampaignReadCache();
        await addLog(
          account._id,
          account.name,
          'warn',
          `Auto tat camp len lich ${item.campaign.name || campaignGraphId}: ${item.pauseReason}`
        );
      }
    }
  } catch (error) {
    if (!isMongoReady()) return;

    if (error.transient) {
      if (error.rateLimited) {
        markAccountRateLimited(account._id);
        await Account.findByIdAndUpdate(account._id, {
          lastChecked: new Date(),
          status: 'connected'
        });
      }
      await addLog(account._id, account.name, 'warn', `Bo qua auto tam thoi: ${error.message}`);
      return;
    }

    await Account.findByIdAndUpdate(account._id, { status: 'error' });
    await addLog(account._id, account.name, 'error', `Loi: ${error.message}`);
  }
}

const accountTimers = {};
const accountRuns = {};
const accountSchedulerActive = {};
let facebookTokenCronTask = null;
let finalSpendCronTask = null;
let todayCampaignSpendSyncTimer = null;
let todayCampaignSpendSyncRunning = false;
let backgroundOrderSyncRunning = false;
let isShuttingDown = false;
let sheetRefreshTimer = null;
let campaignDuplicateQueue = null;
let campaignDuplicateWorker = null;
let campaignSyncQueue = null;
let campaignSyncWorker = null;
let orderSheetSyncQueue = null;
let orderSheetSyncWorker = null;
let redisQueueAvailable = false;
const redisConnections = [];

function createRedisConnection() {
  const connection = REDIS_URL
    ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
    : new IORedis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: null
    });

  redisConnections.push(connection);
  return connection;
}

async function checkRedisAvailable() {
  if (!REDIS_QUEUE_ENABLED) return false;

  const connection = REDIS_URL
    ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true })
    : new IORedis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      lazyConnect: true
    });

  connection.on('error', () => {});

  try {
    await connection.connect();
    await connection.ping();
    return true;
  } catch (error) {
    console.warn(`Redis/BullMQ disabled: cannot connect to ${REDIS_URL || `${REDIS_HOST}:${REDIS_PORT}`} (${error.message})`);
    return false;
  } finally {
    await connection.quit().catch(() => connection.disconnect());
  }
}

function initCampaignDuplicateQueue() {
  if (!REDIS_QUEUE_ENABLED || !redisQueueAvailable || campaignDuplicateQueue) return campaignDuplicateQueue;

  campaignDuplicateQueue = new Queue(CAMPAIGN_DUPLICATE_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: CAMPAIGN_DUPLICATE_JOB_ATTEMPTS,
      backoff: { type: 'fixed', delay: CAMPAIGN_DUPLICATE_JOB_BACKOFF_MS },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 1000 }
    }
  });

  campaignDuplicateQueue.on('error', error => {
    console.error(`Campaign duplicate queue error: ${error.message}`);
  });

  console.log(`Campaign duplicate queue enabled: ${CAMPAIGN_DUPLICATE_QUEUE_NAME}`);
  return campaignDuplicateQueue;
}

function startCampaignDuplicateWorker() {
  if (!campaignDuplicateQueue || campaignDuplicateWorker) return campaignDuplicateWorker;

  campaignDuplicateWorker = new Worker(
    CAMPAIGN_DUPLICATE_QUEUE_NAME,
    async job => processCampaignDuplicateExactRequest(job.data, async progress => {
      await job.updateProgress(progress);
    }),
    {
      connection: createRedisConnection(),
      concurrency: CAMPAIGN_DUPLICATE_QUEUE_CONCURRENCY
    }
  );

  campaignDuplicateWorker.on('completed', job => {
    console.log(`Campaign duplicate job completed: ${job.id}`);
  });
  campaignDuplicateWorker.on('failed', (job, error) => {
    console.error(`Campaign duplicate job failed ${job?.id || ''}: ${error.message}`);
  });
  campaignDuplicateWorker.on('error', error => {
    console.error(`Campaign duplicate worker error: ${error.message}`);
  });

  return campaignDuplicateWorker;
}

function initCampaignSyncQueue() {
  if (!REDIS_QUEUE_ENABLED || !redisQueueAvailable || campaignSyncQueue) return campaignSyncQueue;

  campaignSyncQueue = new Queue(CAMPAIGN_SYNC_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: CAMPAIGN_SYNC_JOB_ATTEMPTS,
      backoff: { type: 'fixed', delay: CAMPAIGN_SYNC_JOB_BACKOFF_MS },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 1000 }
    }
  });

  campaignSyncQueue.on('error', error => {
    console.error(`Campaign sync queue error: ${error.message}`);
  });

  console.log(`Campaign sync queue enabled: ${CAMPAIGN_SYNC_QUEUE_NAME}`);
  return campaignSyncQueue;
}

function startCampaignSyncWorker() {
  if (!campaignSyncQueue || campaignSyncWorker) return campaignSyncWorker;

  campaignSyncWorker = new Worker(
    CAMPAIGN_SYNC_QUEUE_NAME,
    async job => processCampaignSyncHistoryJob(job.data, async progress => {
      await job.updateProgress(progress);
    }),
    {
      connection: createRedisConnection(),
      concurrency: CAMPAIGN_SYNC_QUEUE_CONCURRENCY
    }
  );

  campaignSyncWorker.on('completed', job => {
    console.log(`Campaign sync job completed: ${job.id}`);
  });
  campaignSyncWorker.on('failed', (job, error) => {
    console.error(`Campaign sync job failed ${job?.id || ''}: ${error.message}`);
  });
  campaignSyncWorker.on('error', error => {
    console.error(`Campaign sync worker error: ${error.message}`);
  });

  return campaignSyncWorker;
}

async function processOrderSheetSyncJob(data = {}, onProgress = null) {
  const { fromDate, toDate } = data;
  if (onProgress) {
    await onProgress({
      state: 'active',
      fromDate,
      toDate,
      percent: 10,
      message: 'Dang tai Google Sheet'
    });
  }

  const rows = await fetchOrderSheetRows({ refresh: true });
  const filteredRows = rows.filter(row => {
    if (fromDate && row.dateKey < fromDate) return false;
    if (toDate && row.dateKey > toDate) return false;
    return true;
  });

  const result = {
    state: 'completed',
    source: 'google_sheet',
    fromDate,
    toDate,
    totalRows: rows.length,
    synced: filteredRows.length,
    percent: 100,
    cachedAt: new Date().toISOString(),
    message: 'Da tai xong Google Sheet'
  };

  if (onProgress) await onProgress(result);
  return result;
}

function initOrderSheetSyncQueue() {
  if (!REDIS_QUEUE_ENABLED || !redisQueueAvailable || orderSheetSyncQueue) return orderSheetSyncQueue;

  orderSheetSyncQueue = new Queue(ORDER_SHEET_SYNC_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: ORDER_SHEET_SYNC_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: ORDER_SHEET_SYNC_JOB_BACKOFF_MS },
      removeOnComplete: { age: 24 * 60 * 60, count: 100 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 100 }
    }
  });

  orderSheetSyncQueue.on('error', error => {
    console.error(`Order sheet sync queue error: ${error.message}`);
  });

  console.log(`Order sheet sync queue enabled: ${ORDER_SHEET_SYNC_QUEUE_NAME}`);
  return orderSheetSyncQueue;
}

function startOrderSheetSyncWorker() {
  if (!orderSheetSyncQueue || orderSheetSyncWorker) return orderSheetSyncWorker;

  orderSheetSyncWorker = new Worker(
    ORDER_SHEET_SYNC_QUEUE_NAME,
    async job => processOrderSheetSyncJob(job.data, async progress => {
      await job.updateProgress(progress);
    }),
    { connection: createRedisConnection(), concurrency: ORDER_SHEET_SYNC_QUEUE_CONCURRENCY }
  );

  orderSheetSyncWorker.on('completed', job => {
    console.log(`Order sheet sync job completed: ${job.id}`);
  });
  orderSheetSyncWorker.on('failed', (job, error) => {
    console.error(`Order sheet sync job failed: ${job?.id || 'unknown'} - ${error.message}`);
  });
  orderSheetSyncWorker.on('error', error => {
    console.error(`Order sheet sync worker error: ${error.message}`);
  });

  return orderSheetSyncWorker;
}

function isMongoReady() {
  return !isShuttingDown && mongoose.connection.readyState === 1;
}

async function runAutoControlSafely(account, source = 'auto') {
  const accountId = String(account._id);
  if (!isMongoReady()) return;
  if (accountRuns[accountId]) return;
  if (getAccountRateLimitDelayMs(accountId) > 0) return;

  accountRuns[accountId] = true;
  try {
    await runAutoControl(account);
  } catch (error) {
    if (!isShuttingDown) {
      console.error(`${source} auto run failed for ${account.name}: ${error.message}`);
    }
  } finally {
    delete accountRuns[accountId];
  }
}

async function startAccountScheduler(account) {
  const accountId = String(account._id);
  if (accountTimers[accountId]) clearTimeout(accountTimers[accountId]);
  accountSchedulerActive[accountId] = true;

  const scheduleNext = async () => {
    if (!isMongoReady() || !accountSchedulerActive[accountId]) return;
    let intervalSeconds = 300;
    try {
      intervalSeconds = await getAutoCheckIntervalSeconds(account);
    } catch (error) {
      if (!isShuttingDown) {
        console.error(`Auto scheduler interval failed for ${account.name}: ${error.message}`);
      }
    }
    accountTimers[accountId] = setTimeout(async () => {
      if (!accountSchedulerActive[accountId]) return;
      await runAutoControlSafely(account, 'Scheduled');
      scheduleNext();
    }, intervalSeconds * 1000);
  };

  runAutoControlSafely(account, 'Initial');
  scheduleNext();
}

async function syncTodayCampaignSpendForAccount(account) {
  const accountId = String(account._id);
  if (!isMongoReady() || accountRuns[accountId]) return { skipped: true };
  if (getAccountRateLimitDelayMs(accountId) > 0) return { skipped: true, rateLimitedCooldown: true };

  accountRuns[accountId] = true;
  try {
    if (account.provider === 'shopee') {
      await fetchShopeeAccountData(account);
    } else {
      await fetchAccountData(account);
    }
    await Account.findByIdAndUpdate(account._id, {
      lastChecked: new Date(),
      status: 'connected'
    });
    return { ok: true };
  } catch (error) {
    if (!isMongoReady()) return { skipped: true, error: error.message };

    if (error.transient) {
      if (error.rateLimited) {
        markAccountRateLimited(account._id);
        await Account.findByIdAndUpdate(account._id, {
          lastChecked: new Date(),
          status: 'connected'
        });
      }
      await addLog(account._id, account.name, 'warn', `Bo qua dong bo chi tieu hom nay tam thoi: ${error.message}`);
      return { skipped: true, transient: true, error: error.message };
    }

    await Account.findByIdAndUpdate(account._id, { status: 'error' });
    await addLog(account._id, account.name, 'error', `Loi dong bo chi tieu hom nay: ${error.message}`);
    return { ok: false, error: error.message };
  } finally {
    delete accountRuns[accountId];
  }
}

async function syncTodayCampaignSpendAllAccounts(source = 'timer') {
  if (!isMongoReady() || todayCampaignSpendSyncRunning) return;

  todayCampaignSpendSyncRunning = true;
  try {
    const accounts = await Account.find({
      $or: [
        buildAccountProviderFilter('facebook'),
        buildAccountProviderFilter('shopee')
      ]
    });
    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const account of accounts) {
      if (isShuttingDown) break;
      const result = await syncTodayCampaignSpendForAccount(account);
      if (result?.ok) synced += 1;
      else if (result?.skipped) skipped += 1;
      else failed += 1;
    }

    console.log(`Today campaign spend sync (${source}): synced=${synced}, skipped=${skipped}, failed=${failed}`);
  } catch (error) {
    if (!isShuttingDown) {
      console.error(`Today campaign spend sync failed: ${error.message}`);
    }
  } finally {
    todayCampaignSpendSyncRunning = false;
  }
}

function startTodayCampaignSpendSync() {
  if (todayCampaignSpendSyncTimer) clearInterval(todayCampaignSpendSyncTimer);
  console.log(`Today campaign spend sync scheduled every ${Math.round(TODAY_CAMPAIGN_SYNC_INTERVAL_MS / 1000)}s`);
  setTimeout(() => syncTodayCampaignSpendAllAccounts('startup'), Math.min(TODAY_CAMPAIGN_SYNC_INTERVAL_MS, 5 * 60 * 1000));
  todayCampaignSpendSyncTimer = setInterval(() => {
    syncTodayCampaignSpendAllAccounts('timer');
  }, TODAY_CAMPAIGN_SYNC_INTERVAL_MS);
}

function stopAccountScheduler(accountId) {
  accountSchedulerActive[accountId] = false;
  if (accountTimers[accountId]) {
    clearTimeout(accountTimers[accountId]);
    delete accountTimers[accountId];
  }
}

app.get('/api/clean-tokens', async (req, res) => {
  try {
    const result = await Account.updateMany({}, { $set: { fbToken: '' } });
    res.json({ success: true, message: 'Cleared old tokens', result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use('/api', authenticateApiRequest);

app.post('/api/auth/login', async (req, res) => {
  try {
    await ensureDefaultUsers();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const requestedProvider = normalizeProvider(req.body.provider);
    const defaultUser = DEFAULT_LOGIN_USERS.find(item => item.username === username);
    let user = await User.findOne({ username });
    if ((!user || !user.active) && defaultUser && password === defaultUser.password) {
      user = await User.findOneAndUpdate(
        { username },
        {
          $set: {
            username,
            displayName: defaultUser.displayName || username,
            passwordHash: hashPassword(defaultUser.password),
            provider: defaultUser.provider || 'facebook',
            active: true,
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true, new: true }
      );
    }
    let passwordOk = user ? verifyPassword(password, user.passwordHash) : false;
    if (user && !passwordOk && defaultUser && password === defaultUser.password) {
      user.passwordHash = hashPassword(defaultUser.password);
      user.provider = defaultUser.provider || user.provider || 'facebook';
      user.active = true;
      user.updatedAt = new Date();
      await user.save();
      passwordOk = true;
    }
    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Sai tai khoan hoac mat khau' });
    }

    if (requestedProvider && user.provider !== requestedProvider) {
      return res.status(403).json({ error: 'Tai khoan nay khong thuoc nen tang da chon' });
    }

    const token = createAuthToken(user);
    res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName || user.username,
        provider: user.provider
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticateApiRequest, async (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.currentUser._id,
      username: req.currentUser.username,
      displayName: req.currentUser.displayName || req.currentUser.username,
      provider: req.currentUser.provider
    }
  });
});

app.get('/api/google/oauth/start', async (req, res) => {
  try {
    const { clientId, redirectUri } = requireGoogleOAuthConfig(req);
    const state = createSignedState('google-oauth', { userId: String(req.currentUser._id) });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    });

    res.json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/google/oauth/callback', async (req, res) => {
  const htmlEscape = (value) => String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

  try {
    const { code, state, error } = req.query;
    if (error) throw new Error(String(error));
    if (!code) throw new Error('Google khong tra ve code');

    const stateData = parseSignedState('google-oauth', state);
    if (!stateData?.userId || !mongoose.Types.ObjectId.isValid(stateData.userId)) {
      throw new Error('Google OAuth state khong hop le hoac da het han');
    }

    const { clientId, clientSecret, redirectUri } = requireGoogleOAuthConfig(req);
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code: String(code),
      grant_type: 'authorization_code'
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = tokenResponse.data || {};
    if (!tokenData.access_token) throw new Error('Google khong tra ve access token');

    let profile = {};
    try {
      const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      profile = profileResponse.data || {};
    } catch (profileError) {
      console.warn(`Google profile fetch failed: ${profileError.message}`);
    }

    const update = {
      googleAccessToken: tokenData.access_token,
      googleTokenExpiresAt: new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000),
      googleEmail: profile.email || '',
      googleName: profile.name || '',
      googleTokenScope: tokenData.scope || '',
      updatedAt: new Date()
    };
    if (tokenData.refresh_token) update.googleRefreshToken = tokenData.refresh_token;

    await User.findByIdAndUpdate(stateData.userId, update);

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Google connected</title></head>
<body><script>window.location.href='/google-sheets?google=connected';</script></body></html>`);
  } catch (callbackError) {
    res.type('html').status(400).send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Google error</title></head>
<body>
  <p>Google login error: ${htmlEscape(callbackError.message)}</p>
  <script>
    setTimeout(function () {
      window.location.href='/google-sheets?google=error&message=' + encodeURIComponent(${JSON.stringify(callbackError.message)});
    }, 1200);
  </script>
</body></html>`);
  }
});

app.get('/api/google/status', async (req, res) => {
  try {
    const user = await User.findById(req.currentUser._id)
      .select('googleAccessToken googleRefreshToken googleTokenExpiresAt googleEmail googleName')
      .lean();

    res.json({
      ok: true,
      connected: Boolean(user?.googleAccessToken || user?.googleRefreshToken),
      email: user?.googleEmail || '',
      name: user?.googleName || '',
      expiresAt: user?.googleTokenExpiresAt || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/google/sheets', async (req, res) => {
  try {
    const accessToken = await getGoogleAccessToken(req);
    const pageSize = parseBoundedInt(req.query.pageSize, 100, 1, 1000);
    const search = String(req.query.search || '').trim();
    const qParts = [
      "mimeType='application/vnd.google-apps.spreadsheet'",
      'trashed=false'
    ];
    if (search) {
      qParts.push(`name contains '${search.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
    }

    const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: qParts.join(' and '),
        pageSize,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      }
    });

    res.json({ ok: true, files: response.data?.files || [] });
  } catch (error) {
    const status = error.response?.status || 500;
    const detail = error.response?.data?.error?.message || error.message;
    res.status(status === 401 ? 401 : 500).json({ error: detail });
  }
});

app.get('/api/accounts', async (req, res) => {
  try {
    const { provider } = req.query;
    const filter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const accounts = await Account.find(filter).select('-fbToken -claudeKey').sort('-createdAt').lean();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { provider, date, fromDate, toDate } = req.query;
    const filter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const fDate = fromDate || date || todayStr();
    const tDate = toDate || date || fDate;
    const cacheKey = userScopedCacheKey(req, `stats:${provider || 'all'}:${fDate}:${tDate}`);
    const cached = getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const [totalAccounts, connectedAccounts, accountList] = await Promise.all([
      Account.countDocuments(filter),
      Account.countDocuments({ ...filter, status: 'connected' }),
      Account.find(filter).select('_id').lean()
    ]);

    // Lọc campaign theo tài khoản thuộc provider
    let campaignQuery = { date: { $gte: fDate, $lte: tDate } };
    campaignQuery.accountId = { $in: accountList.map(account => account._id) };

    const [campaignTotals = {}] = await Campaign.aggregate([
      { $match: campaignQuery },
      {
        $group: {
          _id: null,
          activeCount: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$spend', 0] }, { $eq: [{ $toUpper: '$status' }, 'ACTIVE'] }] },
                1,
                0
              ]
            }
          },
          pausedCount: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$spend', 0] }, { $eq: [{ $toUpper: '$status' }, 'PAUSED'] }] },
                1,
                0
              ]
            }
          },
          totalSpend: { $sum: '$spend' },
          totalMessages: { $sum: '$messages' },
          totalClicks: { $sum: '$clicks' }
        }
      },
      {
        $project: {
          _id: 0,
          activeCount: 1,
          pausedCount: 1,
          totalSpend: 1,
          totalMessages: 1,
          totalClicks: 1,
          avgCPM: {
            $cond: [{ $gt: ['$totalMessages', 0] }, { $divide: ['$totalSpend', '$totalMessages'] }, 0]
          }
        }
      }
    ]).allowDiskUse(true);

    let totalOrders = 0;
    let ordersError = '';
    try {
      if (useSheetOrders()) {
        const todayRows = await getOrderSheetOrders({ fromDate: fDate, toDate: tDate, limit: 5000 });
        // Chỉ đếm dòng có ID2 (orderId) không trống
        totalOrders = todayRows.filter(o => o.orderId && String(o.orderId).trim() !== '').length;
      } else {
        totalOrders = await Order.countDocuments(buildOrderQuery({ fromDate: fDate, toDate: tDate }));
      }
    } catch (error) {
      ordersError = error.message;
    }

    res.json(setReadCache(cacheKey, {
      totalAccounts,
      connectedAccounts,
      activeCount: campaignTotals.activeCount || 0,
      pausedCount: campaignTotals.pausedCount || 0,
      totalSpend: campaignTotals.totalSpend || 0,
      totalMessages: campaignTotals.totalMessages || 0,
      totalClicks: campaignTotals.totalClicks || 0,
      avgCPM: campaignTotals.avgCPM || 0,
      totalOrders,
      ordersError,
      fromDate: fDate,
      toDate: tDate
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config', async (req, res) => {
  try {
    const config = await getAppConfig();
    const user = await User.findById(req.currentUser._id).select(
      'fbToken fbTokenExpiresAt fbTokenLastRefreshTime fbTokenLastDebugTime fbTokenLastRefreshError ' +
      'autoRuleStartTime autoRuleEndTime shopeeAutoRuleStartTime shopeeAutoRuleEndTime scheduledDuplicatePauseTime ' +
      'dailyZeroMessageSpendLimit dailyHighCostPerMessageLimit dailyHighCostSpendLimit ' +
      'dailyClickLimit dailyCpcLimit lifetimeZeroMessageSpendLimit lifetimeHighCostPerMessageLimit ' +
      'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit'
    ).lean();
    const autoConfig = mergeAutoConfig(config || {}, user || {});
    res.json({
      hasFbToken: Boolean(user?.fbToken || config?.fbToken),
      fbTokenExpiresAt: user?.fbTokenExpiresAt || config?.fbTokenExpiresAt || null,
      fbTokenLastRefreshTime: user?.fbTokenLastRefreshTime || config?.fbTokenLastRefreshTime || null,
      fbTokenLastDebugTime: user?.fbTokenLastDebugTime || config?.fbTokenLastDebugTime || null,
      fbTokenLastRefreshError: user?.fbTokenLastRefreshError || config?.fbTokenLastRefreshError || '',
      hasClaudeKey: Boolean(config?.claudeKey),
      hasFbAppId: Boolean(config?.fbAppId),
      hasFbAppSecret: Boolean(config?.fbAppSecret),
      hasPancakeApiKey: Boolean(config?.pancakeApiKey),
      hasPancakeShopId: Boolean(config?.pancakeShopId),
      pancakeShopId: config?.pancakeShopId || '',
      autoRuleStartTime: autoConfig.autoRuleStartTime,
      autoRuleEndTime: autoConfig.autoRuleEndTime,
      shopeeAutoRuleStartTime: autoConfig.shopeeAutoRuleStartTime,
      shopeeAutoRuleEndTime: autoConfig.shopeeAutoRuleEndTime,
      scheduledDuplicatePauseTime: autoConfig.scheduledDuplicatePauseTime,

      dailyZeroMessageSpendLimit: autoConfig.dailyZeroMessageSpendLimit,
      dailyHighCostPerMessageLimit: autoConfig.dailyHighCostPerMessageLimit,
      dailyHighCostSpendLimit: autoConfig.dailyHighCostSpendLimit,
      dailyClickLimit: autoConfig.dailyClickLimit,
      dailyCpcLimit: autoConfig.dailyCpcLimit,

      lifetimeZeroMessageSpendLimit: autoConfig.lifetimeZeroMessageSpendLimit,
      lifetimeHighCostPerMessageLimit: autoConfig.lifetimeHighCostPerMessageLimit,
      lifetimeHighCostSpendLimit: autoConfig.lifetimeHighCostSpendLimit,
      lifetimeClickLimit: autoConfig.lifetimeClickLimit,
      lifetimeCpcLimit: autoConfig.lifetimeCpcLimit,
      autoPauseCpoLimit: autoConfig.autoPauseCpoLimit
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(['/token', '/api/token'], async (req, res) => {
  try {
    const tokenState = await configureFacebookToken({
      app_id: req.body.app_id,
      app_secret: req.body.app_secret,
      long_lived_user_access_token: req.body.long_lived_user_access_token
    });

    res.status(201).json({
      ok: true,
      token: tokenState.token,
      expires_at: tokenState.expires_at,
      last_refresh_time: tokenState.last_refresh_time,
      last_debug_time: tokenState.last_debug_time
    });
  } catch (error) {
    await sendTokenAlert('Facebook token configure failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get(['/token', '/api/token'], async (req, res) => {
  try {
    const [tokenState, config] = await Promise.all([
      FacebookToken.findOne({ key: FACEBOOK_TOKEN_KEY }),
      getAppConfig()
    ]);

    const token = tokenState?.token || config?.fbToken || '';
    if (!token) return res.status(404).json({ error: 'No Facebook token configured' });

    res.json({
      token,
      expires_at: tokenState?.expires_at || config?.fbTokenExpiresAt || null,
      last_refresh_time: tokenState?.last_refresh_time || config?.fbTokenLastRefreshTime || null,
      last_debug_time: tokenState?.last_debug_time || config?.fbTokenLastDebugTime || null,
      last_error: tokenState?.last_error || config?.fbTokenLastRefreshError || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(['/token/refresh', '/api/token/refresh'], async (req, res) => {
  try {
    const result = await checkAndRefreshFacebookToken({ force: Boolean(req.body.force), source: 'api' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/facebook/oauth/start', async (req, res) => {
  try {
    const config = await getAppConfig();
    const appId = String(config?.fbAppId || process.env.FB_APP_ID || '').trim();
    const appSecret = String(config?.fbAppSecret || process.env.FB_APP_SECRET || '').trim();
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'Chua cau hinh Facebook App ID va App Secret' });
    }

    const state = getFacebookOAuthState(req);
    const redirectUri = getFacebookOAuthRedirectUri(req);
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: FB_OAUTH_SCOPES.join(','),
      auth_type: 'rerequest'
    });

    res.json({
      ok: true,
      authUrl: `https://www.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`,
      redirectUri,
      scopes: FB_OAUTH_SCOPES
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/facebook/oauth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      return res.status(400).send(renderOAuthPopupResult({
        ok: false,
        error: String(error_description || error)
      }));
    }

    const stateRecord = facebookOAuthStates.get(String(state || ''));
    facebookOAuthStates.delete(String(state || ''));
    if (!code || !stateRecord || Date.now() - stateRecord.createdAt > 10 * 60 * 1000) {
      return res.status(400).send(renderOAuthPopupResult({
        ok: false,
        error: 'Phien dang nhap Facebook khong hop le hoac da het han'
      }));
    }

    const config = await getAppConfig();
    const appId = String(config?.fbAppId || process.env.FB_APP_ID || '').trim();
    const appSecret = String(config?.fbAppSecret || process.env.FB_APP_SECRET || '').trim();
    if (!appId || !appSecret) {
      throw new Error('Chua cau hinh Facebook App ID va App Secret');
    }

    const tokenResponse = await axios.get(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: stateRecord.redirectUri,
        code
      },
      timeout: 15000
    });
    const shortToken = tokenResponse.data?.access_token;
    if (!shortToken) throw new Error('Facebook khong tra ve access_token');

    const longLivedToken = await exchangeToken(shortToken, appId, appSecret);
    const tokenState = stateRecord.userId
      ? await User.findByIdAndUpdate(stateRecord.userId, {
          fbToken: longLivedToken,
          fbTokenLastRefreshTime: new Date(),
          fbTokenLastRefreshError: '',
          updatedAt: new Date()
        }, { new: true }).lean().then(user => ({
          expires_at: user?.fbTokenExpiresAt || null
        }))
      : await configureFacebookToken({
          app_id: appId,
          app_secret: appSecret,
          long_lived_user_access_token: longLivedToken
        });
    clearAllReadCache();

    res.send(renderOAuthPopupResult({
      ok: true,
      expires_at: tokenState.expires_at,
      scopes: FB_OAUTH_SCOPES
    }));
  } catch (callbackError) {
    await sendTokenAlert('Facebook OAuth login failed', { error: callbackError.message });
    res.status(400).send(renderOAuthPopupResult({
      ok: false,
      error: callbackError.message
    }));
  }
});

app.put('/api/auto-limits', async (req, res) => {
  try {
    const limits = {
      dailyZeroMessageSpendLimit: Number(req.body.dailyZeroMessageSpendLimit),
      dailyHighCostPerMessageLimit: Number(req.body.dailyHighCostPerMessageLimit),
      dailyHighCostSpendLimit: Number(req.body.dailyHighCostSpendLimit),
      dailyClickLimit: Number(req.body.dailyClickLimit || 0),
      dailyCpcLimit: Number(req.body.dailyCpcLimit || 0),
      lifetimeZeroMessageSpendLimit: Number(req.body.lifetimeZeroMessageSpendLimit),
      lifetimeHighCostPerMessageLimit: Number(req.body.lifetimeHighCostPerMessageLimit),
      lifetimeHighCostSpendLimit: Number(req.body.lifetimeHighCostSpendLimit),
      lifetimeClickLimit: Number(req.body.lifetimeClickLimit || 0),
      lifetimeCpcLimit: Number(req.body.lifetimeCpcLimit || 0),
      autoPauseCpoLimit: Number(req.body.autoPauseCpoLimit ?? AUTO_PAUSE_CPO_LIMIT),
      updatedAt: new Date()
    };

    await User.findByIdAndUpdate(
      req.currentUser._id,
      { $set: limits },
      { new: true }
    );
    res.json({ ok: true, limits });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/auto-rules', async (req, res) => {
  try {
    const { startTime, endTime } = req.body;
    const provider = normalizeProvider(req.body.provider);
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Thieu startTime hoac endTime' });
    }
    // Validate HH:MM format
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ error: 'Dinh dang thoi gian khong hop le (HH:MM)' });
    }
    const timeUpdates = provider === 'shopee'
      ? { shopeeAutoRuleStartTime: startTime, shopeeAutoRuleEndTime: endTime, updatedAt: new Date() }
      : { autoRuleStartTime: startTime, autoRuleEndTime: endTime, updatedAt: new Date() };
    const user = await User.findByIdAndUpdate(
      req.currentUser._id,
      { $set: timeUpdates },
      { new: true }
    );
    res.json({
      ok: true,
      provider,
      autoRuleStartTime: user.autoRuleStartTime,
      autoRuleEndTime: user.autoRuleEndTime,
      shopeeAutoRuleStartTime: user.shopeeAutoRuleStartTime,
      shopeeAutoRuleEndTime: user.shopeeAutoRuleEndTime
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/scheduled-duplicate-pause-time', async (req, res) => {
  try {
    const pauseTime = String(req.body.pauseTime || '').trim();
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(pauseTime)) {
      return res.status(400).json({ error: 'Dinh dang thoi gian khong hop le (HH:MM)' });
    }

    await User.findByIdAndUpdate(
      req.currentUser._id,
      { $set: { scheduledDuplicatePauseTime: pauseTime, updatedAt: new Date() } },
      { new: true }
    );

    res.json({ ok: true, scheduledDuplicatePauseTime: pauseTime });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/config', async (req, res) => {
  try {
    const updates = { updatedAt: new Date() };
    if (typeof req.body.claudeKey === 'string' && req.body.claudeKey.trim()) {
      updates.claudeKey = req.body.claudeKey.trim();
    }
    if (typeof req.body.fbAppId === 'string' && req.body.fbAppId.trim()) {
      updates.fbAppId = req.body.fbAppId.trim();
    }
    if (typeof req.body.fbAppSecret === 'string' && req.body.fbAppSecret.trim()) {
      updates.fbAppSecret = req.body.fbAppSecret.trim();
    }
    if (typeof req.body.pancakeApiKey === 'string' && req.body.pancakeApiKey.trim()) {
      updates.pancakeApiKey = req.body.pancakeApiKey.trim();
    }
    if (typeof req.body.pancakeShopId === 'string' && req.body.pancakeShopId.trim()) {
      updates.pancakeShopId = req.body.pancakeShopId.trim();
    }

    const config = await Config.findOneAndUpdate(
      { key: 'app' },
      { $set: updates, $setOnInsert: { key: 'app' } },
      { upsert: true, new: true }
    );

    if (typeof req.body.fbToken === 'string' && req.body.fbToken.trim()) {
      await User.findByIdAndUpdate(req.currentUser._id, {
        fbToken: req.body.fbToken.trim(),
        fbTokenLastRefreshTime: new Date(),
        fbTokenLastRefreshError: '',
        updatedAt: new Date()
      });
      clearAllReadCache();
    }

    res.json({
      ok: true,
      hasFbToken: Boolean(req.body.fbToken?.trim() || config.fbToken),
      hasClaudeKey: Boolean(config.claudeKey),
      hasFbAppId: Boolean(config.fbAppId),
      hasFbAppSecret: Boolean(config.fbAppSecret),
      hasPancakeApiKey: Boolean(config.pancakeApiKey),
      hasPancakeShopId: Boolean(config.pancakeShopId)
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const payload = await buildAccountPayload({ ...req.body, ownerUserId: req.currentUser._id });
    if (!payload.name || !payload.adAccountId) {
      return res.status(400).json({ error: 'Thieu ten tai khoan hoac Ad Account ID' });
    }
    const providerNameError = getAccountProviderNameError(payload.provider, payload.name);
    if (providerNameError) return res.status(400).json({ error: providerNameError });
    if (!isValidAdAccountId(payload.adAccountId, payload.provider)) {
      return res.status(400).json({
        error: payload.provider === 'shopee'
          ? 'Ad Account/Shopee shop ID khong hop le.'
          : 'Ad Account ID khong hop le. Dung dang act_123456789 hoac chi nhap so.'
      });
    }
    if (payload.provider === 'facebook' && !payload.fbToken) {
      return res.status(400).json({ error: 'Thieu Facebook Access Token dung chung hoac rieng cho tai khoan' });
    }

    const account = await Account.create(payload);
    try {
      const { fbToken } = await getEffectiveSecrets(account);
      const me = await fbGet(fbToken, 'me', { fields: 'name,id' });
      await Account.findByIdAndUpdate(account._id, { status: 'connected' });
      await addLog(account._id, account.name, 'success', `Ket noi thanh cong: ${me.name} (${me.id})`);
    } catch (error) {
      await Account.findByIdAndUpdate(account._id, { status: 'error' });
      await addLog(account._id, account.name, 'error', `Loi ket noi: ${error.message}`);
    }

    res.json(account);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accounts/auto-discover', async (req, res) => {
  try {
    const config = await getAppConfig();
    const currentUser = await User.findById(req.currentUser._id).select('fbToken').lean();
    const fbToken = req.body.fbToken || currentUser?.fbToken || config?.fbToken || '';
    const provider = normalizeProvider(req.body.provider);
    const fastSync = req.body.fast === true || req.body.fast === 'true' || req.body.mode === 'fast';
    const spendDatePreset = String(req.body.spendDatePreset || 'this_year').trim() || 'this_year';
    const maxPages = req.body.maxPages
      ? parseBoundedInt(req.body.maxPages, 1000, 1, 1000)
      : (fastSync ? 5 : 1000);
    if (!fbToken) {
      return res.status(400).json({ error: 'Thieu Facebook Access Token. Hay luu token dung chung truoc.' });
    }

    const startedAt = Date.now();
    console.log(`[auto-discover] start provider=${provider} fast=${fastSync} maxPages=${maxPages}`);

    const allAdAccounts = [];
    const seenAdAccountIds = new Set();
    const addAdAccounts = (items = []) => {
      for (const item of items) {
        const accountId = getAdAccountNumericId(item);
        if (!accountId || seenAdAccountIds.has(accountId)) continue;
        seenAdAccountIds.add(accountId);
        allAdAccounts.push({ ...item, account_id: accountId });
      }
    };
    const sources = [];
    const sourceErrors = [];
    const adAccountFields = 'name,account_id,account_status,currency';

    const directAccounts = await fetchAllFbEdge(fbToken, 'me/adaccounts', {
      fields: adAccountFields,
      limit: 200
    }, {
      maxPages,
      pageTimeoutMs: fastSync ? 15000 : 30000,
      requestOptions: fastSync ? { retries: 1, rateLimitRetries: 1 } : {}
    });
    addAdAccounts(directAccounts.items);
    sources.push({ source: 'me/adaccounts', count: directAccounts.items.length, pages: directAccounts.pageCount });
    console.log(`[auto-discover] fetched ${directAccounts.items.length} accounts in ${directAccounts.pageCount} pages after ${Date.now() - startedAt}ms`);

    if (!allAdAccounts.length) {
      return res.json({ ok: true, found: 0, created: [], skipped: [], sources, sourceErrors, message: 'Khong tim thay tai khoan quang cao nao duoc gan cho user/token nay.' });
    }

    const discoveredAdAccounts = allAdAccounts.filter(account => {
      const isShopeeName = isShopeeAdAccountName(account.name);
      return provider === 'shopee' ? isShopeeName : !isShopeeName;
    });

    if (!discoveredAdAccounts.length) {
      return res.json({
        ok: true,
        found: 0,
        totalFetched: allAdAccounts.length,
        created: [],
        skipped: [],
        sources,
        sourceErrors,
        message: provider === 'shopee'
          ? `Tim thay ${allAdAccounts.length} tai khoan nhung khong co tai khoan Shopee nao bat dau bang XK11, XK12 hoac XK13.`
          : `Tim thay ${allAdAccounts.length} tai khoan nhung tat ca deu thuoc nhom Shopee XK11, XK12, XK13.`
      });
    }

    let accountsWithSpend = [];
    let spendCheckErrors = [];
    let finalAdAccounts = discoveredAdAccounts;

    if (!fastSync) {
      console.log(`Checking spend for ${discoveredAdAccounts.length} ${provider} accounts with batch insights (${spendDatePreset})...`);
      const spendResult = await fetchAdAccountsWithSpend(fbToken, discoveredAdAccounts, {
        datePreset: spendDatePreset,
        batchSize: 50,
        concurrency: 3
      });
      accountsWithSpend = spendResult.accountsWithSpend;
      spendCheckErrors = spendResult.spendCheckErrors;

      console.log(`Found ${accountsWithSpend.length}/${discoveredAdAccounts.length} accounts with confirmed spend > 0 (${spendDatePreset})`);

      if (!accountsWithSpend.length) {
        return res.json({
          ok: true,
          found: 0,
          totalFetched: allAdAccounts.length,
          accountsChecked: discoveredAdAccounts.length,
          created: [],
          skipped: [],
          sources,
          sourceErrors,
          spendCheckErrors,
          fast: false,
          spendScope: spendDatePreset,
          message: `Tim thay ${discoveredAdAccounts.length} tai khoan ${provider} nhung khong co tai khoan nao da chi tieu theo khoang ${spendDatePreset}.`
        });
      }

      finalAdAccounts = accountsWithSpend;
    }

    // Check existing accounts in DB
    const existingAccounts = await Account.find(withUserFilter(req, buildAccountProviderFilter(provider)), 'adAccountId');
    const existingIds = new Set(existingAccounts.map(a => {
      const id = String(a.adAccountId || '').trim();
      return id.startsWith('act_') ? id : `act_${id}`;
    }).filter(id => id !== 'act_'));

    const pendingCreates = [];
    const skipped = [];

    for (const adAccount of finalAdAccounts) {
      const actId = normalizeAdAccountId(adAccount.account_id);
      if (existingIds.has(actId)) {
        skipped.push({ name: adAccount.name, adAccountId: actId });
        continue;
      }

      try {
        const name = String(adAccount.name || `Account ${adAccount.account_id}`).trim();
        if (!name || !isValidAdAccountId(actId, provider)) {
          throw new Error('Ad Account ID khong hop le');
        }
        pendingCreates.push({
          payload: {
            ownerUserId: req.currentUser._id,
            name,
            provider,
            fbToken: provider === 'facebook' ? fbToken : '',
            adAccountId: provider === 'facebook' ? actId : String(actId || '').trim(),
            claudeKey: String(config?.claudeKey || '').trim(),
            spendThreshold: 20000,
            checkInterval: 60,
            autoEnabled: false,
            linkedPageIds: []
          },
          source: {
            name,
            adAccountId: actId
          }
        });
        existingIds.add(actId); // Prevent duplicates within same batch
      } catch (error) {
        skipped.push({ name: adAccount.name, adAccountId: actId, error: error.message });
      }
    }

    const created = [];
    if (pendingCreates.length) {
      try {
        const insertedAccounts = await Account.insertMany(pendingCreates.map(item => item.payload), { ordered: true });
        insertedAccounts.forEach((account, index) => {
          const source = pendingCreates[index].source;
          created.push({ id: account._id, name: source.name, adAccountId: source.adAccountId });
        });
      } catch (error) {
        for (const item of pendingCreates) {
          try {
            const account = await Account.create(item.payload);
            created.push({ id: account._id, name: item.source.name, adAccountId: item.source.adAccountId });
          } catch (createError) {
            skipped.push({
              name: item.source.name,
              adAccountId: item.source.adAccountId,
              error: createError.message
            });
          }
        }
      }
    }
    console.log(`[auto-discover] done provider=${provider} found=${finalAdAccounts.length} created=${created.length} skipped=${skipped.length} after ${Date.now() - startedAt}ms`);

    res.json({
      ok: true,
      found: finalAdAccounts.length,
      totalFetched: allAdAccounts.length,
      accountsChecked: discoveredAdAccounts.length,
      accountsWithSpend: accountsWithSpend.length,
      fast: fastSync,
      created,
      skipped,
      sources,
      sourceErrors,
      spendCheckErrors,
      spendScope: fastSync ? 'all' : spendDatePreset,
      message: fastSync
        ? `Dong bo tai khoan duoc gan trong BM: tim thay ${finalAdAccounts.length}/${discoveredAdAccounts.length} tai khoan ${provider}. Da them ${created.length}, bo qua ${skipped.length} (da ton tai).`
        : `Tim thay ${finalAdAccounts.length}/${discoveredAdAccounts.length} tai khoan ${provider} duoc gan trong BM va da chi tieu theo khoang ${spendDatePreset}. Da them ${created.length}, bo qua ${skipped.length} (da ton tai).`
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accounts/bulk', async (req, res) => {
  try {
    const items = Array.isArray(req.body.accounts)
      ? req.body.accounts
      : Array.isArray(req.body.items)
        ? req.body.items
        : [];
    if (!items.length) {
      return res.status(400).json({ error: 'Chua co tai khoan nao de them' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < items.length; i += 1) {
      try {
        const payload = await buildAccountPayload({ ...items[i], ownerUserId: req.currentUser._id });
        if (!payload.name || !payload.adAccountId) {
          throw new Error('Thieu ten tai khoan hoac Ad Account ID');
        }
        const providerNameError = getAccountProviderNameError(payload.provider, payload.name);
        if (providerNameError) throw new Error(providerNameError);
        if (!isValidAdAccountId(payload.adAccountId, payload.provider)) {
          throw new Error(payload.provider === 'shopee'
            ? 'Ad Account/Shopee shop ID khong hop le.'
            : 'Ad Account ID khong hop le. Dung dang act_123456789 hoac chi nhap so.');
        }
        if (payload.provider === 'facebook' && !payload.fbToken) {
          throw new Error('Thieu Facebook Access Token dung chung');
        }

        const account = await Account.create(payload);
        created.push({ id: account._id, name: account.name });
      } catch (error) {
        errors.push({ index: i, name: items[i]?.name || '', error: error.message });
      }
    }

    res.json({ ok: true, created, errors });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/accounts/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ownerUserId;
    const existingAccount = await Account.findOne(withUserFilter(req, { _id: req.params.id })).select('provider name').lean();
    if (!existingAccount) return res.status(404).json({ error: 'Not found' });

    if (!updates.fbToken) delete updates.fbToken;
    if (!updates.claudeKey) delete updates.claudeKey;
    if (Object.prototype.hasOwnProperty.call(updates, 'provider')) {
      updates.provider = normalizeProvider(updates.provider);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'adAccountId')) {
      const provider = updates.provider || existingAccount.provider || 'facebook';
      updates.adAccountId = provider === 'facebook' ? normalizeAdAccountId(updates.adAccountId) : String(updates.adAccountId || '').trim();
      if (!isValidAdAccountId(updates.adAccountId, provider)) {
        return res.status(400).json({
          error: provider === 'shopee'
            ? 'Ad Account/Shopee shop ID khong hop le.'
            : 'Ad Account ID khong hop le. Dung dang act_123456789 hoac chi nhap so.'
        });
      }
    }
    const nextProvider = updates.provider || existingAccount.provider || 'facebook';
    const nextName = Object.prototype.hasOwnProperty.call(updates, 'name') ? updates.name : existingAccount.name;
    const providerNameError = getAccountProviderNameError(nextProvider, nextName);
    if (providerNameError) return res.status(400).json({ error: providerNameError });
    if (req.body.linkedPageIds !== undefined) {
      updates.linkedPageIds = Array.isArray(req.body.linkedPageIds) ? req.body.linkedPageIds : [];
    }

    const account = await Account.findOneAndUpdate(withUserFilter(req, { _id: req.params.id }), updates, { new: true });
    if (!account) return res.status(404).json({ error: 'Not found' });

    if (account.autoEnabled) {
      await startAccountScheduler(account);
      await addLog(account._id, account.name, 'info', 'Da cap nhat cau hinh tu dong');
    }

    res.json(account);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const provider = String(req.query.provider || '').trim();
    const filter = withUserFilter(req, { _id: req.params.id });
    if (provider) Object.assign(filter, buildAccountProviderFilter(provider));

    const account = await Account.findOneAndDelete(filter);
    if (!account) return res.status(404).json({ error: 'Not found' });

    await Campaign.deleteMany({ accountId: account._id });
    await Log.deleteMany({ accountId: account._id });
    stopAccountScheduler(req.params.id);
    res.json({ ok: true, deletedCount: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts/:id/auto', async (req, res) => {
  try {
    console.log('TOGGLE AUTO BODY:', req.body);

    const { enabled } = req.body;
    const account = await Account.findOne(withUserFilter(req, { _id: req.params.id }));
    if (!account) return res.status(404).json({ error: 'Not found' });

    account.autoEnabled = Boolean(enabled);
    await account.save();

    if (account.autoEnabled) {
      await startAccountScheduler(account);
      await addLog(account._id, account.name, 'info', 'AUTO: ON');
    } else {
      stopAccountScheduler(account._id.toString());
      await addLog(account._id, account.name, 'warn', 'AUTO: OFF');
    }

    res.json({ ok: true, autoEnabled: account.autoEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/toggle-auto-bulk', async (req, res) => {
  try {
    const { ids, enabled } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ids must be an array' });

    const scopeFilter = withUserFilter(req, { _id: { $in: ids } });
    await Account.updateMany(scopeFilter, { autoEnabled: Boolean(enabled) });

    const accounts = await Account.find(scopeFilter);
    for (const account of accounts) {
      if (account.autoEnabled) {
        await startAccountScheduler(account);
        await addLog(account._id, account.name, 'info', 'AUTO: ON (Bulk)');
      } else {
        stopAccountScheduler(account._id.toString());
        await addLog(account._id, account.name, 'warn', 'AUTO: OFF (Bulk)');
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/delete-bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    const provider = String(req.body.provider || '').trim();
    console.log(`Bulk deleting ${ids?.length} accounts...`);
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ids must be an array' });

    const filter = withUserFilter(req, { _id: { $in: ids } });
    if (provider) Object.assign(filter, buildAccountProviderFilter(provider));
    const accounts = await Account.find(filter).select('_id').lean();
    const matchedIds = accounts.map(account => account._id);

    for (const id of matchedIds) {
      stopAccountScheduler(id);
    }

    const accResult = matchedIds.length
      ? await Account.deleteMany({ _id: { $in: matchedIds } })
      : { deletedCount: 0 };
    const campResult = matchedIds.length
      ? await Campaign.deleteMany({ accountId: { $in: matchedIds } })
      : { deletedCount: 0 };
    const logResult = matchedIds.length
      ? await Log.deleteMany({ accountId: { $in: matchedIds } })
      : { deletedCount: 0 };

    console.log(`Deleted: ${accResult.deletedCount} accounts, ${campResult.deletedCount} campaigns, ${logResult.deletedCount} logs`);
    res.json({ ok: true, deletedCount: accResult.deletedCount });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/refresh', async (req, res) => {
  try {
    const account = await Account.findOne(withUserFilter(req, { _id: req.params.id }));
    if (!account) return res.status(404).json({ error: 'Not found' });

    const result = account.provider === 'shopee'
      ? await fetchShopeeAccountData(account)
      : await fetchAccountData(account);

    await Account.findByIdAndUpdate(account._id, {
      lastChecked: new Date(),
      status: 'connected'
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    const account = await Account.findOne(withUserFilter(req, { _id: req.params.id })).catch(() => null);
    if (error.transient) {
      if (account) {
        if (error.rateLimited) {
          await Account.findByIdAndUpdate(account._id, {
            lastChecked: new Date(),
            status: 'connected'
          });
        }
        await addLog(account._id, account.name, 'warn', `Bo qua refresh tam thoi: ${error.message}`);
      }
      return res.json({ ok: false, skipped: true, transient: true, accountId: account?._id, error: error.message });
    }

    if (account) {
      await Account.findByIdAndUpdate(account._id, { status: 'error' });
    }
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/toggle', async (req, res) => {
  try {
    const { accountId, currentStatus } = req.body;
    const date = normalizeCampaignDate(req.body.date);
    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    await fbPost(fbToken, req.params.campaignId, { status: newStatus });
    await Campaign.findOneAndUpdate(
      { accountId, campaignId: req.params.campaignId, date },
      { $set: { status: newStatus, updatedAt: new Date() } },
      { new: true }
    );

    await addLog(
      account._id,
      account.name,
      newStatus === 'ACTIVE' ? 'success' : 'warn',
      `Thu cong: ${currentStatus} -> ${newStatus} (${req.params.campaignId})`
    );

    res.json({ ok: true, newStatus });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/rename', async (req, res) => {
  try {
    const { accountId } = req.body;
    const date = normalizeCampaignDate(req.body.date);
    const name = String(req.body.name || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Ten campaign khong duoc de trong' });
    if (name.length > 400) return res.status(400).json({ error: 'Ten campaign qua dai' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    await fbPost(fbToken, req.params.campaignId, { name });
    await Campaign.findOneAndUpdate(
      { accountId, campaignId: req.params.campaignId, date },
      { $set: { name, updatedAt: new Date() } },
      { new: true }
    );
    clearCampaignReadCache();

    await addLog(account._id, account.name, 'success', `Doi ten camp ${req.params.campaignId}: ${name}`);
    res.json({ ok: true, name });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/budget', async (req, res) => {
  try {
    const { accountId } = req.body;
    const date = normalizeCampaignDate(req.body.date);
    const budget = Math.round(Number(req.body.budget || 0));
    if (!Number.isFinite(budget) || budget <= 0) return res.status(400).json({ error: 'Ngan sach khong hop le' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    const campaign = await Campaign.findOne({ accountId, campaignId: req.params.campaignId, date }).lean();
    const isLifetime = String(campaign?.budgetType || '').toUpperCase() === 'LIFETIME' || Number(campaign?.lifetimeBudget || 0) > 0;
    const field = isLifetime ? 'lifetime_budget' : 'daily_budget';
    await fbPost(fbToken, req.params.campaignId, { [field]: budget });

    const update = isLifetime
      ? { lifetimeBudget: budget, dailyBudget: 0, budgetType: 'LIFETIME', updatedAt: new Date() }
      : { dailyBudget: budget, lifetimeBudget: 0, budgetType: 'DAILY', updatedAt: new Date() };
    await Campaign.findOneAndUpdate(
      { accountId, campaignId: req.params.campaignId, date },
      { $set: update },
      { new: true }
    );
    clearCampaignReadCache();

    await addLog(account._id, account.name, 'success', `Doi ngan sach camp ${req.params.campaignId}: ${budget.toLocaleString()}d`);
    res.json({ ok: true, budget, budgetType: update.budgetType });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function processCampaignDuplicateExactRequest(body = {}, onProgress = null) {
  const ownerUserId = body.ownerUserId || null;
  const provider = normalizeProvider(body.provider);
  const date = normalizeCampaignDate(body.date);
  const copyCount = parseBoundedInt(body.copyCount, 1, 1, 20);
  const selectedItems = Array.isArray(body.items) ? body.items : [];
  const cloneStart = parseVietnamCampaignStart(body.startTime);
  const cloneEnd = parseVietnamCampaignEnd(body.endTime);

  if (cloneEnd && new Date(cloneEnd.utc).getTime() <= new Date(cloneStart.utc).getTime()) {
    throw new Error('Thoi gian ket thuc phai lon hon thoi gian bat dau');
  }

  const requested = selectedItems
    .map(item => ({
      campaignId: String(item?.campaignId || '').trim(),
      accountId: String(item?.accountId || '').trim()
    }))
    .filter(item => item.campaignId && mongoose.Types.ObjectId.isValid(item.accountId));

  const selectedKeys = [...new Set(requested.map(item => `${item.accountId}:${item.campaignId}`))];
  if (!selectedKeys.length) {
    throw new Error('Chua chon campaign de nhan ban');
  }

  if (selectedKeys.length * copyCount > 100) {
    throw new Error('Chi cho phep tao toi da 100 ban copy moi lan');
  }

  const query = {
    date,
    $or: selectedKeys.map(key => {
      const [accountId, campaignId] = key.split(':');
      return { accountId, campaignId };
    })
  };
  if (ownerUserId) {
    const ownerAccounts = await Account.find({ ownerUserId, _id: { $in: requested.map(item => item.accountId) } }).select('_id').lean();
    const ownerAccountIds = new Set(ownerAccounts.map(account => String(account._id)));
    query.$or = query.$or.filter(item => ownerAccountIds.has(String(item.accountId)));
  }

  const campaigns = await Campaign.find(query)
    .populate('accountId', 'name adAccountId provider fbToken claudeKey')
    .lean();

  const validCampaigns = campaigns.filter(campaign => {
    const account = campaign.accountId;
    if (!account) return false;
    if (provider === 'shopee') return account.provider === 'shopee';
    return account.provider === 'facebook' || !account.provider;
  });

  const copyOptions = {
    start_time: cloneStart.fbStartTime,
    ...(cloneEnd ? { end_time: cloneEnd.fbStartTime } : {})
  };
  const scheduledCampaignDate = campaignDateFromScheduledStart(cloneStart);

  const copied = [];
  const errors = [];
  const totalCopies = validCampaigns.length * copyCount;
  let finishedCopies = 0;

  if (onProgress) await onProgress({ copied: 0, errors: 0, totalCopies, percent: 0 });

  for (const campaign of validCampaigns) {
    const account = campaign.accountId;
    const accountIdValue = account?._id || account;
    try {
      const { fbToken } = await getEffectiveSecrets(account);
      if (!fbToken) throw new Error('Thieu Facebook Access Token');

      for (let index = 0; index < copyCount; index += 1) {
        const copyResult = await duplicateCampaignExactQueued(fbToken, campaign, copyOptions);
        const copiedCampaignId = copyResult.copiedCampaignId;

        await upsertDailyCampaign(accountIdValue, copiedCampaignId, scheduledCampaignDate, {
          name: copyResult.copiedCampaignName || campaign.name || campaign.campaignId,
          status: 'ACTIVE',
          dailyBudget: campaign.dailyBudget || 0,
          lifetimeBudget: campaign.lifetimeBudget || 0,
          budgetType: campaign.budgetType || (campaign.lifetimeBudget > 0 ? 'LIFETIME' : 'DAILY'),
          isScheduled: true,
          scheduledStartTime: cloneStart.fbStartTime,
          scheduledStartTimeUtc: cloneStart.utc,
          scheduledStartTimeDisplay: cloneStart.display,
          scheduledEndTime: cloneEnd?.fbStartTime || '',
          scheduledEndTimeUtc: cloneEnd?.utc,
          scheduledEndTimeDisplay: cloneEnd?.display || ''
        });

        copied.push({
          sourceCampaignId: campaign.campaignId,
          copiedCampaignId,
          copyIndex: index + 1,
          sourceName: campaign.name || '',
          name: copyResult.copiedCampaignName || campaign.name || '',
          copiedCampaignName: copyResult.copiedCampaignName || campaign.name || '',
          copiedCampaignStatus: 'ACTIVE',
          accountId: String(accountIdValue),
          accountName: account.name || '',
          copyMode: 'queued',
          copiedAdSetCount: copyResult.copiedAdSets.length,
          copiedAdCount: copyResult.copiedAds.length,
          raw: copyResult.raw
        });

        finishedCopies += 1;
        if (onProgress) {
          await onProgress({
            copied: copied.length,
            errors: errors.length,
            totalCopies,
            percent: totalCopies ? Math.round((finishedCopies / totalCopies) * 100) : 100
          });
        }
      }

      await addLog(
        accountIdValue,
        account.name || '',
        'success',
        `Nhan ban y nguyen theo hang doi ${copyCount} ban: ${campaign.name || campaign.campaignId}`
      );
    } catch (error) {
      await addLog(
        accountIdValue,
        account?.name || '',
        'error',
        `Nhan ban y nguyen that bai ${campaign.name || campaign.campaignId}: ${error.message}`
      );

      errors.push({
        sourceCampaignId: campaign.campaignId,
        name: campaign.name || '',
        accountId: accountIdValue ? String(accountIdValue) : '',
        accountName: account?.name || '',
        error: error.message
      });

      finishedCopies += copyCount;
      if (onProgress) {
        await onProgress({
          copied: copied.length,
          errors: errors.length,
          totalCopies,
          percent: totalCopies ? Math.round((finishedCopies / totalCopies) * 100) : 100
        });
      }
    }
  }

  const foundKeys = new Set(validCampaigns.map(campaign => `${campaign.accountId?._id || campaign.accountId}:${campaign.campaignId}`));
  for (const key of selectedKeys) {
    if (!foundKeys.has(key)) {
      const [, campaignId] = key.split(':');
      errors.push({ sourceCampaignId: campaignId, error: 'Khong tim thay campaign phu hop voi tai khoan/provider da chon' });
    }
  }

  return {
    ok: true,
    date,
    count: selectedKeys.length,
    copyCount,
    copied,
    errors,
    startTime: cloneStart.fbStartTime,
    endTime: cloneEnd?.fbStartTime || ''
  };
}

app.post('/api/campaigns/duplicate-exact', async (req, res) => {
  try {
    req.body.ownerUserId = req.currentUser._id;
    if (campaignDuplicateQueue && req.body?.queue === true) {
      startCampaignDuplicateWorker();
      const job = await campaignDuplicateQueue.add('duplicate-exact', req.body);
      return res.status(202).json({
        ok: true,
        queued: true,
        queue: CAMPAIGN_DUPLICATE_QUEUE_NAME,
        jobId: String(job.id),
        statusUrl: `/api/queues/campaign-duplicates/jobs/${job.id}`
      });
    }

    const result = await processCampaignDuplicateExactRequest(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/queues/campaign-duplicates/jobs/:id', async (req, res) => {
  try {
    if (!campaignDuplicateQueue) {
      return res.status(404).json({ error: 'Campaign duplicate queue is not enabled' });
    }

    const job = await campaignDuplicateQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job' });

    const state = await job.getState();
    res.json({
      ok: true,
      id: String(job.id),
      name: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason || '',
      returnvalue: job.returnvalue || null,
      timestamp: job.timestamp,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/create-from-posts', async (req, res) => {
  try {
    const { accountId } = req.body;
    const campaignItems = parseCampaignCreateItems(req.body.codes);
    const selectedPageId = String(req.body.pageId || '').trim();
    const campaignPrefix = String(req.body.campaignPrefix || '').trim();
    const adNamePrefix = String(req.body.adNamePrefix || DEFAULT_AD_NAME_PREFIX).trim() || DEFAULT_AD_NAME_PREFIX;
    const adNameStatus = normalizeAdNameStatus(req.body.adNameStatus);

    if (!accountId) return res.status(400).json({ error: 'Thieu tai khoan quang cao' });
    if (!campaignItems.length) return res.status(400).json({ error: 'Chua co ma san pham nao' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    const acctId = account.adAccountId.startsWith('act_')
      ? account.adAccountId
      : `act_${account.adAccountId}`;

    const isShopee = account.provider === 'shopee';
    const dailyBudgetDefault = isShopee ? SHOPEE_CAMPAIGN_DAILY_BUDGET : DEFAULT_CAMPAIGN_DAILY_BUDGET;
    const dailyBudget = Math.max(1000, Number(req.body.dailyBudget || dailyBudgetDefault));
    const requestedBidAmount = Number(req.body.bidAmount);
    const shopeeBidAmount = Number.isFinite(requestedBidAmount) && requestedBidAmount > 0
      ? Math.round(requestedBidAmount)
      : SHOPEE_AD_SET_BID_AMOUNT;
    const { ageMin, ageMax } = parseCampaignAgeRange(
      req.body.ageMin,
      req.body.ageMax,
      isShopee ? SHOPEE_AGE_MIN : 18,
      isShopee ? SHOPEE_AGE_MAX : 50
    );
    const objective = isShopee ? 'OUTCOME_TRAFFIC' : DEFAULT_CAMPAIGN_OBJECTIVE;
    const destinationType = isShopee ? 'UNDEFINED' : DEFAULT_AD_SET_DESTINATION_TYPE;
    const optimizationGoal = isShopee ? 'LINK_CLICKS' : DEFAULT_AD_SET_OPTIMIZATION_GOAL;
    const campaignBidStrategy = isShopee ? SHOPEE_CAMPAIGN_BID_STRATEGY : DEFAULT_CAMPAIGN_BID_STRATEGY;
    const shopeeCallToActionType = normalizeShopeeCallToActionType(req.body.callToActionType);

    const scheduledStart = parseVietnamCampaignStart(req.body.startTime);
    const campaignDate = campaignDateFromScheduledStart(scheduledStart);

    const created = [];
    const errors = [];
    const createConcurrency = parseBoundedInt(
      req.body.createConcurrency || req.body.concurrency,
      CAMPAIGN_CREATE_CONCURRENCY,
      1,
      3
    );
    const createItemDelayMs = parseBoundedInt(
      req.body.createItemDelayMs,
      CAMPAIGN_CREATE_ITEM_DELAY_MS,
      0,
      60000
    );

    const processCampaignItem = async (item) => {
      const code = item.campaignName;
      const lookupTerm = item.lookupTerm;
      const destinationUrl = getDestinationUrlFromLookupTerm(item.destinationUrl || lookupTerm);
      let matchedPostInfo = null;
      try {
        const lookupTerms = buildPostLookupTerms(lookupTerm);
        const postQuery = {
          $or: lookupTerms.map(term => ({
            message: { $regex: escapeRegExp(term), $options: 'i' }
          }))
        };
        if (selectedPageId) {
          postQuery.pageId = selectedPageId;
        }

        const post = await FacebookPost.findOne(postQuery).sort({ createdTime: -1, fetchedAt: -1 }).lean();
        matchedPostInfo = post ? {
          postId: post.postId,
          pageId: post.pageId,
          pageName: post.pageName
        } : null;

        if (!post) {
          const pageScope = selectedPageId ? ` tren Page ${selectedPageId}` : '';
          return { error: { code, lookupTerm, error: `Khong tim thay bai viet da luu co link/ma nay${pageScope}` } };
        }

        const cleanCode = code.replace(/\s+/g, ' ');
        const baseName = buildCampaignName(cleanCode, campaignPrefix);
        const pageId = getPostPageId(post);
        if (!pageId) {
          return { error: { code, lookupTerm, error: 'Khong xac dinh duoc Page ID cua bai viet de tao camp luot mua qua tin nhan' } };
        }

        const adName = buildAdName(cleanCode, adNamePrefix, adNameStatus);
        const finalAdName = isShopee ? baseName : adName;
        let campaign = await fbPost(fbToken, `${acctId}/campaigns`, {
          name: baseName,
          objective: objective,
          status: 'ACTIVE',
          special_ad_categories: [],
          buying_type: 'AUCTION',
          daily_budget: Math.round(dailyBudget),
          bid_strategy: campaignBidStrategy
        }, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        const buildAdSetPayload = (campaignId, nextDestinationType, nextOptimizationGoal) => ({
          name: isShopee ? baseName : DEFAULT_AD_SET_NAME,
          campaign_id: campaignId,
          ...(nextDestinationType && nextDestinationType !== 'UNDEFINED'
            ? { destination_type: nextDestinationType }
            : {}),
          billing_event: 'IMPRESSIONS',
          optimization_goal: nextOptimizationGoal,
          ...(isShopee ? {} : { optimization_sub_event: 'NONE' }),
          ...(isShopee ? { bid_amount: shopeeBidAmount } : {}),
          ...(nextDestinationType === 'MESSENGER'
            ? { promoted_object: { page_id: pageId, smart_pse_enabled: false } }
            : {}),
          attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }],
          targeting: {
            geo_locations: {
              countries: ['VN'],
              location_types: isShopee ? ['home', 'recent'] : ['frequently_in', 'home', 'recent']
            },
            brand_safety_content_filter_levels: isShopee ? ['FACEBOOK_RELAXED'] : ['FACEBOOK_STANDARD', 'AN_STANDARD'],
            targeting_automation: {
              advantage_audience: 0
            },
            ...(isShopee ? {
              publisher_platforms: ['facebook', 'instagram', 'messenger'],
              facebook_positions: ['feed', 'facebook_reels', 'facebook_reels_overlay', 'profile_feed', 'notification', 'instream_video', 'marketplace', 'story', 'search'],
              instagram_positions: ['stream', 'ig_search', 'story', 'explore', 'reels', 'explore_home', 'profile_feed'],
              messenger_positions: ['story'],
              device_platforms: ['mobile', 'desktop']
            } : {
              genders: [2]
            }),
            age_min: ageMin,
            age_max: ageMax
          },
          start_time: scheduledStart.fbStartTime,
          status: 'ACTIVE'
        });

        const adSetPayload = buildAdSetPayload(campaign.id, destinationType, optimizationGoal);

        const adSet = await fbPost(fbToken, `${acctId}/adsets`, adSetPayload, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        const creativePayload = {
          name: `${baseName} - Creative`,
          object_story_id: post.postId,
          contextual_multi_ads: {
            enroll_status: 'OPT_OUT'
          }
        };

        if (isShopee && shopeeCallToActionType !== 'NO_BUTTON' && destinationUrl) {
          creativePayload.call_to_action_type = shopeeCallToActionType;
          creativePayload.link_url = destinationUrl;
        }

        const creative = await fbPost(fbToken, `${acctId}/adcreatives`, creativePayload, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        const ad = await fbPost(fbToken, `${acctId}/ads`, {
          name: finalAdName,
          adset_id: adSet.id,
          creative: { creative_id: creative.id },
          status: 'ACTIVE'
        }, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        await upsertDailyCampaign(account._id, campaign.id, campaignDate, {
          name: baseName,
          status: 'ACTIVE',
          dailyBudget,
          budgetType: 'DAILY',
          isScheduled: true,
          scheduledStartTime: scheduledStart.fbStartTime,
          scheduledStartTimeUtc: scheduledStart.utc,
          scheduledStartTimeDisplay: scheduledStart.display
        });

        await addLog(
          account._id,
          account.name,
          'success',
          isShopee
            ? `Tao camp Shopee traffic tu bai viet: ${cleanCode} -> ${campaign.id}, bat dau ${scheduledStart.display}`
            : `Tao camp luot mua qua tin nhan tu bai viet: ${cleanCode} -> ${campaign.id}, bat dau ${scheduledStart.display}`
        );

        return {
          created: {
            code,
            lookupTerm,
            postId: post.postId,
            pageName: post.pageName,
            objective,
            destinationType,
            optimizationGoal,
            campaignBidStrategy,
            bidAmount: isShopee ? shopeeBidAmount : undefined,
            callToActionType: isShopee ? shopeeCallToActionType : undefined,
            destinationUrl: isShopee ? destinationUrl : undefined,
            adName: finalAdName,
            campaignId: campaign.id,
            adSetId: adSet.id,
            creativeId: creative.id,
            adId: ad.id,
            status: 'ACTIVE',
            startTime: scheduledStart.fbStartTime,
            startTimeUtc: scheduledStart.utc,
            startTimeDisplay: scheduledStart.display
          }
        };
      } catch (error) {
        const purchaseOptimizationHint = isMessagingPurchaseOptimizationError(error) && matchedPostInfo
          ? ` Page "${matchedPostInfo.pageName || matchedPostInfo.pageId}" (${matchedPostInfo.pageId}) chua du dieu kien toi uu hoa luot mua qua tin nhan.`
          : '';
        return {
          error: {
            code,
            lookupTerm,
            error: `${error.message}${purchaseOptimizationHint}`,
            rateLimited: Boolean(error.rateLimited),
            objective,
            destinationType,
            optimizationGoal,
            campaignBidStrategy,
            bidAmount: isShopee ? shopeeBidAmount : undefined,
            callToActionType: isShopee ? shopeeCallToActionType : undefined,
            destinationUrl: isShopee ? destinationUrl : undefined,
            postPageId: matchedPostInfo?.pageId,
            postPageName: matchedPostInfo?.pageName,
            postId: matchedPostInfo?.postId
          }
        };
      }
    };

    let stoppedByRateLimit = false;
    for (let i = 0; i < campaignItems.length; i += createConcurrency) {
      const chunk = campaignItems.slice(i, i + createConcurrency);
      const itemResults = await Promise.allSettled(chunk.map(processCampaignItem));

      for (const result of itemResults) {
        if (result.status === 'fulfilled') {
          if (result.value?.created) created.push(result.value.created);
          if (result.value?.error) errors.push(result.value.error);
          if (result.value?.error?.rateLimited) stoppedByRateLimit = true;
          continue;
        }

        errors.push({ code: 'unknown', error: result.reason?.message || String(result.reason || 'Unknown error') });
        if (result.reason?.rateLimited) stoppedByRateLimit = true;
      }

      if (stoppedByRateLimit) {
        break;
      }

      if (createItemDelayMs > 0 && i + createConcurrency < campaignItems.length) {
        await sleep(createItemDelayMs);
      }
    }

    res.json({
      ok: true,
      created,
      errors,
      createConcurrency,
      createItemDelayMs,
      stoppedByRateLimit,
      startTime: scheduledStart.fbStartTime,
      startTimeDisplay: scheduledStart.display
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/accounts/:id/campaigns', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { date, fromDate, toDate } = req.query;
    const fDate = fromDate || date || todayStr();
    const tDate = toDate || date || fDate;
    const provider = String(req.query.provider || '').trim();
    const cacheKey = userScopedCacheKey(req, `campaigns:account:${req.params.id}:${provider || 'all'}:${fDate}:${tDate}`);
    const cached = getReadCache(cacheKey);
    if (cached) return res.json(cached);

    if (provider) {
      const account = await Account.findOne(withUserFilter(req, {
        _id: req.params.id,
        ...buildAccountProviderFilter(provider)
      })).select('_id').lean();
      if (!account) return res.json([]);
    }
    const match = {
      accountId: new mongoose.Types.ObjectId(req.params.id),
      date: { $gte: fDate, $lte: tDate }
    };
    const ownedAccount = await Account.findOne(withUserFilter(req, { _id: req.params.id })).select('_id').lean();
    if (!ownedAccount) return res.json([]);

    const campaigns = await Campaign.aggregate([
      { $match: match },
      { $sort: { date: 1, updatedAt: 1, _id: 1 } },
      {
        $group: {
          _id: '$campaignId',
          campaignId: { $first: '$campaignId' },
          accountId: { $first: '$accountId' },
          name: { $first: '$name' },
          status: { $last: '$status' },
          dailyBudget: { $last: '$dailyBudget' },
          lifetimeBudget: { $last: '$lifetimeBudget' },
          createdTime: { $last: '$createdTime' },
          spend: { $sum: '$spend' },
          messages: { $sum: '$messages' },
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
          costPerMessage: { $last: '$costPerMessage' },
          metaOrders: { $sum: '$metaOrders' }
        }
      },
      {
        $project: {
          _id: 0,
          campaignId: 1,
          accountId: 1,
          name: 1,
          status: 1,
          dailyBudget: 1,
          lifetimeBudget: 1,
          createdTime: 1,
          spend: 1,
          messages: 1,
          clicks: 1,
          impressions: 1,
          metaOrders: 1,
          costPerMessage: 1
        }
      },
      { $sort: { spend: -1 } }
    ]);
    console.log(`[campaigns:account] account=${req.params.id} ${fDate}..${tDate} rows=${campaigns.length} ${Date.now() - startedAt}ms`);
    res.json(setReadCache(cacheKey, campaigns));
  } catch (error) {
    console.error(`[campaigns:account] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/campaigns/today', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { provider, date, fromDate, toDate } = req.query;
    const fDate = fromDate || date || todayStr();
    const tDate = toDate || date || fDate;
    const cacheKey = userScopedCacheKey(req, `campaigns:today:${provider || 'all'}:${fDate}:${tDate}`);
    const cached = getReadCache(cacheKey);
    if (cached) return res.json(cached);

    let match = {
      date: { $gte: fDate, $lte: tDate }
    };
    if (provider) {
      const accountIds = (await Account.find(withUserFilter(req, buildAccountProviderFilter(provider))).select('_id')).map(a => a._id);
      match.accountId = { $in: accountIds };
    } else {
      const accountIds = (await Account.find(getUserFilter(req)).select('_id')).map(a => a._id);
      match.accountId = { $in: accountIds };
    }

    // Nếu là khoảng ngày, ta group theo campaignId để cộng dồn spend/messages
    const campaigns = await Campaign.aggregate([
      { $match: match },
      { $sort: { date: 1, updatedAt: 1, _id: 1 } },
      {
        $group: {
          _id: '$campaignId',
          campaignId: { $first: '$campaignId' },
          accountId: { $first: '$accountId' },
          name: { $first: '$name' },
          status: { $last: '$status' },
          dailyBudget: { $last: '$dailyBudget' },
          lifetimeBudget: { $last: '$lifetimeBudget' },
          createdTime: { $last: '$createdTime' },
          spend: { $sum: '$spend' },
          messages: { $sum: '$messages' },
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
          costPerMessage: { $last: '$costPerMessage' },
          metaOrders: { $sum: '$metaOrders' }
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'accountInfo'
        }
      },
      { $unwind: '$accountInfo' },
      {
        $project: {
          _id: 0,
          campaignId: 1,
          accountId: {
            _id: '$accountInfo._id',
            name: '$accountInfo.name',
            adAccountId: '$accountInfo.adAccountId',
            provider: '$accountInfo.provider'
          },
          name: 1,
          status: 1,
          dailyBudget: 1,
          lifetimeBudget: 1,
          createdTime: 1,
          spend: 1,
          messages: 1,
          clicks: 1,
          impressions: 1,
          metaOrders: 1,
          costPerMessage: 1
        }
      },
      { $sort: { spend: -1 } }
    ]);

    console.log(`[campaigns:today] provider=${provider || 'all'} ${fDate}..${tDate} rows=${campaigns.length} ${Date.now() - startedAt}ms`);
    res.json(setReadCache(cacheKey, campaigns));
  } catch (error) {
    console.error(`[campaigns:today] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

async function fetchAccountInsightsInRange(account, fromDate, toDate) {
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const { items } = await fetchAllFbEdge(fbToken, `${acctId}/insights`, {
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,conversions,cost_per_action_type',
    time_range: JSON.stringify({ since: fromDate, until: toDate }),
    level: 'campaign',
    limit: 500,
    time_increment: 1
  });

  return items;
}

async function syncAccountHistoricalData(account, fromDate, toDate, options = {}) {
  const insights = await fetchAccountInsightsInRange(account, fromDate, toDate);
  let count = 0;
  const seenByDate = new Map();

  for (const insight of insights) {
    const date = insight.date_start;
    if (!date || !insight.campaign_id) continue;
    if (!seenByDate.has(date)) seenByDate.set(date, new Set());
    seenByDate.get(date).add(String(insight.campaign_id));

    const spend = parseFloat(insight.spend || 0);
    const impressions = parseInt(insight.impressions || 0, 10);
    const clicks = parseInt(insight.clicks || 0, 10);
    const msgAction = getMetaMessageActionFromInsight(insight);
    const messages = parseInt(msgAction?.value || 0, 10);
    const costPerMessage = getMetaCostPerMessageFromInsight(insight);
    const metaOrders = getMetaOrdersFromInsight(insight);

    await upsertDailyCampaign(account._id, insight.campaign_id, date, {
      name: insight.campaign_name,
      spend,
      impressions,
      clicks,
      messages,
      costPerMessage,
      metaOrders
    });
    count++;
  }

  if (options.prune === true && fromDate === toDate) {
    const seenCampaignIds = [...(seenByDate.get(fromDate) || new Set())];
    const pruneFilter = {
      accountId: account._id,
      date: fromDate
    };
    if (seenCampaignIds.length) {
      pruneFilter.campaignId = { $nin: seenCampaignIds };
    }
    const result = await Campaign.deleteMany(pruneFilter);
    if (result.deletedCount) {
      clearCampaignReadCache();
      await addLog(account._id, account.name, 'info', `Chot ngay ${fromDate}: xoa ${result.deletedCount} camp cu khong con trong snapshot`);
    }
  }

  return count;
}

let finalSpendSyncRunning = false;
const syncHistoryJobs = new Map();

function createSyncHistoryJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDateKeysInRange(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('Khoang ngay khong hop le');
  }

  const dates = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push(cursor.toISOString().split('T')[0]);
  }
  return dates;
}

function assertPastCampaignSyncRange(fromDate, toDate) {
  if (toDate >= todayStr()) {
    throw new Error('Chi dong bo thu cong cac ngay truoc hom nay. Du lieu hom nay duoc cap nhat rieng va se duoc chot tu dong cuoi ngay.');
  }
  return getDateKeysInRange(fromDate, toDate);
}

function setSyncHistoryJob(jobId, updates) {
  const current = syncHistoryJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
  syncHistoryJobs.set(jobId, next);
  return next;
}

async function runSyncHistoryJob(jobId, { fromDate, toDate, provider, accountId }) {
  try {
    const job = syncHistoryJobs.get(jobId);
    if (!job) return;

    const filter = {
      _id: accountId,
      ...(provider ? buildAccountProviderFilter(provider) : {})
    };
    if (job.ownerUserId) filter.ownerUserId = job.ownerUserId;
    const account = await Account.findOne(filter);
    if (!account) throw new Error('Khong tim thay tai khoan can dong bo');
    if (account.provider === 'shopee') throw new Error('Shopee khong can dong bo Meta insights');

    const dates = assertPastCampaignSyncRange(fromDate, toDate);
    setSyncHistoryJob(jobId, {
      state: 'active',
      accountName: account.name,
      totalDays: dates.length,
      currentDay: '',
      message: 'Đang Đồng Bộ'
    });

    let syncedRows = 0;
    const errors = [];

    for (let index = 0; index < dates.length; index += 1) {
      const dateKey = dates[index];
      setSyncHistoryJob(jobId, {
        currentDay: dateKey,
        completedDays: index,
        percent: Math.round((index / dates.length) * 100)
      });

      try {
        const count = await syncAccountHistoricalData(account, dateKey, dateKey, { prune: true });
        syncedRows += count;
        await addLog(account._id, account.name, 'success', `Dong bo ngay ${dateKey}: ${count} camp`);
      } catch (error) {
        errors.push({ date: dateKey, error: error.message });
        await addLog(account._id, account.name, 'error', `Loi dong bo ngay ${dateKey}: ${error.message}`);
      }

      if (index < dates.length - 1) {
        await sleep(300);
      }
    }

    setSyncHistoryJob(jobId, {
      state: errors.length ? 'completed_with_errors' : 'completed',
      completedDays: dates.length,
      percent: 100,
      syncedRows,
      errors,
      currentDay: '',
      finishedAt: new Date().toISOString(),
      message: errors.length ? 'Dong bo xong nhung co loi' : 'Dong bo xong'
    });
    setTimeout(() => syncHistoryJobs.delete(jobId), 60 * 60 * 1000);
  } catch (error) {
    setSyncHistoryJob(jobId, {
      state: 'failed',
      error: error.message,
      finishedAt: new Date().toISOString(),
      message: error.message
    });
    setTimeout(() => syncHistoryJobs.delete(jobId), 60 * 60 * 1000);
  }
}

async function processCampaignSyncHistoryJob(data = {}, onProgress = null) {
  const { fromDate, toDate, provider, accountId } = data;
  const normalizedProvider = normalizeProvider(provider);
  const filter = {
    ...(normalizedProvider ? buildAccountProviderFilter(normalizedProvider) : {})
  };
  if (data.ownerUserId) {
    filter.ownerUserId = data.ownerUserId;
  }
  if (accountId) {
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      throw new Error('Tai khoan dong bo khong hop le');
    }
    filter._id = accountId;
  }
  const accounts = await Account.find(filter).sort('name');
  if (!accounts.length) throw new Error('Khong tim thay tai khoan can dong bo');
  if (accounts.some(account => account.provider === 'shopee')) {
    throw new Error('Shopee khong can dong bo Meta insights');
  }

  const dates = assertPastCampaignSyncRange(fromDate, toDate);
  const totalSteps = Math.max(1, accounts.length * dates.length);
  const baseProgress = {
    state: 'active',
    accountId: accountId ? String(accounts[0]._id) : '',
    accountName: accountId ? accounts[0].name : 'Tat ca tai khoan',
    totalAccounts: accounts.length,
    completedAccounts: 0,
    fromDate,
    toDate,
    totalDays: dates.length,
    completedDays: 0,
    currentDay: '',
    percent: 0,
    syncedRows: 0,
    errors: [],
    message: 'Đang Đồng Bộ'
  };

  if (onProgress) await onProgress(baseProgress);

  let syncedRows = 0;
  const errors = [];
  let completedSteps = 0;

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
    const account = accounts[accountIndex];
    for (let index = 0; index < dates.length; index += 1) {
      const dateKey = dates[index];
      if (onProgress) {
        await onProgress({
          ...baseProgress,
          accountId: String(account._id),
          accountName: account.name,
          completedAccounts: accountIndex,
          syncedRows,
          errors,
          currentDay: dateKey,
          completedDays: index,
          percent: Math.round((completedSteps / totalSteps) * 100)
        });
      }

      try {
        const count = await syncAccountHistoricalData(account, dateKey, dateKey, { prune: true });
        syncedRows += count;
        await addLog(account._id, account.name, 'success', `Dong bo ngay ${dateKey}: ${count} camp`);
      } catch (error) {
        errors.push({ accountId: String(account._id), accountName: account.name, date: dateKey, error: error.message });
        await addLog(account._id, account.name, 'error', `Loi dong bo ngay ${dateKey}: ${error.message}`);
      }

      completedSteps += 1;
      if (completedSteps < totalSteps && CAMPAIGN_SYNC_DAY_DELAY_MS > 0) {
        await sleep(CAMPAIGN_SYNC_DAY_DELAY_MS);
      }
    }
  }

  const result = {
    state: errors.length ? 'completed_with_errors' : 'completed',
    accountId: accountId ? String(accounts[0]._id) : '',
    accountName: accountId ? accounts[0].name : 'Tat ca tai khoan',
    totalAccounts: accounts.length,
    completedAccounts: accounts.length,
    fromDate,
    toDate,
    totalDays: dates.length,
    completedDays: dates.length,
    currentDay: '',
    percent: 100,
    syncedRows,
    errors,
    message: errors.length ? 'Dong bo xong nhung co loi' : 'Dong bo xong',
    finishedAt: new Date().toISOString()
  };

  if (onProgress) await onProgress(result);
  return result;
}

async function ensureDefaultUsers() {
  for (const item of DEFAULT_LOGIN_USERS) {
    const username = String(item.username || '').trim().toLowerCase();
    if (!username) continue;
    const existing = await User.findOne({ username }).select('_id').lean();
    if (existing) continue;
    await User.create({
      username,
      displayName: item.displayName || username,
      passwordHash: hashPassword(item.password),
      provider: item.provider || 'facebook',
      active: true
    });
  }
}

async function migrateLegacyAccountsToDefaultUser() {
  const admin = await User.findOne({ username: 'admin' }).select('_id').lean();
  if (!admin) return;
  await Account.updateMany(
    { $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: null }] },
    { $set: { ownerUserId: admin._id } }
  );
}

async function syncFinalSpendForDate(dateKey = dateKeyFromVnOffset(-1)) {
  if (finalSpendSyncRunning) {
    console.log(`Final spend sync skipped for ${dateKey}: previous run still active`);
    return { skipped: true, date: dateKey };
  }

  finalSpendSyncRunning = true;
  let syncedAccounts = 0;
  let failedAccounts = 0;
  let syncedRows = 0;

  try {
    const accounts = await Account.find(buildAccountProviderFilter('facebook'));
    console.log(`Final spend sync: closing ${dateKey} for ${accounts.length} Facebook accounts`);

    for (const account of accounts) {
      try {
        const count = await syncAccountHistoricalData(account, dateKey, dateKey, { prune: true });
        syncedRows += count;
        syncedAccounts += 1;
        await addLog(account._id, account.name, 'success', `Chot chi tieu ngay ${dateKey}: ${count} camp`);
      } catch (error) {
        failedAccounts += 1;
        await addLog(account._id, account.name, 'error', `Loi chot chi tieu ngay ${dateKey}: ${error.message}`);
      }
    }

    console.log(`Final spend sync finished for ${dateKey}: accounts=${syncedAccounts}, rows=${syncedRows}, failed=${failedAccounts}`);
    return { ok: true, date: dateKey, syncedAccounts, failedAccounts, syncedRows };
  } finally {
    finalSpendSyncRunning = false;
  }
}

function startFinalSpendCron() {
  if (!cron.validate(FINAL_SPEND_CRON)) {
    console.warn(`Invalid FINAL_SPEND_CRON "${FINAL_SPEND_CRON}", final spend cron disabled`);
    return null;
  }

  const task = cron.schedule(FINAL_SPEND_CRON, async () => {
    try {
      await syncFinalSpendForDate(dateKeyFromVnOffset(-1));
    } catch (error) {
      console.error(`Final spend cron failed: ${error.message}`);
    }
  }, { timezone: FINAL_SPEND_TIMEZONE });

  console.log(`Final spend cron scheduled: ${FINAL_SPEND_CRON} (${FINAL_SPEND_TIMEZONE})`);
  return task;
}
app.post('/api/campaigns/sync-history', async (req, res) => {
  try {
    const { fromDate, toDate, provider, accountId } = req.body;
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Thieu fromDate hoac toDate' });
    }
    if (accountId && !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ error: 'Tai khoan dong bo khong hop le' });
    }

    const dates = assertPastCampaignSyncRange(fromDate, toDate);
    const payload = {
      fromDate,
      toDate,
      provider: normalizeProvider(provider),
      ownerUserId: req.currentUser._id,
      totalDays: dates.length
    };
    if (accountId) payload.accountId = accountId;

    if (campaignSyncQueue && req.body?.queue === true) {
      const job = await campaignSyncQueue.add('sync-history', payload);
      startCampaignSyncWorker();

      return res.status(202).json({
        ok: true,
        queued: true,
        queue: CAMPAIGN_SYNC_QUEUE_NAME,
        jobId: String(job.id),
        statusUrl: `/api/campaigns/sync-history/${job.id}`,
        message: 'Dang dong bo trong nen'
      });
    }

    const result = await processCampaignSyncHistoryJob(payload);
    res.json({ ok: true, queued: false, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/campaigns/sync-history/:jobId', async (req, res) => {
  try {
    if (!campaignSyncQueue) {
      return res.status(404).json({ error: 'Campaign sync queue is not enabled' });
    }

    const job = await campaignSyncQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job dong bo' });

    const state = await job.getState();
    const progress = typeof job.progress === 'object' && job.progress !== null ? job.progress : {};
    const returnvalue = job.returnvalue || {};
    const failedJob = state === 'failed';
    const payload = {
      id: String(job.id),
      state: failedJob ? 'failed' : (returnvalue.state || progress.state || state),
      accountId: progress.accountId || returnvalue.accountId || job.data.accountId,
      accountName: progress.accountName || returnvalue.accountName || '',
      totalAccounts: progress.totalAccounts || returnvalue.totalAccounts || 0,
      completedAccounts: progress.completedAccounts || returnvalue.completedAccounts || 0,
      fromDate: progress.fromDate || returnvalue.fromDate || job.data.fromDate,
      toDate: progress.toDate || returnvalue.toDate || job.data.toDate,
      totalDays: progress.totalDays || returnvalue.totalDays || job.data.totalDays || 0,
      completedDays: progress.completedDays || returnvalue.completedDays || 0,
      currentDay: progress.currentDay || returnvalue.currentDay || '',
      percent: progress.percent || returnvalue.percent || 0,
      syncedRows: progress.syncedRows || returnvalue.syncedRows || 0,
      errors: progress.errors || returnvalue.errors || [],
      message: failedJob ? (job.failedReason || 'Dong bo loi') : (progress.message || returnvalue.message || state),
      error: failedJob ? job.failedReason : '',
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : '',
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : '',
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : (returnvalue.finishedAt || '')
    };

    res.json({ ok: true, job: payload });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/finalize-day', async (req, res) => {
  try {
    const dateKey = normalizeCampaignDate(req.body.date || dateKeyFromVnOffset(-1));
    const result = await syncFinalSpendForDate(dateKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/export-spending', async (req, res) => {
  try {
    const { fromDate, toDate, provider } = req.query;
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Thieu fromDate hoac toDate' });
    }

    const filter = {
      date: { $gte: fromDate, $lte: toDate }
    };

    const accountFilter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const accounts = await Account.find(accountFilter).select('_id');
    filter.accountId = { $in: accounts.map(a => a._id) };

    const campaigns = await Campaign.find(filter)
      .populate('accountId', 'name adAccountId')
      .sort({ date: 1, spend: -1 })
      .lean();

    if (!campaigns.length) {
      return res.status(404).json({ error: 'Khong co du lieu trong khoang thoi gian nay' });
    }

    const rows = campaigns.map(c => ({
      'Ngay': c.date,
      'ID TKQC': c.accountId?.adAccountId || 'N/A',
      'Ten TKQC': c.accountId?.name || 'N/A',
      'ID Campaign': c.campaignId,
      'Ten Campaign': c.name,
      'Chi tieu': c.spend,
      'Tin nhan': c.messages,
      'Gia/TN': c.costPerMessage,
      'Clicks': c.clicks,
      'Hien thi': c.impressions
    }));

    const header = Object.keys(rows[0]).join(',');
    const csvContent = rows.map(row =>
      Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const csv = `\ufeff${header}\n${csvContent}`; // BOM for UTF-8 Excel support

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=spending_report_${fromDate}_to_${toDate}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const { accountId, provider, limit = 100 } = req.query;
    const accountFilter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    if (accountId) accountFilter._id = accountId;
    const accountIds = (await Account.find(accountFilter).select('_id').lean()).map(account => account._id);
    const query = { accountId: { $in: accountIds } };
    const safeLimit = parseBoundedInt(limit, 100, 1, 500);
    const logs = await Log.find(query).sort('-createdAt').limit(safeLimit).lean();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/logs', async (req, res) => {
  try {
    const { accountId, provider } = req.query;
    const accountFilter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    if (accountId) accountFilter._id = accountId;
    const accountIds = (await Account.find(accountFilter).select('_id').lean()).map(account => account._id);
    const query = { accountId: { $in: accountIds } };
    await Log.deleteMany(query);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-token', async (req, res) => {
  try {
    const { fbToken } = req.body;
    if (!fbToken) return res.status(400).json({ error: 'Thieu token' });

    const me = await fbGet(fbToken, 'me', { fields: 'name,id' });
    res.json({ ok: true, name: me.name, id: me.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/webhooks/pancake', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Pancake Webhook payload:', JSON.stringify(payload, null, 2));

    // Pancake webhook structure usually has event type and data
    // Fallback to simple extraction if exact structure is unknown
    const orderData = payload.data || payload || {};
    const orderId = orderData.id || orderData.order_id || `temp_${Date.now()}`;
    const status = orderData.status || payload.event || 'unknown';

    const newOrder = await Order.findOneAndUpdate(
      { orderId: String(orderId) },
      {
        status: String(status),
        customerName: orderData.customer_name || orderData.customer?.name || '',
        totalPrice: Number(orderData.total_price || orderData.total || 0),
        rawData: payload,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, message: 'Webhook processed successfully', orderId: newOrder.orderId });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const wantsPaged = req.query.page !== undefined || req.query.limit !== undefined;

    if (useSheetOrders()) {
      const orders = await getOrderSheetOrders({ fromDate, toDate });
      if (wantsPaged) {
        const total = orders.length;
        const start = (page - 1) * limit;
        res.json({
          ok: true,
          orders: orders.slice(start, start + limit),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1
        });
        return;
      }
      res.json(orders);
      return;
    }

    const query = buildOrderQuery({ fromDate, toDate });
    if (wantsPaged) {
      const [orders, total] = await Promise.all([
        Order.find(query)
          .select('orderId status rawData createdAt')
          .sort('-createdAt')
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Order.countDocuments(query)
      ]);
      res.json({ ok: true, orders, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
      return;
    }

    const orders = await Order.find(query)
      .select('orderId status rawData createdAt')
      .sort('-createdAt')
      .limit(200000)
      .lean();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/sku-counts', async (req, res) => {
  try {
    const fromDate = req.query.fromDate || todayStr();
    const { toDate } = req.query;
    const cacheKey = useSheetOrders() ? getOrderStatsCacheKey({ fromDate, toDate }) : '';

    if (cacheKey && orderStatsCache.has(cacheKey)) {
      res.json({ ok: true, ...orderStatsCache.get(cacheKey), cached: true });
      return;
    }

    const allOrders = useSheetOrders()
      ? await getOrderSheetOrders({ fromDate, toDate, limit: 200000 })
      : await Order.find(buildOrderQuery({ fromDate, toDate })).select('rawData orderId status').lean();

    const stats = buildOrderSkuStats(allOrders);
    if (cacheKey) {
      orderStatsCache.set(cacheKey, stats);
      if (orderStatsCache.size > 50) {
        const oldestKey = orderStatsCache.keys().next().value;
        orderStatsCache.delete(oldestKey);
      }
    }

    res.json({ ok: true, ...stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Đồng bộ đơn hàng từ Google Sheet ──

app.get('/api/inventory', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const filter = withUserFilter(req);
    const term = String(search || '').trim();

    if (term) {
      const regex = new RegExp(escapeRegExp(term), 'i');
      filter.$or = [{ barcode: regex }, { name: regex }];
    }

    const items = await InventoryItem.find(filter)
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ ok: true, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/summary', async (req, res) => {
  try {
    const googleAccessToken = await getGoogleAccessToken(req);
    const [rows, pendingCounts] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(googleAccessToken),
      buildInventoryPendingOrderCounts()
    ]);

    const grouped = new Map();
    for (const row of rows) {
      const rawBarcode = String(row.barcode || '').trim();
      if (!rawBarcode) continue;

      const productCode = extractInventoryProductCode(rawBarcode);
      const key = productCode || rawBarcode;
      if (!grouped.has(key)) {
        grouped.set(key, {
          productCode: key,
          totalQuantity: 0,
          pendingQuantity: pendingCounts.byCode.get(key) || 0,
          variants: 0,
          warehouses: new Set(),
          barcodes: [],
          names: new Set(),
          salePrices: new Set(),
          updatedAt: null
        });
      }

      const current = grouped.get(key);
      current.totalQuantity += Number(row.quantity || 0);
      current.variants += 1;
      if (row.warehouseName) current.warehouses.add(String(row.warehouseName).trim());
      if (rawBarcode) current.barcodes.push(rawBarcode);
      if (row.name) current.names.add(String(row.name).trim());
      if (row.salePrice) current.salePrices.add(String(row.salePrice).trim());
    }

    const itemsSummary = Array.from(grouped.values())
      .map(item => ({
        productCode: item.productCode,
        totalQuantity: item.totalQuantity,
        pendingQuantity: item.pendingQuantity,
        variants: item.variants,
        warehouseCount: item.warehouses.size,
        warehouses: Array.from(item.warehouses).sort(),
        name: Array.from(item.names)[0] || '',
        salePrice: Array.from(item.salePrices)[0] || '',
        updatedAt: item.updatedAt,
        barcodes: item.barcodes.sort()
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity || a.productCode.localeCompare(b.productCode));

    res.json({
      ok: true,
      totalCodes: itemsSummary.length,
      totalQuantity: itemsSummary.reduce((sum, item) => sum + Number(item.totalQuantity || 0), 0),
      items: itemsSummary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/summary/export', async (req, res) => {
  try {
    const googleAccessToken = await getGoogleAccessToken(req);
    const [rows, pendingCounts] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(googleAccessToken),
      buildInventoryPendingOrderCounts()
    ]);

    const grouped = new Map();
    for (const row of rows) {
      const rawBarcode = String(row.barcode || '').trim();
      if (!rawBarcode) continue;

      const productCode = extractInventoryProductCode(rawBarcode);
      const key = productCode || rawBarcode;
      if (!grouped.has(key)) {
        grouped.set(key, {
          productCode: key,
          totalQuantity: 0,
          pendingQuantity: pendingCounts.byCode.get(key) || 0,
          warehouses: new Set(),
          names: new Set(),
          salePrices: new Set()
        });
      }

      const current = grouped.get(key);
      current.totalQuantity += Number(row.quantity || 0);
      if (row.warehouseName) current.warehouses.add(String(row.warehouseName).trim());
      if (row.name) current.names.add(String(row.name).trim());
      if (row.salePrice) current.salePrices.add(String(row.salePrice).trim());
    }

    const itemsSummary = Array.from(grouped.values())
      .map(item => ({
        name: Array.from(item.names)[0] || '',
        productCode: item.productCode,
        totalQuantity: item.totalQuantity,
        pendingQuantity: item.pendingQuantity,
        warehouses: Array.from(item.warehouses).sort().join(', '),
        salePrice: Array.from(item.salePrices)[0] || ''
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity || a.productCode.localeCompare(b.productCode));

    const header = ['Ten hang', 'Ma SP', 'So luong ton', 'So luong chot', 'Kho', 'Gia sale'];
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvContent = itemsSummary.map(item => ([
      escapeCsv(item.name),
      escapeCsv(item.productCode),
      item.totalQuantity,
      item.pendingQuantity,
      escapeCsv(item.warehouses),
      escapeCsv(item.salePrice)
    ].join(',')));
    const totalQuantity = itemsSummary.reduce((sum, item) => sum + Number(item.totalQuantity || 0), 0);
    const totalPendingQuantity = itemsSummary.reduce((sum, item) => sum + Number(item.pendingQuantity || 0), 0);
    const totalRow = [
      escapeCsv('Tong cong'),
      escapeCsv(''),
      totalQuantity,
      totalPendingQuantity,
      escapeCsv(''),
      escapeCsv('')
    ].join(',');
    const csv = `\ufeff${header.join(',')}\n${csvContent.join('\n')}\n${totalRow}`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_summary_${todayStr()}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/scan-summary', async (req, res) => {
  try {
    const fromDate = normalizeCampaignDate(req.query.fromDate || todayStr());
    const toDate = normalizeCampaignDate(req.query.toDate || fromDate);
    const fromRange = buildVnDateRange(fromDate);
    const toRange = buildVnDateRange(toDate);

    const items = await InventoryItem.find(withUserFilter(req))
      .select('barcode scans')
      .lean();

    const totalsByBarcode = {};
    let totalScannedQuantity = 0;

    for (const item of items) {
      const barcode = String(item.barcode || '').trim();
      if (!barcode || !Array.isArray(item.scans)) continue;

      let barcodeTotal = 0;
      for (const scan of item.scans) {
        const scannedAt = new Date(scan?.scannedAt || 0);
        if (Number.isNaN(scannedAt.getTime())) continue;
        if (scannedAt < fromRange.startUtc || scannedAt >= toRange.endUtc) continue;
        const quantity = Number(scan?.quantity || 0);
        if (!Number.isFinite(quantity) || quantity === 0) continue;
        barcodeTotal += quantity;
      }

      if (barcodeTotal !== 0) {
        totalsByBarcode[barcode] = barcodeTotal;
        totalScannedQuantity += barcodeTotal;
      }
    }

    res.json({
      ok: true,
      fromDate,
      toDate,
      totalScannedQuantity,
      totalsByBarcode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/sheet-rows', async (req, res) => {
  try {
    const googleAccessToken = await getGoogleAccessToken(req);
    const [rows, pendingCounts] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(googleAccessToken),
      buildInventoryPendingOrderCounts()
    ]);
    const search = String(req.query.search || '').trim().toLowerCase();
    const warehouse = String(req.query.warehouse || '').trim().toLowerCase();
    const filteredRows = rows
      .filter(row => (
        !search || (
          String(row.barcode || '').toLowerCase().includes(search) ||
          String(row.name || '').toLowerCase().includes(search) ||
          String(row.warehouseName || '').toLowerCase().includes(search)
        )
      ))
      .filter(row => (
        !warehouse || String(row.warehouseName || '').toLowerCase().includes(warehouse)
      ))
      .map(row => {
        const identity = parseInventorySheetIdentity(row.barcode || row.name || '');
        const pendingQuantity = identity.productCode
          ? (identity.size
              ? (pendingCounts.byCodeSize.get(`${identity.productCode}\u0000${identity.size}`) || 0)
              : (pendingCounts.byCode.get(identity.productCode) || 0))
          : 0;
        return { ...row, pendingQuantity };
      });

    res.json({ ok: true, rows: filteredRows, total: filteredRows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/scan', async (req, res) => {
  try {
    const barcode = normalizeBarcode(req.body?.barcode);
    const quantity = parseBoundedInt(req.body?.quantity, 1, 1, 100000);
    const name = String(req.body?.name || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!barcode) return res.status(400).json({ error: 'Thieu ma vach' });

    const now = new Date();
    const setFields = { updatedAt: now };
    if (name) setFields.name = name;
    if (req.body?.salePrice !== undefined) setFields.salePrice = String(req.body.salePrice || '').trim();
    const insertFields = { createdAt: now };
    if (!name) insertFields.name = '';

    const item = await InventoryItem.findOneAndUpdate(
      withUserFilter(req, { barcode }),
      {
        $inc: { quantity },
        $set: setFields,
        $setOnInsert: insertFields,
        $push: {
          scans: {
            $each: [{ quantity, note, scannedAt: now }],
            $slice: -50
          }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ ok: true, item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/import-sheet', async (req, res) => {
  try {
    let sheetItems = [];
    let source = 'public';
    try {
      const googleAccessToken = await getGoogleAccessToken(req);
      sheetItems = await fetchInventorySheetItemsWithGoogleAccess(googleAccessToken, { refresh: true });
      source = 'google_oauth';
    } catch (googleError) {
      if (
        !/google|token|scope|permission|access|sheet/i.test(String(googleError.message || '')) &&
        googleError.response?.status !== 401 &&
        googleError.response?.status !== 403
      ) {
        throw googleError;
      }
      sheetItems = await fetchInventorySheetItems();
    }

    const now = new Date();
    const sheetBarcodes = new Set(sheetItems.map(item => String(item.barcode || '').trim()).filter(Boolean));
    const operations = sheetItems.map(item => ({
        updateOne: {
          filter: withUserFilter(req, { barcode: item.barcode }),
          update: {
            $set: {
              warehouseName: item.warehouseName || '',
              name: item.name || '',
              salePrice: item.salePrice || '',
              sheetRowNumbers: Array.isArray(item.rowNumbers) ? item.rowNumbers : (item.rowNumber ? [item.rowNumber] : []),
              quantity: item.quantity,
              updatedAt: now
          },
          $setOnInsert: { createdAt: now }
        },
        upsert: true
      }
    }));

    if (operations.length) {
      await InventoryItem.bulkWrite(operations, { ordered: false });
    }

    const deleteFilter = withUserFilter(req, sheetBarcodes.size
      ? { barcode: { $nin: Array.from(sheetBarcodes) } }
      : {});
    const deleteResult = await InventoryItem.deleteMany(deleteFilter);

    const items = await InventoryItem.find(withUserFilter(req))
      .sort({ updatedAt: -1 })
      .limit(1000)
      .lean();

    res.json({
      ok: true,
      imported: sheetItems.length,
      deleted: deleteResult.deletedCount || 0,
      source,
      items
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/price-by-code', async (req, res) => {
  try {
    const productCode = normalizeInventoryProductCode(req.body?.productCode);
    const salePrice = String(req.body?.salePrice || '').trim();
    if (!productCode) {
      return res.status(400).json({ error: 'Thieu ma san pham' });
    }

    const inventoryItems = await InventoryItem.find(withUserFilter(req))
      .select('_id barcode sheetRowNumbers')
      .lean();
    const matchedItems = inventoryItems
      .filter(item => extractInventoryProductCode(item.barcode) === productCode);
    const matchedIds = matchedItems.map(item => item._id);

    if (!matchedIds.length) {
      return res.status(404).json({ error: 'Khong tim thay san pham theo ma nay' });
    }

    const now = new Date();
    await syncInventorySalePriceToSheet(req, matchedItems, salePrice);

    await InventoryItem.updateMany(
      withUserFilter(req, { _id: { $in: matchedIds } }),
      { $set: { salePrice, updatedAt: now } }
    );

    const items = await InventoryItem.find(withUserFilter(req, { _id: { $in: matchedIds } }))
      .sort({ barcode: 1 })
      .lean();

    res.json({ ok: true, updated: items.length, productCode, salePrice, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/inventory/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID san pham khong hop le' });
    }

    const currentItem = await InventoryItem.findOne(withUserFilter(req, { _id: req.params.id }))
      .lean();
    if (!currentItem) return res.status(404).json({ error: 'Khong tim thay san pham trong kho' });

    const update = { updatedAt: new Date() };
    if (req.body?.name !== undefined) update.name = String(req.body.name || '').trim();
    if (req.body?.salePrice !== undefined) update.salePrice = String(req.body.salePrice || '').trim();
    if (req.body?.quantity !== undefined) update.quantity = parseBoundedInt(req.body.quantity, 0, 0, 100000000);

    if (
      req.body?.salePrice !== undefined &&
      String(update.salePrice || '') !== String(currentItem.salePrice || '')
    ) {
      await syncInventorySalePriceToSheet(req, [currentItem], update.salePrice);
    }

    const item = await InventoryItem.findOneAndUpdate(
      withUserFilter(req, { _id: req.params.id }),
      { $set: update },
      { new: true }
    ).lean();

    res.json({ ok: true, item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID san pham khong hop le' });
    }

    const result = await InventoryItem.deleteOne(withUserFilter(req, { _id: req.params.id }));
    if (!result.deletedCount) return res.status(404).json({ error: 'Khong tim thay san pham trong kho' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/sync', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    if (orderSheetSyncQueue && req.body?.queue === true) {
      const job = await orderSheetSyncQueue.add('sync-sheet', { fromDate, toDate });
      return res.status(202).json({
        ok: true,
        queued: true,
        queue: ORDER_SHEET_SYNC_QUEUE_NAME,
        jobId: String(job.id),
        statusUrl: `/api/orders/sync/${job.id}`,
        message: 'Dang tai don hang trong nen'
      });
    }

    const rows = await fetchOrderSheetRows({ refresh: true });
    const orders = rows
      .filter(row => {
        if (fromDate && row.dateKey < fromDate) return false;
        if (toDate && row.dateKey > toDate) return false;
        return true;
      })
      .map(({ dateKey, ...order }) => order);
    res.json({ success: true, synced: orders.length, source: 'google_sheet', cachedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Lỗi tải đơn từ Google Sheet:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/sync/:jobId', async (req, res) => {
  try {
    if (!orderSheetSyncQueue) {
      return res.status(404).json({ error: 'Order sheet sync queue is not enabled' });
    }

    const job = await orderSheetSyncQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job tai don hang' });

    const state = await job.getState();
    const progress = typeof job.progress === 'object' && job.progress !== null ? job.progress : {};
    const returnvalue = job.returnvalue || {};
    const failedJob = state === 'failed';
    const payload = {
      id: String(job.id),
      state: failedJob ? 'failed' : (returnvalue.state || progress.state || state),
      source: returnvalue.source || progress.source || 'google_sheet',
      fromDate: returnvalue.fromDate || progress.fromDate || job.data.fromDate || '',
      toDate: returnvalue.toDate || progress.toDate || job.data.toDate || '',
      totalRows: returnvalue.totalRows || progress.totalRows || 0,
      synced: returnvalue.synced || progress.synced || 0,
      percent: returnvalue.percent || progress.percent || 0,
      message: failedJob ? (job.failedReason || 'Tai don hang loi') : (returnvalue.message || progress.message || state),
      error: failedJob ? job.failedReason : '',
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : '',
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : '',
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : (returnvalue.cachedAt || '')
    };

    res.json({ ok: true, job: payload });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Pages & Posts (for campaign creation) ──

registerPageRoutes(app, {
  axios,
  FacebookPost,
  User,
  getAppConfig,
  fbGet,
  escapeRegExp,
  normalizeProvider,
  POSTS_PER_PAGE_LIMIT,
  SHOPEE_POSTS_PER_PAGE_LIMIT,
  ALL_POSTS_MAX_LIMIT,
  META_POST_REQUEST_LIMIT
});
async function cleanupCampaignDailyDuplicates() {
  const duplicateGroups = await Campaign.aggregate([
    { $match: { date: { $type: 'string' } } },
    { $sort: { updatedAt: -1, _id: -1 } },
    {
      $group: {
        _id: { accountId: '$accountId', campaignId: '$campaignId', date: '$date' },
        ids: { $push: '$_id' },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  const duplicateIds = duplicateGroups.flatMap(group => group.ids.slice(1));
  if (!duplicateIds.length) return;

  const result = await Campaign.deleteMany({ _id: { $in: duplicateIds } });
  console.log(`Removed ${result.deletedCount} duplicate campaign daily records`);
}

async function ensureCampaignDailyStorage() {
  const campaignsCollection = mongoose.connection.collection('campaigns');
  let indexes = [];
  try {
    indexes = await campaignsCollection.indexes();
  } catch (error) {
    if (error?.codeName !== 'NamespaceNotFound') throw error;
  }
  const hasDailyUniqueIndex = indexes.some(index => index.name === 'campaign_daily_unique');

  try {
    await campaignsCollection.dropIndex('campaign_id_1');
    console.log('Dropped legacy index: campaign_id_1');
  } catch (e) {
    // Index might not exist, that's fine.
  }

  if (!hasDailyUniqueIndex) {
    await cleanupCampaignDailyDuplicates();
  }
  await Campaign.createIndexes();
  console.log('Campaign daily indexes ready');
}

async function ensureApplicationIndexes() {
  await Promise.all([
    Account.createIndexes(),
    Log.createIndexes(),
    Order.createIndexes(),
    InventoryItem.createIndexes(),
    FacebookPost.createIndexes(),
    Config.createIndexes()
  ]);
  console.log('Application indexes ready');
}

async function migrateLegacyAccountProviders() {
  const result = await Account.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { provider: null },
        { provider: '' }
      ]
    },
    { $set: { provider: 'facebook' } }
  );

  if (result.modifiedCount) {
    console.log(`Migrated ${result.modifiedCount} legacy accounts to provider=facebook`);
  }
}

function renderPublicPolicyPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #102033; line-height: 1.6; margin: 0; background: #f6f8fb; }
      main { max-width: 760px; margin: 40px auto; padding: 32px; background: #fff; border: 1px solid #d8e1ec; border-radius: 8px; }
      h1 { margin-top: 0; font-size: 28px; }
      h2 { margin-top: 28px; font-size: 18px; }
      a { color: #1664d9; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      ${body}
      <p><strong>Last updated:</strong> May 1, 2026</p>
    </main>
  </body>
</html>`;
}

app.get('/privacy-policy', (req, res) => {
  res.type('html').send(renderPublicPolicyPage({
    title: 'Privacy Policy',
    body: `
      <p>ads-systems uses Meta APIs to help authorized users manage advertising accounts, campaigns, pages, posts, and related performance data.</p>
      <h2>Information We Access</h2>
      <p>When you connect Facebook, we may access information authorized by you through Meta permissions, including profile information, ad account data, campaign data, page data, post data, and performance insights.</p>
      <h2>How We Use Information</h2>
      <p>We use this information only to provide app functionality such as campaign reporting, campaign creation, campaign status updates, and ad performance monitoring.</p>
      <h2>Sharing</h2>
      <p>We do not sell user data. We do not share user data with third parties except where required to operate the app or comply with law.</p>
      <h2>Data Deletion</h2>
      <p>You can request deletion of app-related data by following our <a href="/data-deletion">User Data Deletion Instructions</a>.</p>
    `
  }));
});

app.get('/data-deletion', (req, res) => {
  res.type('html').send(renderPublicPolicyPage({
    title: 'User Data Deletion Instructions',
    body: `
      <p>If you want to delete data associated with ads-systems, remove the app from your Facebook account and contact the app administrator.</p>
      <h2>Remove the App from Facebook</h2>
      <ol>
        <li>Go to Facebook Settings & Privacy.</li>
        <li>Open Settings.</li>
        <li>Go to Apps and Websites.</li>
        <li>Find ads-systems.</li>
        <li>Select Remove to disconnect the app.</li>
      </ol>
      <h2>Request Data Deletion</h2>
      <p>To request deletion of data stored by this app, contact the app administrator and include your Facebook name, Facebook user ID if available, and the ad account or page connected to the app.</p>
      <p>We will delete related app data unless retention is required by law or operational records are needed for security and audit purposes.</p>
    `
  }));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager';
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGO_URI).then(() => {
  console.log('MongoDB connected');
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

  (async () => {
    try {
      await ensureDefaultUsers();
      await migrateLegacyAccountsToDefaultUser();
      await migrateLegacyAccountProviders();
      await ensureCampaignDailyStorage();
      await ensureApplicationIndexes();
    } catch (error) {
      console.error(`Startup storage maintenance failed: ${error.message}`);
    }

    try {
      await bootstrapFacebookTokenFromEnv();
    } catch (error) {
      await sendTokenAlert('Facebook token environment bootstrap failed', { error: error.message });
    }

    facebookTokenCronTask = startFacebookTokenCron();
    finalSpendCronTask = startFinalSpendCron();
    startTodayCampaignSpendSync();
    redisQueueAvailable = await checkRedisAvailable();
    initCampaignDuplicateQueue();
    initCampaignSyncQueue();
    initOrderSheetSyncQueue();
    startOrderSheetSyncWorker();

    const autoAccounts = await Account.find({ autoEnabled: true });
    for (const account of autoAccounts) {
      console.log(`Resuming auto for: ${account.name}`);
      startAccountScheduler(account);
    }
  })().catch(error => {
    console.error(`Background startup failed: ${error.message}`);
  });

  // Background: Refresh cache đơn hàng từ Google Sheet mỗi 5 phút
  let sheetRefreshRunning = false;
  const sheetRefreshInitial = async () => {
    try {
      console.log('Sheet Cache: Khởi tạo cache đơn hàng từ Google Sheet...');
      if (orderSheetSyncQueue) {
        await orderSheetSyncQueue.add('sync-sheet', {}, { jobId: 'startup-order-sheet-sync' });
      } else {
        await fetchOrderSheetRows({ refresh: true });
      }
      console.log(`Sheet Cache: Đã tải ${ordersSheetCache.rows?.length || 0} dòng đơn hàng.`);
    } catch (err) {
      console.error('Sheet Cache: Lỗi tải lần đầu:', err.message);
    }
  };
  sheetRefreshInitial();

  sheetRefreshTimer = setInterval(async () => {
    if (isShuttingDown || sheetRefreshRunning) return;
    sheetRefreshRunning = true;
    try {
      console.log('Sheet Cache: Đang refresh đơn hàng từ Google Sheet...');
      if (orderSheetSyncQueue) {
        await orderSheetSyncQueue.add('sync-sheet', {}, {
          jobId: `order-sheet-sync-${Math.floor(Date.now() / (5 * 60 * 1000))}`
        });
      } else {
        await fetchOrderSheetRows({ refresh: true });
      }
      console.log(`Sheet Cache: Đã cập nhật ${ordersSheetCache.rows?.length || 0} dòng.`);
    } catch (err) {
      console.error('Sheet Cache: Lỗi refresh:', err.message);
    } finally {
      sheetRefreshRunning = false;
    }
  }, 5 * 60 * 1000);

}).catch(error => {
  console.error('MongoDB error:', error.message);
  process.exit(1);
});

async function gracefulShutdown(signal) {
  console.log(`Shutting down gracefully (${signal})...`);
  isShuttingDown = true;
  if (facebookTokenCronTask) {
    facebookTokenCronTask.stop();
  }
  if (finalSpendCronTask) {
    finalSpendCronTask.stop();
  }
  if (todayCampaignSpendSyncTimer) {
    clearInterval(todayCampaignSpendSyncTimer);
  }
  if (sheetRefreshTimer) {
    clearInterval(sheetRefreshTimer);
  }
  if (campaignDuplicateWorker) {
    await campaignDuplicateWorker.close();
  }
  if (campaignDuplicateQueue) {
    await campaignDuplicateQueue.close();
  }
  if (campaignSyncWorker) {
    await campaignSyncWorker.close();
  }
  if (campaignSyncQueue) {
    await campaignSyncQueue.close();
  }
  if (orderSheetSyncWorker) {
    await orderSheetSyncWorker.close();
  }
  if (orderSheetSyncQueue) {
    await orderSheetSyncQueue.close();
  }
  await Promise.all(redisConnections.map(connection => connection.quit().catch(() => connection.disconnect())));
  for (const accountId in accountTimers) {
    stopAccountScheduler(accountId);
  }
  const waitForRuns = Object.keys(accountRuns).length
    ? new Promise(resolve => setTimeout(resolve, 1500))
    : Promise.resolve();
  await waitForRuns;
  await mongoose.connection.close();
  process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT').catch(error => {
  console.error('Graceful shutdown failed:', error.message);
  process.exit(1);
}));

process.once('SIGTERM', () => gracefulShutdown('SIGTERM').catch(error => {
  console.error('Graceful shutdown failed:', error.message);
  process.exit(1);
}));

