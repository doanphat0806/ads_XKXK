const axios = require('axios');
const { parseBoundedInt } = require('../utils/number');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_ORDERS_SHEET_ID = '12fPfFQQSKX5SE3748rfWGNnLsgvzzWCtRHrAKLAh7lg';
const DEFAULT_ORDERS_SHEET_NAME = '\u0110\u01a0N H\u00c0NG(T\u1ed5ng Ho\u00e0n)';
const ORDERS_SHEET_ID = process.env.ORDERS_SHEET_ID || DEFAULT_ORDERS_SHEET_ID;
const ORDERS_SHEET_NAME = process.env.ORDERS_SHEET_NAME || DEFAULT_ORDERS_SHEET_NAME;
const ORDERS_SHEET_RANGE = process.env.ORDERS_SHEET_RANGE || 'A1:M200000';
const ORDERS_SHEET_QUERY = process.env.ORDERS_SHEET_QUERY || 'select L,B,D,G,H,K,M where B is not null';
const ORDERS_SOURCE = String(process.env.ORDERS_SOURCE || 'sheet').trim().toLowerCase();
const ORDERS_SHEET_CACHE_TTL_MS = parseBoundedInt(process.env.ORDERS_SHEET_CACHE_TTL_MS, 30 * 60 * 1000, 5000, 60 * 60 * 1000);
const ORDERS_SHEET_TIMEOUT_MS = parseBoundedInt(process.env.ORDERS_SHEET_TIMEOUT_MS, 90000, 10000, 300000);
const ORDERS_SHEET_RETRIES = parseBoundedInt(process.env.ORDERS_SHEET_RETRIES, 3, 1, 5);
const ORDERS_SHEET_RATE_LIMIT_BACKOFF_MS = parseBoundedInt(process.env.ORDERS_SHEET_RATE_LIMIT_BACKOFF_MS, 30 * 60 * 1000, 60 * 1000, 6 * 60 * 60 * 1000);
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const ordersSheetCache = {
  fetchedAt: 0,
  rows: null,
  rateLimitedUntil: 0,
  lastError: '',
  lastErrorAt: 0
};
const orderStatsCache = new Map();
const orderSheetPageCache = new Map();
const RETURN_SUMMARY_BUCKETS = [
  { key: 'san', label: 'Sẵn' },
  { key: 'sale', label: 'Sale' },
  { key: 'sale119', label: 'Sale 119+99' },
  { key: 'od', label: 'Order' }
];

function buildOrderQuery({ fromDate, toDate } = {}) {
  const query = {
    status: { $nin: ['5', 'cancelled', 'deleted'] },
    'rawData.is_deleted': { $ne: true }
  };

  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) {
      const d = new Date(`${fromDate}T00:00:00Z`);
      query.createdAt.$gte = new Date(d.getTime() - 7 * 60 * 60 * 1000);
    }
    if (toDate) {
      const d = new Date(`${toDate}T23:59:59Z`);
      query.createdAt.$lte = new Date(d.getTime() - 7 * 60 * 60 * 1000);
    }
  }

  return query;
}

function getOrderItemsFromRaw(raw = {}) {
  return [raw.items, raw.line_items, raw.products, raw.details].find(Array.isArray) || [];
}

function getOrderItemSku(item = {}) {
  const variationInfo = item.variation_info || {};
  return variationInfo.product_display_id ||
    variationInfo.display_id ||
    item.sku ||
    item.item_code ||
    '';
}

