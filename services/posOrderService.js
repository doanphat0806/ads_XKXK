'use strict';

const axios = require('axios');
const Order = require('../models/Order');
const PosOrderSyncState = require('../models/PosOrderSyncState');
const { getAppConfig } = require('./configService');
const { buildOrderSkuStats, buildOrderQuery, useSheetOrders } = require('./orderService');
const { orderSourceState } = require('./orderSourceState');
const { parseBoundedInt } = require('../utils/number');

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
// Lay lui them mot chut moi lan dong bo de khong sot don cap nhat sat moc thoi gian
const POS_SYNC_OVERLAP_MS = 5 * 60 * 1000;
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
async function fetchPosOrderPages({ startDateTime, endDateTime, byUpdatedAt = false, pageSize = POS_PAGE_SIZE, concurrency = 1, onPage } = {}) {
  const { apiKey, shopId } = await getPosCredentials();
  const orders = [];
  const loadPage = async page => {
    const params = { api_key: apiKey, page_size: pageSize, page_number: page, startDateTime, endDateTime };
    if (byUpdatedAt) params.updateStatus = 'updated_at';
    const data = await getPosPage(`${POS_API_BASE}/shops/${shopId}/orders`, params);
    const items = Array.isArray(data?.data) ? data.data : [];
    if (onPage) await onPage(items);
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
function normalizePosOrder(order = {}) {
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
  const orderId = String(order.id ?? order.system_id ?? '');
  const [y, m, d] = (vn?.dateKey || '').split('-');

  return {
    orderId,
    status: statusLabel,
    customerName: String(order.bill_full_name || order.customer?.name || ''),
    totalPrice: Number(order.total_price_after_sub_discount ?? order.total_price ?? 0) || 0,
    createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs) : new Date(),
    rawData: {
      source: 'pancake_pos',
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
        col12: orderId,
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

async function upsertPosOrders(orders = []) {
  const docs = orders.map(normalizePosOrder).filter(doc => doc.orderId);
  let changed = 0;
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
    console.log(`[pos-orders] backfill tu ${addDays(cursor, -1)} lui ve ${backfillFrom}...`);
    while (cursor > backfillFrom) {
      const windowStart = [addDays(cursor, -POS_BACKFILL_WINDOW_DAYS), backfillFrom].sort().pop();
      await fetchPosOrderPages({
        startDateTime: vnDayStartUnix(windowStart),
        endDateTime: vnDayStartUnix(cursor) - 1,
        pageSize: POS_BACKFILL_PAGE_SIZE,
        concurrency: POS_BACKFILL_CONCURRENCY,
        onPage: async items => {
          const { received } = await upsertPosOrders(items);
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
    const since = state.lastSyncedAt ? new Date(state.lastSyncedAt).getTime() - POS_SYNC_OVERLAP_MS : now - 24 * 3600 * 1000;
    let received = 0;
    let changed = 0;
    await fetchPosOrderPages({
      startDateTime: Math.floor(since / 1000),
      endDateTime: Math.floor(now / 1000),
      byUpdatedAt: true,
      onPage: async items => {
        const result = await upsertPosOrders(items);
        received += result.received;
        changed += result.changed;
      }
    });
    await saveSyncState({ lastSyncedAt: new Date(now) });
    orderSourceState.posLastSyncedAt = new Date(now);
    if (changed) console.log(`[pos-orders] dong bo: ${received} don, ${changed} thay doi`);
    return { received, changed };
  } finally {
    syncRunning = false;
  }
}

// Goi khi khoi dong server (ORDERS_SOURCE=pos)
async function startPosOrderSync() {
  if (orderSourceState.source !== 'pos' || syncTimer) return;
  try {
    await getPosCredentials();
  } catch (error) {
    console.warn(`[pos-orders] khong dong bo duoc, van dung Google Sheet: ${error.message}`);
    return;
  }

  const state = await getSyncState();
  orderSourceState.posReady = Boolean(state.backfillDone);
  orderSourceState.posCoveredFrom = !state.backfillDone && state.backfillDirection === 'desc' ? state.backfillCursor : '';
  orderSourceState.posLastSyncedAt = state.lastSyncedAt || null;
  console.log(`[pos-orders] nguon don: ${orderSourceState.posReady
    ? 'Pancake POS (MongoDB)'
    : `dang tai lich su POS${orderSourceState.posCoveredFrom ? ` (POS tu ${orderSourceState.posCoveredFrom})` : ''}, ngay cu hon dung Google Sheet`}`);

  const tick = async () => {
    try {
      if (!orderSourceState.posReady) runPosBackfill();
      await syncRecentPosOrders();
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
    const docs = await Order.find(buildOrderQuery({ fromDate, toDate })).select('orderId status rawData createdAt').lean();
    rows = docs.filter(doc => inHourRange(new Date(doc.createdAt)));
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
