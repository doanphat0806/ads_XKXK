const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { registerAllRoutes } = require('../routes');
const { registerLegacyRoutes } = require('../routes/legacyRoutes');
const { registerReportRoutes } = require('../routes/reportRoutes');
const { authenticateApiRequest } = require('../middleware/auth');
const { parseBoundedInt } = require('../utils/number');
const { parseCsvRows, normalizeCsvHeader, getCsvColumnIndex, getCsvCell, parseCsvNumber, parseCsvInteger, parseCsvCampaignDate } = require('../utils/csvImport');
const { normalizeProvider } = require('../utils/authUtils');
const {
  getVietnamDayMinute, isVietnamTimeMinute, isWithinAutoRuleTimeWindow, todayStr,
  dateKeyFromVnOffset, normalizeCampaignDate, buildVnDateRange,
  isAfterVietnamTime, parseHourMinute, getVnDateKeyFromDateValue,
  isDateKeyInRange, getVietnamDateRangeBounds, dateRangeIncludesToday,
  dateRangeTouchesTodayOrFuture
} = require('../utils/timeUtils');
const {
  getGoogleOAuthConfig, requireGoogleOAuthConfig, getGoogleAccessToken,
  getGoogleAccessTokenForUser
} = require('../utils/googleOAuth');
const {
  getReadCache, setReadCache, clearCampaignReadCache, clearAllReadCache,
  getPurchaseOrderReadCache, setPurchaseOrderReadCache, clearPurchaseOrderReadCache
} = require('../utils/cacheManager');
const {
  fbGet, fbPost, fetchAllFbEdge,
  sleep,
  getAccountRateLimitDelayMs, markAccountRateLimited,
  FB_CAMPAIGN_CREATE_REQUEST_OPTIONS,
  mapWithConcurrency, chunkArray
} = require('../utils/fbApi');
const {
  getAppConfig,
  mergeAutoConfig,
  getShopeeAutoMinSpendLimit
} = require('../services/configService');
const {
  ensureDefaultUsers,
  migrateLegacyAccountsToDefaultUser
} = require('../services/userService');

