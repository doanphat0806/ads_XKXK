const DataPurchaseOrder = require('../models/DataPurchaseOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const {
  SHEET_ID,
  SHEET_NAME,
  normalizeDateKey
} = require('./dataPurchaseOrderSheetService');

const STATUS_OPTIONS = [
  { value: 've_du', label: 'Về Đủ', className: 'status-done' },
  { value: 've_thieu', label: 'Về Thiếu', className: 'status-missing' },
  { value: 'sai_hang', label: 'Sai Hàng', className: 'status-wrong' },
  { value: 've_thua', label: 'Về Thừa', className: 'status-extra' },
  { value: 'that_lac', label: 'Thất Lạc', className: 'status-lost' }
];

const STATUS_BY_VALUE = STATUS_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item;
  return acc;
}, {});

const INVALID_TRACKING_VALUES = new Set(['', '未知', '合并订单暂无', 'unknown', 'null', 'undefined']);

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeText(value) {
  return toText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  const text = toText(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function getFirstText(...values) {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return '';
}

function looksLikeDateTime(value = '') {
  const text = toText(value);
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(text)) return true;
  return false;
}

function getOrderDateTime(...values) {
  return toText(values.find(looksLikeDateTime) || '');
}

function getFirstAmount(...values) {
  const amountValue = values.find(value => {
    const text = toText(value);
    return text && !looksLikeDateTime(text) && !isUrl(text);
  });
  return toText(amountValue || '');
}

function isUrl(value = '') {
  return /^https?:\/\//i.test(toText(value));
}

function getFirstUrl(...values) {
  return toText(values.find(isUrl) || '');
}

function getFirstNonUrl(...values) {
  for (const value of values) {
    const text = toText(value);
    if (text && !isUrl(text)) return text;
  }
  return '';
}

function getLastValidTracking(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = toText(values[index]);
    if (!INVALID_TRACKING_VALUES.has(value.toLowerCase()) && !INVALID_TRACKING_VALUES.has(value)) {
      return value;
    }
  }
  return '';
}

function normalizeStatus(status = '') {
  const value = toText(status);
  return STATUS_BY_VALUE[value] ? value : '';
}

function buildDateFilter(fromDate, toDate) {
  const filter = {};
  const fromKey = normalizeDateKey(fromDate);
  const toKey = normalizeDateKey(toDate);

  if (fromKey || toKey) {
    filter.orderDateKey = {};
    if (fromKey) filter.orderDateKey.$gte = fromKey;
    if (toKey) filter.orderDateKey.$lte = toKey;
  }

  return filter;
}

function isDateInRange(value, fromDate, toDate) {
  const dateKey = normalizeDateKey(value);
  const fromKey = normalizeDateKey(fromDate);
  const toKey = normalizeDateKey(toDate);

  if (!fromKey && !toKey) return true;
  if (!dateKey) return false;
  if (fromKey && dateKey < fromKey) return false;
  if (toKey && dateKey > toKey) return false;
  return true;
}

function rowMatchesSearch(row, search) {
  const term = normalizeText(search);
  if (!term) return true;

  return normalizeText([
    row.orderId,
    row.trackingCode,
    row.statusLabel,
    row.receivedQuantity,
    row.skuManual,
    row.productAttribute,
    row.quantity,
    row.accountName,
    row.totalAmount,
    row.orderDate,
    row.productLink
  ].join(' ')).includes(term);
}

function buildSummary(rows) {
  const statusCounts = {
    ve_du: 0,
    ve_thieu: 0,
    sai_hang: 0,
    ve_thua: 0,
    that_lac: 0
  };

  let totalProductQuantity = 0;
  let trackingCount = 0;

  rows.forEach(row => {
    totalProductQuantity += parseNumber(row.quantity);
    if (row.trackingCode) trackingCount += 1;
    if (statusCounts[row.status] !== undefined) statusCounts[row.status] += 1;
  });

  return {
    orderCount: rows.length,
    totalProductQuantity,
    trackingCount,
    receivedFull: statusCounts.ve_du,
    missing: statusCounts.ve_thieu,
    wrong: statusCounts.sai_hang,
    extra: statusCounts.ve_thua,
    lost: statusCounts.that_lac,
    mvdRatio: rows.length ? trackingCount / rows.length : 0,
    statusCounts
  };
}