function getOrderItemQuantity(item = {}) {
  const quantity = Number(
    item.quantity ??
    item.qty ??
    item.amount ??
    item.count ??
    1
  );
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function normalizeSkuKey(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMarketingText(value = '') {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function classifyReturnOrderTagBucket(value = '') {
  const tokens = normalizeMarketingText(value).split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';

  const tokenSet = new Set(tokens);
  const compact = tokens.join('');
  if (
    tokenSet.has('sale119') ||
    tokenSet.has('sale99') ||
    tokenSet.has('99') ||
    compact.includes('sale119') ||
    compact.includes('sale99') ||
    (tokenSet.has('sale') && (tokenSet.has('119') || tokenSet.has('99')))
  ) {
    return 'sale119';
  }
  if (tokenSet.has('san') || compact.includes('san')) return 'san';
  if (tokenSet.has('sale') || compact.includes('sale')) return 'sale';
  if (
    tokenSet.has('od') ||
    tokenSet.has('oder') ||
    tokenSet.has('order') ||
    compact.includes('oder') ||
    compact.includes('order')
  ) {
    return 'od';
  }
  return '';
}

function classifyReturnAdNameBucket(value = '') {
  const tokens = normalizeMarketingText(value).split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';

  const tokenSet = new Set(tokens);
  const compact = tokens.join('');
  if (
    tokenSet.has('xa') ||
    tokenSet.has('99') ||
    tokenSet.has('sale99') ||
    compact.includes('xa') ||
    tokenSet.has('sale119') ||
    compact.includes('sale99') ||
    compact.includes('sale119') ||
    (tokenSet.has('sale') && (tokenSet.has('119') || tokenSet.has('99')))
  ) {
    return 'sale119';
  }
  if (tokenSet.has('san') || compact.includes('san')) return 'san';
  if (tokenSet.has('sale') || compact.includes('sale')) return 'sale';
  if (
    tokenSet.has('win') ||
    tokenSet.has('test') ||
    tokenSet.has('od') ||
    tokenSet.has('oder') ||
    tokenSet.has('order') ||
    compact.includes('oder') ||
    compact.includes('order')
  ) {
    return 'od';
  }
  return '';
}

function getOrderTagText(order = {}) {
  const raw = order.rawData || {};
  const sheet = raw.sheetColumns || {};
  const tags = Array.isArray(raw.tags) ? raw.tags.join(' ') : raw.tags;
  return [sheet.col13, tags].filter(Boolean).join(' ');
}

function getOrderDateKey(order = {}) {
  if (order.dateKey) return order.dateKey;

  const raw = order.rawData || {};
  const sheet = raw.sheetColumns || {};
  const sheetDateKey = parseSheetDateKey(sheet.col2);
  if (sheetDateKey) return sheetDateKey;

  const timestamp = new Date(order.createdAt || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  return new Date(timestamp + VN_OFFSET_MS).toISOString().split('T')[0];
}

function normalizeStatusKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyReturnStatus(order = {}) {
  const rawStatus = order.status || order.rawData?.status_name || order.rawData?.status || '';
  const status = normalizeStatusKey(rawStatus);
  if (!status) return '';

  if (status.includes('dang hoan')) return 'returning';
  if (status.includes('da hoan')) return 'returned';
  if (status.includes('da nhan')) return 'received';
  return '';
}

function isUnshippedSummaryStatus(order = {}) {
  const rawStatus = order.status || order.rawData?.status_name || order.rawData?.status || '';
  const status = normalizeStatusKey(rawStatus);
  if (!status) return false;

  return status === 'moi' ||
    status === 'new' ||
    status.includes('don moi') ||
    status.includes('cho hang');
}

function incrementReturnStats(stats, status, amount = 1) {
  if (status && Object.prototype.hasOwnProperty.call(stats, status)) {
    stats[status] += amount;
  }
}

function useSheetOrders() {
  return ORDERS_SOURCE === 'sheet';
}

function toSheetText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

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

function parseSheetDateKey(value) {
  const raw = toSheetText(value);
  if (!raw) return '';

  const serial = Number(raw.replace(',', '.'));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().split('T')[0];
  }

  const yyyyFirst = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (yyyyFirst) {
    const [, y, m, d] = yyyyFirst;
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const dmy = raw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    if (Number(m) > 12 && Number(d) <= 12) {
      [d, m] = [m, d];
    }
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const vnDate = new Date(parsed.getTime() + VN_OFFSET_MS);
    return vnDate.toISOString().split('T')[0];
  }

  return '';
}

function dateKeyToVnIso(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date().toISOString();
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) - VN_OFFSET_MS).toISOString();
}

function parseSheetNumber(value, fallback = 1) {
  const clean = toSheetText(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSheetCell(row, index) {
  return toSheetText(row[index] || '');
}

function mapOrderSheetRow(row, rowIndex) {
  // Sheet nguồn 13 cột (A:M) — dựa theo QUERY: SELECT Col12,Col2,Col4,Col7,Col8,Col11,Col13
  // Col12=L=ID2(Mã đơn), Col2=B=Ngày tạo, Col4=D=Mã sản phẩm(SKU), Col7=G=Số lượng,
  // Col8=H=Trạng thái, Col11=K=Thuộc tính SIZE, Col13=M=Thẻ
  // Default Sheet query returns 7 columns:
  // L, B, D, G, H, K, M.
  // Keep the old A:M index mapping as a fallback for custom queries/ranges.
  const queriedShape = row.length <= 7;
  const col12 = getSheetCell(row, queriedShape ? 0 : 11); // L - ID2
  const col2  = getSheetCell(row, queriedShape ? 1 : 1);  // B - Ngay tao don
  const col4  = getSheetCell(row, queriedShape ? 2 : 3);  // D - SKU
  const col7  = getSheetCell(row, queriedShape ? 3 : 6);  // G - So luong
  const col8  = getSheetCell(row, queriedShape ? 4 : 7);  // H - Trang thai
  const col11 = getSheetCell(row, queriedShape ? 5 : 10); // K - SIZE
  const col13 = getSheetCell(row, queriedShape ? 6 : 12); // M - Tags

  const dateKey = parseSheetDateKey(col2);
  if (!dateKey) return null;

  const orderId  = col12 || '';                                              // ID2 = mã đơn (để trống nếu không có)
  const sku      = col4;                                  // Mã sản phẩm
  const quantity = parseSheetNumber(col7, 1);             // Số lượng
  const status   = col8 || 'unknown';                     // Trạng thái
  const size     = col11;                                 // Thuộc tính SIZE
  const tags     = col13;                                 // Thẻ

  return {
    source: 'google_sheet',
    orderId,
    status,
    customerName: '',
    totalPrice: 0,
    createdAt: dateKeyToVnIso(dateKey),
    dateKey,
    rawData: {
      source: 'google_sheet',
      rowNumber: rowIndex + 1,
      status_name: status,
      tags: tags ? [tags] : [],
      sheetColumns: { col12, col2, col4, col7, col8, col11, col13 },
      items: [{
        sku,
        item_code: sku,
        name: sku,
        product_name: sku,
        quantity,
        variation_value: size,
        size,
        variation_info: {
          product_display_id: sku,
          display_id: sku,
          name: sku,
          detail: size
        }
      }]
    }
  };
}

function getOrderSearchText(order = {}) {
  const raw = order.rawData || {};
  const sheet = raw.sheetColumns || {};
  const itemText = getOrderItemsFromRaw(raw)
    .map(item => [
      getOrderItemSku(item),
      item.name,
      item.product_name,
      item.variation_value,
      item.size,
      item.variation_info?.name,
      item.variation_info?.detail
    ].filter(Boolean).join(' '))
    .join(' ');

  return normalizeSearchText([
    order.orderId,
    order.status,
    order.customerName,
    sheet.col12,
    sheet.col2,
    sheet.col4,
    sheet.col7,
    sheet.col8,
    sheet.col11,
    sheet.col13,
    raw.status_name,
    Array.isArray(raw.tags) ? raw.tags.join(' ') : raw.tags,
    itemText
  ].filter(Boolean).join(' '));
}

function orderMatchesSearch(order = {}, search = '') {
  const term = normalizeSearchText(search);
  if (!term) return true;
  return getOrderSearchText(order).includes(term);
}

function buildOrderTableStats(orders = []) {
  const uniqueSkus = new Set();
  const statusCounts = {};
  let totalQuantity = 0;

  for (const order of orders) {
    const status = toSheetText(order.status || order.rawData?.status_name || 'unknown', 'unknown');
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    for (const item of getOrderItemsFromRaw(order.rawData || {})) {
      const sku = normalizeSkuKey(getOrderItemSku(item));
      if (sku) uniqueSkus.add(sku);
      totalQuantity += getOrderItemQuantity(item);
    }
  }

  return {
    totalQuantity,
    uniqueSkus: uniqueSkus.size,
    statusCounts
  };
}

function getOrderStatsCacheKey({ fromDate, toDate } = {}) {
  return `${fromDate || ''}:${toDate || ''}:${ordersSheetCache.fetchedAt || 0}`;
}

function getOrderSheetPageCacheKey({ fromDate, toDate, search } = {}) {
  return [
    fromDate || '',
    toDate || '',
    normalizeSearchText(search),
    ordersSheetCache.fetchedAt || 0
  ].join(':');
}

function buildOrderSkuStats(orders = []) {
  const EXCLUDE_ST = ['mới', 'moi', 'new'];
  const rows = orders.filter(o => {
    const st = String(o.status || '').toLowerCase().trim();
    return !EXCLUDE_ST.includes(st);
  });
  const totalOrders = rows.filter(o => o.orderId && String(o.orderId).trim() !== '').length;
  const counts = {};
  const returnStats = {
    returned: 0,
    returning: 0,
    received: 0,
    denominator: 0,
    rate: 0
  };
  const returnStatsBySku = {};

  for (const order of rows) {
    const returnStatus = classifyReturnStatus(order);
    incrementReturnStats(returnStats, returnStatus, 1);

    const orderSkuQuantities = {};
    for (const item of getOrderItemsFromRaw(order.rawData || {})) {
      const sku = normalizeSkuKey(getOrderItemSku(item));
      if (!sku) continue;
      orderSkuQuantities[sku] = (orderSkuQuantities[sku] || 0) + getOrderItemQuantity(item);
    }

    for (const [sku, quantity] of Object.entries(orderSkuQuantities)) {
      counts[sku] = (counts[sku] || 0) + quantity;
      if (!returnStatsBySku[sku]) {
        returnStatsBySku[sku] = {
          returned: 0,
          returning: 0,
          received: 0,
          denominator: 0,
          rate: 0
        };
      }
      incrementReturnStats(returnStatsBySku[sku], returnStatus, 1);
    }
  }

  returnStats.denominator = returnStats.returned + returnStats.returning + returnStats.received;
  returnStats.rate = returnStats.denominator > 0
    ? (returnStats.returned + returnStats.returning) / returnStats.denominator
    : 0;

  for (const skuStats of Object.values(returnStatsBySku)) {
    skuStats.denominator = skuStats.returned + skuStats.returning + skuStats.received;
    skuStats.rate = skuStats.denominator > 0
      ? (skuStats.returned + skuStats.returning) / skuStats.denominator
      : 0;
  }

  return { counts, totalOrders, returnStats, returnStatsBySku };
}

function createReturnProductRateStats(key, label) {
  return {
    key,
    label,
    returned: 0,
    returning: 0,
    received: 0,
    returnCount: 0,
    denominator: 0,
    rate: 0
  };
}

function finalizeReturnProductRateStats(stats = {}) {
  const returned = Number(stats.returned || 0);
  const returning = Number(stats.returning || 0);
  const received = Number(stats.received || 0);
  const returnCount = returned + returning;
  const denominator = returnCount + received;

  return {
    ...stats,
    returned,
    returning,
    received,
    returnCount,
    denominator,
    rate: denominator > 0 ? returnCount / denominator : 0
  };
}

function getOrderReturnProductUnitCount(order = {}) {
  const skus = new Set();
  for (const item of getOrderItemsFromRaw(order.rawData || {})) {
    const sku = normalizeSkuKey(getOrderItemSku(item));
    if (sku) skus.add(sku);
  }
  return skus.size;
}

function buildReturnProductRateStats(orders = []) {
  const categories = RETURN_SUMMARY_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = createReturnProductRateStats(bucket.key, bucket.label);
    return acc;
  }, {});
  const total = createReturnProductRateStats('total', 'Tổng');

  for (const order of orders) {
    const returnStatus = classifyReturnStatus(order);
    if (!['returned', 'returning', 'received'].includes(returnStatus)) continue;

    const productUnitCount = getOrderReturnProductUnitCount(order);
    if (productUnitCount <= 0) continue;

    incrementReturnStats(total, returnStatus, productUnitCount);

    const bucketKey = classifyReturnOrderTagBucket(getOrderTagText(order));
    if (bucketKey && categories[bucketKey]) {
      incrementReturnStats(categories[bucketKey], returnStatus, productUnitCount);
    }
  }

  return {
    total: finalizeReturnProductRateStats(total),
    categories: RETURN_SUMMARY_BUCKETS.map(bucket => finalizeReturnProductRateStats(categories[bucket.key]))
  };
}

function buildReturnSummaryOrderStats(orders = [], { fromDate = '', toDate = '' } = {}) {
  const categories = RETURN_SUMMARY_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = {
      key: bucket.key,
      label: bucket.label,
      orderCount: 0
    };
    return acc;
  }, {});
  const daily = {};
  const total = { orderCount: 0, shippedOrderCount: 0, shipRate: 0 };

  for (const order of orders) {
    const dateKey = getOrderDateKey(order);
    if (!dateKey) continue;
    if (fromDate && dateKey < fromDate) continue;
    if (toDate && dateKey > toDate) continue;

    const orderId = String(order.orderId || order.rawData?.sheetColumns?.col12 || '').trim();
    if (!orderId) continue;

    if (!daily[dateKey]) {
      daily[dateKey] = RETURN_SUMMARY_BUCKETS.reduce((acc, bucket) => {
        acc[bucket.key] = { orderCount: 0 };
        return acc;
      }, { total: { orderCount: 0, shippedOrderCount: 0, shipRate: 0 } });
    }

    total.orderCount += 1;
    daily[dateKey].total.orderCount += 1;
    if (!isUnshippedSummaryStatus(order)) {
      total.shippedOrderCount += 1;
      daily[dateKey].total.shippedOrderCount += 1;
    }

    const bucketKey = classifyReturnOrderTagBucket(getOrderTagText(order));
    if (!bucketKey || !categories[bucketKey]) continue;

    categories[bucketKey].orderCount += 1;
    daily[dateKey][bucketKey].orderCount += 1;
  }

  total.shipRate = total.orderCount > 0 ? total.shippedOrderCount / total.orderCount : 0;
  Object.values(daily).forEach(day => {
    day.total.shipRate = day.total.orderCount > 0
      ? day.total.shippedOrderCount / day.total.orderCount
      : 0;
  });

  return { categories, daily, total };
}

