const { parseBoundedInt } = require('../utils/number');
const { orderSourceState } = require('./orderSourceState');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const orderStatsCache = new Map();
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
  // Nguon POS: chi doc don do dong bo POS ghi (bo du lieu cu tu webhook ghi payload tho vao bang Order)
  if (orderSourceState.source === 'pos') query['rawData.source'] = 'pancake_pos';

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

// The chinh -> nhom. "Oder + Sẵn" tinh la Order. Thu tu uu tien khi don co nhieu the chinh: Order > Sale 119 > Sale > Sẵn.
const MAIN_ORDER_TAG_BUCKETS = new Map([
  ['oder', 'od'],
  ['order', 'od'],
  ['od', 'od'],
  ['oder san', 'od'],
  ['order san', 'od'],
  ['sale 119', 'sale119'],
  ['sale119', 'sale119'],
  ['sale 99', 'sale119'],
  ['sale99', 'sale119'],
  ['sale', 'sale'],
  ['san', 'san']
]);
const ORDER_TAG_BUCKET_PRIORITY = ['od', 'sale119', 'sale', 'san'];

function pickOrderTagBucket(buckets) {
  return ORDER_TAG_BUCKET_PRIORITY.find(bucket => buckets.has(bucket)) || '';
}

// value: chuoi the (nhieu the cach nhau dau phay, vd cot J/M cua sheet) hoac mang ten the (POS).
function classifyReturnOrderTagBucket(value = '') {
  const tags = (Array.isArray(value) ? value : String(value || '').split(','))
    .map(tag => normalizeMarketingText(tag))
    .filter(Boolean);
  if (!tags.length) return '';

  const exact = pickOrderTagBucket(new Set(tags.map(tag => MAIN_ORDER_TAG_BUCKETS.get(tag)).filter(Boolean)));
  if (exact) return exact;

  // The phu nhu "Đơn nhiều sản phẩm" chua chu "san" -> khong duoc tinh la Sẵn
  const fallback = tags
    .filter(tag => !tag.includes('nhieu san pham'))
    .map(classifyLegacyOrderTagText)
    .filter(Boolean);
  return pickOrderTagBucket(new Set(fallback));
}

