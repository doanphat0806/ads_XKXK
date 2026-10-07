'use strict';

const axios = require('axios');
const Order = require('../models/Order');
const PosOrderSyncState = require('../models/PosOrderSyncState');
const { getAppConfig } = require('./configService');
const { buildOrderSkuStats, buildOrderQuery, useSheetOrders, getOrderDataVersion } = require('./orderService');
const { getOrderDerivedCache, setOrderDerivedCache } = require('../utils/cacheManager');
const { orderSourceState } = require('./orderSourceState');
const { parseBoundedInt } = require('../utils/number');
const { trackJob } = require('../utils/perfMonitor');

// Don hang tu Pancake POS -> bang Order (MongoDB). Thay cho Google Sheet: co gio tao don, ad_id, doanh thu.
const POS_API_BASE = 'https://pos.pages.fm/api/v1';
const POS_PAGE_SIZE = 200;
const POS_MAX_PAGES = 500;
const POS_RETRIES = 4;
const POS_CACHE_TTL_MS = 60 * 1000;
const POS_BACKFILL_FROM = process.env.POS_BACKFILL_FROM || '2026-02-01';
const POS_BACKFILL_WINDOW_DAYS = 7;
const POS_BACKFILL_PAGE_SIZE = 500;
const POS_BACKFILL_CONCURRENCY = 3;
const POS_SYNC_INTERVAL_MS = parseBoundedInt(process.env.POS_SYNC_INTERVAL_MS, 60 * 1000, 15 * 1000, 30 * 60 * 1000);
// Lay lui them moi lan dong bo de khong sot don cap nhat sat moc thoi gian.
// Bo loc updated_at cua POS doi khi tra don tre (>5 phut) -> don doi trang thai bi bo sot neu cua so qua hep.
// Ghi lai don khong doi khong tinh la thay doi (modifiedCount = 0) nen cua so rong khong lam cache truot.
const POS_SYNC_OVERLAP_MS = parseBoundedInt(process.env.POS_SYNC_OVERLAP_MS, 30 * 60 * 1000, 60 * 1000, 6 * 3600 * 1000);
// Cu moi POS_DEEP_SYNC_EVERY lan dong bo thi quet lai POS_DEEP_SYNC_LOOKBACK_MS de vot don con sot
const POS_DEEP_SYNC_EVERY = parseBoundedInt(process.env.POS_DEEP_SYNC_EVERY, 15, 1, 1440);
const POS_DEEP_SYNC_LOOKBACK_MS = parseBoundedInt(process.env.POS_DEEP_SYNC_LOOKBACK_MS, 6 * 3600 * 1000, 60 * 1000, 48 * 3600 * 1000);
const BULK_WRITE_SIZE = 500;
const SYNC_STATE_KEY = 'pancake';
const POS_EXCLUDED_STATUSES = new Set([6, 7]); // 6 = da huy, 7 = da xoa
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Trang thai POS -> ten trang thai nhu tren sheet (cot H), de cac phan dang dung (ti le hoan, cho hang...) giu nguyen.
// 6/7 -> 'cancelled'/'deleted' de buildOrderQuery loai ra (sheet cung khong co don huy/xoa).
const POS_STATUS_LABELS = {
  0: 'Mới',
  1: 'Đã xác nhận',
  2: 'Đã gửi hàng',
  3: 'Đã nhận',
  4: 'Đang hoàn',
  5: 'Đã hoàn',
  6: 'cancelled',
  7: 'deleted',
  8: 'Đang đóng hàng',
  9: 'Chờ chuyển hàng',
  11: 'Chờ hàng',
  12: 'Chờ in',
  13: 'Đã in',
  15: 'Hoàn một phần',
  16: 'Đã thu tiền',
  17: 'Chờ xác nhận',
  20: 'Đã đặt hàng'
};

const posOrdersCache = new Map();
let detectedShop = { apiKey: '', shopId: '' };
let syncTimer = null;
let syncRunning = false;
let backfillRunning = false;
let deletedCleanupRunning = false;
let syncCount = 0;
let legacyOrdersMigrated = false;

