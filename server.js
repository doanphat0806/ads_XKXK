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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
function getVietnamDayMinute(date = new Date()) {
  const vnOffset = 7 * 60; // minutes
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + vnOffset) % (24 * 60);
}

function isVietnamTimeMinute(hour = 0, minute = 0, date = new Date()) {
  return getVietnamDayMinute(date) === (hour * 60 + minute);
}

function isWithinAutoRuleTimeWindow(startTime, endTime) {
  const vnMinutes = getVietnamDayMinute();

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
const DataPurchaseOrder = require('./models/DataPurchaseOrder');
const PurchaseOrder = require('./models/PurchaseOrder');
const ShopeeCommission = require('./models/ShopeeCommission');
const {
  buildOrderQuery,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  useSheetOrders,
  normalizeStatusKey,
  buildOrderSkuStats,
  buildOrderTableStats,
  buildReturnSummaryOrderStats,
  buildReturnProductRateStats,
  classifyReturnAdNameBucket,
  RETURN_SUMMARY_BUCKETS,
  fetchOrderSheetRows,
  getOrderSheetPage,
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
  getDataPurchaseOrders,
  importDataPurchaseOrdersFromCsvText,
  syncDataPurchaseOrdersFromSheet
} = require('./services/dataPurchaseOrderSheetService');
const {
  getPurchaseOrderDashboard,
  getPurchaseOrders,
  importPurchaseOrderStatusesFromCsvText,
  updatePurchaseOrderDashboardCancellation,
  updatePurchaseOrderDashboardNote,
  updatePurchaseOrder
} = require('./services/purchaseOrderService');
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
const AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT = 60000;
const AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT = 15;
const AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT = 50000;
const SHOPEE_PAUSE_ROI_PERCENT = 10;
const SHOPEE_WARN_ROI_PERCENT = 15;
const SHOPEE_REACTIVATE_ROI_PERCENT = 15;
const SHOPEE_SCALE_ROI_PERCENT = 40;
const SHOPEE_STRONG_SCALE_ROI_PERCENT = 80;
const SHOPEE_PERFORMANCE_TOTAL_FROM_DATE = '2026-04-27';
const SHOPEE_REACTIVATE_CRON = '0 0 * * *';
const SCHEDULED_DUPLICATE_SCOPE_COOLDOWN_MS = 2 * 60 * 1000;

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

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
const PURCHASE_ORDER_READ_CACHE_TTL_MS = parseBoundedInt(process.env.PURCHASE_ORDER_READ_CACHE_TTL_MS, 60 * 1000, 5000, 10 * 60 * 1000);
const purchaseOrderReadCache = new Map();
const ACCOUNT_RATE_LIMIT_COOLDOWN_MS = parseBoundedInt(process.env.ACCOUNT_RATE_LIMIT_COOLDOWN_MS, 10 * 60 * 1000, 60 * 1000, 60 * 60 * 1000);
const AUTO_CHECK_MIN_INTERVAL_SECONDS = parseBoundedInt(process.env.AUTO_CHECK_MIN_INTERVAL_SECONDS, 180, 60, 60 * 60);
const accountRateLimitUntil = new Map();
const AUTH_TOKEN_TTL_MS = parseBoundedInt(process.env.AUTH_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000, 60 * 1000, 30 * 24 * 60 * 60 * 1000);
const AUTH_SECRET = String(process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.FB_APP_SECRET || 'adsctrl-local-auth-secret');
const DEFAULT_LOGIN_USERS = [
  { username: 'admin', password: process.env.USER_ADMIN_PASSWORD || 'admin', displayName: 'Admin', provider: 'facebook' },
  { username: 'admin1', password: process.env.USER_ADMIN1_PASSWORD || 'admin', displayName: 'Shopee Admin', provider: 'shopee' },
  { username: 'phat', password: process.env.USER_PHAT_PASSWORD || 'phat', displayName: 'Phat', provider: 'shopee' },
  { username: 'user2', password: process.env.USER2_PASSWORD || 'admin', displayName: 'User 2', provider: 'facebook' },
  { username: 'user3', password: process.env.USER3_PASSWORD || 'admin', displayName: 'User 3', provider: 'facebook' },
  { username: 'user4', password: process.env.USER4_PASSWORD || 'admin', displayName: 'User 4', provider: 'facebook' },
  { username: 'oder', password: 'oder', displayName: 'Order Staff', provider: 'oder' },
  { username: 'kho', password: process.env.USER_KHO_PASSWORD || 'kho', displayName: 'Kho Staff', provider: 'kho' }
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

const FB_ACTIVE_CAMPAIGN_STATUSES = new Set([
  'ACTIVE',
  'SCHEDULED',
  'PENDING_REVIEW',
  'PENDING_BILLING_INFO',
  'CAMPAIGN_PAUSED'
]);

function normalizeCampaignStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function isCampaignServingStatus(status) {
  return FB_ACTIVE_CAMPAIGN_STATUSES.has(normalizeCampaignStatus(status));
}

function clearAllReadCache() {
  readCache.clear();
}

function parseDelimitedRows(text = '', delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function detectCsvDelimiter(text = '') {
  const firstLine = String(text || '').split(/\r?\n/).find(line => line.trim()) || '';
  const counts = [
    { delimiter: ',', count: parseDelimitedRows(firstLine, ',')[0]?.length || 0 },
    { delimiter: ';', count: parseDelimitedRows(firstLine, ';')[0]?.length || 0 },
    { delimiter: '\t', count: parseDelimitedRows(firstLine, '\t')[0]?.length || 0 }
  ];
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function parseCsvRows(text = '') {
  return parseDelimitedRows(text, detectCsvDelimiter(text))
    .filter(row => row.some(cell => String(cell || '').trim()));
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

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

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

async function refreshGoogleAccessTokenWithConfig(user, config = {}) {
  if (!user?.googleRefreshToken) {
    throw new Error('Chua dang nhap Google hoac thieu refresh token');
  }

  const clientId = String(config.clientId || '').trim();
  const clientSecret = String(config.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Chua cau hinh GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET trong .env');
  }

  const response = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: user.googleRefreshToken,
    grant_type: 'refresh_token'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000
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

async function refreshGoogleAccessToken(user, req) {
  return refreshGoogleAccessTokenWithConfig(user, requireGoogleOAuthConfig(req));
}

async function getGoogleAccessTokenForUser(userId, config = {}) {
  const user = await User.findById(userId)
    .select('googleAccessToken googleRefreshToken googleTokenExpiresAt googleTokenScope')
    .lean();
  if (!user) throw new Error('Tai khoan khong hop le');

  const expiresAt = user.googleTokenExpiresAt ? new Date(user.googleTokenExpiresAt).getTime() : 0;
  if (user.googleAccessToken && expiresAt - Date.now() > 60 * 1000) {
    return user.googleAccessToken;
  }

  return refreshGoogleAccessTokenWithConfig(user, config);
}

async function getGoogleAccessToken(req) {
  return getGoogleAccessTokenForUser(req.currentUser._id, requireGoogleOAuthConfig(req));
}

async function getAdminDataOwnerUser() {
  const admin = await User.findOne({ username: 'admin', active: true }).select('_id').lean();
  if (!admin?._id) {
    throw new Error('Khong tim thay tai khoan admin de lay du lieu kho');
  }
  return admin;
}

async function getInventoryOwnerUserId(req) {
  if (normalizeProvider(req.currentUser?.provider) !== 'kho') {
    return req.currentUser?._id;
  }

  const admin = await getAdminDataOwnerUser();
  return admin._id;
}

function withInventoryOwnerFilter(ownerUserId, filter = {}) {
  return ownerUserId ? { ...filter, ownerUserId } : { ...filter };
}

async function getInventoryFilter(req, filter = {}) {
  return withInventoryOwnerFilter(await getInventoryOwnerUserId(req), filter);
}

async function getInventoryGoogleAccessToken(req) {
  return getGoogleAccessTokenForUser(await getInventoryOwnerUserId(req), requireGoogleOAuthConfig(req));
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

function getShopeeAutoMinSpendLimit(limits = {}) {
  const value = Number(limits?.autoPauseShopeeMinSpendLimit);
  return Number.isFinite(value) && value > 0
    ? value
    : AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT;
}

function mergeAutoConfig(globalConfig = {}, userConfig = {}) {
  const shopeeMinSpendLimit = pickDefinedValue(
    userConfig.autoPauseShopeeMinSpendLimit,
    globalConfig.autoPauseShopeeMinSpendLimit,
    AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT
  );

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
    autoPauseCpoLimit: pickDefinedValue(userConfig.autoPauseCpoLimit, globalConfig.autoPauseCpoLimit, AUTO_PAUSE_CPO_LIMIT),
    autoPauseZeroOrderSpendLimit: pickDefinedValue(userConfig.autoPauseZeroOrderSpendLimit, globalConfig.autoPauseZeroOrderSpendLimit, AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
    autoPauseShopeeMinSpendLimit: getShopeeAutoMinSpendLimit({ autoPauseShopeeMinSpendLimit: shopeeMinSpendLimit }),
    autoPauseShopeeHhAdsPercent: pickDefinedValue(userConfig.autoPauseShopeeHhAdsPercent, globalConfig.autoPauseShopeeHhAdsPercent, AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT)
  };
}

async function getUserAutoConfig(userId) {
  const [globalConfig, userConfig] = await Promise.all([
    getAppConfig(),
    userId ? User.findById(userId).select(
      'autoRuleStartTime autoRuleEndTime shopeeAutoRuleStartTime shopeeAutoRuleEndTime scheduledDuplicatePauseTime ' +
      'dailyZeroMessageSpendLimit dailyHighCostPerMessageLimit dailyHighCostSpendLimit ' +
      'dailyClickLimit dailyCpcLimit lifetimeZeroMessageSpendLimit lifetimeHighCostPerMessageLimit ' +
      'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit autoPauseZeroOrderSpendLimit autoPauseShopeeMinSpendLimit autoPauseShopeeHhAdsPercent'
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

function getPostObjectStoryId(post = {}) {
  const postId = String(post.postId || post.id || '').trim();
  if (postId.includes('_')) return postId;

  const pageId = getPostPageId(post);
  if (pageId && postId) return `${pageId}_${postId}`;
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

function combineAdNames(values = []) {
  const names = [];
  const seen = new Set();
  for (const value of values || []) {
    const rawNames = typeof value === 'string'
      ? value.split(/\s+\|\s+/)
      : [value?.name || ''];
    for (const rawName of rawNames) {
      const name = String(rawName || '').replace(/\s+/g, ' ').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names.join(' | ');
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

  const googleAccessToken = await getInventoryGoogleAccessToken(req);
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

function parseCampaignGender(value, defaultValue = 'all') {
  const normalized = String(value || defaultValue).trim().toLowerCase();
  if (normalized === 'male' || normalized === 'nam' || normalized === '1') return 'male';
  if (normalized === 'female' || normalized === 'nu' || normalized === 'nữ' || normalized === '2') return 'female';
  return 'all';
}

function getMetaGenderTargeting(value) {
  const gender = parseCampaignGender(value);
  if (gender === 'male') return [1];
  if (gender === 'female') return [2];
  return [];
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
  'pages_manage_posts',
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

async function fetchScheduledCampaignsByAccounts(token, accounts = [], options = {}) {
  const includeAccountInfo = options.includeAccountInfo === true;
  const existingCampaignIds = new Set(
    [...(options.existingCampaignIds || [])]
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const batchSize = parseBoundedInt(options.batchSize, 20, 1, 50);
  const batchConcurrency = parseBoundedInt(options.concurrency, 1, 1, 3);
  const chunks = chunkArray(accounts.filter(Boolean), batchSize);
  const chunkResults = await mapWithConcurrency(chunks, async (chunk) => {
    const batch = chunk.map(account => {
      const acctId = normalizeAdAccountId(account?.adAccountId || '');
      if (!acctId) return null;
      const params = new URLSearchParams({
        fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time',
        effective_status: JSON.stringify(['SCHEDULED']),
        limit: '100'
      });
      return {
        method: 'GET',
        relative_url: `${acctId}/campaigns?${params.toString()}`
      };
    }).filter(Boolean);

    if (!batch.length) return { chunk, response: [] };
    const response = await fbPost(token, '', { batch: JSON.stringify(batch) }, { retries: 1, rateLimitRetries: 1 });
    return { chunk, response };
  }, batchConcurrency);

  const items = [];
  for (const result of chunkResults) {
    if (result?.error) continue;

    const responses = Array.isArray(result.response) ? result.response : [];
    result.chunk.forEach((account, index) => {
      const item = responses[index] || {};
      if (item.code < 200 || item.code >= 300) return;

      try {
        const body = JSON.parse(item.body || '{}');
        const campaigns = Array.isArray(body.data) ? body.data : [];
        for (const campaign of campaigns) {
          const campaignId = String(campaign?.id || '').trim();
          if (!campaignId || existingCampaignIds.has(campaignId)) continue;
          existingCampaignIds.add(campaignId);
          items.push(mapLiveCampaignToReportRow(campaign, account, includeAccountInfo));
        }
      } catch {
        // Ignore malformed batch rows and keep the fast path responsive.
      }
    });
  }

  return items;
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
  const configuredLimitCpc = isDaily ? limits.dailyCpcLimit : limits.lifetimeCpcLimit;
  const limitCpc = normalizedProvider === 'shopee'
    ? Number(configuredLimitCpc || 600)
    : configuredLimitCpc;

  if (normalizedProvider === 'shopee') {
    const minSpend = getShopeeAutoMinSpendLimit(limits);
    if (spend >= minSpend && limitCpc > 0 && costPerClick > limitCpc) {
      return `Chi phi moi click ${Math.round(costPerClick).toLocaleString()}d > ${limitCpc.toLocaleString()}d`;
    }
    return null;
  }

  if (normalizedProvider !== 'facebook') {
    return null;
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
    return null;
  }
}

function normalizeShopeeSubIdKey(value) {
  return String(value || '').trim().toLowerCase();
}

async function getShopeePerformanceTotalsForAuto(account, campaigns = []) {
  const campaignKeys = new Set(
    campaigns
      .map(campaign => normalizeShopeeSubIdKey(campaign.name))
      .filter(Boolean)
  );
  if (!campaignKeys.size) return {};

  try {
    const ownerUserId = account.ownerUserId || account._id;
    const accountFilter = account.ownerUserId
      ? { ...buildAccountProviderFilter('shopee'), ownerUserId: account.ownerUserId }
      : { _id: account._id };
    const shopeeAccounts = await Account.find(accountFilter).select('_id').lean();
    const accountIds = shopeeAccounts.length
      ? shopeeAccounts.map(item => item._id)
      : [account._id];

    const [spendRows, commissionRows] = await Promise.all([
      Campaign.aggregate([
        {
          $match: {
            accountId: { $in: accountIds },
            date: { $gte: SHOPEE_PERFORMANCE_TOTAL_FROM_DATE, $lte: todayStr() }
          }
        },
        {
          $group: {
            _id: { $toLower: { $ifNull: ['$name', ''] } },
            spend: { $sum: '$spend' }
          }
        }
      ]),
      ShopeeCommission.aggregate([
        {
          $match: {
            ownerUserId,
            date: { $gte: SHOPEE_PERFORMANCE_TOTAL_FROM_DATE, $lte: todayStr() }
          }
        },
        {
          $group: {
            _id: { $toLower: { $ifNull: ['$subId2', ''] } },
            commission: { $sum: '$commission' }
          }
        }
      ])
    ]);

    const totals = {};
    for (const row of spendRows) {
      const key = normalizeShopeeSubIdKey(row._id);
      if (!campaignKeys.has(key)) continue;
      totals[key] = totals[key] || { spend: 0, commission: 0 };
      totals[key].spend += Number(row.spend || 0);
    }

    for (const row of commissionRows) {
      const key = normalizeShopeeSubIdKey(row._id);
      if (!campaignKeys.has(key)) continue;
      totals[key] = totals[key] || { spend: 0, commission: 0 };
      totals[key].commission += Number(row.commission || 0);
    }

    return totals;
  } catch (err) {
    console.error('Loi getShopeePerformanceTotalsForAuto:', err);
    return {};
  }
}

function getShopeeOptimizationDecision({ spend = 0, commission = 0, minSpendLimit = AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT } = {}) {
  const numericSpend = Number(spend || 0);
  const numericCommission = Number(commission || 0);
  const minSpend = getShopeeAutoMinSpendLimit({ autoPauseShopeeMinSpendLimit: minSpendLimit });
  const profit = numericCommission - numericSpend;
  const roi = numericSpend > 0
    ? (profit / numericSpend) * 100
    : (profit > 0 ? 100 : 0);
  const roas = numericSpend > 0 ? numericCommission / numericSpend : 0;
  const hhAdsPercent = numericCommission > 0 ? (profit / numericCommission) * 100 : 0;
  const hasEnoughSpend = numericSpend >= minSpend;

  const baseDecisionMetrics = {
    profit,
    roi,
    roas,
    hhAdsPercent,
    minSpend,
    hasEnoughSpend,
    zeroCommissionPauseSpend: minSpend,
    lossPauseSpend: minSpend,
    pauseRoiMinSpend: minSpend,
    pauseRoiPercent: SHOPEE_PAUSE_ROI_PERCENT
  };

  if (hasEnoughSpend && numericCommission <= 0) {
    return {
      action: 'pause',
      label: 'TAT',
      shouldPause: true,
      reason: `Tieu ${Math.round(numericSpend).toLocaleString()}d nhung chua co hoa hong`,
      ...baseDecisionMetrics
    };
  }

  if (hasEnoughSpend && profit < 0) {
    return {
      action: 'pause',
      label: 'TAT',
      shouldPause: true,
      reason: `Doanh thu am ${Math.round(Math.abs(profit)).toLocaleString()}d sau khi tieu ${Math.round(numericSpend).toLocaleString()}d`,
      ...baseDecisionMetrics
    };
  }

  if (hasEnoughSpend && profit <= 0) {
    return {
      action: 'pause',
      label: 'TAT',
      shouldPause: true,
      reason: `Lo ${Math.round(Math.abs(profit)).toLocaleString()}d sau khi tieu ${Math.round(numericSpend).toLocaleString()}d`,
      ...baseDecisionMetrics
    };
  }

  if (hasEnoughSpend && roi < SHOPEE_PAUSE_ROI_PERCENT) {
    return {
      action: 'pause',
      label: 'TAT',
      shouldPause: true,
      reason: `ROI ${roi.toFixed(2)}% < ${SHOPEE_PAUSE_ROI_PERCENT}% sau khi tieu tu ${minSpend.toLocaleString()}d`,
      ...baseDecisionMetrics
    };
  }

  if (hasEnoughSpend && roi < SHOPEE_WARN_ROI_PERCENT) {
    return {
      action: 'warning',
      label: 'CANH BAO',
      shouldPause: false,
      reason: `ROI ${roi.toFixed(2)}% < ${SHOPEE_WARN_ROI_PERCENT}% sau khi tieu du nguong`,
      ...baseDecisionMetrics
    };
  }

  if (hasEnoughSpend && roi >= SHOPEE_STRONG_SCALE_ROI_PERCENT) {
    return {
      action: 'scale_strong',
      label: 'SCALE MANH',
      shouldPause: false,
      reason: `ROI ${roi.toFixed(2)}% >= ${SHOPEE_STRONG_SCALE_ROI_PERCENT}%`,
      ...baseDecisionMetrics
    };
  }

  if (hasEnoughSpend && roi >= SHOPEE_SCALE_ROI_PERCENT) {
    return {
      action: 'scale',
      label: 'SCALE NHE',
      shouldPause: false,
      reason: `ROI ${roi.toFixed(2)}% >= ${SHOPEE_SCALE_ROI_PERCENT}%`,
      ...baseDecisionMetrics
    };
  }

  return {
    action: hasEnoughSpend ? 'keep' : 'testing',
    label: hasEnoughSpend ? 'GIU' : 'TEST THEM',
    shouldPause: false,
    reason: hasEnoughSpend
      ? `ROI ${roi.toFixed(2)}% dang co loi`
      : `Chua du nguong chi tieu ${minSpend.toLocaleString()}d`,
    ...baseDecisionMetrics
  };
}

function getAutoPauseDecision({ provider, campaignName, spend, messages, costPerMessage, clicks, costPerClick, limits, budgetType, skuCounts, shopeeCommission }) {
  const normalizedProvider = normalizeProvider(provider);
  const basePauseReason = getPauseReason(provider, spend, messages, costPerMessage, clicks, costPerClick, limits, budgetType);
  if (normalizedProvider === 'shopee') {
    const decision = getShopeeOptimizationDecision({
      spend,
      commission: shopeeCommission || 0,
      minSpendLimit: limits?.autoPauseShopeeMinSpendLimit
    });
    if (decision.shouldPause) {
      return { pauseReason: decision.reason, orderCount: 0, costPerOrder: 0 };
    }
    return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0 };
  }

  if (normalizedProvider !== 'facebook') {
    return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0 };
  }

  if (!skuCounts || typeof skuCounts !== 'object') {
    return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0 };
  }

  const orderCount = getOrderCountForCampaignName(campaignName, skuCounts);
  const costPerOrder = orderCount > 0 ? spend / orderCount : 0;
  const zeroOrderSpendLimit = Number(limits?.autoPauseZeroOrderSpendLimit ?? AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT);
  if (zeroOrderSpendLimit > 0 && orderCount <= 0 && spend >= zeroOrderSpendLimit) {
    return {
      pauseReason: `Campaign khong co don va da tieu tu ${zeroOrderSpendLimit.toLocaleString()}d`,
      orderCount,
      costPerOrder
    };
  }

  const cpoLimit = Number(limits?.autoPauseCpoLimit ?? AUTO_PAUSE_CPO_LIMIT);
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

function getScheduledCampaignDateKey(campaign) {
  const rawStartTime = campaign?.scheduledStartTimeUtc || campaign?.scheduledStartTime || campaign?.start_time || '';
  const startMs = new Date(rawStartTime).getTime();
  if (!Number.isFinite(startMs)) return '';
  return new Date(startMs + VN_OFFSET_MS).toISOString().split('T')[0];
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

function isCampaignCreatedOnDate(campaign, dateKey = todayStr()) {
  return getVnDateKeyFromDateValue(campaign?.createdTime || campaign?.created_time) === normalizeCampaignDate(dateKey);
}

function getCampaignSpendValue(campaign) {
  const directSpend = Number(campaign?.spend || 0);
  if (Number.isFinite(directSpend) && directSpend > 0) return directSpend;

  const insightSpend = Number(campaign?.insights?.data?.[0]?.spend || 0);
  return Number.isFinite(insightSpend) ? insightSpend : 0;
}

function isActiveCampaign(campaign) {
  return normalizeCampaignStatus(campaign?.effective_status || campaign?.status) === 'ACTIVE';
}

function getCampaignStableId(campaign) {
  return String(campaign?.campaignId || campaign?.id || '').trim();
}

function compareCampaignPriority(a, b) {
  const lifetimeDiff = Number(isLifetimeCampaign(b)) - Number(isLifetimeCampaign(a));
  if (lifetimeDiff !== 0) return lifetimeDiff;

  const scheduledDiff = Number(Boolean(a?.isScheduled)) - Number(Boolean(b?.isScheduled));
  if (scheduledDiff !== 0) return scheduledDiff;

  return getCampaignCreatedTimeMs(a) - getCampaignCreatedTimeMs(b);
}

function isScheduledDuplicateRelevantStatus(status) {
  const normalized = normalizeCampaignStatus(status);
  return normalized === 'ACTIVE'
    || normalized === 'SCHEDULED'
    || normalized === 'PENDING_REVIEW'
    || normalized === 'PENDING_BILLING_INFO';
}

function isScheduledDuplicateCandidate(campaign) {
  const normalizedStatus = normalizeCampaignStatus(campaign?.status);
  if (isScheduledDuplicateRelevantStatus(normalizedStatus)) return true;
  return !normalizedStatus && Boolean(campaign?.isScheduled);
}

function isTodayCreatedDuplicateCandidate(campaign, dailyDate) {
  return isCampaignCreatedOnDate(campaign, dailyDate) && isScheduledDuplicateCandidate(campaign);
}

function buildScheduledPauseTargets(campaigns = [], options = {}) {
  const { hour, minute } = parseHourMinute(options.scheduledDuplicatePauseTime, '21:00');
  if (!isAfterVietnamTime(hour, minute)) return [];
  const dailyDate = normalizeCampaignDate(options.dailyDate);

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

    const relevantCampaigns = group.filter(isScheduledDuplicateCandidate);
    if (relevantCampaigns.length <= 1) continue;

    const keeper = [...relevantCampaigns].sort(compareCampaignPriority)[0];
    const todayCreatedCampaigns = relevantCampaigns
      .filter(campaign => !campaign?.isScheduled && isTodayCreatedDuplicateCandidate(campaign, dailyDate));
    const todayCreatedKeeper = [...todayCreatedCampaigns].sort(compareCampaignPriority)[0];
    const hasMultipleTodayCreatedCampaigns = todayCreatedCampaigns.length > 1;
    const activeSpendBaseCampaign = [...relevantCampaigns]
      .filter(campaign =>
        !isCampaignCreatedOnDate(campaign, dailyDate)
        && isActiveCampaign(campaign)
        && getCampaignSpendValue(campaign) > 0
      )
      .sort(compareCampaignPriority)[0];
    const groupKeeper = activeSpendBaseCampaign || todayCreatedKeeper || keeper;
    const groupKeeperId = getCampaignStableId(groupKeeper);
    const duplicatePauseCandidates = relevantCampaigns.filter(campaign => {
      const campaignId = getCampaignStableId(campaign);
      return campaignId && campaignId !== groupKeeperId;
    });
    if (!duplicatePauseCandidates.length) continue;

    for (const campaign of duplicatePauseCandidates) {
      const campaignId = getCampaignStableId(campaign);
      const isTodayCreated = isCampaignCreatedOnDate(campaign, dailyDate);
      const isSameDayCloneDuplicate = isTodayCreated
        && !campaign?.isScheduled
        && !activeSpendBaseCampaign
        && hasMultipleTodayCreatedCampaigns
        && campaignId !== groupKeeperId;
      items.push({
        campaign,
        keeper: groupKeeper,
        pauseLabel: isTodayCreated && !campaign?.isScheduled ? 'camp nhan hom nay' : 'camp len lich',
        pauseReason: isSameDayCloneDuplicate
          ? `Camp nhan hom nay trung voi camp nhan hom nay ${groupKeeper?.name || groupKeeper?.campaignId}`
          : (isTodayCreated && !campaign?.isScheduled
          ? `Camp nhan hom nay trung voi camp da tieu tien ${groupKeeper.name || groupKeeper.campaignId}`
          : (isLifetimeCampaign(groupKeeper)
            ? `Camp trung, uu tien giu camp tron doi ${groupKeeper.name || groupKeeper.campaignId}`
            : `Camp trung voi camp dang chay ${groupKeeper.name || groupKeeper.campaignId}`))
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

async function fetchCampaignMetaMapBestEffort(fbToken, campaignIds = []) {
  const campaignMetaById = new Map();
  const normalizedIds = [...new Set((campaignIds || []).map(id => String(id || '').trim()).filter(Boolean))];

  for (const chunk of chunkArray(normalizedIds, 50)) {
    try {
      const chunkMeta = await fetchCampaignMetaMap(fbToken, chunk);
      for (const [campaignId, meta] of chunkMeta.entries()) {
        campaignMetaById.set(campaignId, meta);
      }
    } catch (chunkError) {
      console.warn(`[campaigns:meta] chunk metadata failed: ${chunkError.message}`);
      for (const campaignId of chunk) {
        try {
          const singleMeta = await fetchCampaignMetaMap(fbToken, [campaignId]);
          const meta = singleMeta.get(campaignId);
          if (meta) campaignMetaById.set(campaignId, meta);
        } catch (singleError) {
          console.warn(`[campaigns:meta] skip campaign ${campaignId}: ${singleError.message}`);
        }
      }
    }
  }

  return campaignMetaById;
}

function getMetaCampaignInsightMetrics(insight = {}) {
  const spend = parseFloat(insight.spend || 0);
  const impressions = parseInt(insight.impressions || 0, 10);
  const clicks = parseInt(insight.clicks || 0, 10);
  const msgAction = getMetaMessageActionFromInsight(insight);
  const messages = parseInt(msgAction?.value || 0, 10);
  const metaOrders = getMetaOrdersFromInsight(insight);
  const costPerMessage = getMetaCostPerMessageFromInsight(insight);

  return {
    spend: Number.isFinite(spend) ? spend : 0,
    impressions: Number.isFinite(impressions) ? impressions : 0,
    clicks: Number.isFinite(clicks) ? clicks : 0,
    messages: Number.isFinite(messages) ? messages : 0,
    metaOrders: Number.isFinite(metaOrders) ? metaOrders : 0,
    costPerMessage: Number.isFinite(costPerMessage) ? costPerMessage : 0,
    costPerMessageWeight: Number.isFinite(messages) && messages > 0 ? messages : 0
  };
}

function hasMetaCampaignInsightMetrics(metrics = {}) {
  return Number(metrics.spend || 0) > 0
    || Number(metrics.impressions || 0) > 0
    || Number(metrics.clicks || 0) > 0
    || Number(metrics.messages || 0) > 0
    || Number(metrics.metaOrders || 0) > 0;
}

function mergeMetaInsightMetrics(target = {}, source = {}) {
  target.spend = Number(target.spend || 0) + Number(source.spend || 0);
  target.impressions = Number(target.impressions || 0) + Number(source.impressions || 0);
  target.clicks = Number(target.clicks || 0) + Number(source.clicks || 0);
  target.messages = Number(target.messages || 0) + Number(source.messages || 0);
  target.metaOrders = Number(target.metaOrders || 0) + Number(source.metaOrders || 0);
  const currentWeight = Number(target.costPerMessageWeight || 0);
  const sourceWeight = Number(source.costPerMessageWeight || 0);
  if (sourceWeight > 0) {
    const weightedTotal = (Number(target.costPerMessage || 0) * currentWeight) + (Number(source.costPerMessage || 0) * sourceWeight);
    const nextWeight = currentWeight + sourceWeight;
    target.costPerMessage = nextWeight > 0 ? weightedTotal / nextWeight : Number(source.costPerMessage || target.costPerMessage || 0);
    target.costPerMessageWeight = nextWeight;
  } else if (!Number(target.costPerMessage || 0)) {
    target.costPerMessage = Number(source.costPerMessage || 0);
  }
  return target;
}

function buildReportAccountInfo(account) {
  return {
    _id: account._id,
    name: account.name,
    adAccountId: account.adAccountId,
    provider: account.provider
  };
}

async function fetchMetaCampaignMetricRowsForReport(accounts = [], fromDate, toDate, options = {}) {
  const includeAccountInfo = options.includeAccountInfo === true;
  const persist = options.persist === true;
  const concurrency = parseBoundedInt(options.concurrency, 2, 1, 5);
  const facebookAccounts = (accounts || []).filter(account => account?.provider !== 'shopee');
  if (!facebookAccounts.length) return [];

  const accountResults = await mapWithConcurrency(facebookAccounts, async (account) => {
    const accountId = String(account?._id || '');
    if (!accountId || getAccountRateLimitDelayMs(accountId) > 0) return [];

    try {
      const { fbToken } = await getEffectiveSecrets(account);
      if (!fbToken) return [];

      const insights = await fetchAccountInsightsInRange(account, fromDate, toDate);
      let adNamesByDateCampaign = new Map();
      let adNamesByCampaignId = new Map();
      try {
        const adNameMap = await fetchAccountAdNameMapInRange(account, fromDate, toDate);
        adNamesByDateCampaign = adNameMap.byDateCampaign;
        adNamesByCampaignId = adNameMap.byCampaign;
      } catch (error) {
        console.warn(`[campaigns:adnames] skip ${account?.name || account?._id} ${fromDate}..${toDate}: ${error.message}`);
      }
      const metricsByCampaignId = new Map();
      const dailyMetricRows = [];

      for (const insight of insights) {
        const campaignId = String(insight.campaign_id || '').trim();
        if (!campaignId) continue;

        const metrics = getMetaCampaignInsightMetrics(insight);
        if (!hasMetaCampaignInsightMetrics(metrics)) continue;

        if (!metricsByCampaignId.has(campaignId)) {
          metricsByCampaignId.set(campaignId, {
            campaignId,
            name: insight.campaign_name || '',
            adName: '',
            spend: 0,
            impressions: 0,
            clicks: 0,
            messages: 0,
            metaOrders: 0,
            costPerMessage: 0
          });
        }

        const aggregate = metricsByCampaignId.get(campaignId);
        const insightDate = normalizeCampaignDate(insight.date_start || fromDate);
        const adName = adNamesByDateCampaign.get(`${insightDate}:${campaignId}`) || adNamesByCampaignId.get(campaignId) || '';
        if (insight.campaign_name) aggregate.name = insight.campaign_name;
        if (adName) aggregate.adName = combineAdNames([aggregate.adName, adName]);
        mergeMetaInsightMetrics(aggregate, metrics);
        dailyMetricRows.push({ campaignId, insight, metrics, adName });
      }

      if (!metricsByCampaignId.size) return [];

      let campaignMetaById = new Map();
      try {
        campaignMetaById = await fetchCampaignMetaMap(fbToken, [...metricsByCampaignId.keys()]);
      } catch (error) {
        console.warn(`[campaigns:meta] campaign metadata failed for ${account?.name || account?._id}: ${error.message}`);
      }

      if (persist) {
        for (const dailyRow of dailyMetricRows) {
          const dailyDate = normalizeCampaignDate(dailyRow.insight.date_start || fromDate);
          const meta = campaignMetaById.get(dailyRow.campaignId) || {};
          const campaignUpdate = {
            ...meta,
            name: dailyRow.insight.campaign_name || meta.name || '',
            spend: dailyRow.metrics.spend,
            impressions: dailyRow.metrics.impressions,
            clicks: dailyRow.metrics.clicks,
            messages: dailyRow.metrics.messages,
            costPerMessage: dailyRow.metrics.costPerMessage,
            metaOrders: dailyRow.metrics.metaOrders
          };
          if (dailyRow.adName) campaignUpdate.adName = dailyRow.adName;
          await upsertDailyCampaign(account._id, dailyRow.campaignId, dailyDate, campaignUpdate);
        }
      }

      return [...metricsByCampaignId.values()].map(metricRow => {
        const meta = campaignMetaById.get(metricRow.campaignId) || {};
        return {
          campaignId: metricRow.campaignId,
          accountId: includeAccountInfo ? buildReportAccountInfo(account) : account._id,
          name: metricRow.name || meta.name || '',
          adName: metricRow.adName || '',
          status: meta.status || '',
          dailyBudget: Number(meta.dailyBudget || 0),
          lifetimeBudget: Number(meta.lifetimeBudget || 0),
          budgetType: meta.budgetType || (Number(meta.lifetimeBudget || 0) > 0 ? 'LIFETIME' : 'DAILY'),
          createdTime: meta.createdTime,
          spend: metricRow.spend,
          messages: metricRow.messages,
          clicks: metricRow.clicks,
          impressions: metricRow.impressions,
          metaOrders: metricRow.metaOrders,
          costPerMessage: metricRow.costPerMessage
        };
      });
    } catch (error) {
      if (error?.rateLimited) markAccountRateLimited(account._id);
      console.warn(`[campaigns:meta] skip account ${account?.name || account?._id}: ${error.message}`);
      return [];
    }
  }, concurrency);

  return accountResults.flatMap(result => Array.isArray(result) ? result : []);
}

function applyMetaCampaignMetricRows(baseRows = [], metaRows = []) {
  if (!metaRows.length) return baseRows;

  const byCampaignId = new Map();
  const merged = [];

  for (const row of baseRows) {
    const campaignId = String(row?.campaignId || row?.id || '').trim();
    if (!campaignId || byCampaignId.has(campaignId)) continue;
    const current = { ...row };
    byCampaignId.set(campaignId, current);
    merged.push(current);
  }

  for (const metaRow of metaRows) {
    const campaignId = String(metaRow?.campaignId || metaRow?.id || '').trim();
    if (!campaignId) continue;

    const existing = byCampaignId.get(campaignId);
    if (existing) {
      Object.assign(existing, {
        name: metaRow.name || existing.name,
        adName: metaRow.adName || existing.adName || '',
        status: metaRow.status || existing.status,
        dailyBudget: Number(metaRow.dailyBudget || 0) > 0 ? metaRow.dailyBudget : existing.dailyBudget,
        lifetimeBudget: Number(metaRow.lifetimeBudget || 0) > 0 ? metaRow.lifetimeBudget : existing.lifetimeBudget,
        budgetType: metaRow.budgetType || existing.budgetType,
        createdTime: metaRow.createdTime || existing.createdTime,
        spend: Number(metaRow.spend || 0),
        messages: Number(metaRow.messages || 0),
        clicks: Number(metaRow.clicks || 0),
        impressions: Number(metaRow.impressions || 0),
        metaOrders: Number(metaRow.metaOrders || 0),
        costPerMessage: Number(metaRow.costPerMessage || 0)
      });
      continue;
    }

    const added = { ...metaRow };
    byCampaignId.set(campaignId, added);
    merged.push(added);
  }

  return merged.sort(sortCampaignRowsForReport);
}

function dateRangeIncludesToday(fromDate, toDate) {
  const today = todayStr();
  return String(fromDate || today) <= today && String(toDate || fromDate || today) >= today;
}

function dateRangeTouchesTodayOrFuture(fromDate, toDate) {
  const today = todayStr();
  return String(toDate || fromDate || today) >= today;
}

function getVnDateKeyFromDateValue(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time)) return '';
  return new Date(time + VN_OFFSET_MS).toISOString().split('T')[0];
}

function isDateKeyInRange(dateKey, fromDate, toDate) {
  const normalized = String(dateKey || '').trim();
  if (!normalized) return false;
  const from = normalizeCampaignDate(fromDate);
  const to = normalizeCampaignDate(toDate || from);
  return normalized >= from && normalized <= to;
}

function getVietnamDateRangeBounds(fromDate, toDate) {
  const from = normalizeCampaignDate(fromDate);
  const to = normalizeCampaignDate(toDate || from);
  const startUtc = new Date(`${from}T00:00:00+07:00`);
  const endStartUtc = new Date(`${to}T00:00:00+07:00`);
  return {
    startUtc,
    endUtc: new Date(endStartUtc.getTime() + 24 * 60 * 60 * 1000)
  };
}

function buildCreatedCampaignFiltering(fromDate, toDate) {
  const { startUtc, endUtc } = getVietnamDateRangeBounds(fromDate, toDate);
  return JSON.stringify([
    {
      field: 'created_time',
      operator: 'GREATER_THAN',
      value: Math.floor(startUtc.getTime() / 1000) - 1
    },
    {
      field: 'created_time',
      operator: 'LESS_THAN',
      value: Math.floor(endUtc.getTime() / 1000)
    }
  ]);
}

function shouldShowLiveCampaignForRange(campaign, fromDate, toDate, options = {}) {
  if (!campaign?.id) return false;

  const createdDate = getVnDateKeyFromDateValue(campaign.created_time || campaign.createdTime);
  if (isDateKeyInRange(createdDate, fromDate, toDate)) return true;

  const isScheduled = normalizeCampaignStatus(campaign.effective_status || campaign.status) === 'SCHEDULED';
  if (!isScheduled) return false;

  const scheduledDate = getScheduledCampaignDateKey(campaign);
  if (!scheduledDate) return options.includeFutureScheduled === true;
  if (options.includeFutureScheduled === true) return scheduledDate >= todayStr();
  return isDateKeyInRange(scheduledDate, fromDate, toDate);
}

function sortCampaignRowsForReport(a, b) {
  const spendDiff = Number(b?.spend || 0) - Number(a?.spend || 0);
  if (spendDiff !== 0) return spendDiff;

  const createdDiff = getCampaignCreatedTimeMs(b) - getCampaignCreatedTimeMs(a);
  if (createdDiff !== 0) return createdDiff;

  return String(a?.name || '').localeCompare(String(b?.name || ''), 'vi');
}

function mergeCampaignReportRows(baseRows = [], extraRows = []) {
  const seen = new Set();
  const byId = new Map();
  const merged = [];
  for (const row of baseRows) {
    const campaignId = String(row?.campaignId || row?.id || '').trim();
    if (!campaignId || seen.has(campaignId)) continue;
    seen.add(campaignId);
    byId.set(campaignId, row);
    merged.push(row);
  }

  for (const row of extraRows) {
    const campaignId = String(row?.campaignId || row?.id || '').trim();
    if (!campaignId) continue;
    const existing = byId.get(campaignId);
    if (existing) {
      const updated = {
        ...existing,
        name: row.name || existing.name,
        adName: row.adName || existing.adName || '',
        status: row.status || existing.status,
        dailyBudget: Number(row.dailyBudget || 0) > 0 ? row.dailyBudget : existing.dailyBudget,
        lifetimeBudget: Number(row.lifetimeBudget || 0) > 0 ? row.lifetimeBudget : existing.lifetimeBudget,
        budgetType: row.budgetType || existing.budgetType,
        createdTime: row.createdTime || existing.createdTime,
        isScheduled: Boolean(existing.isScheduled) || Boolean(row.isScheduled),
        scheduledStartTime: row.scheduledStartTime || existing.scheduledStartTime || '',
        scheduledStartTimeUtc: row.scheduledStartTimeUtc || existing.scheduledStartTimeUtc,
        scheduledStartTimeDisplay: row.scheduledStartTimeDisplay || existing.scheduledStartTimeDisplay || ''
      };
      byId.set(campaignId, updated);
      continue;
    }

    seen.add(campaignId);
    byId.set(campaignId, row);
    merged.push(row);
  }

  for (let i = 0; i < merged.length; i += 1) {
    const campaignId = String(merged[i]?.campaignId || merged[i]?.id || '').trim();
    if (campaignId && byId.has(campaignId)) merged[i] = byId.get(campaignId);
  }
  return merged.sort(sortCampaignRowsForReport);
}

function mapLiveCampaignToReportRow(campaign, account, includeAccountInfo = false) {
  const dailyBudget = parseFloat(campaign.daily_budget || 0);
  const lifetimeBudget = parseFloat(campaign.lifetime_budget || 0);
  const budgetType = lifetimeBudget > 0 ? 'LIFETIME' : 'DAILY';
  const scheduledStartTime = String(campaign.start_time || '').trim();
  const scheduledStartTimeUtc = scheduledStartTime ? new Date(scheduledStartTime) : undefined;
  const scheduledStatus = normalizeCampaignStatus(campaign.effective_status || campaign.status);

  return {
    campaignId: String(campaign.id || '').trim(),
    accountId: includeAccountInfo
      ? {
          _id: account._id,
          name: account.name,
          adAccountId: account.adAccountId,
          provider: account.provider
        }
      : account._id,
    name: campaign.name || '',
    adName: campaign.adName || '',
    status: campaign.effective_status || campaign.status || '',
    dailyBudget: budgetType === 'DAILY' ? dailyBudget : 0,
    lifetimeBudget: budgetType === 'LIFETIME' ? lifetimeBudget : 0,
    budgetType,
    createdTime: campaign.created_time ? new Date(campaign.created_time) : undefined,
    spend: 0,
    messages: 0,
    clicks: 0,
    impressions: 0,
    metaOrders: 0,
    costPerMessage: 0,
    isScheduled: scheduledStatus === 'SCHEDULED',
    scheduledStartTime,
    scheduledStartTimeUtc,
    scheduledStartTimeDisplay: ''
  };
}

async function fetchScheduledCampaignRowsFromDb(accountIds = [], fromDate, toDate, options = {}) {
  const includeAccountInfo = options.includeAccountInfo === true;
  const includeFutureScheduled = options.includeFutureScheduled === true;
  const existingCampaignIds = new Set(
    [...(options.existingCampaignIds || [])]
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const normalizedAccountIds = (accountIds || [])
    .map(accountId => {
      if (accountId instanceof mongoose.Types.ObjectId) return accountId;
      return mongoose.Types.ObjectId.isValid(accountId) ? new mongoose.Types.ObjectId(accountId) : null;
    })
    .filter(Boolean);
  if (!normalizedAccountIds.length) return [];

  const scheduledDateFilter = includeFutureScheduled
    ? { $gte: todayStr() }
    : { $gte: normalizeCampaignDate(fromDate), $lte: normalizeCampaignDate(toDate) };

  const scheduledRows = await Campaign.find({
    accountId: { $in: normalizedAccountIds },
    isScheduled: true,
    date: scheduledDateFilter
  })
    .select('campaignId accountId name adName status dailyBudget lifetimeBudget budgetType createdTime scheduledStartTime scheduledStartTimeUtc scheduledStartTimeDisplay')
    .sort({ date: 1, scheduledStartTimeUtc: 1, updatedAt: -1, _id: -1 })
    .lean();

  const latestByCampaignId = new Map();
  for (const row of scheduledRows) {
    const campaignId = String(row?.campaignId || '').trim();
    if (!campaignId || existingCampaignIds.has(campaignId) || latestByCampaignId.has(campaignId)) continue;
    latestByCampaignId.set(campaignId, row);
  }

  if (!latestByCampaignId.size) return [];

  let accountMap = new Map();
  if (includeAccountInfo) {
    const accounts = await Account.find({ _id: { $in: normalizedAccountIds } })
      .select('_id name adAccountId provider')
      .lean();
    accountMap = new Map(accounts.map(account => [String(account._id), account]));
  }

  return [...latestByCampaignId.values()].map(row => {
    const accountInfo = includeAccountInfo
      ? (accountMap.get(String(row.accountId)) || {})
      : null;
    return {
      campaignId: String(row.campaignId || '').trim(),
      accountId: includeAccountInfo
        ? {
            _id: accountInfo?._id || row.accountId,
            name: accountInfo?.name || '',
            adAccountId: accountInfo?.adAccountId || '',
            provider: accountInfo?.provider || 'facebook'
          }
        : row.accountId,
      name: row.name || '',
      adName: row.adName || '',
      status: row.status || 'SCHEDULED',
      dailyBudget: Number(row.dailyBudget || 0),
      lifetimeBudget: Number(row.lifetimeBudget || 0),
      budgetType: row.budgetType || (Number(row.lifetimeBudget || 0) > 0 ? 'LIFETIME' : 'DAILY'),
      createdTime: row.createdTime || row.scheduledStartTimeUtc || undefined,
      spend: 0,
      messages: 0,
      clicks: 0,
      impressions: 0,
      metaOrders: 0,
      costPerMessage: 0,
      isScheduled: true,
      scheduledStartTime: row.scheduledStartTime || '',
      scheduledStartTimeUtc: row.scheduledStartTimeUtc,
      scheduledStartTimeDisplay: row.scheduledStartTimeDisplay || ''
    };
  });
}

async function fetchLiveCampaignRowsForReportByAccounts(accounts = [], fromDate, toDate, options = {}) {
  const includeAccountInfo = options.includeAccountInfo === true;
  const includeFutureScheduled = options.includeFutureScheduled === true;
  const limit = parseBoundedInt(options.limit, 200, 25, 500);
  const existingCampaignIds = new Set(
    [...(options.existingCampaignIds || [])]
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const batchSize = parseBoundedInt(options.batchSize, 20, 1, 50);
  const batchConcurrency = parseBoundedInt(options.concurrency, 1, 1, 3);
  const accountRows = [];

  for (const account of accounts || []) {
    const acctId = normalizeAdAccountId(account?.adAccountId || '');
    if (!/^act_\d+$/.test(acctId)) continue;

    try {
      const { fbToken } = await getEffectiveSecrets(account);
      if (!fbToken) continue;
      accountRows.push({ account, acctId, fbToken });
    } catch (error) {
      console.warn(`[campaigns:live] skip account ${account?.name || account?._id}: ${error.message}`);
    }
  }

  if (!accountRows.length) return [];

  const rowsByToken = new Map();
  for (const row of accountRows) {
    if (!rowsByToken.has(row.fbToken)) rowsByToken.set(row.fbToken, []);
    rowsByToken.get(row.fbToken).push(row);
  }

  const output = [];
  for (const [fbToken, tokenRows] of rowsByToken.entries()) {
    const chunks = chunkArray(tokenRows, batchSize);
    const fallbackRows = [];
    const chunkResults = await mapWithConcurrency(chunks, async (chunk) => {
      const specs = [];
      for (const row of chunk) {
        const createdParams = new URLSearchParams({
          fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time',
          filtering: buildCreatedCampaignFiltering(fromDate, toDate),
          limit: String(limit)
        });
        specs.push({
          row,
          type: 'created',
          request: {
            method: 'GET',
            relative_url: `${row.acctId}/campaigns?${createdParams.toString()}`
          }
        });

        const params = new URLSearchParams({
          fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time',
          effective_status: JSON.stringify(['SCHEDULED']),
          limit: String(limit)
        });
        specs.push({
          row,
          type: 'scheduled',
          request: {
            method: 'GET',
            relative_url: `${row.acctId}/campaigns?${params.toString()}`
          }
        });
      }

      const response = await fbPost(fbToken, '', { batch: JSON.stringify(specs.map(spec => spec.request)) }, { retries: 1, rateLimitRetries: 1 });
      return { specs, response };
    }, batchConcurrency);

    for (const result of chunkResults) {
      if (result?.error) {
        console.warn(`[campaigns:live] batch failed: ${result.error.message || result.error}`);
        continue;
      }

      const responses = Array.isArray(result.response) ? result.response : [];
      result.specs.forEach((spec, index) => {
        const item = responses[index] || {};
        const account = spec.row.account;
        if (item.code < 200 || item.code >= 300) {
          if (spec.type === 'created') fallbackRows.push(spec.row);
          if (item.code) console.warn(`[campaigns:live] ${account.name || account._id} ${spec.type} HTTP ${item.code}`);
          return;
        }

        try {
          const body = JSON.parse(item.body || '{}');
          const campaigns = Array.isArray(body.data) ? body.data : [];
          for (const campaign of campaigns) {
            const campaignId = String(campaign?.id || '').trim();
            if (!campaignId || existingCampaignIds.has(campaignId)) continue;
            if (!shouldShowLiveCampaignForRange(campaign, fromDate, toDate, { includeFutureScheduled })) continue;

            existingCampaignIds.add(campaignId);
            output.push(mapLiveCampaignToReportRow(campaign, account, includeAccountInfo));
          }
        } catch (error) {
          console.warn(`[campaigns:live] parse failed for ${account.name || account._id}: ${error.message}`);
        }
      });
    }

    if (!fallbackRows.length) continue;

    const fallbackChunks = chunkArray(fallbackRows, batchSize);
    const fallbackResults = await mapWithConcurrency(fallbackChunks, async (chunk) => {
      const batch = chunk.map(({ acctId }) => {
        const params = new URLSearchParams({
          fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time',
          limit: '100'
        });
        return {
          method: 'GET',
          relative_url: `${acctId}/campaigns?${params.toString()}`
        };
      });

      const response = await fbPost(fbToken, '', { batch: JSON.stringify(batch) }, { retries: 1, rateLimitRetries: 1 });
      return { chunk, response };
    }, batchConcurrency);

    for (const result of fallbackResults) {
      if (result?.error) {
        console.warn(`[campaigns:live] fallback batch failed: ${result.error.message || result.error}`);
        continue;
      }

      const responses = Array.isArray(result.response) ? result.response : [];
      result.chunk.forEach(({ account }, index) => {
        const item = responses[index] || {};
        if (item.code < 200 || item.code >= 300) {
          if (item.code) console.warn(`[campaigns:live] ${account.name || account._id} HTTP ${item.code}`);
          return;
        }

        try {
          const body = JSON.parse(item.body || '{}');
          const campaigns = Array.isArray(body.data) ? body.data : [];
          for (const campaign of campaigns) {
            const campaignId = String(campaign?.id || '').trim();
            if (!campaignId || existingCampaignIds.has(campaignId)) continue;
            if (!shouldShowLiveCampaignForRange(campaign, fromDate, toDate, { includeFutureScheduled })) continue;

            existingCampaignIds.add(campaignId);
            output.push(mapLiveCampaignToReportRow(campaign, account, includeAccountInfo));
          }
        } catch (error) {
          console.warn(`[campaigns:live] parse failed for ${account.name || account._id}: ${error.message}`);
        }
      });
    }
  }

  return output;
}

async function fetchScheduledNoSpendCampaignRowsForAccount(account, existingCampaignIds = new Set(), options = {}) {
  const includeAccountInfo = options.includeAccountInfo === true;
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 5;
  const pageTimeoutMs = Number.isFinite(options.pageTimeoutMs) ? options.pageTimeoutMs : 15000;
  const knownIds = new Set([...existingCampaignIds].map(id => String(id || '').trim()).filter(Boolean));
  const acctId = normalizeAdAccountId(account?.adAccountId || '');
  if (!acctId) return [];

  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) return [];

  let items = [];
  try {
    const response = await fetchAllFbEdge(fbToken, `${acctId}/campaigns`, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time',
      effective_status: JSON.stringify(['SCHEDULED']),
      limit: 100
    }, {
      maxPages,
      pageTimeoutMs,
      requestOptions: { retries: 2, rateLimitRetries: 2 }
    });
    items = response.items || [];
  } catch {
    const fallback = await fetchAllFbEdge(fbToken, `${acctId}/campaigns`, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time,start_time',
      limit: 100
    }, {
      maxPages,
      pageTimeoutMs,
      requestOptions: { retries: 2, rateLimitRetries: 2 }
    });
    items = fallback.items || [];
  }

  return items
    .filter(campaign => {
      const campaignId = String(campaign?.id || '').trim();
      if (!campaignId || knownIds.has(campaignId)) return false;
      return normalizeCampaignStatus(campaign.effective_status || campaign.status) === 'SCHEDULED';
    })
    .map(campaign => mapLiveCampaignToReportRow(campaign, account, includeAccountInfo));
}

async function getScheduledDuplicateCandidatesForAccount(account, dailyDate = todayStr()) {
  const storedCampaigns = await Campaign.find({ accountId: account._id, date: dailyDate }).lean();
  const existingCampaignIds = new Set(
    storedCampaigns
      .map(campaign => String(campaign.campaignId || '').trim())
      .filter(Boolean)
  );

  try {
    const extraCampaigns = await fetchLiveCampaignRowsForReportByAccounts([account], dailyDate, dailyDate, {
      includeAccountInfo: false,
      includeFutureScheduled: true,
      existingCampaignIds,
      batchSize: 1,
      concurrency: 1,
      limit: 200
    });
    const relevantExtraCampaigns = extraCampaigns.filter(campaign => {
      if (isCampaignCreatedOnDate(campaign, dailyDate)) return true;
      const scheduledDateKey = getScheduledCampaignDateKey(campaign);
      return !scheduledDateKey || scheduledDateKey <= dailyDate;
    });
    if (!relevantExtraCampaigns.length) return storedCampaigns;

    return [
      ...storedCampaigns,
      ...relevantExtraCampaigns.map(campaign => ({
        ...campaign,
        date: dailyDate,
        id: campaign.campaignId || campaign.id || '',
        isScheduled: Boolean(campaign.isScheduled)
      }))
    ];
  } catch (error) {
    console.warn(`[auto-scheduled-pause] live candidate merge failed for ${account.name}: ${error.message}`);
    return storedCampaigns;
  }
}

function getScheduledDuplicateScopeKey(account) {
  const ownerKey = account?.ownerUserId ? String(account.ownerUserId) : 'legacy';
  return `${normalizeProvider(account?.provider)}:${ownerKey}`;
}

function getCampaignAccountIdValue(campaign) {
  const accountId = campaign?.accountId;
  if (!accountId) return '';
  if (accountId._id) return String(accountId._id);
  return String(accountId);
}

async function getScheduledDuplicateScopeAccounts(account) {
  if (normalizeProvider(account?.provider) !== 'facebook') return [];

  const ownerFilter = account?.ownerUserId
    ? { ownerUserId: account.ownerUserId }
    : { $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: null }] };
  const filter = {
    autoEnabled: true,
    $and: [
      buildAccountProviderFilter('facebook'),
      ownerFilter
    ]
  };

  const accounts = await Account.find(filter);
  return accounts.length ? accounts : [account];
}

async function getScheduledDuplicateCandidatesForScope(accounts = [], dailyDate = todayStr()) {
  const candidates = [];
  for (const account of accounts) {
    const accountCandidates = await getScheduledDuplicateCandidatesForAccount(account, dailyDate);
    candidates.push(...accountCandidates);
  }
  return candidates;
}

async function pauseScheduledDuplicateTarget(item, accountsById, fallbackAccount, dailyDate) {
  const campaignGraphId = item.campaign.id || item.campaign.campaignId;
  if (!campaignGraphId) return false;

  const targetAccountId = getCampaignAccountIdValue(item.campaign) || String(fallbackAccount._id);
  const targetAccount = accountsById.get(targetAccountId) || fallbackAccount;
  const { fbToken } = await getEffectiveSecrets(targetAccount);

  await fbPost(fbToken, campaignGraphId, { status: 'PAUSED' });
  await Campaign.findOneAndUpdate(
    { accountId: targetAccount._id, campaignId: campaignGraphId, date: dailyDate },
    { $set: { status: 'PAUSED', updatedAt: new Date() } },
    { new: true }
  );
  clearCampaignReadCache();
  await addLog(
    targetAccount._id,
    targetAccount.name,
    'warn',
    `Auto tat ${item.pauseLabel || 'camp len lich'} ${item.campaign.name || campaignGraphId}: ${item.pauseReason}`
  );
  return true;
}

async function runScheduledDuplicatePauseForScope(account, config, dailyDate = todayStr()) {
  if (normalizeProvider(account?.provider) !== 'facebook') return;

  const scopeKey = getScheduledDuplicateScopeKey(account);
  const lastRunAt = scheduledDuplicateScopeLastRunAt[scopeKey] || 0;
  if (scheduledDuplicateScopeRuns[scopeKey]) return;
  if (Date.now() - lastRunAt < SCHEDULED_DUPLICATE_SCOPE_COOLDOWN_MS) return;

  scheduledDuplicateScopeRuns[scopeKey] = true;
  try {
    const scopeAccounts = await getScheduledDuplicateScopeAccounts(account);
    if (!scopeAccounts.length) return;

    const scheduledPauseCandidates = await getScheduledDuplicateCandidatesForScope(scopeAccounts, dailyDate);
    const scheduledPauseTargets = buildScheduledPauseTargets(scheduledPauseCandidates, {
      scheduledDuplicatePauseTime: config?.scheduledDuplicatePauseTime,
      dailyDate
    });
    if (!scheduledPauseTargets.length) return;

    const accountsById = new Map(scopeAccounts.map(scopeAccount => [String(scopeAccount._id), scopeAccount]));
    let pausedCount = 0;
    for (const item of scheduledPauseTargets) {
      try {
        if (await pauseScheduledDuplicateTarget(item, accountsById, account, dailyDate)) {
          pausedCount += 1;
        }
      } catch (error) {
        const targetAccount = accountsById.get(getCampaignAccountIdValue(item.campaign)) || account;
        await addLog(
          targetAccount._id,
          targetAccount.name,
          'error',
          `Loi auto tat camp trung ${item.campaign.name || item.campaign.campaignId || ''}: ${error.message}`
        );
      }
    }

    if (pausedCount > 0) {
      await addLog(
        account._id,
        account.name,
        'warn',
        `Auto tat ${pausedCount} camp trung tren ${scopeAccounts.length} tai khoan quang cao`
      );
    }
  } finally {
    scheduledDuplicateScopeLastRunAt[scopeKey] = Date.now();
    delete scheduledDuplicateScopeRuns[scopeKey];
  }
}

async function getShopeeHistoricalCampaignCandidatesForAuto(account, fbToken, currentCampaigns = [], dailyDate = todayStr()) {
  if (!account?._id || !fbToken) return [];

  const currentCampaignIds = new Set(
    (currentCampaigns || [])
      .map(campaign => getCampaignStableId(campaign))
      .filter(Boolean)
  );
  const match = {
    accountId: account._id,
    date: { $gte: SHOPEE_PERFORMANCE_TOTAL_FROM_DATE, $lt: normalizeCampaignDate(dailyDate) }
  };
  if (currentCampaignIds.size) {
    match.campaignId = { $nin: [...currentCampaignIds] };
  }

  const historicalRows = await Campaign.aggregate([
    { $match: match },
    { $sort: { date: -1, updatedAt: -1 } },
    { $group: { _id: '$campaignId', campaign: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$campaign' } }
  ]);

  if (!historicalRows.length) return [];

  const campaignIds = historicalRows.map(row => getCampaignStableId(row)).filter(Boolean);
  const campaignMetaById = await fetchCampaignMetaMapBestEffort(fbToken, campaignIds);

  return historicalRows
    .map(row => {
      const campaignId = getCampaignStableId(row);
      const meta = campaignMetaById.get(campaignId);
      if (!campaignId || normalizeCampaignStatus(meta?.status) !== 'PAUSED') return null;

      const dailyBudget = Number(meta.dailyBudget ?? row.dailyBudget ?? 0);
      const lifetimeBudget = Number(meta.lifetimeBudget ?? row.lifetimeBudget ?? 0);
      const createdTime = meta.createdTime || row.createdTime;

      return {
        ...row,
        id: campaignId,
        campaignId,
        name: meta.name || row.name || '',
        status: meta.status,
        dailyBudget,
        daily_budget: dailyBudget,
        lifetimeBudget,
        lifetime_budget: lifetimeBudget,
        budgetType: meta.budgetType || row.budgetType || (lifetimeBudget > 0 ? 'LIFETIME' : 'DAILY'),
        createdTime,
        created_time: createdTime,
        spend: 0,
        impressions: 0,
        clicks: 0,
        messages: 0,
        costPerMessage: 0,
        isHistoricalAutoCandidate: true
      };
    })
    .filter(Boolean);
}

async function fetchShopeeAccountData(account) {
  const today = todayStr();
  let campaigns = await Campaign.find({ accountId: account._id, date: today }).lean();
  const { fbToken } = await getEffectiveSecrets(account);
  if (fbToken) {
    const insights = await fetchAccountInsightsInRange(account, today, today);
    let adNamesByDateCampaign = new Map();
    try {
      const adNameMap = await fetchAccountAdNameMapInRange(account, today, today);
      adNamesByDateCampaign = adNameMap.byDateCampaign;
    } catch (error) {
      console.warn(`[campaigns:adnames] skip ${account?.name || account?._id} ${today}: ${error.message}`);
    }
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
      const adName = adNamesByDateCampaign.get(`${today}:${campaignId}`) || '';
      const campaignUpdate = {
        ...meta,
        name: insight.campaign_name,
        spend: insight.spend,
        impressions: insight.impressions,
        clicks: insight.clicks,
        messages: 0,
        costPerMessage: 0
      };
      if (adName) campaignUpdate.adName = adName;

      await upsertDailyCampaign(account._id, campaignId, today, campaignUpdate);
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
  let adNamesByDateCampaign = new Map();
  try {
    const adNameMap = await fetchAccountAdNameMapInRange(account, today, today);
    adNamesByDateCampaign = adNameMap.byDateCampaign;
  } catch (error) {
    console.warn(`[campaigns:adnames] skip ${account?.name || account?._id} ${today}: ${error.message}`);
  }
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
    const adName = adNamesByDateCampaign.get(`${today}:${campaignId}`) || '';

    const campaignUpdate = {
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
    };
    if (adName) campaignUpdate.adName = adName;

    await upsertDailyCampaign(account._id, campaignId, today, campaignUpdate);

    campaigns.push({
      id: campaignId,
      name: insight.campaign_name || meta.name,
      adName: adName || existingCampaign.adName || '',
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
    const adName = adNamesByDateCampaign.get(`${today}:${campaignId}`) || storedCampaign.adName || '';
    await upsertDailyCampaign(account._id, campaignId, today, {
      ...meta,
      ...(adName ? { adName } : {}),
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
      adName,
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

async function runAutoControl(account, options = {}) {
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
    let campaignsToActivate = [];
    const isAutoRuleTime = isWithinAutoRuleTimeWindow(ruleStart, ruleEnd);
    const canReactivateShopeeAtMidnight = isShopee
      && (options.allowShopeeReactivateAtMidnight || isVietnamTimeMinute(0, 0));
    if (isAutoRuleTime || canReactivateShopeeAtMidnight) {
      const skuCounts = isAutoRuleTime ? await getTodayOrderSkuCountsForAuto(account) : {};
      const historicalShopeeCampaigns = canReactivateShopeeAtMidnight
        ? await getShopeeHistoricalCampaignCandidatesForAuto(account, fbToken, campaigns, today)
        : [];
      const ruleCampaigns = isShopee ? [...campaigns, ...historicalShopeeCampaigns] : campaigns;
      const shopeePerformanceTotals = isShopee ? await getShopeePerformanceTotalsForAuto(account, ruleCampaigns) : {};
      const ruleCandidates = ruleCampaigns
        .map(campaign => {
          const { spend, messages, costPerMessage, clicks, costPerClick } = getCampaignRuleStats(campaign);
          const shopeeKey = normalizeShopeeSubIdKey(campaign.name);
          const shopeeTotals = isShopee ? (shopeePerformanceTotals[shopeeKey] || {}) : {};
          const ruleSpend = isShopee ? Number(shopeeTotals.spend || spend || 0) : spend;
          const ruleCommission = isShopee ? Number(shopeeTotals.commission || 0) : 0;
          const isLifetime = !!campaign.lifetimeBudget || !!campaign.lifetime_budget && parseFloat(campaign.lifetime_budget) > 0;
          const budgetType = isLifetime ? 'LIFETIME' : 'DAILY';
          const { pauseReason, orderCount, costPerOrder } = getAutoPauseDecision({
            provider: account.provider,
            campaignName: campaign.name,
            spend: ruleSpend,
            messages,
            costPerMessage,
            clicks,
            costPerClick,
            limits: config,
            budgetType,
            skuCounts,
            shopeeCommission: ruleCommission
          });
          const optimizationDecision = isShopee
            ? getShopeeOptimizationDecision({
              spend: ruleSpend,
              commission: ruleCommission,
              minSpendLimit: config?.autoPauseShopeeMinSpendLimit
            })
            : null;
          return {
            campaign,
            spend,
            ruleSpend,
            ruleCommission,
            messages,
            costPerMessage,
            clicks,
            costPerClick,
            orderCount,
            costPerOrder,
            pauseReason,
            optimizationDecision
          };
        })
        .filter(Boolean);

      campaignsToPause = isAutoRuleTime
        ? ruleCandidates.filter(item =>
          normalizeCampaignStatus(item.campaign.status) === 'ACTIVE' && item.pauseReason
        )
        : [];

      campaignsToActivate = canReactivateShopeeAtMidnight
        ? ruleCandidates.filter(item =>
          normalizeCampaignStatus(item.campaign.status) === 'PAUSED'
          && !item.pauseReason
          && item.optimizationDecision?.hasEnoughSpend
          && item.optimizationDecision.roi > SHOPEE_REACTIVATE_ROI_PERCENT
        )
        : [];
    } else {
      await addLog(
        account._id,
        account.name,
        'info',
        `Ngoai khung gio auto-rule (${ruleStart}-${ruleEnd}), chi theo doi khong tat/bat camp`
      );
    }

    await runScheduledDuplicatePauseForScope(account, config, today);

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
            `Shopee campaign can tam dung: ${item.campaign.name} · ${item.pauseReason} · tong tieu ${Math.round(item.ruleSpend || item.spend || 0).toLocaleString()}d · tong HH ${Math.round(item.ruleCommission || 0).toLocaleString()}d`
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

    if (campaignsToActivate.length > 0) {
      for (const item of campaignsToActivate) {
        const campaignGraphId = item.campaign.id || item.campaign.campaignId;
        const roiText = Number(item.optimizationDecision?.roi || 0).toFixed(2);
        await fbPost(fbToken, campaignGraphId, { status: 'ACTIVE' });
        await upsertDailyCampaign(account._id, campaignGraphId, today, {
          name: item.campaign.name || '',
          status: 'ACTIVE',
          dailyBudget: Number(item.campaign.dailyBudget ?? item.campaign.daily_budget ?? 0),
          lifetimeBudget: Number(item.campaign.lifetimeBudget ?? item.campaign.lifetime_budget ?? 0),
          budgetType: item.campaign.budgetType || (Number(item.campaign.lifetimeBudget ?? item.campaign.lifetime_budget ?? 0) > 0 ? 'LIFETIME' : 'DAILY'),
          createdTime: item.campaign.createdTime || item.campaign.created_time,
          spend: Number(item.campaign.isHistoricalAutoCandidate ? 0 : item.spend || 0),
          impressions: Number(item.campaign.isHistoricalAutoCandidate ? 0 : item.campaign.impressions || 0),
          clicks: Number(item.campaign.isHistoricalAutoCandidate ? 0 : item.clicks || 0),
          messages: Number(item.campaign.isHistoricalAutoCandidate ? 0 : item.messages || 0),
          costPerMessage: Number(item.campaign.isHistoricalAutoCandidate ? 0 : item.costPerMessage || 0),
          metaOrders: Number(item.campaign.isHistoricalAutoCandidate ? 0 : item.campaign.metaOrders || 0),
          isScheduled: Boolean(item.campaign.isScheduled)
        });
        await addLog(
          account._id,
          account.name,
          'success',
          `Shopee campaign tu bat lai: ${item.campaign.name} · ROI ${roiText}% > ${SHOPEE_REACTIVATE_ROI_PERCENT}% · tong tieu ${Math.round(item.ruleSpend || item.spend || 0).toLocaleString()}d · tong HH ${Math.round(item.ruleCommission || 0).toLocaleString()}d`
        );
      }

      await addLog(
        account._id,
        account.name,
        'success',
        `Da bat lai ${campaignsToActivate.length} Shopee campaign co ROI > ${SHOPEE_REACTIVATE_ROI_PERCENT}%`
      );
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
const scheduledDuplicateScopeRuns = {};
const scheduledDuplicateScopeLastRunAt = {};
let facebookTokenCronTask = null;
let finalSpendCronTask = null;
let shopeeReactivateCronTask = null;
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

async function runAutoControlSafely(account, source = 'auto', options = {}) {
  const accountId = String(account._id);
  if (!isMongoReady()) return;
  if (accountRuns[accountId]) return;
  if (getAccountRateLimitDelayMs(accountId) > 0) return;

  accountRuns[accountId] = true;
  try {
    await runAutoControl(account, options);
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
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    const defaultUser = DEFAULT_LOGIN_USERS.find(item => item.username === username);
    let user = await User.findOne({ username });
    if (!user && defaultUser && password === defaultUser.password) {
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
    const passwordOk = user && user.active ? verifyPassword(password, user.passwordHash) : false;
    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Sai tai khoan hoac mat khau' });
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

app.get('/api/users', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const users = await User.find({ active: true })
      .select('username displayName provider createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, users: users.map(serializeAdminUser) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const { username, password, displayName, provider } = req.body;
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      return res.status(400).json({ error: 'Username va password la bat buoc' });
    }
    if (!/^[a-z0-9._-]+$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Username chi duoc dung chu thuong, so, dau cham, gach ngang hoac gach duoi' });
    }

    const existing = await User.findOne({ username: normalizedUsername });
    if (existing?.active) {
      return res.status(400).json({ error: 'Username da ton tai' });
    }
    const payload = {
      username: normalizedUsername,
      displayName: String(displayName || normalizedUsername).trim(),
      passwordHash: hashPassword(password),
      provider: normalizeProvider(provider),
      active: true,
      updatedAt: new Date()
    };
    const user = existing
      ? await User.findByIdAndUpdate(
        existing._id,
        { $set: payload },
        { new: true }
      )
      : await User.create({
        ...payload,
        createdAt: new Date()
      });
    res.json({
      ok: true,
      user: serializeAdminUser(user)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/users/:username', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const username = normalizeUsername(req.params.username);
    const { password, displayName, provider } = req.body;
    const update = { updatedAt: new Date() };
    if (password) update.passwordHash = hashPassword(password);
    if (Object.prototype.hasOwnProperty.call(req.body, 'displayName')) {
      update.displayName = String(displayName || '').trim();
    }
    if (provider) {
      const nextProvider = normalizeProvider(provider);
      if (username === 'admin' && nextProvider !== 'facebook') {
        return res.status(400).json({ error: 'Khong the doi provider cua tai khoan admin' });
      }
      update.provider = nextProvider;
    }

    const user = await User.findOneAndUpdate(
      { username, active: true },
      { $set: update },
      { new: true }
    ).select('username displayName provider createdAt updatedAt');

    if (!user) {
      return res.status(404).json({ error: 'User khong ton tai' });
    }
    res.json({ ok: true, user: serializeAdminUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const username = normalizeUsername(req.params.username);
    if (username === 'admin') {
      return res.status(400).json({ error: 'Khong the xoa tai khoan admin' });
    }
    const user = await User.findOneAndUpdate(
      { username, active: true },
      { $set: { active: false, updatedAt: new Date() } },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ error: 'User khong ton tai' });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    const includeOrders = req.query.includeOrders !== 'false' && req.query.includeOrders !== false;
    const cacheKey = userScopedCacheKey(req, `stats:${provider || 'all'}:${fDate}:${tDate}:${includeOrders ? 'with-orders' : 'no-orders'}`);
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

    let totalOrders;
    let ordersError;
    if (includeOrders) {
      totalOrders = 0;
      ordersError = '';
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
      ...(includeOrders ? { totalOrders, ordersError } : {}),
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
      'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit autoPauseZeroOrderSpendLimit autoPauseShopeeMinSpendLimit autoPauseShopeeHhAdsPercent'
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
      autoPauseCpoLimit: autoConfig.autoPauseCpoLimit,
      autoPauseZeroOrderSpendLimit: autoConfig.autoPauseZeroOrderSpendLimit,
      autoPauseShopeeMinSpendLimit: autoConfig.autoPauseShopeeMinSpendLimit,
      autoPauseShopeeHhAdsPercent: autoConfig.autoPauseShopeeHhAdsPercent
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
      autoPauseZeroOrderSpendLimit: Number(req.body.autoPauseZeroOrderSpendLimit ?? AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
      autoPauseShopeeMinSpendLimit: getShopeeAutoMinSpendLimit({ autoPauseShopeeMinSpendLimit: req.body.autoPauseShopeeMinSpendLimit }),
      autoPauseShopeeHhAdsPercent: Number(req.body.autoPauseShopeeHhAdsPercent ?? AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT),
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
    const fromDate = normalizeCampaignDate(req.body.fromDate || req.body.date);
    const toDate = normalizeCampaignDate(req.body.toDate || req.body.date || fromDate);
    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    const campaignId = String(req.params.campaignId || '').trim();
    if (!campaignId) return res.status(400).json({ error: 'Thieu campaignId' });

    const storedCampaign = await Campaign.findOne({
      accountId,
      campaignId,
      date: { $gte: fromDate, $lte: toDate }
    }).sort({ updatedAt: -1, _id: -1 }).lean();

    let effectiveStatus = normalizeCampaignStatus(currentStatus);
    try {
      const liveCampaign = await fbGet(fbToken, campaignId, { fields: 'id,status' }, { retries: 2, rateLimitRetries: 2 });
      effectiveStatus = normalizeCampaignStatus(liveCampaign?.status || effectiveStatus);
    } catch (error) {
      effectiveStatus = normalizeCampaignStatus(storedCampaign?.status || effectiveStatus);
      if (!effectiveStatus) throw error;
    }

    const requestedTargetStatus = normalizeCampaignStatus(req.body.targetStatus);
    const newStatus = requestedTargetStatus === 'PAUSED' || requestedTargetStatus === 'ACTIVE'
      ? requestedTargetStatus
      : (isCampaignServingStatus(effectiveStatus) ? 'PAUSED' : 'ACTIVE');

    await fbPost(fbToken, req.params.campaignId, { status: newStatus });
    const updateFilter = storedCampaign
      ? { _id: storedCampaign._id }
      : { accountId, campaignId, date: { $gte: fromDate, $lte: toDate } };
    await Campaign.findOneAndUpdate(updateFilter, { $set: { status: newStatus, updatedAt: new Date() } }, { new: true });
    clearCampaignReadCache();

    const logLevel = newStatus === 'ACTIVE' ? 'success' : 'warn';
    const logMessage = `Thu cong: ${effectiveStatus || normalizeCampaignStatus(currentStatus) || 'UNKNOWN'} -> ${newStatus} (${campaignId})`;

    await addLog(
      account._id,
      account.name,
      logLevel,
      logMessage
    );

    res.json({ ok: true, previousStatus: effectiveStatus, newStatus, logLevel, logMessage });
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
        const copiedAdName = combineAdNames(copyResult.copiedAds) || campaign.adName || '';

        await upsertDailyCampaign(accountIdValue, copiedCampaignId, scheduledCampaignDate, {
          name: copyResult.copiedCampaignName || campaign.name || campaign.campaignId,
          adName: copiedAdName,
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
          adName: copiedAdName,
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
    const campaignGender = isShopee ? parseCampaignGender(req.body.gender) : 'female';
    const genderTargeting = getMetaGenderTargeting(campaignGender);

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
        const objectStoryId = getPostObjectStoryId(post);
        if (!objectStoryId || !objectStoryId.includes('_')) {
          return {
            error: {
              code,
              lookupTerm,
              error: `Bai viet ${post.postId || post.id || ''} chua co object_story_id hop le. Hay bam cap nhat bai viet Page roi tao lai camp.`
            }
          };
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
              publisher_platforms: ['facebook'],
              facebook_positions: ['feed', 'facebook_reels', 'facebook_reels_overlay', 'profile_feed', 'notification', 'instream_video', 'marketplace', 'story', 'search'],
              device_platforms: ['mobile', 'desktop'],
              ...(genderTargeting.length ? { genders: genderTargeting } : {})
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
          object_story_id: objectStoryId,
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
          adName: finalAdName,
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
            gender: isShopee ? campaignGender : 'female',
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
            gender: isShopee ? campaignGender : 'female',
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
    const includeScheduledNoSpend = req.query.includeScheduledNoSpend === 'true' || req.query.includeScheduledNoSpend === true;
    const includeLiveCreated = req.query.includeLiveCreated === 'true' || req.query.includeLiveCreated === true;
    const includeLiveCampaigns = includeScheduledNoSpend && includeLiveCreated && dateRangeTouchesTodayOrFuture(fDate, tDate);
    const cacheKey = userScopedCacheKey(req, `campaigns:account:${req.params.id}:${provider || 'all'}:${fDate}:${tDate}:${includeScheduledNoSpend ? 'with-scheduled-zero' : 'default'}:${includeLiveCampaigns ? 'live-created' : 'stored'}`);
    const cached = includeLiveCampaigns ? null : getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const ownedAccount = await Account.findOne(withUserFilter(req, { _id: req.params.id }))
      .select('_id name adAccountId provider fbToken ownerUserId')
      .lean();
    if (!ownedAccount) return res.json([]);

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

    const campaigns = await Campaign.aggregate([
      { $match: match },
      { $sort: { date: 1, updatedAt: 1, _id: 1 } },
      {
        $group: {
          _id: '$campaignId',
          campaignId: { $first: '$campaignId' },
          accountId: { $first: '$accountId' },
          name: { $first: '$name' },
          adName: { $max: '$adName' },
          status: { $last: '$status' },
          dailyBudget: { $last: '$dailyBudget' },
          lifetimeBudget: { $last: '$lifetimeBudget' },
          budgetType: { $last: '$budgetType' },
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
          adName: 1,
          status: 1,
          dailyBudget: 1,
          lifetimeBudget: 1,
          budgetType: 1,
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
    let result = campaigns;
    if (includeScheduledNoSpend) {
      try {
        const existingCampaignIds = new Set(campaigns.map(campaign => campaign.campaignId));
        const extraCampaigns = await fetchScheduledCampaignRowsFromDb(
          [ownedAccount._id],
          fDate,
          tDate,
          {
            includeAccountInfo: false,
            includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
            existingCampaignIds
          }
        );
        if (extraCampaigns.length > 0) {
          result = mergeCampaignReportRows(result, extraCampaigns);
          for (const campaign of extraCampaigns) {
            existingCampaignIds.add(String(campaign.campaignId || '').trim());
          }
        }

        if (includeLiveCampaigns) {
          const liveCampaigns = await fetchLiveCampaignRowsForReportByAccounts(
            [ownedAccount],
            fDate,
            tDate,
            {
              includeAccountInfo: false,
              includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
              existingCampaignIds
            }
          );
          if (liveCampaigns.length > 0) {
            result = mergeCampaignReportRows(result, liveCampaigns);
          }
        }
      } catch (error) {
        console.warn(`[campaigns:account] extra campaign merge failed for ${req.params.id}: ${error.message}`);
      }
    }

    console.log(`[campaigns:account] account=${req.params.id} ${fDate}..${tDate} rows=${result.length} ${Date.now() - startedAt}ms`);
    res.json(includeLiveCampaigns ? result : setReadCache(cacheKey, result));
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
    const includeScheduledNoSpend = req.query.includeScheduledNoSpend === 'true' || req.query.includeScheduledNoSpend === true;
    const includeLiveCreated = req.query.includeLiveCreated === 'true' || req.query.includeLiveCreated === true;
    const includeMetaInsights = req.query.includeMetaInsights === 'true' || req.query.includeMetaInsights === true;
    const includeLiveCampaigns = includeScheduledNoSpend && includeLiveCreated && dateRangeTouchesTodayOrFuture(fDate, tDate);
    const today = todayStr();
    const shouldFetchMetaInsights = includeMetaInsights && provider !== 'shopee' && String(fDate) <= today;
    const metaInsightsToDate = String(tDate) > today ? today : tDate;
    const cacheKey = userScopedCacheKey(req, `campaigns:today:${provider || 'all'}:${fDate}:${tDate}:${includeScheduledNoSpend ? 'with-scheduled-zero' : 'default'}:${includeLiveCampaigns ? 'live-created' : 'stored'}:${shouldFetchMetaInsights ? 'meta-insights' : 'stored-insights'}`);
    const cached = includeLiveCampaigns || shouldFetchMetaInsights ? null : getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const accountFilter = provider ? buildAccountProviderFilter(provider) : {};
    const accounts = await Account.find(withUserFilter(req, accountFilter))
      .select('_id name adAccountId provider fbToken ownerUserId')
      .lean();

    let match = {
      date: { $gte: fDate, $lte: tDate }
    };
    match.accountId = { $in: accounts.map(account => account._id) };

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
          adName: { $max: '$adName' },
          status: { $last: '$status' },
          dailyBudget: { $last: '$dailyBudget' },
          lifetimeBudget: { $last: '$lifetimeBudget' },
          budgetType: { $last: '$budgetType' },
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
          adName: 1,
          status: 1,
          dailyBudget: 1,
          lifetimeBudget: 1,
          budgetType: 1,
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

    let result = campaigns;
    if (includeScheduledNoSpend && accounts.length > 0) {
      const existingCampaignIds = new Set(campaigns.map(campaign => campaign.campaignId));
      const extraCampaigns = await fetchScheduledCampaignRowsFromDb(
        accounts.map(account => account._id),
        fDate,
        tDate,
        {
          includeAccountInfo: true,
          includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
          existingCampaignIds
        }
      );

      if (extraCampaigns.length > 0) {
        result = mergeCampaignReportRows(result, extraCampaigns);
        for (const campaign of extraCampaigns) {
          existingCampaignIds.add(String(campaign.campaignId || '').trim());
        }
      }

      if (includeLiveCampaigns) {
        const liveCampaigns = await fetchLiveCampaignRowsForReportByAccounts(
          accounts,
          fDate,
          tDate,
          {
            includeAccountInfo: true,
            includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
            existingCampaignIds
          }
        );
        if (liveCampaigns.length > 0) {
          result = mergeCampaignReportRows(result, liveCampaigns);
        }
      }
    }

    if (shouldFetchMetaInsights && accounts.length > 0) {
      const metaRows = await fetchMetaCampaignMetricRowsForReport(accounts, fDate, metaInsightsToDate, { includeAccountInfo: true, persist: true });
      result = applyMetaCampaignMetricRows(result, metaRows);
    }

    console.log(`[campaigns:today] provider=${provider || 'all'} ${fDate}..${tDate} rows=${result.length} meta=${shouldFetchMetaInsights ? 'yes' : 'no'} ${Date.now() - startedAt}ms`);
    res.json(includeLiveCampaigns || shouldFetchMetaInsights ? result : setReadCache(cacheKey, result));
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

async function fetchAccountAdNameMapInRange(account, fromDate, toDate) {
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const { items } = await fetchAllFbEdge(fbToken, `${acctId}/insights`, {
    fields: 'campaign_id,ad_id,ad_name',
    time_range: JSON.stringify({ since: fromDate, until: toDate }),
    level: 'ad',
    limit: 500,
    time_increment: 1
  });

  const byDateCampaign = new Map();
  const byCampaign = new Map();
  for (const row of items) {
    const campaignId = String(row?.campaign_id || '').trim();
    const date = String(row?.date_start || fromDate || '').trim();
    const adName = String(row?.ad_name || '').replace(/\s+/g, ' ').trim();
    if (!campaignId || !date || !adName) continue;

    const dateCampaignKey = `${normalizeCampaignDate(date)}:${campaignId}`;
    byDateCampaign.set(dateCampaignKey, combineAdNames([byDateCampaign.get(dateCampaignKey), adName]));
    byCampaign.set(campaignId, combineAdNames([byCampaign.get(campaignId), adName]));
  }

  return { byDateCampaign, byCampaign };
}

async function syncAccountHistoricalData(account, fromDate, toDate, options = {}) {
  const insights = await fetchAccountInsightsInRange(account, fromDate, toDate);
  const isShopee = normalizeProvider(account?.provider) === 'shopee';
  let adNamesByDateCampaign = new Map();
  try {
    const adNameMap = await fetchAccountAdNameMapInRange(account, fromDate, toDate);
    adNamesByDateCampaign = adNameMap.byDateCampaign;
  } catch (error) {
    console.warn(`[campaigns:adnames] skip ${account?.name || account?._id} ${fromDate}..${toDate}: ${error.message}`);
  }
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
    const msgAction = isShopee ? null : getMetaMessageActionFromInsight(insight);
    const messages = isShopee ? 0 : parseInt(msgAction?.value || 0, 10);
    const costPerMessage = isShopee ? 0 : getMetaCostPerMessageFromInsight(insight);
    const metaOrders = isShopee ? 0 : getMetaOrdersFromInsight(insight);
    const adName = adNamesByDateCampaign.get(`${normalizeCampaignDate(date)}:${String(insight.campaign_id).trim()}`) || '';

    const campaignUpdate = {
      name: insight.campaign_name,
      spend,
      impressions,
      clicks,
      messages,
      costPerMessage,
      metaOrders
    };
    if (adName) campaignUpdate.adName = adName;

    await upsertDailyCampaign(account._id, insight.campaign_id, date, campaignUpdate);
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
const dataPurchaseOrderSyncJobs = new Map();
const orderSheetSyncJobs = new Map();
let activeDataPurchaseOrderSyncJobId = '';
let activeOrderSheetSyncJobId = '';

function createSyncHistoryJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDataPurchaseOrderSyncJobId() {
  return `data-po-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function createOrderSheetSyncJobId() {
  return `orders-sheet-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function setDataPurchaseOrderSyncJob(jobId, updates) {
  const current = dataPurchaseOrderSyncJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
  dataPurchaseOrderSyncJobs.set(jobId, next);
  return next;
}

function toDataPurchaseOrderSyncJobPayload(job = {}) {
  return {
    id: job.id || '',
    state: job.state || 'unknown',
    percent: Number(job.percent || 0),
    imported: Number(job.imported || 0),
    matched: Number(job.matched || 0),
    modified: Number(job.modified || 0),
    upserted: Number(job.upserted || 0),
    deleted: Number(job.deleted || 0),
    sourceType: job.sourceType || '',
    message: job.message || '',
    error: job.error || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    finishedAt: job.finishedAt || ''
  };
}

async function runDataPurchaseOrderSyncJob(jobId, { accessToken = '', userId = '', googleConfig = null } = {}) {
  try {
    const job = dataPurchaseOrderSyncJobs.get(jobId);
    if (!job) return;

    setDataPurchaseOrderSyncJob(jobId, {
      state: 'active',
      percent: 10,
      message: 'Dang dong bo DATA dat hang'
    });

    let token = accessToken;
    if (!token && userId && googleConfig) {
      setDataPurchaseOrderSyncJob(jobId, {
        percent: 5,
        message: 'Dang lay quyen Google Sheet'
      });
      try {
        token = await getGoogleAccessTokenForUser(userId, googleConfig);
      } catch {
        token = '';
      }
    }

    setDataPurchaseOrderSyncJob(jobId, {
      percent: 10,
      message: 'Dang dong bo DATA dat hang'
    });

    const result = await syncDataPurchaseOrdersFromSheet({ accessToken: token });
    clearPurchaseOrderReadCache();
    setDataPurchaseOrderSyncJob(jobId, {
      state: 'completed',
      percent: 100,
      imported: result.imported || 0,
      matched: result.matched || 0,
      modified: result.modified || 0,
      upserted: result.upserted || 0,
      deleted: result.deleted || 0,
      sourceType: result.sourceType || '',
      finishedAt: new Date().toISOString(),
      message: 'Da dong bo DATA dat hang'
    });
  } catch (error) {
    setDataPurchaseOrderSyncJob(jobId, {
      state: 'failed',
      percent: 100,
      error: error.message,
      finishedAt: new Date().toISOString(),
      message: error.message
    });
  } finally {
    if (activeDataPurchaseOrderSyncJobId === jobId) {
      activeDataPurchaseOrderSyncJobId = '';
    }
    setTimeout(() => dataPurchaseOrderSyncJobs.delete(jobId), 60 * 60 * 1000);
  }
}

function setOrderSheetSyncJob(jobId, updates) {
  const current = orderSheetSyncJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
  orderSheetSyncJobs.set(jobId, next);
  return next;
}

function toOrderSheetSyncJobPayload(job = {}) {
  return {
    id: job.id || '',
    state: job.state || 'unknown',
    source: job.source || 'google_sheet',
    fromDate: job.fromDate || '',
    toDate: job.toDate || '',
    totalRows: Number(job.totalRows || 0),
    synced: Number(job.synced || 0),
    percent: Number(job.percent || 0),
    message: job.message || '',
    error: job.error || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    finishedAt: job.finishedAt || ''
  };
}

async function runOrderSheetSyncJob(jobId, { fromDate = '', toDate = '' } = {}) {
  try {
    const job = orderSheetSyncJobs.get(jobId);
    if (!job) return;

    setOrderSheetSyncJob(jobId, {
      state: 'active',
      percent: 10,
      message: 'Dang tai Google Sheet'
    });

    const result = await processOrderSheetSyncJob({ fromDate, toDate }, progress => {
      setOrderSheetSyncJob(jobId, {
        state: progress.state || 'active',
        percent: progress.percent || 0,
        message: progress.message || '',
        totalRows: progress.totalRows || 0,
        synced: progress.synced || 0,
        fromDate: progress.fromDate || fromDate,
        toDate: progress.toDate || toDate
      });
    });

    setOrderSheetSyncJob(jobId, {
      ...result,
      state: result.state || 'completed',
      finishedAt: new Date().toISOString()
    });
  } catch (error) {
    setOrderSheetSyncJob(jobId, {
      state: 'failed',
      percent: 100,
      error: error.message,
      message: error.message,
      finishedAt: new Date().toISOString()
    });
  } finally {
    if (activeOrderSheetSyncJobId === jobId) {
      activeOrderSheetSyncJobId = '';
    }
    setTimeout(() => orderSheetSyncJobs.delete(jobId), 60 * 60 * 1000);
  }
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

function startShopeeReactivateCron() {
  if (!cron.validate(SHOPEE_REACTIVATE_CRON)) {
    console.warn(`Invalid SHOPEE_REACTIVATE_CRON "${SHOPEE_REACTIVATE_CRON}", Shopee reactivate cron disabled`);
    return null;
  }

  const task = cron.schedule(SHOPEE_REACTIVATE_CRON, async () => {
    try {
      if (!isMongoReady()) return;
      const accounts = await Account.find({ autoEnabled: true, ...buildAccountProviderFilter('shopee') });
      for (const account of accounts) {
        await runAutoControlSafely(account, 'Shopee midnight reactivate', {
          allowShopeeReactivateAtMidnight: true
        });
      }
    } catch (error) {
      console.error(`Shopee reactivate cron failed: ${error.message}`);
    }
  }, { timezone: FINAL_SPEND_TIMEZONE });

  console.log(`Shopee reactivate cron scheduled: ${SHOPEE_REACTIVATE_CRON} (${FINAL_SPEND_TIMEZONE})`);
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

function parseCsvRows(text = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function normalizeCsvHeader(value = '') {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getCsvColumnIndex(headers = [], candidates = []) {
  const normalizedCandidates = candidates.map(normalizeCsvHeader).filter(Boolean);
  return headers.findIndex(header => {
    const normalizedHeader = normalizeCsvHeader(header);
    return normalizedCandidates.some(candidate =>
      normalizedHeader === candidate ||
      normalizedHeader.startsWith(candidate) ||
      candidate.startsWith(normalizedHeader)
    );
  });
}

function getCsvCell(row = [], indexes = [], fallback = '') {
  for (const index of indexes) {
    if (index < 0) continue;
    const value = row[index];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

function parseCsvNumber(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return 0;
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;

  let normalized = cleaned;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    normalized = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const parts = cleaned.split(',');
    normalized = parts.length === 2 && parts[1].length <= 2
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (hasDot) {
    const parts = cleaned.split('.');
    normalized = parts.length > 1 && parts.slice(1).every(part => part.length === 3)
      ? cleaned.replace(/\./g, '')
      : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsvInteger(value) {
  return Math.round(parseCsvNumber(value));
}

function formatCsvDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCsvCampaignDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoMatch = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) return formatCsvDate(isoMatch[1], isoMatch[2], isoMatch[3]);

  const slashMatch = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    if (first <= 12 && second > 12) return formatCsvDate(slashMatch[3], first, second);
    return formatCsvDate(slashMatch[3], second, first);
  }

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString().split('T')[0];

  return '';
}

const SHOPEE_COMMISSION_DATE_HEADERS = [
  'Thời Gian Đặt Hàng',
  'Thoi Gian Dat Hang',
  'Thời gian đặt hàng',
  'Ngay dat hang',
  'Order Time',
  'Order Date'
];
const SHOPEE_COMMISSION_SUB_ID2_HEADERS = ['Sub_id2', 'Sub ID2', 'sub_id2', 'subid2'];
const SHOPEE_COMMISSION_TOTAL_HEADERS = [
  'Tổng hoa hồng đơn hàng(₫)',
  'Tong hoa hong don hang',
  'Tổng hoa hồng đơn hàng',
  'Tổng hoa hồng',
  'Total Order Commission',
  'Total Commission'
];

function getRequiredCsvColumnIndex(headers = [], candidates = [], label = '') {
  const index = getCsvColumnIndex(headers, candidates);
  if (index < 0) throw new Error(`CSV thieu cot ${label || candidates[0]}`);
  return index;
}

async function importShopeeCommissionsFromCsvText(req, csvText = '', options = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error('File CSV khong co du lieu');

  const headers = rows[0];
  const dateIndex = getRequiredCsvColumnIndex(headers, SHOPEE_COMMISSION_DATE_HEADERS, 'ngay thang');
  const subId2Index = getRequiredCsvColumnIndex(headers, SHOPEE_COMMISSION_SUB_ID2_HEADERS, 'Sub_id2');
  const commissionIndex = getRequiredCsvColumnIndex(headers, SHOPEE_COMMISSION_TOTAL_HEADERS, 'tong hoa hong');
  const ownerUserId = req.currentUser?._id;
  if (!ownerUserId) throw new Error('Chua xac dinh duoc user import');

  const grouped = new Map();
  const skipped = {
    noDate: 0,
    noSubId2: 0,
    zeroCommission: 0
  };

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some(cell => String(cell || '').trim())) continue;

    const date = parseCsvCampaignDate(row[dateIndex]);
    if (!date) {
      skipped.noDate += 1;
      continue;
    }

    const subId2 = String(row[subId2Index] || '').trim();
    if (!subId2) {
      skipped.noSubId2 += 1;
      continue;
    }

    const rawCommission = String(row[commissionIndex] || '').split('.')[0];
    const commission = parseCsvNumber(rawCommission);
    if (!commission) skipped.zeroCommission += 1;

    const key = `${date}\u0000${subId2}`;
    const current = grouped.get(key) || { date, subId2, commission: 0, rowCount: 0 };
    current.commission += commission;
    current.rowCount += 1;
    grouped.set(key, current);
  }

  if (!grouped.size) throw new Error('CSV khong co dong hoa hong hop le de import');

  const now = new Date();
  const sourceFileName = String(options.sourceFileName || '').trim().slice(0, 300);
  const operations = [...grouped.values()].map(item => ({
    updateOne: {
      filter: { ownerUserId, date: item.date, subId2: item.subId2 },
      update: {
        $set: {
          commission: item.commission,
          rowCount: item.rowCount,
          sourceFileName,
          importedAt: now,
          updatedAt: now
        },
        $setOnInsert: { ownerUserId }
      },
      upsert: true
    }
  }));

  const result = await ShopeeCommission.bulkWrite(operations, { ordered: false });
  const totalCommission = [...grouped.values()].reduce((sum, item) => sum + item.commission, 0);

  return {
    ok: true,
    imported: grouped.size,
    sourceRows: Math.max(0, rows.length - 1),
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
    upserted: result.upsertedCount || 0,
    totalCommission,
    skipped
  };
}

function resolveCsvCampaignAccount(row, columnIndexes, accountsById, accountsByAdId, accountsByName, fallbackAccount) {
  const accountObjectId = getCsvCell(row, columnIndexes.accountObjectIds);
  if (accountObjectId && accountsById.has(accountObjectId)) return accountsById.get(accountObjectId);

  const adAccountId = getCsvCell(row, columnIndexes.adAccountIds);
  if (adAccountId) {
    const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
    const numericAdAccountId = normalizedAdAccountId.replace(/^act_/i, '');
    const matched = accountsByAdId.get(normalizedAdAccountId) || accountsByAdId.get(numericAdAccountId);
    if (matched) return matched;
  }

  const accountName = getCsvCell(row, columnIndexes.accountNames);
  if (accountName) {
    const matched = accountsByName.get(accountName.toLowerCase());
    if (matched) return matched;
  }

  return fallbackAccount || null;
}

async function importCampaignsFromCsvText(req, csvText = '', options = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error('File CSV khong co du lieu');

  const headers = rows[0];
  const provider = normalizeProvider(options.provider || 'facebook');
  const accountFilter = withUserFilter(req, buildAccountProviderFilter(provider));
  const accounts = await Account.find(accountFilter).select('_id name adAccountId provider').lean();
  if (!accounts.length) throw new Error('Khong tim thay tai khoan de import');

  let fallbackAccount = null;
  if (options.accountId) {
    fallbackAccount = accounts.find(account => String(account._id) === String(options.accountId)) || null;
    if (!fallbackAccount) throw new Error('Tai khoan import khong hop le');
  }

  const accountsById = new Map(accounts.map(account => [String(account._id), account]));
  const accountsByAdId = new Map();
  const accountsByName = new Map();
  for (const account of accounts) {
    const normalizedAdAccountId = normalizeAdAccountId(account.adAccountId);
    if (normalizedAdAccountId) {
      accountsByAdId.set(normalizedAdAccountId, account);
      accountsByAdId.set(normalizedAdAccountId.replace(/^act_/i, ''), account);
    }
    if (account.name) accountsByName.set(String(account.name).trim().toLowerCase(), account);
  }

  const columnIndexes = {
    dates: [getCsvColumnIndex(headers, ['Ngay', 'Date', 'Day', 'Date Start', 'date_start', 'dateStart', 'Start Date', 'Reporting starts', 'Ngay bat dau bao cao'])],
    endDates: [getCsvColumnIndex(headers, ['Date End', 'date_stop', 'dateStop', 'End Date', 'Reporting ends', 'Ngay ket thuc bao cao'])],
    campaignIds: [getCsvColumnIndex(headers, ['ID Campaign', 'Campaign ID', 'campaign_id', 'campaignId', 'Ma campaign', 'ID chien dich'])],
    campaignNames: [getCsvColumnIndex(headers, ['Ten Campaign', 'Campaign name', 'campaign_name', 'campaignName', 'Campaign', 'Ten chien dich', 'Chien dich'])],
    accountObjectIds: [getCsvColumnIndex(headers, ['accountId', 'Account Object ID', '_id'])],
    adAccountIds: [getCsvColumnIndex(headers, ['ID TKQC', 'Ad account ID', 'Account ID', 'account_id', 'adAccountId', 'ID tai khoan quang cao', 'ID tai khoan'])],
    accountNames: [getCsvColumnIndex(headers, ['Ten TKQC', 'Account name', 'Ad account name', 'account_name', 'Ten tai khoan quang cao', 'Ten tai khoan'])],
    adNames: [getCsvColumnIndex(headers, ['Ad Name', 'Ten quang cao', 'ad_name'])],
    statuses: [getCsvColumnIndex(headers, ['Trang Thai', 'Status', 'Delivery', 'campaign_status', 'Phan phoi'])],
    spends: [getCsvColumnIndex(headers, ['Chi tieu', 'Spend', 'Amount spent', 'Amount Spent', 'amount_spent', 'So tien da chi tieu', 'So tien da chi tieu VND'])],
    messages: [getCsvColumnIndex(headers, ['Tin nhan', 'Messages', 'Messaging conversations started', 'Conversations', 'Bat dau tro chuyen', 'BDCT', 'Luot bat dau cuoc tro chuyen qua tin nhan', 'So luot bat dau cuoc tro chuyen qua tin nhan'])],
    costPerMessages: [getCsvColumnIndex(headers, ['Gia/TN', 'Cost per messaging conversation started', 'Cost per message', 'costPerMessage', 'cost_per_message', 'Chi phi tren moi luot bat dau cuoc tro chuyen qua tin nhan'])],
    clicks: [getCsvColumnIndex(headers, ['Clicks', 'Link clicks', 'clicks', 'Luot click vao lien ket', 'Luot click'])],
    impressions: [getCsvColumnIndex(headers, ['Hien thi', 'Impressions', 'impressions', 'Luot hien thi'])],
    metaOrders: [getCsvColumnIndex(headers, ['Don Meta', 'Meta orders', 'Purchases', 'Website purchases', 'metaOrders', 'Luot mua', 'Giao dich mua'])]
  };

  if (columnIndexes.dates.every(index => index < 0) && columnIndexes.endDates.every(index => index < 0)) throw new Error('CSV thieu cot ngay');
  if (columnIndexes.campaignIds.every(index => index < 0) && columnIndexes.campaignNames.every(index => index < 0)) {
    throw new Error('CSV thieu cot campaign name hoac campaign id');
  }
  const hasAccountColumn = columnIndexes.adAccountIds.some(index => index >= 0)
    || columnIndexes.accountNames.some(index => index >= 0)
    || columnIndexes.accountObjectIds.some(index => index >= 0);
  if (!fallbackAccount && !hasAccountColumn) {
    throw new Error('CSV thieu cot tai khoan. Hay chon mot tai khoan truoc khi import hoac them cot ID TKQC/Ten TKQC.');
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];
  const campaignRowsByKey = new Map();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some(cell => String(cell || '').trim())) continue;

    const date = parseCsvCampaignDate(getCsvCell(row, columnIndexes.dates) || getCsvCell(row, columnIndexes.endDates));
    const campaignName = getCsvCell(row, columnIndexes.campaignNames);
    const campaignId = getCsvCell(row, columnIndexes.campaignIds) || campaignName;
    const adName = getCsvCell(row, columnIndexes.adNames);
    const account = resolveCsvCampaignAccount(row, columnIndexes, accountsById, accountsByAdId, accountsByName, fallbackAccount);

    if (!date || !campaignId || !account) {
      skipped += 1;
      if (errors.length < 20) {
        errors.push({
          row: rowIndex + 1,
          error: !date ? 'Thieu ngay hop le' : (!campaignId ? 'Thieu campaign id' : 'Khong map duoc tai khoan')
        });
      }
      continue;
    }

    const spend = parseCsvNumber(getCsvCell(row, columnIndexes.spends));
    const rawCostPerMessage = parseCsvNumber(getCsvCell(row, columnIndexes.costPerMessages));
    const rawMessages = parseCsvInteger(getCsvCell(row, columnIndexes.messages));
    const messages = rawMessages > 0 ? rawMessages : (spend > 0 && rawCostPerMessage > 0 ? Math.round(spend / rawCostPerMessage) : 0);
    const costPerMessage = rawCostPerMessage > 0 ? rawCostPerMessage : (messages > 0 ? spend / messages : 0);
    const clicks = parseCsvInteger(getCsvCell(row, columnIndexes.clicks));
    const impressions = parseCsvInteger(getCsvCell(row, columnIndexes.impressions));
    const metaOrders = parseCsvInteger(getCsvCell(row, columnIndexes.metaOrders));
    const key = `${account._id}:${date}:${campaignId}`;
    const aggregate = campaignRowsByKey.get(key) || {
      account,
      date,
      campaignId,
      name: campaignName || campaignId,
      adName: adName || '',
      status: getCsvCell(row, columnIndexes.statuses),
      spend: 0,
      messages: 0,
      costPerMessage: 0,
      clicks: 0,
      impressions: 0,
      metaOrders: 0,
      costPerMessageWeightedTotal: 0,
      costPerMessageWeight: 0
    };

    aggregate.spend += spend;
    aggregate.messages += messages;
    aggregate.clicks += clicks;
    aggregate.impressions += impressions;
    aggregate.metaOrders += metaOrders;
    if (campaignName && !aggregate.name) aggregate.name = campaignName;
    if (adName) aggregate.adName = combineAdNames([aggregate.adName, adName]);
    if (costPerMessage > 0 && messages > 0) {
      aggregate.costPerMessageWeightedTotal += costPerMessage * messages;
      aggregate.costPerMessageWeight += messages;
    }
    campaignRowsByKey.set(key, aggregate);
  }

  for (const aggregate of campaignRowsByKey.values()) {
    const costPerMessage = aggregate.costPerMessageWeight > 0
      ? aggregate.costPerMessageWeightedTotal / aggregate.costPerMessageWeight
      : (aggregate.messages > 0 ? aggregate.spend / aggregate.messages : 0);

    const campaignUpdate = {
      name: aggregate.name || aggregate.campaignId,
      status: aggregate.status,
      spend: aggregate.spend,
      messages: aggregate.messages,
      costPerMessage,
      clicks: aggregate.clicks,
      impressions: aggregate.impressions,
      metaOrders: aggregate.metaOrders
    };
    if (aggregate.adName) campaignUpdate.adName = aggregate.adName;

    await upsertDailyCampaign(aggregate.account._id, aggregate.campaignId, aggregate.date, campaignUpdate);

    imported += 1;
  }

  return { ok: true, imported, skipped, errors, totalRows: Math.max(0, rows.length - 1), sourceRows: Math.max(0, rows.length - 1) };
}

app.post('/api/campaigns/import-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';
    let provider = '';
    let accountId = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chua chon file CSV' });
      }
      csvText = await csvFile.text();
      provider = String(formData.get('provider') || '');
      accountId = String(formData.get('accountId') || '');
    } else {
      csvText = String(req.body?.csv || '');
      provider = String(req.body?.provider || '');
      accountId = String(req.body?.accountId || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rong hoac khong doc duoc du lieu' });
    }

    const result = await importCampaignsFromCsvText(req, csvText, { provider, accountId });
    res.json(result);
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
      'Ten quang cao': c.adName || '',
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

app.get('/api/shopee/commission-summary', async (req, res) => {
  try {
    const defaultFromDate = '2026-04-27';
    const fromDate = normalizeCampaignDate(req.query.fromDate || defaultFromDate);
    const toDate = normalizeCampaignDate(req.query.toDate || todayStr());
    if (fromDate > toDate) {
      return res.status(400).json({ error: 'fromDate phai nho hon hoac bang toDate' });
    }

    const accountFilter = withUserFilter(req, buildAccountProviderFilter('shopee'));
    const accounts = await Account.find(accountFilter).select('_id name adAccountId').lean();
    const accountIds = accounts.map(account => account._id);

    const match = {
      accountId: { $in: accountIds },
      date: { $gte: fromDate, $lte: toDate }
    };
    const commissionMatch = {
      ownerUserId: req.currentUser._id,
      date: { $gte: fromDate, $lte: toDate }
    };

    const [totalRows, byDate, byAccount, commissionBySubId, commissionByDate] = await Promise.all([
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalSpend: { $sum: '$spend' },
            totalClicks: { $sum: '$clicks' },
            totalCampaignRows: { $sum: 1 },
            activeDays: { $addToSet: '$date' }
          }
        },
        {
          $project: {
            _id: 0,
            totalSpend: 1,
            totalClicks: 1,
            totalCampaignRows: 1,
            activeDayCount: { $size: '$activeDays' }
          }
        }
      ]),
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$date',
            spend: { $sum: '$spend' },
            clicks: { $sum: '$clicks' },
            campaignRows: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', spend: 1, clicks: 1, campaignRows: 1 } },
        { $sort: { date: 1 } }
      ]),
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$accountId',
            spend: { $sum: '$spend' },
            clicks: { $sum: '$clicks' },
            campaignRows: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'accounts',
            localField: '_id',
            foreignField: '_id',
            as: 'account'
          }
        },
        { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            accountId: '$_id',
            accountName: '$account.name',
            adAccountId: '$account.adAccountId',
            spend: 1,
            clicks: 1,
            campaignRows: 1
          }
        },
        { $sort: { spend: -1 } }
      ]),
      ShopeeCommission.aggregate([
        { $match: commissionMatch },
        {
          $group: {
            _id: '$subId2',
            commission: { $sum: '$commission' },
            rowCount: { $sum: '$rowCount' },
            activeDays: { $addToSet: '$date' }
          }
        },
        {
          $project: {
            _id: 0,
            subId2: '$_id',
            commission: 1,
            rowCount: 1,
            activeDayCount: { $size: '$activeDays' }
          }
        },
        { $sort: { commission: -1, subId2: 1 } }
      ]),
      ShopeeCommission.aggregate([
        { $match: commissionMatch },
        {
          $group: {
            _id: '$date',
            commission: { $sum: '$commission' },
            subIdCount: { $sum: 1 },
            rowCount: { $sum: '$rowCount' }
          }
        },
        { $project: { _id: 0, date: '$_id', commission: 1, subIdCount: 1, rowCount: 1 } },
        { $sort: { date: 1 } }
      ])
    ]);

    const totals = totalRows[0] || {};
    const commissionTotal = commissionBySubId.reduce((sum, item) => sum + Number(item.commission || 0), 0);
    const autoConfig = await getUserAutoConfig(req.currentUser._id);

    const spendByCampaignName = await Campaign.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $toLower: '$name' },
          spend: { $sum: '$spend' },
          originalName: { $first: '$name' }
        }
      }
    ]);

    const unifiedMap = new Map();
    for (const item of commissionBySubId) {
      const key = String(item.subId2 || '').trim().toLowerCase();
      unifiedMap.set(key, {
        subId2: item.subId2,
        commission: item.commission || 0,
        spend: 0
      });
    }

    for (const item of spendByCampaignName) {
      const key = String(item._id || '').trim().toLowerCase();
      const existing = unifiedMap.get(key) || {
        subId2: item.originalName || item._id,
        commission: 0,
        spend: 0
      };
      existing.spend += (item.spend || 0);
      unifiedMap.set(key, existing);
    }

    let unifiedList = Array.from(unifiedMap.values()).map(item => {
      const doanhThu = item.commission - item.spend;
      const roi = item.spend > 0 ? (doanhThu / item.spend) * 100 : (doanhThu > 0 ? 100 : 0);
      const optimization = getShopeeOptimizationDecision({
        spend: item.spend,
        commission: item.commission,
        minSpendLimit: autoConfig.autoPauseShopeeMinSpendLimit
      });
      return {
        ...item,
        doanhThu,
        roi,
        roas: optimization.roas,
        hhAdsPercent: optimization.hhAdsPercent,
        optimization
      };
    });

    unifiedList.sort((a, b) => b.commission - a.commission || b.spend - a.spend);
    unifiedList = unifiedList.slice(0, 500);

    // Swap original array contents
    commissionBySubId.length = 0;
    commissionBySubId.push(...unifiedList);

    res.json({
      fromDate,
      toDate,
      accountCount: accounts.length,
      totalSpend: totals.totalSpend || 0,
      totalClicks: totals.totalClicks || 0,
      totalCampaignRows: totals.totalCampaignRows || 0,
      activeDayCount: totals.activeDayCount || 0,
      totalCommission: commissionTotal,
      autoPauseShopeeMinSpendLimit: autoConfig.autoPauseShopeeMinSpendLimit,
      commissionSubIdCount: commissionBySubId.length,
      commissionBySubId,
      commissionByDate,
      byDate,
      byAccount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shopee/commission-import-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';
    let sourceFileName = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chua chon file CSV hoa hong Shopee' });
      }
      csvText = await csvFile.text();
      sourceFileName = String(csvFile.name || '');
    } else {
      csvText = String(req.body?.csv || '');
      sourceFileName = String(req.body?.sourceFileName || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rong hoac khong doc duoc du lieu' });
    }

    const result = await importShopeeCommissionsFromCsvText(req, csvText, { sourceFileName });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
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
    const search = String(req.query.search || '').trim();
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const wantsPaged = req.query.page !== undefined || req.query.limit !== undefined;

    if (useSheetOrders()) {
      if (wantsPaged) {
        const data = await getOrderSheetPage({ fromDate, toDate, search, page, limit });
        res.json({
          ok: true,
          source: 'google_sheet',
          ...data
        });
        return;
      }
      const orders = await getOrderSheetOrders({ fromDate, toDate, search });
      res.json(orders);
      return;
    }

    const query = buildOrderQuery({ fromDate, toDate });
    if (search) {
      const searchRegex = escapeRegExp(search);
      query.$or = [
        { orderId: { $regex: searchRegex, $options: 'i' } },
        { status: { $regex: searchRegex, $options: 'i' } },
        { customerName: { $regex: searchRegex, $options: 'i' } },
        { 'rawData.status_name': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col4': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col8': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col11': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col13': { $regex: searchRegex, $options: 'i' } }
      ];
    }
    if (wantsPaged) {
      const [orders, total, statsOrders] = await Promise.all([
        Order.find(query)
          .select('orderId status rawData createdAt')
          .sort('-createdAt')
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Order.countDocuments(query),
        Order.find(query).select('rawData orderId status customerName').limit(200000).lean()
      ]);
      res.json({
        ok: true,
        source: 'database',
        orders,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        stats: buildOrderTableStats(statsOrders)
      });
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

function createReturnSummaryBucketMap() {
  return RETURN_SUMMARY_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = {
      key: bucket.key,
      label: bucket.label,
      orderCount: 0,
      amount: 0,
      costPerOrder: 0
    };
    return acc;
  }, {});
}

function finalizeReturnSummaryBucket(bucket = {}) {
  const orderCount = Number(bucket.orderCount || 0);
  const amount = Number(bucket.amount || 0);
  return {
    ...bucket,
    orderCount,
    amount,
    costPerOrder: orderCount > 0 ? amount / orderCount : 0
  };
}

function makeReturnSummaryDateKeys(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const keys = [];
  for (let cursor = start, guard = 0; cursor <= end && guard < 370; guard += 1) {
    keys.push(cursor.toISOString().split('T')[0]);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return keys;
}

function getReturnSummaryDailyRow(dailyMap, dateKey) {
  if (!dailyMap.has(dateKey)) {
    dailyMap.set(dateKey, {
      date: dateKey,
      categories: createReturnSummaryBucketMap(),
      totalOrderCount: 0,
      totalShippedOrderCount: 0
    });
  }
  return dailyMap.get(dateKey);
}

function finalizeReturnSummaryDailyRow(row = {}) {
  const categories = RETURN_SUMMARY_BUCKETS.map(bucket => (
    finalizeReturnSummaryBucket(row.categories?.[bucket.key] || {
      key: bucket.key,
      label: bucket.label
    })
  ));
  const total = finalizeReturnSummaryBucket(categories.reduce((acc, item) => {
    acc.orderCount += item.orderCount;
    acc.amount += item.amount;
    return acc;
  }, { key: 'total', label: 'Tổng', orderCount: 0, amount: 0 }));
  const totalOrderCount = Number(row.totalOrderCount);
  if (Number.isFinite(totalOrderCount) && totalOrderCount >= 0) {
    total.orderCount = totalOrderCount;
    total.costPerOrder = total.orderCount > 0 ? total.amount / total.orderCount : 0;
  }
  total.shippedOrderCount = Number(row.totalShippedOrderCount || 0);
  total.shipRate = total.orderCount > 0 ? total.shippedOrderCount / total.orderCount : 0;

  return {
    date: row.date,
    categories,
    total
  };
}

function buildProductReturnSummary(orderRows = []) {
  const skuStats = buildOrderSkuStats(orderRows);
  const rows = Object.entries(skuStats.returnStatsBySku || {})
    .map(([sku, stats = {}]) => {
      const returned = Number(stats.returned || 0);
      const returning = Number(stats.returning || 0);
      const received = Number(stats.received || 0);
      const returnCount = returned + returning;
      const denominator = Number(stats.denominator || (returnCount + received));
      return {
        sku,
        returned,
        returning,
        received,
        returnCount,
        denominator,
        rate: denominator > 0 ? returnCount / denominator : 0
      };
    })
    .filter(row => row.denominator > 0)
    .sort((a, b) => (
      (b.rate - a.rate) ||
      (b.returnCount - a.returnCount) ||
      (b.denominator - a.denominator) ||
      a.sku.localeCompare(b.sku)
    ));

  const total = rows.reduce((acc, row) => {
    acc.returned += row.returned;
    acc.returning += row.returning;
    acc.received += row.received;
    acc.returnCount += row.returnCount;
    acc.denominator += row.denominator;
    return acc;
  }, {
    returned: 0,
    returning: 0,
    received: 0,
    returnCount: 0,
    denominator: 0,
    rate: 0
  });
  total.rate = total.denominator > 0 ? total.returnCount / total.denominator : 0;

  return {
    rows: rows.slice(0, 100),
    total
  };
}

app.get('/api/return-summary', async (req, res) => {
  try {
    const provider = normalizeProvider(req.query.provider || 'facebook');
    const fromDate = String(req.query.fromDate || '').slice(0, 10);
    const toDate = String(req.query.toDate || '').slice(0, 10);
    const refresh = req.query.refresh === 'true' || req.query.refresh === true;
    const hasValidFromDate = !fromDate || /^\d{4}-\d{2}-\d{2}$/.test(fromDate);
    const hasValidToDate = !toDate || /^\d{4}-\d{2}-\d{2}$/.test(toDate);
    if (!hasValidFromDate || !hasValidToDate || (fromDate && toDate && fromDate > toDate)) {
      return res.status(400).json({ error: 'Khoang ngay khong hop le' });
    }

    const cacheKey = userScopedCacheKey(req, `return-summary:${provider}:${fromDate || 'all'}:${toDate || 'all'}:${ordersSheetCache.fetchedAt || 0}`);
    const cached = refresh ? null : getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const accounts = await Account.find(withUserFilter(req, buildAccountProviderFilter(provider)))
      .select('_id')
      .lean();
    const accountIds = accounts.map(account => account._id);
    const campaignMatch = {
      accountId: { $in: accountIds }
    };
    if (fromDate || toDate) {
      campaignMatch.date = {};
      if (fromDate) campaignMatch.date.$gte = fromDate;
      if (toDate) campaignMatch.date.$lte = toDate;
    }

    const [orderRows, campaignRows] = await Promise.all([
      useSheetOrders()
        ? getOrderSheetOrders({ fromDate, toDate, limit: 200000, refresh })
        : Order.find(buildOrderQuery({ fromDate, toDate }))
          .select('orderId status rawData createdAt')
          .limit(200000)
          .lean(),
      accountIds.length ? Campaign.aggregate([
        {
          $match: campaignMatch
        },
        {
          $group: {
            _id: { date: '$date', adName: '$adName' },
            date: { $first: '$date' },
            adName: { $first: '$adName' },
            amount: { $sum: '$spend' }
          }
        },
        { $project: { _id: 0, date: 1, adName: 1, amount: 1 } }
      ]).allowDiskUse(true) : Promise.resolve([])
    ]);

    const orderStats = buildReturnSummaryOrderStats(orderRows, { fromDate, toDate });
    const productReturnSummary = buildProductReturnSummary(orderRows);
    const productReturnRateSummary = buildReturnProductRateStats(orderRows);
    const categories = createReturnSummaryBucketMap();
    const dailyMap = new Map();

    RETURN_SUMMARY_BUCKETS.forEach(bucket => {
      categories[bucket.key].orderCount = Number(orderStats.categories?.[bucket.key]?.orderCount || 0);
    });

    Object.entries(orderStats.daily || {}).forEach(([dateKey, byBucket]) => {
      const day = getReturnSummaryDailyRow(dailyMap, dateKey);
      day.totalOrderCount = Number(byBucket?.total?.orderCount || 0);
      day.totalShippedOrderCount = Number(byBucket?.total?.shippedOrderCount || 0);
      RETURN_SUMMARY_BUCKETS.forEach(bucket => {
        day.categories[bucket.key].orderCount = Number(byBucket?.[bucket.key]?.orderCount || 0);
      });
    });

    campaignRows.forEach(row => {
      const dateKey = String(row.date || '').slice(0, 10);
      if (!dateKey) return;
      const bucketKey = classifyReturnAdNameBucket(row.adName);
      if (!bucketKey || !categories[bucketKey]) return;

      const amount = Number(row.amount || 0);
      categories[bucketKey].amount += amount;
      getReturnSummaryDailyRow(dailyMap, dateKey).categories[bucketKey].amount += amount;
    });

    const categoryRows = RETURN_SUMMARY_BUCKETS.map(bucket => finalizeReturnSummaryBucket(categories[bucket.key]));
    const total = finalizeReturnSummaryBucket(categoryRows.reduce((acc, item) => {
      acc.amount += item.amount;
      return acc;
    }, {
      key: 'total',
      label: 'Tổng',
      orderCount: Number(orderStats.total?.orderCount || 0),
      amount: 0
    }));
    total.shippedOrderCount = Number(orderStats.total?.shippedOrderCount || 0);
    total.shipRate = total.orderCount > 0 ? total.shippedOrderCount / total.orderCount : 0;

    const fullDateKeys = makeReturnSummaryDateKeys(fromDate, toDate);
    const dateKeys = fullDateKeys.length > 0 && fullDateKeys.length <= 120
      ? fullDateKeys
      : [...dailyMap.keys()].sort();
    const dailyRows = dateKeys
      .map(dateKey => finalizeReturnSummaryDailyRow(getReturnSummaryDailyRow(dailyMap, dateKey)))
      .filter(row => fullDateKeys.length <= 120 || row.total.orderCount > 0 || row.total.amount > 0);

    res.json(setReadCache(cacheKey, {
      ok: true,
      source: {
        orders: useSheetOrders() ? 'google_sheet' : 'database',
        campaigns: 'database'
      },
      fromDate,
      toDate,
      provider,
      categories: categoryRows,
      total,
      dailyRows,
      productReturnRows: productReturnSummary.rows,
      productReturnTotal: productReturnRateSummary.total,
      productReturnCategories: productReturnRateSummary.categories,
      orderTotal: Number(orderStats.total?.orderCount || 0),
      campaignRowCount: campaignRows.length
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Đồng bộ đơn hàng từ Google Sheet ──

app.get('/api/data-purchase-orders', async (req, res) => {
  try {
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const search = String(req.query.search || '').trim();
    const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());

    if (refresh) {
      let accessToken = '';
      try {
        accessToken = await getGoogleAccessToken(req);
      } catch {
        accessToken = '';
      }
      await syncDataPurchaseOrdersFromSheet({ accessToken });
      clearPurchaseOrderReadCache();
    }

    const cacheKey = `data-purchase-orders:${page}:${limit}:${search}`;
    const cached = !refresh ? getPurchaseOrderReadCache(cacheKey) : null;
    if (cached) return res.json(cached);

    const data = await getDataPurchaseOrders({ page, limit, search });
    res.json(setPurchaseOrderReadCache(cacheKey, { ok: true, ...data }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/data-purchase-orders/sync', async (req, res) => {
  try {
    if (activeDataPurchaseOrderSyncJobId) {
      const activeJob = dataPurchaseOrderSyncJobs.get(activeDataPurchaseOrderSyncJobId);
      if (activeJob && ['pending', 'active'].includes(activeJob.state)) {
        return res.status(202).json({
          ok: true,
          queued: true,
          jobId: activeJob.id,
          job: toDataPurchaseOrderSyncJobPayload(activeJob),
          statusUrl: `/api/data-purchase-orders/sync/${activeJob.id}`,
          message: 'DATA dat hang dang duoc dong bo trong nen'
        });
      }
      activeDataPurchaseOrderSyncJobId = '';
    }

    const userId = String(req.currentUser?._id || '');
    const googleConfig = getGoogleOAuthConfig(req);

    const jobId = createDataPurchaseOrderSyncJobId();
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      state: 'pending',
      percent: 0,
      imported: 0,
      message: 'Dang cho dong bo DATA dat hang',
      createdAt: now,
      updatedAt: now
    };
    dataPurchaseOrderSyncJobs.set(jobId, job);
    activeDataPurchaseOrderSyncJobId = jobId;

    setImmediate(() => {
      runDataPurchaseOrderSyncJob(jobId, { userId, googleConfig });
    });

    res.status(202).json({
      ok: true,
      queued: true,
      jobId,
      job: toDataPurchaseOrderSyncJobPayload(job),
      statusUrl: `/api/data-purchase-orders/sync/${jobId}`,
      message: 'Da bat dau dong bo DATA dat hang trong nen'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/data-purchase-orders/sync/:jobId', async (req, res) => {
  try {
    const job = dataPurchaseOrderSyncJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job dong bo DATA' });
    res.json({ ok: true, job: toDataPurchaseOrderSyncJobPayload(job) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/data-purchase-orders/import-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chưa chọn file CSV' });
      }
      csvText = await csvFile.text();
    } else {
      csvText = String(req.body?.csv || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rỗng hoặc không đọc được dữ liệu' });
    }

    const result = await importDataPurchaseOrdersFromCsvText(csvText);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/purchase-orders', async (req, res) => {
  try {
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();
    const search = String(req.query.search || '').trim();
    const cacheKey = `purchase-orders:${page}:${limit}:${fromDate}:${toDate}:${search}`;
    const cached = getPurchaseOrderReadCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await getPurchaseOrders({ fromDate, toDate, search, page, limit });
    res.json(setPurchaseOrderReadCache(cacheKey, { ok: true, ...data }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/purchase-orders/import-status-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chưa chọn file CSV' });
      }
      csvText = await csvFile.text();
    } else {
      csvText = String(req.body?.csv || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rỗng hoặc không đọc được dữ liệu' });
    }

    const result = await importPurchaseOrderStatusesFromCsvText(csvText);
    clearPurchaseOrderReadCache();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/purchase-orders/:orderId', async (req, res) => {
  try {
    const result = await updatePurchaseOrder(req.params.orderId, req.body || {});
    clearPurchaseOrderReadCache();
    res.json({ ok: true, order: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/oder/dashboard', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'fromDate va toDate la bat buoc' });
    }

    const cacheKey = `oder-dashboard:${fromDate}:${toDate}`;
    const cached = getPurchaseOrderReadCache(cacheKey);
    if (cached) return res.json(cached);

    const result = await getPurchaseOrderDashboard({ fromDate, toDate });
    return res.json(setPurchaseOrderReadCache(cacheKey, { ok: true, ...result }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/oder/dashboard/cancellations/:dateKey', async (req, res) => {
  try {
    const result = await updatePurchaseOrderDashboardCancellation(
      req.params.dateKey,
      req.body?.huy ?? req.body?.canceledCount ?? 0
    );
    clearPurchaseOrderReadCache();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/oder/dashboard/notes/:dateKey', async (req, res) => {
  try {
    const result = await updatePurchaseOrderDashboardNote(
      req.params.dateKey,
      req.body?.note ?? ''
    );
    clearPurchaseOrderReadCache();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const filter = await getInventoryFilter(req);
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
    const googleAccessToken = await getInventoryGoogleAccessToken(req);
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
    const googleAccessToken = await getInventoryGoogleAccessToken(req);
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

    const items = await InventoryItem.find(await getInventoryFilter(req))
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
    const googleAccessToken = await getInventoryGoogleAccessToken(req);
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
      await getInventoryFilter(req, { barcode }),
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
    const ownerUserId = await getInventoryOwnerUserId(req);
    try {
      const googleAccessToken = await getInventoryGoogleAccessToken(req);
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
          filter: withInventoryOwnerFilter(ownerUserId, { barcode: item.barcode }),
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

    const deleteFilter = withInventoryOwnerFilter(ownerUserId, sheetBarcodes.size
      ? { barcode: { $nin: Array.from(sheetBarcodes) } }
      : {});
    const deleteResult = await InventoryItem.deleteMany(deleteFilter);

    const items = await InventoryItem.find(withInventoryOwnerFilter(ownerUserId))
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
    const ownerUserId = await getInventoryOwnerUserId(req);
    if (!productCode) {
      return res.status(400).json({ error: 'Thieu ma san pham' });
    }

    const inventoryItems = await InventoryItem.find(withInventoryOwnerFilter(ownerUserId))
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
      withInventoryOwnerFilter(ownerUserId, { _id: { $in: matchedIds } }),
      { $set: { salePrice, updatedAt: now } }
    );

    const items = await InventoryItem.find(withInventoryOwnerFilter(ownerUserId, { _id: { $in: matchedIds } }))
      .sort({ barcode: 1 })
      .lean();

    res.json({ ok: true, updated: items.length, productCode, salePrice, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/inventory/:id', async (req, res) => {
  try {
    const ownerUserId = await getInventoryOwnerUserId(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID san pham khong hop le' });
    }

    const currentItem = await InventoryItem.findOne(withInventoryOwnerFilter(ownerUserId, { _id: req.params.id }))
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
      withInventoryOwnerFilter(ownerUserId, { _id: req.params.id }),
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
    const ownerUserId = await getInventoryOwnerUserId(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID san pham khong hop le' });
    }

    const result = await InventoryItem.deleteOne(withInventoryOwnerFilter(ownerUserId, { _id: req.params.id }));
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

    if (req.body?.queue === true) {
      if (activeOrderSheetSyncJobId) {
        const activeJob = orderSheetSyncJobs.get(activeOrderSheetSyncJobId);
        if (activeJob && ['pending', 'active'].includes(activeJob.state)) {
          return res.status(202).json({
            ok: true,
            queued: true,
            jobId: activeJob.id,
            job: toOrderSheetSyncJobPayload(activeJob),
            statusUrl: `/api/orders/sync/${activeJob.id}`,
            message: 'Dang tai don hang trong nen'
          });
        }
        activeOrderSheetSyncJobId = '';
      }

      const jobId = createOrderSheetSyncJobId();
      const now = new Date().toISOString();
      const job = {
        id: jobId,
        state: 'pending',
        source: 'google_sheet',
        fromDate: fromDate || '',
        toDate: toDate || '',
        totalRows: 0,
        synced: 0,
        percent: 0,
        message: 'Dang cho tai Google Sheet',
        createdAt: now,
        updatedAt: now
      };
      orderSheetSyncJobs.set(jobId, job);
      activeOrderSheetSyncJobId = jobId;

      setImmediate(() => {
        runOrderSheetSyncJob(jobId, { fromDate, toDate });
      });

      return res.status(202).json({
        ok: true,
        queued: true,
        jobId,
        job: toOrderSheetSyncJobPayload(job),
        statusUrl: `/api/orders/sync/${jobId}`,
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
    const memoryJob = orderSheetSyncJobs.get(req.params.jobId);
    if (memoryJob) {
      return res.json({ ok: true, job: toOrderSheetSyncJobPayload(memoryJob) });
    }

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
  fbPost,
  FACEBOOK_GRAPH_API_VERSION,
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

async function ensurePurchaseOrderStorage() {
  const purchaseOrdersCollection = mongoose.connection.collection('purchaseorders');
  const legacyIndexNames = [
    'purchase_order_sheet_row_unique',
    'sheetId_1_sheetName_1_rowNumber_1'
  ];

  for (const indexName of legacyIndexNames) {
    try {
      await purchaseOrdersCollection.dropIndex(indexName);
      console.log(`Dropped legacy purchase order index: ${indexName}`);
    } catch (error) {
      if (!['IndexNotFound', 'NamespaceNotFound'].includes(error?.codeName)) {
        throw error;
      }
    }
  }
}

async function ensureApplicationIndexes() {
  await ensurePurchaseOrderStorage();
  await Promise.all([
    Account.createIndexes(),
    Log.createIndexes(),
    Order.createIndexes(),
    InventoryItem.createIndexes(),
    FacebookPost.createIndexes(),
    DataPurchaseOrder.createIndexes(),
    PurchaseOrder.createIndexes(),
    ShopeeCommission.createIndexes(),
    Config.createIndexes(),
    User.createIndexes(),
    FacebookToken.createIndexes()
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
    shopeeReactivateCronTask = startShopeeReactivateCron();
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
      if (ordersSheetCache.rateLimitedUntil > Date.now() && ordersSheetCache.rows?.length) {
        console.warn(`Sheet Cache: skip startup refresh due to rate limit until ${new Date(ordersSheetCache.rateLimitedUntil).toISOString()}; using cached ${ordersSheetCache.rows.length} rows`);
        return;
      }
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
      if (ordersSheetCache.rateLimitedUntil > Date.now() && ordersSheetCache.rows?.length) {
        console.warn(`Sheet Cache: skip refresh due to rate limit until ${new Date(ordersSheetCache.rateLimitedUntil).toISOString()}; using cached ${ordersSheetCache.rows.length} rows`);
        return;
      }
      console.log('Sheet Cache: Đang refresh đơn hàng từ Google Sheet...');
      if (orderSheetSyncQueue) {
        await orderSheetSyncQueue.add('sync-sheet', {}, {
          jobId: `order-sheet-sync-${Math.floor(Date.now() / (60 * 1000))}`
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
  }, 60 * 1000);

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
  if (shopeeReactivateCronTask) {
    shopeeReactivateCronTask.stop();
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