async function getPurchaseOrders({ fromDate = '', toDate = '', search = '', page = 1, limit = 100 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const dateFilter = buildDateFilter(fromDate, toDate);
  const sourceFilter = {
    sourceId: SHEET_ID,
    sourceName: SHEET_NAME,
    col3: { $nin: ['', null] }
  };
  if (dateFilter.orderDateKey) {
    sourceFilter.$or = [
      { orderDateKey: dateFilter.orderDateKey },
      { orderDateKey: '' },
      { orderDateKey: { $exists: false } }
    ];
  }

  const groupedRows = await DataPurchaseOrder.aggregate([
    { $match: sourceFilter },
    { $sort: { rowNumber: 1 } },
    {
      $group: {
        _id: '$col3',
        rowNumber: { $first: '$rowNumber' },
        accountName: { $first: '$col1' },
        imageUrl: { $first: '$col2' },
        orderId: { $first: '$col3' },
        orderDateTime: { $first: '$orderDateTime' },
        totalAmount: { $first: '$totalAmount' },
        orderDateRawCol4: { $first: '$col4' },
        orderDateRawCol5: { $first: '$col5' },
        productLink: { $first: '$col11' },
        productLinkRawCol6: { $first: '$col6' },
        productAttribute: { $first: '$spec' },
        quantity: { $first: '$productQuantity' },
        trackingCandidates: { $push: '$logisticsTrackingCode' },
        fallbackTrackingCandidates: { $push: '$col25' },
        productAttributeFallback: { $first: '$col7' },
        quantityFallback: { $first: '$col15' },
        accountNameFallback: { $first: '$col24' },
        orderDateFallback: { $first: '$col25' },
        productLinkFallback: { $first: '$col27' },
        orderDateKey: { $first: '$orderDateKey' }
      }
    },
    { $sort: { orderDateKey: -1, rowNumber: 1 } }
  ]).allowDiskUse(true);

  const orderIds = groupedRows.map(row => row.orderId).filter(Boolean);
  const manualRows = orderIds.length
    ? await PurchaseOrder.find({
      sourceId: SHEET_ID,
      sourceName: SHEET_NAME,
      orderId: { $in: orderIds }
    }).lean()
    : [];
  const manualByOrderId = new Map(manualRows.map(row => [row.orderId, row]));

  const rows = groupedRows.map(row => {
    const manual = manualByOrderId.get(row.orderId) || {};
    const status = normalizeStatus(manual.status);
    const statusMeta = STATUS_BY_VALUE[status] || null;
    const orderDate = getOrderDateTime(
      row.orderDateTime,
      row.orderDateRawCol4,
      row.orderDateFallback
    );
    const totalAmount = getFirstAmount(row.totalAmount, row.orderDateRawCol5);

    return {
      rowNumber: row.rowNumber,
      orderId: row.orderId,
      trackingCode: getLastValidTracking(row.trackingCandidates) || getLastValidTracking(row.fallbackTrackingCandidates),
      status,
      statusLabel: statusMeta?.label || '',
      statusClass: statusMeta?.className || '',
      receivedQuantity: toText(manual.receivedQuantity),
      skuManual: toText(manual.skuManual),
      productAttribute: getFirstNonUrl(row.productAttribute, row.productAttributeFallback),
      quantity: getFirstText(row.quantity, row.quantityFallback),
      imageUrl: toText(row.imageUrl),
      accountName: getFirstText(row.accountName, row.accountNameFallback),
      totalAmount,
      orderDate,
      orderDateKey: row.orderDateKey || normalizeDateKey(orderDate),
      productLink: getFirstUrl(row.productLink, row.productLinkRawCol6, row.productLinkFallback)
    };
  }).filter(row => isDateInRange(row.orderDateKey || row.orderDate, fromDate, toDate));

  const filteredRows = search ? rows.filter(row => rowMatchesSearch(row, search)) : rows;
  const summary = buildSummary(filteredRows);
  const start = (safePage - 1) * safeLimit;

  return {
    rows: filteredRows.slice(start, start + safeLimit),
    summary,
    statusOptions: STATUS_OPTIONS,
    total: filteredRows.length,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(filteredRows.length / safeLimit) || 1
  };
}

async function updatePurchaseOrder(orderId, patch = {}) {
  const cleanOrderId = toText(orderId);
  if (!cleanOrderId) throw new Error('Thiếu mã đơn hàng');

  const update = { updatedAt: new Date() };
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    update.status = normalizeStatus(patch.status);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'receivedQuantity')) {
    update.receivedQuantity = toText(patch.receivedQuantity).slice(0, 200);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'skuManual')) {
    update.skuManual = toText(patch.skuManual).slice(0, 2000);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
    update.note = toText(patch.note).slice(0, 2000);
  }

  const doc = await PurchaseOrder.findOneAndUpdate(
    { sourceId: SHEET_ID, sourceName: SHEET_NAME, orderId: cleanOrderId },
    {
      $set: update,
      $setOnInsert: {
        sourceId: SHEET_ID,
        sourceName: SHEET_NAME,
        orderId: cleanOrderId,
        createdAt: new Date()
      }
    },
    { upsert: true, new: true }
  ).lean();

  return {
    orderId: doc.orderId,
    status: doc.status || '',
    receivedQuantity: doc.receivedQuantity || '',
    skuManual: doc.skuManual || '',
    updatedAt: doc.updatedAt
  };
}

module.exports = {
  STATUS_OPTIONS,
  getPurchaseOrders,
  updatePurchaseOrder
};