async function fetchOrderSheetRows({ refresh = false } = {}) {
  if (!ORDERS_SHEET_ID) {
    throw new Error('Chua cau hinh ORDERS_SHEET_ID');
  }

  const now = Date.now();
  if (refresh && ordersSheetCache.rateLimitedUntil > now && ordersSheetCache.rows?.length) {
    return ordersSheetCache.rows;
  }
  if (
    !refresh &&
    ordersSheetCache.rows &&
    now - ordersSheetCache.fetchedAt < ORDERS_SHEET_CACHE_TTL_MS
  ) {
    return ordersSheetCache.rows;
  }
  if (!refresh && ordersSheetCache.rows?.length) {
    return ordersSheetCache.rows;
  }

  const params = new URLSearchParams({
    tqx: 'out:csv',
    sheet: ORDERS_SHEET_NAME,
    range: ORDERS_SHEET_RANGE,
    tq: ORDERS_SHEET_QUERY
  });
  const url = `https://docs.google.com/spreadsheets/d/${ORDERS_SHEET_ID}/gviz/tq?${params.toString()}`;
  let response;
  let lastError = null;
  for (let attempt = 1; attempt <= ORDERS_SHEET_RETRIES; attempt += 1) {
    try {
      response = await axios.get(url, {
        responseType: 'text',
        timeout: ORDERS_SHEET_TIMEOUT_MS,
        transformResponse: [(data) => data]
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status === 429) {
        ordersSheetCache.rateLimitedUntil = Date.now() + ORDERS_SHEET_RATE_LIMIT_BACKOFF_MS;
      }
      if (status === 401 || status === 403) {
        throw new Error('Google Sheet dang private voi server. Hay share file Sheet quyen Anyone with the link can view, hoac cau hinh ORDERS_SHEET_ID bang file Sheet public.');
      }
      if (attempt < ORDERS_SHEET_RETRIES) {
        await delay(1000 * attempt);
      }
    }
  }

  if (lastError) {
    ordersSheetCache.lastError = lastError.message || String(lastError);
    ordersSheetCache.lastErrorAt = Date.now();
    if (ordersSheetCache.rows?.length) {
      console.warn(`Sheet Cache: refresh failed (${lastError.message}); using cached ${ordersSheetCache.rows.length} rows`);
      return ordersSheetCache.rows;
    }
    throw lastError;
  }

  const csv = String(response.data || '').trim();
  if (!csv || csv.startsWith('<')) {
    throw new Error('Khong doc duoc Google Sheet. Hay chia se file Sheet o quyen Anyone with the link can view, hoac cau hinh service doc rieng.');
  }
  if (csv.startsWith('{')) {
    try {
      const payload = JSON.parse(csv);
      if (payload.status === 'error') {
        const detail = payload.errors?.[0]?.detailed_message || payload.errors?.[0]?.message || 'Google Sheet query error';
        throw new Error(detail);
      }
    } catch (error) {
      if (error.message) throw error;
      throw new Error('Google Sheet tra ve du lieu khong phai CSV.');
    }
  }

  const csvRows = parseCsvRows(csv);
  const rows = csvRows
    .slice(1)
    .map((row, index) => mapOrderSheetRow(row, index + 1))
    .filter(Boolean);

  ordersSheetCache.rows = rows;
  ordersSheetCache.fetchedAt = now;
  ordersSheetCache.rateLimitedUntil = 0;
  ordersSheetCache.lastError = '';
  ordersSheetCache.lastErrorAt = 0;
  orderStatsCache.clear();
  orderSheetPageCache.clear();
  return rows;
}

async function getOrderSheetPage({ fromDate, toDate, search = '', page = 1, limit = 100, refresh = false } = {}) {
  const rows = await fetchOrderSheetRows({ refresh });
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const cacheKey = getOrderSheetPageCacheKey({ fromDate, toDate, search });

  let cached = !refresh ? orderSheetPageCache.get(cacheKey) : null;
  if (!cached) {
    const filteredRows = rows
      .filter(row => {
        if (fromDate && row.dateKey < fromDate) return false;
        if (toDate && row.dateKey > toDate) return false;
        if (!orderMatchesSearch(row, search)) return false;
        return true;
      })
      .sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));

    cached = {
      rows: filteredRows,
      stats: buildOrderTableStats(filteredRows),
      total: filteredRows.length
    };
    orderSheetPageCache.set(cacheKey, cached);
    if (orderSheetPageCache.size > 50) {
      const oldestKey = orderSheetPageCache.keys().next().value;
      orderSheetPageCache.delete(oldestKey);
    }
  }

  const start = (safePage - 1) * safeLimit;
  return {
    orders: cached.rows.slice(start, start + safeLimit).map(({ dateKey, ...order }) => order),
    total: cached.total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(cached.total / safeLimit) || 1,
    stats: cached.stats,
    cachedAt: ordersSheetCache.fetchedAt ? new Date(ordersSheetCache.fetchedAt).toISOString() : '',
    lastError: ordersSheetCache.lastError || ''
  };
}

