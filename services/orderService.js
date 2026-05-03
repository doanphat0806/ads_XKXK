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
const ORDERS_SHEET_CACHE_TTL_MS = parseBoundedInt(process.env.ORDERS_SHEET_CACHE_TTL_MS, 5 * 60 * 1000, 5000, 600000);
const ORDERS_SHEET_TIMEOUT_MS = parseBoundedInt(process.env.ORDERS_SHEET_TIMEOUT_MS, 90000, 10000, 300000);
const ORDERS_SHEET_RETRIES = parseBoundedInt(process.env.ORDERS_SHEET_RETRIES, 3, 1, 5);
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const ordersSheetCache = {
  fetchedAt: 0,
  rows: null
};
const orderStatsCache = new Map();

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

function getOrderStatsCacheKey({ fromDate, toDate } = {}) {
  return `${fromDate || ''}:${toDate || ''}:${ordersSheetCache.fetchedAt || 0}`;
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

async function fetchOrderSheetRows({ refresh = false } = {}) {
  if (!ORDERS_SHEET_ID) {
    throw new Error('Chua cau hinh ORDERS_SHEET_ID');
  }

  const now = Date.now();
  if (
    !refresh &&
    ordersSheetCache.rows &&
    now - ordersSheetCache.fetchedAt < ORDERS_SHEET_CACHE_TTL_MS
  ) {
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
      if (status === 401 || status === 403) {
        throw new Error('Google Sheet dang private voi server. Hay share file Sheet quyen Anyone with the link can view, hoac cau hinh ORDERS_SHEET_ID bang file Sheet public.');
      }
      if (attempt < ORDERS_SHEET_RETRIES) {
        await delay(1000 * attempt);
      }
    }
  }

  if (lastError) {
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
  orderStatsCache.clear();
  return rows;
}

async function getOrderSheetOrders({ fromDate, toDate, limit, refresh = false } = {}) {
  const rows = await fetchOrderSheetRows({ refresh });
  let filtered = rows.filter(row => {
    if (fromDate && row.dateKey < fromDate) return false;
    if (toDate && row.dateKey > toDate) return false;
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
  classifyReturnStatus,
  useSheetOrders,
  buildOrderSkuStats,
  fetchOrderSheetRows,
  getOrderSheetOrders,
  getOrderStatsCacheKey,
  ordersSheetCache,
  orderStatsCache
};