function classifyLegacyOrderTagText(value = '') {
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

// The don hang, cach nhau dau phay. Sheet: cot M (+ rawData.tags = [cot M]); POS: rawData.tags = [{ id, name }].
function getOrderTagText(order = {}) {
  const raw = order.rawData || {};
  const sheet = raw.sheetColumns || {};
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(tag => (typeof tag === 'string' ? tag : tag?.name || ''))
    : [raw.tags];
  return [...new Set([sheet.col13, ...tags].map(tag => String(tag || '').trim()).filter(Boolean))].join(', ');
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

// Don hang luon doc tu bang Order (MongoDB). Ham nay chi cho biet MongoDB da co du don POS
// cho khoang ngay chua (dang tai lich su POS -> chi khoang fromDate >= posCoveredFrom la du);
// noi nao can so lieu day du khi chua du thi goi thang API POS (vd. thong ke theo gio).
function isPosRangeReady({ fromDate = '' } = {}) {
  if (orderSourceState.source !== 'pos') return true;
  if (orderSourceState.posReady) return true;
  const coveredFrom = orderSourceState.posCoveredFrom;
  return Boolean(fromDate && coveredFrom && String(fromDate) >= coveredFrom);
}

function getOrderSourceName() {
  return orderSourceState.source === 'pos' ? 'pancake_pos' : 'database';
}

// Doi moi khi du lieu don thay doi -> dung lam khoa cache
// posVersion tang gan nhu moi phut (moi lan dong bo POS co don doi) -> cache theo version luon truot.
// Chi cong bo version moi toi da moi ORDER_DATA_VERSION_MIN_MS: so lieu tre toi da 2 phut, cache co tac dung.
const ORDER_DATA_VERSION_MIN_MS = parseBoundedInt(process.env.ORDER_DATA_VERSION_MIN_MS, 2 * 60 * 1000, 0, 30 * 60 * 1000);
const publishedPosVersion = { version: -1, at: 0 };

function getPublishedPosVersion() {
  const now = Date.now();
  if (
    publishedPosVersion.version !== orderSourceState.posVersion &&
    (publishedPosVersion.version < 0 || now - publishedPosVersion.at >= ORDER_DATA_VERSION_MIN_MS)
  ) {
    publishedPosVersion.version = orderSourceState.posVersion;
    publishedPosVersion.at = now;
  }
  return publishedPosVersion.version;
}

function getOrderDataVersion() {
  return `db-${getPublishedPosVersion()}`;
}

function toSheetText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
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

// Chi cac truong buildOrderSkuStats doc: ~1/4 dung luong so voi ca rawData (lich su ~117k don: 103MB -> 26MB)
const ORDER_SKU_STATS_FIELDS = 'orderId status rawData.status rawData.status_name rawData.items rawData.line_items rawData.products rawData.details';

function getOrderStatsCacheKey({ fromDate, toDate } = {}) {
  return `${fromDate || ''}:${toDate || ''}:${getOrderDataVersion({ fromDate })}`;
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

// The ly do hoan (POS) -> nhom hien thi. Cac the khac (Oder/Sale, doi soat, trang thai...) khong phai ly do.
const RETURN_REASON_TAGS = new Map([
  ['khach khong ung hang', 'Khách không ưng hàng'],
  ['khong vua', 'Không vừa'],
  ['chat xau dat', 'Chất xấu - Đắt'],
  ['ko goi duoc khach', 'Không gọi được khách'],
  ['khong goi duoc khach', 'Không gọi được khách'],
  ['khong nghe may', 'Không gọi được khách'],
  ['khong tra ship', 'Không trả ship'],
  ['hang ve muon', 'Hàng về muộn'],
  ['hang ve lau khach k cho duoc', 'Hàng về muộn'],
  ['khong co li do', 'Không có lí do'],
  ['do ship', 'Do ship'],
  ['giao khong thanh', 'Giao không thành'],
  ['do sp loi', 'Sản phẩm lỗi'],
  ['do khach', 'Do khách'],
  ['gui sai hang', 'Gửi sai hàng'],
  ['ve sai hoac dong sai', 'Gửi sai hàng'],
  ['dat sai hang', 'Đặt / chốt sai'],
  ['chot sai', 'Đặt / chốt sai'],
  ['dich benh', 'Dịch bệnh']
]);
const NO_RETURN_REASON_LABEL = 'Chưa ghi lý do';

function getOrderReturnReasons(order = {}) {
  const tags = String(getOrderTagText(order) || '').split(',');
  return [...new Set(tags.map(tag => RETURN_REASON_TAGS.get(normalizeMarketingText(tag))).filter(Boolean))];
}

// Ly do hoan tren cac don da hoan / dang hoan, tong va theo nhom the (Sẵn/Sale/Sale119/Order).
// 1 don co the co nhieu ly do -> tong % cac ly do co the > 100%.
function buildReturnReasonStats(orders = []) {
  const createGroup = () => ({ returnCount: 0, counts: {} });
  const groups = { total: createGroup() };
  RETURN_SUMMARY_BUCKETS.forEach(bucket => { groups[bucket.key] = createGroup(); });

  const seenOrderIds = new Set();

  for (const order of orders) {
    const status = classifyReturnStatus(order);
    if (status !== 'returned' && status !== 'returning') continue;
    const orderId = String(order.orderId || order.rawData?.sheetColumns?.col12 || '').trim();
    if (orderId) {
      if (seenOrderIds.has(orderId)) continue;
      seenOrderIds.add(orderId);
    }
    const reasons = getOrderReturnReasons(order);
    const labels = reasons.length ? reasons : [NO_RETURN_REASON_LABEL];
    const bucketKey = classifyReturnOrderTagBucket(getOrderTagText(order));
    for (const group of [groups.total, groups[bucketKey]].filter(Boolean)) {
      group.returnCount += 1;
      labels.forEach(label => { group.counts[label] = (group.counts[label] || 0) + 1; });
    }
  }

  const finalize = group => ({
    returnCount: group.returnCount,
    reasons: Object.entries(group.counts)
      .map(([label, count]) => ({ label, count, share: group.returnCount > 0 ? count / group.returnCount : 0 }))
      .sort((a, b) => b.count - a.count)
  });
  return Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, finalize(group)]));
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
  const monthly = {};
  const total = {
    orderCount: 0,
    shippedOrderCount: 0,
    shipRate: 0,
    returned: 0,
    returning: 0,
    received: 0,
    returnCount: 0,
    returnDenominator: 0,
    returnRate: 0
  };

  // Google Sheet: 1 dong = 1 san pham -> don nhieu san pham co nhieu dong cung ma don, chi dem 1 lan
  const seenOrderIds = new Set();

  for (const order of orders) {
    const dateKey = getOrderDateKey(order);
    if (!dateKey) continue;
    if (fromDate && dateKey < fromDate) continue;
    if (toDate && dateKey > toDate) continue;

    const orderId = String(order.orderId || order.rawData?.sheetColumns?.col12 || '').trim();
    if (!orderId) continue;
    if (seenOrderIds.has(orderId)) continue;
    seenOrderIds.add(orderId);
    const monthKey = dateKey.slice(0, 7);

    if (!daily[dateKey]) {
      daily[dateKey] = RETURN_SUMMARY_BUCKETS.reduce((acc, bucket) => {
        acc[bucket.key] = { orderCount: 0 };
        return acc;
      }, {
        total: {
          orderCount: 0,
          shippedOrderCount: 0,
          shipRate: 0,
          returned: 0,
          returning: 0,
          received: 0,
          returnCount: 0,
          returnDenominator: 0,
          returnRate: 0
        }
      });
    }
    if (!monthly[monthKey]) {
      monthly[monthKey] = {
        total: {
          orderCount: 0,
          shippedOrderCount: 0,
          shipRate: 0,
          returned: 0,
          returning: 0,
          received: 0,
          returnCount: 0,
          returnDenominator: 0,
          returnRate: 0
        }
      };
    }

    total.orderCount += 1;
    daily[dateKey].total.orderCount += 1;
    monthly[monthKey].total.orderCount += 1;
    if (!isUnshippedSummaryStatus(order)) {
      total.shippedOrderCount += 1;
      daily[dateKey].total.shippedOrderCount += 1;
      monthly[monthKey].total.shippedOrderCount += 1;
    }

    const returnStatus = classifyReturnStatus(order);
    incrementReturnStats(total, returnStatus, 1);
    incrementReturnStats(daily[dateKey].total, returnStatus, 1);
    incrementReturnStats(monthly[monthKey].total, returnStatus, 1);

    const bucketKey = classifyReturnOrderTagBucket(getOrderTagText(order));
    if (!bucketKey || !categories[bucketKey]) continue;

    categories[bucketKey].orderCount += 1;
    daily[dateKey][bucketKey].orderCount += 1;
  }

  [total, ...Object.values(daily).map(day => day.total), ...Object.values(monthly).map(month => month.total)]
    .forEach(stats => {
      stats.shipRate = stats.orderCount > 0 ? stats.shippedOrderCount / stats.orderCount : 0;
      stats.returnCount = Number(stats.returned || 0) + Number(stats.returning || 0);
      stats.returnDenominator = stats.returnCount + Number(stats.received || 0);
      stats.returnRate = stats.returnDenominator > 0 ? stats.returnCount / stats.returnDenominator : 0;
    });

  return { categories, daily, monthly, total };
}

module.exports = {
  buildOrderQuery,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  getOrderTagText,
  normalizeSkuKey,
  normalizeStatusKey,
  orderMatchesSearch,
  classifyReturnStatus,
  classifyReturnOrderTagBucket,
  classifyReturnAdNameBucket,
  classifyReturnSummaryBucket: classifyReturnOrderTagBucket,
  buildReturnSummaryOrderStats,
  buildReturnProductRateStats,
  buildReturnReasonStats,
  RETURN_SUMMARY_BUCKETS,
  isPosRangeReady,
  getOrderSourceName,
  getOrderDataVersion,
  buildOrderSkuStats,
  buildOrderTableStats,
  getOrderStatsCacheKey,
  ORDER_SKU_STATS_FIELDS,
  orderStatsCache
};