async function getOrderSheetOrders({ fromDate, toDate, limit, refresh = false, search = '' } = {}) {
  const rows = await fetchOrderSheetRows({ refresh });
  let filtered = rows.filter(row => {
    if (fromDate && row.dateKey < fromDate) return false;
    if (toDate && row.dateKey > toDate) return false;
    if (!orderMatchesSearch(row, search)) return false;
    return true;
  });

  filtered = filtered.sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));

  // Chỉ giới hạn nếu có truyền limit (số dương hợp lệ)
  const n = Number(limit);
  if (n > 0 && n < filtered.length) {
    filtered = filtered.slice(0, n);
  }

  return filtered.map(({ dateKey, ...order }) => order);
}

module.exports = {
  buildOrderQuery,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  normalizeSkuKey,
  normalizeStatusKey,
  orderMatchesSearch,
  classifyReturnStatus,
  classifyReturnOrderTagBucket,
  classifyReturnAdNameBucket,
  classifyReturnSummaryBucket: classifyReturnOrderTagBucket,
  buildReturnSummaryOrderStats,
  buildReturnProductRateStats,
  RETURN_SUMMARY_BUCKETS,
  useSheetOrders,
  buildOrderSkuStats,
  buildOrderTableStats,
  fetchOrderSheetRows,
  getOrderSheetPage,
  getOrderSheetOrders,
  getOrderStatsCacheKey,
  ordersSheetCache,
  orderStatsCache
};