async function getPosCredentials() {
  const config = await getAppConfig();
  const apiKey = String(process.env.PANCAKE_API_KEY || config?.pancakeApiKey || '').trim();
  let shopId = String(process.env.PANCAKE_SHOP_ID || config?.pancakeShopId || '').trim();
  if (!apiKey) throw new Error('Chua cau hinh Pancake POS API key (PANCAKE_API_KEY hoac Cau hinh > Pancake POS)');

  if (!shopId) {
    if (detectedShop.apiKey === apiKey && detectedShop.shopId) {
      shopId = detectedShop.shopId;
    } else {
      const data = await getPosPage(`${POS_API_BASE}/shops`, { api_key: apiKey });
      shopId = String(data?.shops?.[0]?.id || '');
      if (!shopId) throw new Error('Khong tim thay shop nao voi Pancake POS API key nay');
      detectedShop = { apiKey, shopId };
    }
  }
  return { apiKey, shopId };
}

// POS thinh thoang tra 500 o vai trang -> thu lai truoc khi bao loi
async function getPosPage(url, params) {
  let lastError = null;
  for (let attempt = 1; attempt <= POS_RETRIES; attempt += 1) {
    try {
      const { data } = await axios.get(url, { params, timeout: 60000 });
      return data;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status && status < 500 && status !== 429) break;
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

// Tai tat ca trang don trong khoang thoi gian (giay unix). byUpdatedAt: loc theo updated_at thay vi inserted_at.
// API POS cham (~9s/trang 200 don) -> trang dau lay tong so trang, cac trang con lai tai song song.
// status: chi lay don co trang thai nay (API mac dinh KHONG tra don da xoa, phai hoi rieng status=7).
async function fetchPosOrderPages({ startDateTime, endDateTime, byUpdatedAt = false, status, pageSize = POS_PAGE_SIZE, concurrency = 1, onPage } = {}) {
  const { apiKey, shopId } = await getPosCredentials();
  const orders = [];
  const loadPage = async page => {
    const params = { api_key: apiKey, page_size: pageSize, page_number: page, startDateTime, endDateTime };
    if (byUpdatedAt) params.updateStatus = 'updated_at';
    if (status !== undefined) params.status = status;
    const data = await getPosPage(`${POS_API_BASE}/shops/${shopId}/orders`, params);
    const items = Array.isArray(data?.data) ? data.data : [];
    if (onPage) await onPage(items, shopId);
    else orders.push(...items);
    return Number(data?.total_pages || 0);
  };

  const totalPages = Math.min(await loadPage(1), POS_MAX_PAGES);
  let nextPage = 2;
  const worker = async () => {
    while (nextPage <= totalPages) {
      const page = nextPage;
      nextPage += 1;
      await loadPage(page);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { orders, shopId };
}

function parsePosTime(value) {
  const raw = String(value || '');
  if (!raw) return NaN;
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
}

// "2026-10-06T02:49:22.963202" (UTC) -> { dateKey: '2026-10-06', hour: 9 } theo gio VN
function getVnDateHour(insertedAt) {
  const ms = parsePosTime(insertedAt);
  if (!Number.isFinite(ms)) return null;
  const vn = new Date(ms + VN_OFFSET_MS);
  return { dateKey: vn.toISOString().slice(0, 10), hour: vn.getUTCHours() };
}

function vnDayStartUnix(dateKey) {
  return Math.floor((Date.parse(`${dateKey}T00:00:00Z`) - VN_OFFSET_MS) / 1000);
}

function addDays(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function todayVnDateKey() {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function getPosItemSize(item = {}) {
  const fields = Array.isArray(item.variation_info?.fields) ? item.variation_info.fields : [];
  const sizeField = fields.find(field => String(field?.name || '').trim().toUpperCase() === 'SIZE');
  // Vai SP nhap gop mau vao size ("M MÀU: XANH") -> chi giu phan size nhu cot K cua sheet
  return String(sizeField?.value || '').replace(/\s*M[AÀ]U\s*:.*$/i, '').trim();
}

function getPosTagNames(order = {}) {
  return (Array.isArray(order.tags) ? order.tags : [])
    .map(tag => String(typeof tag === 'string' ? tag : tag?.name || '').trim())
    .filter(Boolean);
}

// Don POS (~4.6KB, 100+ truong) -> document Order gon, chi giu truong app dung.
// rawData.items giu dang variation_info.product_display_id nhu cu; rawData.sheetColumns de trang Don hang/tim kiem dung nhu sheet.
// orderId = "<shopId>_<id>": id don Pancake danh so rieng tung shop -> doi shop khong bi trung/ghi de don cu.
function normalizePosOrder(order = {}, shopId = '') {
  const status = Number(order.status);
  const statusLabel = POS_STATUS_LABELS[status] || String(order.status_name || status);
  const createdAtMs = parsePosTime(order.inserted_at);
  const vn = getVnDateHour(order.inserted_at);
  const tags = getPosTagNames(order);
  const items = (Array.isArray(order.items) ? order.items : []).map(item => {
    const info = item.variation_info || {};
    return {
      quantity: Number(item.quantity || 1) || 1,
      size: getPosItemSize(item),
      variation_info: {
        product_display_id: info.product_display_id || '',
        display_id: info.display_id || '',
        name: info.name || '',
        detail: info.detail || ''
      }
    };
  });
  const skus = [...new Set(items.map(item => item.variation_info.product_display_id).filter(Boolean))];
  const sizes = [...new Set(items.map(item => item.size).filter(Boolean))];
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const posOrderId = String(order.id ?? order.system_id ?? '');
  const shop = String(order.shop_id || shopId || '');
  const orderId = posOrderId && shop ? `${shop}_${posOrderId}` : posOrderId;
  const [y, m, d] = (vn?.dateKey || '').split('-');

  return {
    orderId,
    status: statusLabel,
    customerName: String(order.bill_full_name || order.customer?.name || ''),
    totalPrice: Number(order.total_price_after_sub_discount ?? order.total_price ?? 0) || 0,
    createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs) : new Date(),
    rawData: {
      source: 'pancake_pos',
      shopId: shop,
      id: order.id,
      status,
      status_name: statusLabel,
      pos_status_name: order.status_name || '',
      inserted_at: order.inserted_at || '',
      updated_at: order.updated_at || '',
      is_deleted: status === 7,
      tags,
      items,
      ad_id: order.ad_id || '',
      ads_source: order.ads_source || '',
      page_id: order.page_id || '',
      post_id: order.post_id || '',
      marketer: order.marketer?.name || '',
      total_price: Number(order.total_price || 0) || 0,
      cod: Number(order.cod || 0) || 0,
      sheetColumns: {
        col12: posOrderId,
        col2: vn ? `${d}/${m}/${y}` : '',
        col4: skus.join(', '),
        col7: String(totalQuantity),
        col8: statusLabel,
        col11: sizes.join(', '),
        col13: tags.join(', ')
      }
    }
  };
}

async function upsertPosOrders(orders = [], shopId = '') {
  // Webhook khong truyen shopId -> lay shop dang cau hinh (don co shop_id thi uu tien shop_id)
  if (!shopId && orders.some(order => !order?.shop_id)) shopId = (await getPosCredentials()).shopId;
  // Don huy/xoa khong luu: xoa khoi DB neu da luu truoc do (luc con la don thuong)
  const removedIds = orders
    .filter(order => POS_EXCLUDED_STATUSES.has(Number(order.status)))
    .map(order => normalizePosOrder(order, shopId).orderId)
    .filter(Boolean);
  let changed = 0;
  if (removedIds.length) {
    const { deletedCount } = await Order.deleteMany({ orderId: { $in: removedIds } });
    changed += Number(deletedCount || 0);
  }
  const docs = orders
    .filter(order => !POS_EXCLUDED_STATUSES.has(Number(order.status)))
    .map(order => normalizePosOrder(order, shopId))
    .filter(doc => doc.orderId);
  for (let start = 0; start < docs.length; start += BULK_WRITE_SIZE) {
    const chunk = docs.slice(start, start + BULK_WRITE_SIZE);
    // Tai lich su va dong bo dinh ky chay song song: chi ghi de khi ban moi co updated_at >= ban dang luu.
    // Neu ban dang luu moi hon, filter khong khop -> upsert dung unique orderId (E11000) -> bo qua, giu ban moi.
    const operations = chunk.map(doc => ({
      updateOne: {
        filter: {
          orderId: doc.orderId,
          $or: [
            { 'rawData.updated_at': { $lte: doc.rawData.updated_at } },
            { 'rawData.updated_at': { $exists: false } }
          ]
        },
        update: { $set: doc },
        upsert: true
      }
    }));
    let result;
    try {
      result = await Order.bulkWrite(operations, { ordered: false });
    } catch (error) {
      const writeErrors = error.writeErrors || error.result?.getWriteErrors?.() || [];
      const onlyStale = writeErrors.length > 0 && writeErrors.every(item => (item.code ?? item.err?.code) === 11000);
      if (!onlyStale) throw error;
      result = error.result || {};
    }
    changed += Number(result.upsertedCount ?? result.nUpserted ?? 0) + Number(result.modifiedCount ?? result.nModified ?? 0);
  }
  if (changed) orderSourceState.posVersion += 1;
  return { received: docs.length, changed };
}

async function getSyncState() {
  return PosOrderSyncState.findOneAndUpdate(
    { key: SYNC_STATE_KEY },
    { $setOnInsert: { key: SYNC_STATE_KEY, backfillFrom: POS_BACKFILL_FROM, backfillCursor: POS_BACKFILL_FROM } },
    { upsert: true, new: true }
  ).lean();
}

async function saveSyncState(updates) {
  await PosOrderSyncState.updateOne({ key: SYNC_STATE_KEY }, { $set: { ...updates, updatedAt: new Date() } });
}

// Don POS luu truoc khi co shopId trong orderId ("123" -> "<shopId>_123"). Chay 1 lan, tu bo qua khi khong con don cu.
async function migrateLegacyPosOrders(shopId) {
  if (legacyOrdersMigrated) return;
  const legacyFilter = { 'rawData.source': 'pancake_pos', 'rawData.shopId': { $exists: false } };
  const legacyCount = await Order.countDocuments(legacyFilter);
  if (legacyCount) {
    try {
      await Order.updateMany(legacyFilter, [{
        $set: { orderId: { $concat: [shopId, '_', '$orderId'] }, 'rawData.shopId': shopId }
      }]);
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Dong bo/webhook da ghi ban moi (co shopId) truoc khi chuyen -> xoa ban cu bi trung
      const remaining = await Order.find(legacyFilter).select('_id orderId').lean();
      for (const doc of remaining) {
        try {
          await Order.updateOne({ _id: doc._id }, { $set: { orderId: `${shopId}_${doc.orderId}`, 'rawData.shopId': shopId } });
        } catch (innerError) {
          if (innerError.code !== 11000) throw innerError;
          await Order.deleteOne({ _id: doc._id });
        }
      }
    }
    console.log(`[pos-orders] chuyen ${legacyCount} don cu sang ma "<shop>_<id>" (shop ${shopId})`);
  }
  legacyOrdersMigrated = true;
}

// Gan tien do tai lich su voi shop dang cau hinh. Doi shop/tai khoan Pancake -> tai lai lich su cho shop moi;
// don shop cu van giu trong DB nen trong luc tai van dung POS (khong quay lai Google Sheet).
async function ensureSyncStateShop() {
  const { shopId } = await getPosCredentials();
  const state = await getSyncState();
  if (!state.shopId) {
    await migrateLegacyPosOrders(shopId);
    await saveSyncState({ shopId });
    return { ...state, shopId };
  }
  if (state.shopId === shopId) return state;

  console.log(`[pos-orders] doi shop ${state.shopId} -> ${shopId}: tai lai lich su don cho shop moi`);
  const reset = {
    shopId,
    backfillDirection: '',
    backfillCursor: '',
    backfillDone: false,
    backfillDoneAt: null,
    lastSyncedAt: null,
    deletedCleanupDone: false,
    hasPreviousShopOrders: Boolean(state.hasPreviousShopOrders || state.backfillDone || state.backfillDirection === 'desc')
  };
  await saveSyncState(reset);
  orderSourceState.posVersion += 1;
  return { ...state, ...reset };
}

// Tai lich su don tu hom nay lui ve POS_BACKFILL_FROM, moi lan 1 tuan (theo ngay tao don).
// backfillCursor = ngay som nhat da tai du; khoang ngay >= moc nay dung don POS ngay (useSheetOrders({ fromDate })),
// nen Dashboard hom nay / luat auto chuyen sang POS sau tuan dau tien thay vi cho tai het lich su.
async function runPosBackfill() {
  if (backfillRunning) return;
  backfillRunning = true;
  const startedAt = Date.now();
  try {
    let state = await getSyncState();
    if (state.backfillDone) return;
    // Dong bo dinh ky bat dau tu luc tai lich su, de khong sot don cap nhat trong luc dang tai
    if (!state.lastSyncedAt) await saveSyncState({ lastSyncedAt: new Date(startedAt) });
    // Tien do kieu cu (tai xuoi tu thang 2) -> tai lai theo chieu nguoc; upsert nen khong trung don
    if (state.backfillDirection !== 'desc') {
      await saveSyncState({ backfillDirection: 'desc', backfillCursor: addDays(todayVnDateKey(), 1) });
      state = await getSyncState();
    }

    const backfillFrom = state.backfillFrom || POS_BACKFILL_FROM;
    let cursor = state.backfillCursor;
    let total = 0;
    const backfillShopId = state.shopId;
    console.log(`[pos-orders] backfill tu ${addDays(cursor, -1)} lui ve ${backfillFrom}...`);
    while (cursor > backfillFrom) {
      // Doi shop giua chung -> dung, ensureSyncStateShop da reset tien do cho shop moi
      if (backfillShopId && (await getPosCredentials()).shopId !== backfillShopId) {
        console.log('[pos-orders] doi shop trong luc tai lich su -> dung, tai lai cho shop moi');
        return;
      }
      const windowStart = [addDays(cursor, -POS_BACKFILL_WINDOW_DAYS), backfillFrom].sort().pop();
      await fetchPosOrderPages({
        startDateTime: vnDayStartUnix(windowStart),
        endDateTime: vnDayStartUnix(cursor) - 1,
        pageSize: POS_BACKFILL_PAGE_SIZE,
        concurrency: POS_BACKFILL_CONCURRENCY,
        onPage: async (items, shopId) => {
          const { received } = await upsertPosOrders(items, shopId);
          total += received;
        }
      });
      cursor = windowStart;
      await saveSyncState({ backfillCursor: cursor });
      orderSourceState.posCoveredFrom = cursor;
      orderSourceState.posVersion += 1;
      console.log(`[pos-orders] backfill da co don tu ${cursor}: ${total} don`);
    }

    await saveSyncState({ backfillDone: true, backfillDoneAt: new Date() });
    orderSourceState.posReady = true;
    orderSourceState.posVersion += 1;
    console.log(`[pos-orders] backfill xong: ${total} don trong ${Math.round((Date.now() - startedAt) / 1000)}s -> dung don POS`);
  } catch (error) {
    console.error(`[pos-orders] backfill loi (se thu lai lan dong bo sau): ${error.message}`);
  } finally {
    backfillRunning = false;
  }
}

// Dong bo cac don moi tao / moi cap nhat (doi trang thai, the...) tu lan truoc.
async function syncRecentPosOrders() {
  if (syncRunning) return { skipped: true, received: 0, changed: 0 };
  syncRunning = true;
  try {
    const state = await getSyncState();
    const now = Date.now();
    const deep = syncCount % POS_DEEP_SYNC_EVERY === 0;
    syncCount += 1;
    const overlap = deep ? POS_DEEP_SYNC_LOOKBACK_MS : POS_SYNC_OVERLAP_MS;
    const since = state.lastSyncedAt ? new Date(state.lastSyncedAt).getTime() - overlap : now - 24 * 3600 * 1000;
    let received = 0;
    let changed = 0;
    const range = { startDateTime: Math.floor(since / 1000), endDateTime: Math.floor(now / 1000), byUpdatedAt: true };
    const onPage = async (items, shopId) => {
      const result = await upsertPosOrders(items, shopId);
      received += result.received;
      changed += result.changed;
    };
    await fetchPosOrderPages({ ...range, onPage });
    // API mac dinh bo don huy/xoa -> don da dong bo luc vua tao roi moi bi xoa se ket o trang thai cu
    // (van bi dem). Hoi rieng tung trang thai de xoa cac don do khoi DB (upsertPosOrders).
    for (const status of POS_EXCLUDED_STATUSES) {
      await fetchPosOrderPages({ ...range, status, onPage });
    }
    await saveSyncState({ lastSyncedAt: new Date(now) });
    orderSourceState.posLastSyncedAt = new Date(now);
    if (changed) console.log(`[pos-orders] dong bo: ${received} don, ${changed} thay doi`);
    return { received, changed };
  } finally {
    syncRunning = false;
  }
}

// Chay 1 lan: truoc khi dong bo hoi rieng don huy/xoa, don bi xoa sau khi da luu van nam trong DB nhu don thuong.
// Quet toan bo don huy/xoa tu backfillFrom de xoa khoi DB.
async function runPosDeletedCleanup() {
  if (deletedCleanupRunning) return;
  deletedCleanupRunning = true;
  const startedAt = Date.now();
  try {
    const state = await getSyncState();
    if (state.deletedCleanupDone) return;
    // Ban cu tung luu don huy/xoa (webhook) -> xoa luon
    await Order.deleteMany({ 'rawData.source': 'pancake_pos', status: { $in: ['cancelled', 'deleted'] } });
    let scanned = 0;
    let removed = 0;
    for (const status of POS_EXCLUDED_STATUSES) {
      await fetchPosOrderPages({
        startDateTime: vnDayStartUnix(state.backfillFrom || POS_BACKFILL_FROM),
        endDateTime: Math.floor(startedAt / 1000),
        status,
        pageSize: POS_BACKFILL_PAGE_SIZE,
        concurrency: POS_BACKFILL_CONCURRENCY,
        onPage: async (items, shopId) => {
          scanned += items.length;
          removed += (await upsertPosOrders(items, shopId)).changed;
        }
      });
    }
    await saveSyncState({ deletedCleanupDone: true });
    console.log(`[pos-orders] quet ${scanned} don huy/xoa tren POS, xoa ${removed} don khoi DB trong ${Math.round((Date.now() - startedAt) / 1000)}s`);
  } catch (error) {
    console.error(`[pos-orders] quet don huy/xoa loi (se thu lai lan dong bo sau): ${error.message}`);
  } finally {
    deletedCleanupRunning = false;
  }
}

// Goi khi khoi dong server (ORDERS_SOURCE=pos)
async function startPosOrderSync() {
  if (orderSourceState.source !== 'pos' || syncTimer) return;
  // Chi kiem tra co key (khong goi mang) de khong chan khoi dong server khi POS cham/loi;
  // loi mang de vong dong bo moi phut tu thu lai.
  const config = await getAppConfig();
  if (!String(process.env.PANCAKE_API_KEY || config?.pancakeApiKey || '').trim()) {
    console.warn('[pos-orders] chua cau hinh Pancake POS API key, van dung Google Sheet');
    return;
  }

  const state = await getSyncState();
  // Da co don shop cu trong DB -> dung POS ngay ca khi dang tai lich su shop moi
  orderSourceState.posReady = Boolean(state.backfillDone || state.hasPreviousShopOrders);
  orderSourceState.posCoveredFrom = !state.backfillDone && state.backfillDirection === 'desc' ? state.backfillCursor : '';
  orderSourceState.posLastSyncedAt = state.lastSyncedAt || null;
  console.log(`[pos-orders] nguon don: ${orderSourceState.posReady
    ? 'Pancake POS (MongoDB)'
    : `dang tai lich su POS${orderSourceState.posCoveredFrom ? ` (POS tu ${orderSourceState.posCoveredFrom})` : ''}, ngay cu hon dung Google Sheet`}`);

  const tick = async () => {
    try {
      const shopState = await ensureSyncStateShop();
      if (shopState.hasPreviousShopOrders) orderSourceState.posReady = true;
      if (!shopState.backfillDone) runPosBackfill();
      if (!shopState.deletedCleanupDone) runPosDeletedCleanup();
      await trackJob('pos-sync', syncRecentPosOrders);
    } catch (error) {
      console.error(`[pos-orders] dong bo loi: ${error.message}`);
    }
  };
  tick();
  syncTimer = setInterval(tick, POS_SYNC_INTERVAL_MS);
}

function stopPosOrderSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

async function fetchPosOrdersLive(fromDate, toDate) {
  const { shopId } = await getPosCredentials();
  const cacheKey = `${shopId}:${fromDate}:${toDate}`;
  const cached = posOrdersCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < POS_CACHE_TTL_MS) return cached.orders;

  const { orders } = await fetchPosOrderPages({
    startDateTime: vnDayStartUnix(fromDate),
    endDateTime: vnDayStartUnix(addDays(toDate, 1)) - 1
  });
  posOrdersCache.set(cacheKey, { fetchedAt: Date.now(), orders });
  if (posOrdersCache.size > 20) posOrdersCache.delete(posOrdersCache.keys().next().value);
  return orders;
}

// Dem don theo SKU (giong /orders/sku-counts) nhung chi tinh don tao trong khung gio fromHour..toHour moi ngay.
// Da dong bo POS -> doc MongoDB; chua thi goi thang API POS.
async function getPosHourlySkuStats({ fromDate, toDate, fromHour = 0, toHour = 23 }) {
  const inHourRange = date => {
    const hour = new Date(date.getTime() + VN_OFFSET_MS).getUTCHours();
    return hour >= fromHour && hour <= toHour;
  };

  let rows;
  if (!useSheetOrders({ fromDate })) {
    const cacheKey = `hourly-sku:${fromDate}:${toDate}:${fromHour}:${toHour}:${getOrderDataVersion({ fromDate })}`;
    const cached = getOrderDerivedCache(cacheKey);
    if (cached) return cached;
    const docs = await Order.find(buildOrderQuery({ fromDate, toDate })).select('orderId status rawData.status rawData.status_name rawData.items createdAt').lean();
    const { counts, totalOrders } = buildOrderSkuStats(docs.filter(doc => inHourRange(new Date(doc.createdAt))));
    return setOrderDerivedCache(cacheKey, { counts, totalOrders, fromDate, toDate, fromHour, toHour });
  } else {
    const orders = await fetchPosOrdersLive(fromDate, toDate);
    rows = [];
    for (const order of orders) {
      if (POS_EXCLUDED_STATUSES.has(Number(order.status))) continue;
      const at = getVnDateHour(order.inserted_at);
      if (!at || at.dateKey < fromDate || at.dateKey > toDate) continue;
      if (at.hour < fromHour || at.hour > toHour) continue;
      rows.push(normalizePosOrder(order));
    }
  }
  const { counts, totalOrders } = buildOrderSkuStats(rows);
  return { counts, totalOrders, fromDate, toDate, fromHour, toHour };
}

module.exports = {
  normalizePosOrder,
  upsertPosOrders,
  syncRecentPosOrders,
  startPosOrderSync,
  stopPosOrderSync,
  getPosHourlySkuStats
};