function createLegacyRuntime(app) {
  // getVietnamDayMinute, isVietnamTimeMinute, isWithinAutoRuleTimeWindow — imported from utils/timeUtils.js
  
  const Account = require('../models/Account');
  const Campaign = require('../models/Campaign');
  const Log = require('../models/Log');
  const Config = require('../models/Config');
  const User = require('../models/User');
  const FacebookToken = require('../models/FacebookToken');
  const Order = require('../models/Order');
  const InventoryItem = require('../models/InventoryItem');
  const FacebookPost = require('../models/FacebookPost');
  const DataPurchaseOrder = require('../models/DataPurchaseOrder');
  const PurchaseOrder = require('../models/PurchaseOrder');
  const ShopeeCommission = require('../models/ShopeeCommission');
  const ShopeeCommissionOrder = require('../models/ShopeeCommissionOrder');
  const { generateExcelReport, importCommissionOrders, getReportData } = require('../services/reportService');
  const {
    buildOrderQuery,
    getOrderItemsFromRaw,
    getOrderItemSku,
    getOrderItemQuantity,
    getOrderTagText,
    useSheetOrders,
    normalizeSkuKey,
    normalizeStatusKey,
    buildOrderSkuStats,
    buildOrderTableStats,
    buildReturnSummaryOrderStats,
    buildReturnProductRateStats,
    classifyReturnStatus,
    classifyReturnAdNameBucket,
    RETURN_SUMMARY_BUCKETS,
    fetchOrderSheetRows,
    getOrderSheetPage,
    getOrderSheetOrders,
    getOrderStatsCacheKey,
    ordersSheetCache,
    orderStatsCache
  } = require('../services/orderService');
  const {
    configureFacebookToken,
    checkAndRefreshFacebookToken,
    bootstrapFacebookTokenFromEnv,
    sendTokenAlert,
    startFacebookTokenCron,
    FACEBOOK_TOKEN_KEY
  } = require('../services/facebookTokenService');
  const {
    fetchInventorySheetItems,
    fetchInventorySheetRowsWithGoogleAccess,
    fetchInventorySheetItemsWithGoogleAccess,
    updateInventorySheetSalePriceWithGoogleAccess
  } = require('../services/inventorySheetService');
  const {
    getDataPurchaseOrders,
    importDataPurchaseOrdersFromCsvText,
    syncDataPurchaseOrdersFromSheet
  } = require('../services/dataPurchaseOrderSheetService');
  const {
    getPurchaseOrderDashboard,
    getPurchaseOrders,
    importPurchaseOrderStatusesFromCsvText,
    updatePurchaseOrderDashboardCancellation,
    updatePurchaseOrderDashboardNote,
    updatePurchaseOrder,
    parseQuantity,
    getFirstQuantityText
  } = require('../services/purchaseOrderService');
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
  } = require('../config/appConstants');
  
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
  const SHOPEE_LOW_SPEND_WINDOW_DAYS = 3;
  const SHOPEE_LOW_SPEND_AVG_DAILY_LIMIT = 30000;
  const SHOPEE_PERFORMANCE_TOTAL_FROM_DATE = '2026-04-27';
  const SHOPEE_REACTIVATE_CRON = '0 0 * * *';
  const SCHEDULED_DUPLICATE_SCOPE_COOLDOWN_MS = 2 * 60 * 1000;
  
  // normalizeProvider — imported from utils/authUtils.js
  
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
      return 'Tai khoan Shopee chi cho phep ten bat dau bang XK lien sau la so (vi du: XK11).';
    }
    if (provider === 'facebook' && isShopeeAdAccountName(name)) {
      return 'Tai khoan bat dau bang XK lien sau la so (vi du: XK11) chi duoc them vao role Shopee.';
    }
    return '';
  }
  
  async function addLog(accountId, accountName, level, message) {
    try {
      if (isShuttingDown || mongoose.connection.readyState !== 1) return;
      await Log.create({ accountId, accountName, level, message });
    } catch { }
  }

  function formatAutoMoney(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0d';
    return `${Math.round(numeric).toLocaleString('vi-VN')}d`;
  }

  function formatAutoPercent(value, fractionDigits = 2) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0.00%';
    return `${numeric.toFixed(fractionDigits)}%`;
  }

  function formatAutoRatio(value, fractionDigits = 2) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0.00';
    return numeric.toFixed(fractionDigits);
  }
  
  // readCache, purchaseOrderReadCache — imported from utils/cacheManager.js
  const AUTO_CHECK_MIN_INTERVAL_SECONDS = parseBoundedInt(process.env.AUTO_CHECK_MIN_INTERVAL_SECONDS, 180, 60, 60 * 60);
  // getReadCache, setReadCache, clearCampaignReadCache — imported from utils/cacheManager.js
  
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
  
  // clearAllReadCache — imported from utils/cacheManager.js
  
  
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
  
  // getGoogleAccessTokenForUser/getGoogleAccessToken are imported from utils/googleOAuth.js
  
  // getGoogleAccessTokenForUser/getGoogleAccessToken are imported from utils/googleOAuth.js
  
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
  
  // getPurchaseOrderReadCache, setPurchaseOrderReadCache, clearPurchaseOrderReadCache
  // — imported from utils/cacheManager.js
  
  function getUserFilter(req) {
    return req.currentUser?._id ? { ownerUserId: req.currentUser._id } : {};
  }
  
  function withUserFilter(req, filter = {}) {
    return { ...filter, ...getUserFilter(req) };
  }
  
  function userScopedCacheKey(req, key) {
    return `${req.currentUser?._id || 'public'}:${key}`;
  }
  
  async function getUserAutoConfig(userId) {
    const [globalConfig, userConfig] = await Promise.all([
      getAppConfig(),
      userId ? User.findById(userId).select(
        'autoRuleStartTime autoRuleEndTime shopeeAutoRuleStartTime shopeeAutoRuleEndTime scheduledDuplicatePauseTime ' +
        'dailyZeroMessageSpendLimit dailyOneMessageSpendLimit dailyFewMessageThreshold dailyFewMessageSpendLimit dailyCheapMessageCostLimit dailyCheapMessageSpendLimit dailyHighCostPerMessageLimit dailyHighCostSpendLimit ' +
        'dailyClickLimit dailyCpcLimit lifetimeZeroMessageSpendLimit lifetimeOneMessageSpendLimit lifetimeFewMessageThreshold lifetimeFewMessageSpendLimit lifetimeCheapMessageCostLimit lifetimeCheapMessageSpendLimit lifetimeHighCostPerMessageLimit ' +
        'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit autoPauseCpoLimitLifetime autoPauseZeroOrderSpendLimit autoPauseZeroOrderSpendLimitLifetime autoPauseShopeeMinSpendLimit autoPauseShopeeHhAdsPercent'
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
    let ownerGeminiKey = '';
    if (account.ownerUserId) {
      const owner = await User.findById(account.ownerUserId).select('fbToken geminiKey').lean();
      ownerFbToken = owner?.fbToken || '';
      ownerGeminiKey = owner?.geminiKey || '';
    }
    let fbToken = account.fbToken || ownerFbToken || config?.fbToken || '';
    let geminiKey = account.geminiKey || ownerGeminiKey || config?.geminiKey || '';
    return { fbToken, geminiKey };
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
      geminiKey: String(input.geminiKey || config?.geminiKey || '').trim(),
      spendThreshold: Number(input.spendThreshold || 20000),
      checkInterval: Number(input.checkInterval || 60),
      autoEnabled: Boolean(input.autoEnabled),
      linkedPageIds: Array.isArray(input.linkedPageIds) ? input.linkedPageIds : []
    };
  }
  
  function toGeminiTextParts(content) {
    if (Array.isArray(content)) {
      return content
        .map(item => {
          if (typeof item === 'string') return item;
          return typeof item?.text === 'string' ? item.text : '';
        })
        .filter(Boolean)
        .map(text => ({ text }));
    }
  
    const text = String(content || '').trim();
    return text ? [{ text }] : [];
  }
  
  function toGeminiContents(messages = []) {
    return messages
      .map(message => {
        const role = message?.role === 'assistant' ? 'model' : 'user';
        const parts = toGeminiTextParts(message?.content);
        return parts.length ? { role, parts } : null;
      })
      .filter(Boolean);
  }
  
  function extractGeminiError(error) {
    const data = error.response?.data;
    return data?.error?.message || data?.error || error.message;
  }
  
  function extractGeminiText(data = {}) {
    return (data?.candidates || [])
      .flatMap(candidate => candidate?.content?.parts || [])
      .map(part => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  
  async function requestGeminiGenerateContent({
    apiKey,
    system = '',
    messages = [],
    maxTokens = 1500,
    timeout = 30000,
    model = '',
    responseMimeType = ''
  }) {
    const contents = toGeminiContents(messages);
    if (!contents.length) throw new Error('Noi dung AI khong hop le');
  
    const mimeType = String(responseMimeType || '').trim();
    const payload = {
      contents,
      generationConfig: {
        maxOutputTokens: parseBoundedInt(maxTokens, 1500, 1, 1500),
        temperature: mimeType === 'application/json' ? 0 : 0.2
      }
    };
    if (mimeType) payload.generationConfig.responseMimeType = mimeType;
    const systemText = String(system || '').trim();
    if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
  
    const activeModel = String(model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent`,
      payload,
      {
        timeout,
        params: { key: apiKey },
        headers: { 'content-type': 'application/json' }
      }
    );
  
    return { data: response.data, model: activeModel };
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
  
  function isMessagingPurchaseOptimizationError(error) {
    const data = error.fbData || error.response?.data || {};
    const apiError = data.error || {};
    const blameSpecs = JSON.stringify(apiError.error_data || '').toLowerCase();
  
    return Number(apiError.code) === 100 &&
      Number(apiError.error_subcode) === 2490408 &&
      blameSpecs.includes('optimization_goal');
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
    const limitOne = isDaily ? limits.dailyOneMessageSpendLimit : limits.lifetimeOneMessageSpendLimit;
    const limitHighCostPerMsg = isDaily ? limits.dailyHighCostPerMessageLimit : limits.lifetimeHighCostPerMessageLimit;
    const limitHighCostSpend = isDaily ? limits.dailyHighCostSpendLimit : limits.lifetimeHighCostSpendLimit;
    const configuredLimitCpc = isDaily ? limits.dailyCpcLimit : limits.lifetimeCpcLimit;
    const limitCpc = normalizedProvider === 'shopee'
      ? Number(configuredLimitCpc || 600)
      : configuredLimitCpc;
  
    if (normalizedProvider === 'shopee') {
      const minSpend = getShopeeAutoMinSpendLimit(limits);
      if (spend >= minSpend && limitCpc > 0 && costPerClick > limitCpc) {
        return `CPC ${formatAutoMoney(costPerClick)} > limit ${formatAutoMoney(limitCpc)} sau khi tieu tu ${formatAutoMoney(minSpend)}`;
      }
      return null;
    }
  
    if (normalizedProvider !== 'facebook') {
      return null;
    }
  
    if (messages <= 0 && spend >= limitZero) {
      return `0 tin nhan va da tieu tu ${formatAutoMoney(limitZero)}`;
    }
  
    if (messages === 1 && spend >= limitOne) {
      return `Chi co 1 tin nhan va da tieu tu ${formatAutoMoney(limitOne)}`;
    }
  
    const fewThreshold = isDaily ? Number(limits.dailyFewMessageThreshold || 0) : Number(limits.lifetimeFewMessageThreshold || 0);
    const fewSpendLimit = isDaily ? Number(limits.dailyFewMessageSpendLimit || 0) : Number(limits.lifetimeFewMessageSpendLimit || 0);
    if (fewThreshold > 1 && fewSpendLimit > 0 && messages < fewThreshold && spend >= fewSpendLimit) {
      return `Duoi ${fewThreshold} tin nhan va da tieu tu ${formatAutoMoney(fewSpendLimit)}`;
    }
  
    if (
      limitHighCostPerMsg > 0 &&
      limitHighCostSpend > 0 &&
      messages > 0 &&
      costPerMessage >= limitHighCostPerMsg &&
      spend >= limitHighCostSpend
    ) {
      return `Cost/msg >= ${formatAutoMoney(limitHighCostPerMsg)} va da tieu tu ${formatAutoMoney(limitHighCostSpend)}`;
    }
  
    return null;
  }
  
  function getCampaignSkuCandidates(campaignName) {
    const rawName = String(campaignName || '').toUpperCase().trim();
    const compactName = rawName.replace(/\s+/g, '');
    const firstNineChars = rawName.slice(0, 9).replace(/\s+/g, '');
    const firstToken = rawName.split(/\s+/)[0]?.replace(/\s+/g, '') || '';
    const tokenMatches = rawName.match(/[A-Z]{1,3}\d{5,}/g) || [];
    const compactMatches = compactName.match(/[A-Z]{1,3}\d{5,}/g) || [];
  
    return [...new Set([
      firstNineChars,
      firstToken,
      compactName,
      ...tokenMatches,
      ...compactMatches
    ].filter(Boolean))]
      .flatMap(code => {
        const normalized = String(code).replace(/\s+/g, '');
        if (!normalized) return [];
        if (normalized.startsWith('MS')) {
          return [normalized, normalized.slice(2)].filter(Boolean);
        }
        return [`MS${normalized}`, normalized];
      });
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
  
  function getRecentShopeeSpendStats(rows = [], referenceDate = dateKeyFromVnOffset(-1)) {
    const normalizedReferenceDate = normalizeCampaignDate(referenceDate);
    const spendByDate = new Map();
    for (const row of rows || []) {
      const date = String(row?.date || '').trim();
      if (!date || date > normalizedReferenceDate) continue;
      spendByDate.set(date, Number(spendByDate.get(date) || 0) + Number(row?.spend || 0));
    }
  
    const dates = [];
    const endTime = new Date(`${normalizedReferenceDate}T00:00:00Z`).getTime();
    for (let offset = SHOPEE_LOW_SPEND_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
      dates.push(new Date(endTime - (offset * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]);
    }
  
    const totalSpend = dates.reduce((sum, date) => sum + Number(spendByDate.get(date) || 0), 0);
    const avgDailySpend = dates.length > 0 ? totalSpend / dates.length : 0;
    const daysWithData = dates.filter(date => spendByDate.has(date)).length;
    const daysWithSpend = dates.filter(date => Number(spendByDate.get(date) || 0) > 0).length;
  
    return {
      dates,
      totalSpend,
      avgDailySpend,
      daysWithData,
      daysWithSpend,
      hasFullWindow: daysWithData >= SHOPEE_LOW_SPEND_WINDOW_DAYS
    };
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
              spend: { $sum: '$spend' },
              recentDailyRows: {
                $push: {
                  date: '$date',
                  spend: '$spend'
                }
              }
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
        totals[key].recentSpend = getRecentShopeeSpendStats(row.recentDailyRows);
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
        reason: `Tieu ${formatAutoMoney(numericSpend)} nhung chua co hoa hong`,
        ...baseDecisionMetrics
      };
    }
  
    if (hasEnoughSpend && profit < 0) {
      return {
        action: 'pause',
        label: 'TAT',
        shouldPause: true,
        reason: `Doanh thu am ${formatAutoMoney(Math.abs(profit))} sau khi tieu ${formatAutoMoney(numericSpend)}`,
        ...baseDecisionMetrics
      };
    }
  
    if (hasEnoughSpend && profit <= 0) {
      return {
        action: 'pause',
        label: 'TAT',
        shouldPause: true,
        reason: `Lo ${formatAutoMoney(Math.abs(profit))} sau khi tieu ${formatAutoMoney(numericSpend)}`,
        ...baseDecisionMetrics
      };
    }
  
    if (hasEnoughSpend && roi < SHOPEE_PAUSE_ROI_PERCENT) {
      return {
        action: 'pause',
        label: 'TAT',
        shouldPause: true,
        reason: `ROI ${formatAutoPercent(roi)} < ${SHOPEE_PAUSE_ROI_PERCENT}% sau khi tieu tu ${formatAutoMoney(minSpend)}`,
        ...baseDecisionMetrics
      };
    }
  
    if (hasEnoughSpend && roi < SHOPEE_WARN_ROI_PERCENT) {
      return {
        action: 'warning',
        label: 'CANH BAO',
        shouldPause: false,
        reason: `ROI ${formatAutoPercent(roi)} < ${SHOPEE_WARN_ROI_PERCENT}% sau khi tieu du nguong`,
        ...baseDecisionMetrics
      };
    }
  
    if (hasEnoughSpend && roi >= SHOPEE_STRONG_SCALE_ROI_PERCENT) {
      return {
        action: 'scale_strong',
        label: 'SCALE MANH',
        shouldPause: false,
        reason: `ROI ${formatAutoPercent(roi)} >= ${SHOPEE_STRONG_SCALE_ROI_PERCENT}%`,
        ...baseDecisionMetrics
      };
    }
  
    if (hasEnoughSpend && roi >= SHOPEE_SCALE_ROI_PERCENT) {
      return {
        action: 'scale',
        label: 'SCALE NHE',
        shouldPause: false,
        reason: `ROI ${formatAutoPercent(roi)} >= ${SHOPEE_SCALE_ROI_PERCENT}%`,
        ...baseDecisionMetrics
      };
    }
  
    return {
      action: hasEnoughSpend ? 'keep' : 'testing',
      label: hasEnoughSpend ? 'GIU' : 'TEST THEM',
      shouldPause: false,
      reason: hasEnoughSpend
        ? `ROI ${formatAutoPercent(roi)} dang co loi`
        : `Chua du nguong chi tieu ${formatAutoMoney(minSpend)}`,
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
        return { pauseReason: decision.reason, orderCount: 0, costPerOrder: 0, optimizationDecision: decision };
      }
      return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0, optimizationDecision: decision };
    }
  
    if (normalizedProvider !== 'facebook') {
      return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0 };
    }
  
    if (!skuCounts || typeof skuCounts !== 'object') {
      return { pauseReason: basePauseReason, orderCount: 0, costPerOrder: 0 };
    }
  
    const orderCount = getOrderCountForCampaignName(campaignName, skuCounts);
    const costPerOrder = orderCount > 0 ? spend / orderCount : 0;
    const isDaily = budgetType === 'DAILY';
  
    const cheapMsgCostLimit = isDaily ? Number(limits?.dailyCheapMessageCostLimit || 0) : Number(limits?.lifetimeCheapMessageCostLimit || 0);
    const cheapMsgSpendLimit = isDaily ? Number(limits?.dailyCheapMessageSpendLimit || 0) : Number(limits?.lifetimeCheapMessageSpendLimit || 0);
    const isCheapMessage = cheapMsgCostLimit > 0 && messages > 0 && costPerMessage < cheapMsgCostLimit;
    if (isCheapMessage && cheapMsgSpendLimit > 0 && orderCount === 0 && spend >= cheapMsgSpendLimit) {
      return {
        pauseReason: `Tin nhan re (${formatAutoMoney(costPerMessage)}/TN < ${formatAutoMoney(cheapMsgCostLimit)}) nhung 0 don, da tieu tu ${formatAutoMoney(cheapMsgSpendLimit)}`,
        orderCount,
        costPerOrder
      };
    }
  
    const zeroOrderSpendLimit = isDaily
      ? Number(limits?.autoPauseZeroOrderSpendLimit ?? AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT)
      : Number(limits?.autoPauseZeroOrderSpendLimitLifetime ?? limits?.autoPauseZeroOrderSpendLimit ?? AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT);
    if (zeroOrderSpendLimit > 0 && orderCount <= 0 && spend >= zeroOrderSpendLimit && !isCheapMessage) {
      return {
        pauseReason: `0 don va da tieu tu ${formatAutoMoney(zeroOrderSpendLimit)}`,
        orderCount,
        costPerOrder
      };
    }
  
    const cpoLimit = isDaily
      ? Number(limits?.autoPauseCpoLimit ?? AUTO_PAUSE_CPO_LIMIT)
      : Number(limits?.autoPauseCpoLimitLifetime ?? limits?.autoPauseCpoLimit ?? AUTO_PAUSE_CPO_LIMIT);
    if (cpoLimit > 0 && orderCount > 0 && costPerOrder > cpoLimit) {
      return {
        pauseReason: `CPO ${formatAutoMoney(costPerOrder)} > limit ${formatAutoMoney(cpoLimit)} (${orderCount} don)`,
        orderCount,
        costPerOrder
      };
    }
  
    if (orderCount > 0) {
      return { pauseReason: null, orderCount, costPerOrder };
    }
  
    return { pauseReason: basePauseReason, orderCount, costPerOrder };
  }

  function buildFacebookPauseLog(item, campaignGraphId) {
    const spend = Number(item.ruleSpend ?? item.spend ?? 0);
    const orderCount = Number(item.orderCount || 0);
    const parts = [
      `Auto pause Facebook: ${item.campaign.name || campaignGraphId}`,
      `id=${campaignGraphId}`,
      `reason=${item.pauseReason}`,
      `budget=${item.budgetType || 'DAILY'}`,
      `spend=${formatAutoMoney(spend)}`,
      `messages=${Number(item.messages || 0)}`,
      `cost/msg=${formatAutoMoney(item.costPerMessage)}`,
      `clicks=${Number(item.clicks || 0)}`,
      `cpc=${formatAutoMoney(item.costPerClick)}`,
      `orders=${orderCount}`,
      `cpo=${orderCount > 0 ? formatAutoMoney(item.costPerOrder) : 'n/a'}`
    ];
    return parts.join(' | ');
  }

  function buildShopeePauseLog(item, campaignGraphId) {
    const decision = item.optimizationDecision || {};
    const spend = Number(item.ruleSpend ?? item.spend ?? 0);
    const commission = Number(item.ruleCommission || 0);
    const profit = Number(decision.profit ?? (commission - spend));
    const parts = [
      `Auto pause Shopee: ${item.campaign.name || campaignGraphId}`,
      `id=${campaignGraphId}`,
      `reason=${item.pauseReason}`,
      `spend=${formatAutoMoney(spend)}`,
      `commission=${formatAutoMoney(commission)}`,
      `profit=${formatAutoMoney(profit)}`,
      `roi=${formatAutoPercent(decision.roi)}`,
      `roas=${formatAutoRatio(decision.roas)}`,
      `hh/ads=${formatAutoPercent(decision.hhAdsPercent)}`,
      `minSpend=${formatAutoMoney(decision.minSpend)}`
    ];
    if (item.shopeeRecentSpend?.hasFullWindow) {
      parts.push(`recentAvgSpend=${formatAutoMoney(item.shopeeRecentSpend.avgDailySpend)}/day`);
    }
    return parts.join(' | ');
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
        const existingCampaign = campaigns.find(campaign => String(campaign.campaignId || '').trim() === campaignId) || {};
        const bidAmount = Number(existingCampaign.bidAmount || 0);
        const adName = adNamesByDateCampaign.get(`${today}:${campaignId}`) || '';
        const campaignUpdate = {
          ...meta,
          bidAmount,
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
      const bidAmount = Number(existingCampaign.bidAmount || 0);
      const adName = adNamesByDateCampaign.get(`${today}:${campaignId}`) || '';
  
      const campaignUpdate = {
        ...meta,
        bidAmount,
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
        bidAmount,
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
      const bidAmount = Number(storedCampaign.bidAmount || 0);
      const adName = adNamesByDateCampaign.get(`${today}:${campaignId}`) || storedCampaign.adName || '';
      await upsertDailyCampaign(account._id, campaignId, today, {
        ...meta,
        bidAmount,
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
        bidAmount,
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
      const { fbToken, geminiKey } = await getEffectiveSecrets(account);
      const today = todayStr();
  
      await Account.findByIdAndUpdate(account._id, {
        lastChecked: new Date(),
        status: 'connected'
      });
  
      await addLog(
        account._id,
        account.name,
        'info',
        `Kiem tra: chi tieu ${formatAutoMoney(totalSpend)} | tin nhan camp: ${totalMessages} | inbox moi: ${unreadMessages}`
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
            const shopeeRecentSpend = isShopee ? shopeeTotals.recentSpend : null;
            const isLifetime = !!campaign.lifetimeBudget || !!campaign.lifetime_budget && parseFloat(campaign.lifetime_budget) > 0;
            const budgetType = isLifetime ? 'LIFETIME' : 'DAILY';
            const { pauseReason, orderCount, costPerOrder, optimizationDecision: autoOptimizationDecision } = getAutoPauseDecision({
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
            const lowRecentSpendReason = isShopee
              && shopeeRecentSpend?.hasFullWindow
              && shopeeRecentSpend.avgDailySpend < SHOPEE_LOW_SPEND_AVG_DAILY_LIMIT
                ? `Tieu TB ${formatAutoMoney(shopeeRecentSpend.avgDailySpend)}/ngay trong ${SHOPEE_LOW_SPEND_WINDOW_DAYS} ngay da chot gan nhat < ${formatAutoMoney(SHOPEE_LOW_SPEND_AVG_DAILY_LIMIT)}`
                : null;
            const optimizationDecision = isShopee
              ? (autoOptimizationDecision || getShopeeOptimizationDecision({
                spend: ruleSpend,
                commission: ruleCommission,
                minSpendLimit: config?.autoPauseShopeeMinSpendLimit
              }))
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
              budgetType,
              orderCount,
              costPerOrder,
              pauseReason: lowRecentSpendReason || pauseReason,
              shopeeRecentSpend,
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
  
      if (geminiKey) {
        try {
          const todayCampaigns = await Campaign.find({ accountId: account._id, date: today });
          const totalMsg = todayCampaigns.reduce((sum, campaign) => sum + campaign.messages, 0);
          const avgCPM = totalMsg > 0 ? totalSpend / totalMsg : 0;
  
          const response = await requestGeminiGenerateContent({
            apiKey: geminiKey,
            maxTokens: 200,
            messages: [{
              role: 'user',
              content: `Tai khoan "${account.name}": chi tieu ${totalSpend.toLocaleString()}d, tin nhan inbox: ${unreadMessages}, tong tin nhan camp: ${totalMsg}, CPM trung binh: ${avgCPM.toFixed(0)}d. Nen giu nguyen hay can luu y gi? 1 cau ngan gon.`
            }]
          });
  
          const aiMsg = extractGeminiText(response.data);
          if (aiMsg) {
            await addLog(account._id, account.name, 'ai', `Gemini: ${aiMsg}`);
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
              buildShopeePauseLog(item, campaignGraphId)
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
            buildFacebookPauseLog(item, campaignGraphId)
          );
        }
  
        await addLog(
          account._id,
          account.name,
          'warn',
          isShopee
            ? `Auto pause ${campaignsToPause.length} Shopee campaign theo rule`
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
            `Auto reactivate Shopee: ${item.campaign.name} | id=${campaignGraphId} | ROI ${roiText}% > ${SHOPEE_REACTIVATE_ROI_PERCENT}% | spend=${formatAutoMoney(item.ruleSpend || item.spend || 0)} | commission=${formatAutoMoney(item.ruleCommission || 0)}`
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
      async job => legacyRoutesRuntime.processCampaignDuplicateExactRequest(job.data, async progress => {
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
      async job => legacyRoutesRuntime.processCampaignSyncHistoryJob(job.data, async progress => {
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
  registerAllRoutes(app);
  
  function createLegacyRouteContext() {
    const context = {
      parseBoundedInt,
      parseCsvRows,
      getCsvColumnIndex,
      getCsvCell,
      parseCsvNumber,
      parseCsvInteger,
      parseCsvCampaignDate,
      normalizeProvider,
      todayStr,
      dateKeyFromVnOffset,
      normalizeCampaignDate,
      buildVnDateRange,
      dateRangeIncludesToday,
      dateRangeTouchesTodayOrFuture,
      getGoogleOAuthConfig,
      getGoogleAccessToken,
      getGoogleAccessTokenForUser,
      getReadCache,
      setReadCache,
      clearCampaignReadCache,
      getPurchaseOrderReadCache,
      setPurchaseOrderReadCache,
      clearPurchaseOrderReadCache,
      fbGet,
      fbPost,
      fetchAllFbEdge,
      sleep,
      FB_CAMPAIGN_CREATE_REQUEST_OPTIONS,
      getAppConfig,
      importCommissionOrders,
      buildOrderQuery,
      getOrderItemsFromRaw,
      getOrderItemSku,
      getOrderItemQuantity,
      getOrderTagText,
      useSheetOrders,
      normalizeSkuKey,
      normalizeStatusKey,
      buildOrderSkuStats,
      buildOrderTableStats,
      buildReturnSummaryOrderStats,
      buildReturnProductRateStats,
      classifyReturnStatus,
      classifyReturnAdNameBucket,
      RETURN_SUMMARY_BUCKETS,
      fetchOrderSheetRows,
      getOrderSheetPage,
      getOrderSheetOrders,
      getOrderStatsCacheKey,
      ordersSheetCache,
      orderStatsCache,
      configureFacebookToken,
      checkAndRefreshFacebookToken,
      sendTokenAlert,
      FACEBOOK_TOKEN_KEY,
      fetchInventorySheetItems,
      fetchInventorySheetRowsWithGoogleAccess,
      fetchInventorySheetItemsWithGoogleAccess,
      getDataPurchaseOrders,
      importDataPurchaseOrdersFromCsvText,
      syncDataPurchaseOrdersFromSheet,
      getPurchaseOrderDashboard,
      getPurchaseOrders,
      importPurchaseOrderStatusesFromCsvText,
      updatePurchaseOrderDashboardCancellation,
      updatePurchaseOrderDashboardNote,
      updatePurchaseOrder,
      parseQuantity,
      getFirstQuantityText,
      DEFAULT_CAMPAIGN_DAILY_BUDGET,
      SHOPEE_CAMPAIGN_DAILY_BUDGET,
      SHOPEE_AD_SET_BID_AMOUNT,
      SHOPEE_AGE_MIN,
      SHOPEE_AGE_MAX,
      DEFAULT_AD_SET_NAME,
      DEFAULT_AD_NAME_PREFIX,
      DEFAULT_CAMPAIGN_OBJECTIVE,
      DEFAULT_CAMPAIGN_BID_STRATEGY,
      SHOPEE_CAMPAIGN_BID_STRATEGY,
      DEFAULT_AD_SET_DESTINATION_TYPE,
      DEFAULT_AD_SET_OPTIMIZATION_GOAL,
      META_POST_REQUEST_LIMIT,
      POSTS_PER_PAGE_LIMIT,
      SHOPEE_POSTS_PER_PAGE_LIMIT,
      ALL_POSTS_MAX_LIMIT,
      CAMPAIGN_CREATE_CONCURRENCY,
      CAMPAIGN_CREATE_ITEM_DELAY_MS,
      FACEBOOK_GRAPH_API_VERSION,
      FINAL_SPEND_CRON,
      FINAL_SPEND_TIMEZONE,
      CAMPAIGN_DUPLICATE_QUEUE_NAME,
      CAMPAIGN_SYNC_QUEUE_NAME,
      CAMPAIGN_SYNC_DAY_DELAY_MS,
      ORDER_SHEET_SYNC_QUEUE_NAME,
      mongoose,
      cron,
      axios,
      path,
      crypto,
      Account,
      Campaign,
      Log,
      User,
      FacebookToken,
      Order,
      InventoryItem,
      FacebookPost,
      DataPurchaseOrder,
      PurchaseOrder,
      ShopeeCommission,
      SHOPEE_STRONG_SCALE_ROI_PERCENT,
      SHOPEE_LOW_SPEND_WINDOW_DAYS,
      SHOPEE_LOW_SPEND_AVG_DAILY_LIMIT,
      SHOPEE_REACTIVATE_CRON,
      buildAccountProviderFilter,
      escapeRegExp,
      isShopeeAdAccountName,
      getAccountProviderNameError,
      addLog,
      normalizeCampaignStatus,
      isCampaignServingStatus,
      getMetaOrdersFromInsight,
      getMetaMessageActionFromInsight,
      getMetaCostPerMessageFromInsight,
      getInventoryOwnerUserId,
      withInventoryOwnerFilter,
      getInventoryFilter,
      getInventoryGoogleAccessToken,
      withUserFilter,
      userScopedCacheKey,
      getUserAutoConfig,
      getEffectiveSecrets,
      normalizeAdAccountId,
      getAdAccountNumericId,
      isValidAdAccountId,
      normalizeShopeeCallToActionType,
      getDestinationUrlFromLookupTerm,
      buildPostLookupTerms,
      parseCampaignCreateItems,
      buildCampaignName,
      getPostPageId,
      getPostObjectStoryId,
      normalizeAdNameStatus,
      buildAdName,
      combineAdNames,
      normalizeBarcode,
      normalizeInventoryProductCode,
      extractInventoryProductCode,
      parseInventorySheetIdentity,
      buildInventoryPendingOrderCounts,
      syncInventorySalePriceToSheet,
      buildAccountPayload,
      upsertDailyCampaign,
      parseVietnamCampaignStart,
      parseVietnamCampaignEnd,
      campaignDateFromScheduledStart,
      parseCampaignAgeRange,
      parseCampaignGender,
      getMetaGenderTargeting,
      isMessagingPurchaseOptimizationError,
      fetchAdAccountsWithSpend,
      duplicateCampaignExactQueued,
      getCampaignSkuCandidates,
      getShopeeOptimizationDecision,
      fetchMetaCampaignMetricRowsForReport,
      applyMetaCampaignMetricRows,
      mergeCampaignReportRows,
      fetchScheduledCampaignRowsFromDb,
      fetchLiveCampaignRowsForReportByAccounts,
      fetchShopeeAccountData,
      fetchAccountData,
      startCampaignDuplicateWorker,
      startCampaignSyncWorker,
      processOrderSheetSyncJob,
      isMongoReady,
      runAutoControlSafely,
      startAccountScheduler,
      stopAccountScheduler
    };
  
    Object.defineProperties(context, {
      campaignDuplicateQueue: { enumerable: true, get: () => campaignDuplicateQueue },
      campaignSyncQueue: { enumerable: true, get: () => campaignSyncQueue },
      orderSheetSyncQueue: { enumerable: true, get: () => orderSheetSyncQueue }
    });
  
    return context;
  }
  
  let legacyRoutesRuntime = null;
  legacyRoutesRuntime = registerLegacyRoutes(app, createLegacyRouteContext());
  
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
      'sheetId_1_sheetName_1_rowNumber_1',
      'purchase_order_updatedAt_desc'
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

    let indexes = [];
    try {
      indexes = await purchaseOrdersCollection.indexes();
    } catch (error) {
      if (error?.codeName !== 'NamespaceNotFound') throw error;
    }
    const sourceOrderIndex = indexes.find(index => index.name === 'purchase_order_source_order_unique');
    if (sourceOrderIndex && !sourceOrderIndex.partialFilterExpression) {
      await purchaseOrdersCollection.dropIndex('purchase_order_source_order_unique');
      console.log('Dropped legacy purchase order index: purchase_order_source_order_unique');
    }
  }

  function isUsernameOnlyIndex(index) {
    const key = index?.key || {};
    return key.username === 1 && Object.keys(key).length === 1;
  }

  async function ensureUserIndexes() {
    const usersCollection = mongoose.connection.collection('users');
    let indexes = [];
    try {
      indexes = await usersCollection.indexes();
    } catch (error) {
      if (error?.codeName !== 'NamespaceNotFound') throw error;
    }

    const usernameIndex = indexes.find(isUsernameOnlyIndex);
    if (usernameIndex?.unique) {
      if (usernameIndex.name !== 'user_username_unique') {
        console.log(`User username index ready: ${usernameIndex.name}`);
      }
      return;
    }

    await User.createIndexes();
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
      ShopeeCommissionOrder.createIndexes(),
      Config.createIndexes(),
      ensureUserIndexes(),
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
  
  registerReportRoutes(app, {
    Account,
    buildAccountProviderFilter,
    generateExcelReport,
    getReportData,
    normalizeCampaignDate,
    todayStr,
    withUserFilter
  });

  async function runStartupMaintenance() {
    await ensureDefaultUsers();
    await migrateLegacyAccountsToDefaultUser();
    await migrateLegacyAccountProviders();
    await ensureCampaignDailyStorage();
    await ensureApplicationIndexes();
  }

  async function bootstrapFacebookTokenRuntime() {
    try {
      await bootstrapFacebookTokenFromEnv();
    } catch (error) {
      await sendTokenAlert('Facebook token environment bootstrap failed', { error: error.message });
    }
  }

  function startCronTasks() {
    facebookTokenCronTask = startFacebookTokenCron();
    finalSpendCronTask = legacyRoutesRuntime.startFinalSpendCron();
    shopeeReactivateCronTask = legacyRoutesRuntime.startShopeeReactivateCron();
    startTodayCampaignSpendSync();
  }

  async function initializeQueues() {
    redisQueueAvailable = await checkRedisAvailable();
    initCampaignDuplicateQueue();
    initCampaignSyncQueue();
    initOrderSheetSyncQueue();
    startOrderSheetSyncWorker();
  }

  async function resumeAutoAccounts() {
    const autoAccounts = await Account.find({ autoEnabled: true });
    for (const account of autoAccounts) {
      console.log(`Resuming auto for: ${account.name}`);
      startAccountScheduler(account);
    }
  }

  function startSheetRefresh() {
    let sheetRefreshRunning = false;
    const sheetRefreshInitial = async () => {
      try {
        if (ordersSheetCache.rateLimitedUntil > Date.now() && ordersSheetCache.rows?.length) {
          console.warn(`Sheet Cache: skip startup refresh due to rate limit until ${new Date(ordersSheetCache.rateLimitedUntil).toISOString()}; using cached ${ordersSheetCache.rows.length} rows`);
          return;
        }
        console.log('Sheet Cache: initializing order cache from Google Sheet...');
        if (orderSheetSyncQueue) {
          await orderSheetSyncQueue.add('sync-sheet', {}, { jobId: 'startup-order-sheet-sync' });
        } else {
          await fetchOrderSheetRows({ refresh: true });
        }
        console.log(`Sheet Cache: loaded ${ordersSheetCache.rows?.length || 0} order rows.`);
      } catch (err) {
        console.error('Sheet Cache: initial load failed:', err.message);
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
        console.log('Sheet Cache: refreshing orders from Google Sheet...');
        if (orderSheetSyncQueue) {
          await orderSheetSyncQueue.add('sync-sheet', {}, {
            jobId: `order-sheet-sync-${Math.floor(Date.now() / (60 * 1000))}`
          });
        } else {
          await fetchOrderSheetRows({ refresh: true });
        }
        console.log(`Sheet Cache: refreshed ${ordersSheetCache.rows?.length || 0} rows.`);
      } catch (err) {
        console.error('Sheet Cache: refresh failed:', err.message);
      } finally {
        sheetRefreshRunning = false;
      }
    }, 60 * 1000);
  }

  async function shutdownRuntime() {
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
  }

  return {
    runStartupMaintenance,
    bootstrapFacebookToken: bootstrapFacebookTokenRuntime,
    startCronTasks,
    initializeQueues,
    resumeAutoAccounts,
    startSheetRefresh,
    shutdown: shutdownRuntime
  };

}

module.exports = { createLegacyRuntime };
