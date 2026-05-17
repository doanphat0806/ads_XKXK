const DataPurchaseOrder = require('../models/DataPurchaseOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const Config = require('../models/Config');
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

const DASHBOARD_METRIC_KEYS = [
  'maDonHang',
  'slHang',
  'maVanDon',
  'mvdVe',
  'chuaCoMvd',
  'chuaCoMvdRaw',
  'huy',
  'thieuHang',
  'saiHang',
  'veThua',
  'thatLac'
];

const ARRIVED_STATUS_VALUES = new Set(['ve_du', 've_thieu', 'sai_hang', 've_thua']);
const CONFIG_KEY = 'app';

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeText(value) {
  return toText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ\u0111\u0110]/g, 'd')
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

const STATUS_IMPORT_ALIASES = {
  ve_du: 've_du',
  vedu: 've_du',
  du: 've_du',
  full: 've_du',
  done: 've_du',
  complete: 've_du',
  completed: 've_du',
  received_full: 've_du',
  ve_thieu: 've_thieu',
  vethieu: 've_thieu',
  thieu: 've_thieu',
  missing: 've_thieu',
  short: 've_thieu',
  sai_hang: 'sai_hang',
  saihang: 'sai_hang',
  sai: 'sai_hang',
  wrong: 'sai_hang',
  ve_thua: 've_thua',
  vethua: 've_thua',
  thua: 've_thua',
  extra: 've_thua',
  that_lac: 'that_lac',
  thatlac: 'that_lac',
  lost: 'that_lac'
};

function normalizeImportToken(value = '') {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeImportedStatus(status = '') {
  const currentStatus = normalizeStatus(status);
  if (currentStatus) return currentStatus;

  const token = normalizeImportToken(status);
  if (STATUS_IMPORT_ALIASES[token]) return STATUS_IMPORT_ALIASES[token];

  const text = normalizeText(status);
  if (!text) return '';
  if (text.includes('that lac') || text.includes('lost')) return 'that_lac';
  if (text.includes('sai') || text.includes('wrong')) return 'sai_hang';
  if (text.includes('thieu') || text.includes('missing') || text.includes('short')) return 've_thieu';
  if (text.includes('thua') || text.includes('extra')) return 've_thua';
  if (text.includes('ve du') || text === 'du' || text.includes('full') || text.includes('done') || text.includes('complete')) return 've_du';
  return '';
}

function parseCsvRows(csvText = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

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
    } else if (char === ',') {
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

function normalizeHeader(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function findImportColumnIndex(headerRow = [], names = []) {
  const normalizedNames = new Set(names.map(normalizeHeader));
  return headerRow.findIndex(cell => normalizedNames.has(normalizeHeader(cell)));
}

function hasImportHeader(row = []) {
  const orderIndex = findImportColumnIndex(row, [
    'ma don hang',
    'madonhang',
    'order id',
    'orderid',
    'order_id'
  ]);
  const statusIndex = findImportColumnIndex(row, [
    'trang thai',
    'trangthai',
    'status'
  ]);
  return orderIndex >= 0 && statusIndex >= 0;
}

function detectStatusImportColumns(rows = []) {
  const headerIndex = rows.findIndex(hasImportHeader);
  if (headerIndex >= 0) {
    const headerRow = rows[headerIndex];
    return {
      startIndex: headerIndex + 1,
      orderIndex: findImportColumnIndex(headerRow, [
        'ma don hang',
        'madonhang',
        'order id',
        'orderid',
        'order_id'
      ]),
      trackingIndex: findImportColumnIndex(headerRow, [
        'ma van don hang ve',
        'mavandonhangve',
        'ma van don',
        'mavandon',
        'mvd',
        'tracking',
        'tracking code',
        'trackingcode',
        'logistics tracking code'
      ]),
      statusIndex: findImportColumnIndex(headerRow, [
        'trang thai',
        'trangthai',
        'status'
      ]),
      receivedQuantityIndex: findImportColumnIndex(headerRow, [
        'so luong hang ve',
        'soluonghangve',
        'received quantity',
        'receivedquantity'
      ]),
      skuManualIndex: findImportColumnIndex(headerRow, [
        'ma sp',
        'masp',
        'sku',
        'product code',
        'productcode'
      ])
    };
  }

  const firstDataRow = rows.find(row => row.some(cell => toText(cell)));
  const width = firstDataRow?.length || 0;
  return {
    startIndex: 0,
    orderIndex: width >= 4 ? 1 : 0,
    trackingIndex: width >= 4 ? 2 : -1,
    statusIndex: width >= 4 ? 3 : 1,
    receivedQuantityIndex: -1,
    skuManualIndex: -1
  };
}

function normalizeImportOrderId(value = '') {
  return toText(value).replace(/\s+/g, '');
}

function buildStatusImportRows(csvText = '') {
  const rows = parseCsvRows(String(csvText || '').replace(/^\uFEFF/, ''));
  if (!rows.length) {
    throw new Error('File CSV khong co du lieu');
  }

  const columns = detectStatusImportColumns(rows);
  if (columns.orderIndex < 0 && columns.trackingIndex < 0) {
    throw new Error('CSV can co cot Ma Don Hang hoac Ma Van Don');
  }
  if (columns.statusIndex < 0) {
    throw new Error('CSV can co cot Trang Thai');
  }

  const items = [];
  const invalidStatuses = [];
  let skippedNoOrder = 0;
  let skippedNoStatus = 0;
  let skippedInvalidStatus = 0;

  for (let index = columns.startIndex; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || !row.some(cell => toText(cell))) continue;

    const orderId = columns.orderIndex >= 0 ? normalizeImportOrderId(row[columns.orderIndex]) : '';
    const trackingCode = columns.trackingIndex >= 0 ? toText(row[columns.trackingIndex]) : '';
    const rawStatus = toText(row[columns.statusIndex]);
    const status = normalizeImportedStatus(rawStatus);
    const receivedQuantity = columns.receivedQuantityIndex >= 0
      ? toText(row[columns.receivedQuantityIndex]).slice(0, 200)
      : '';
    const skuManual = columns.skuManualIndex >= 0
      ? toText(row[columns.skuManualIndex]).slice(0, 2000)
      : '';

    if (!orderId && !trackingCode) {
      skippedNoOrder += 1;
      continue;
    }
    if (!rawStatus) {
      skippedNoStatus += 1;
      continue;
    }
    if (!status) {
      skippedInvalidStatus += 1;
      if (invalidStatuses.length < 5) invalidStatuses.push(rawStatus);
      continue;
    }

    items.push({
      rowNumber: index + 1,
      orderId,
      trackingCode,
      status,
      receivedQuantity,
      skuManual
    });
  }

  return {
    items,
    skippedNoOrder,
    skippedNoStatus,
    skippedInvalidStatus,
    invalidStatuses
  };
}

async function getOrderIdsByTrackingCodes(trackingCodes = []) {
  const cleanTrackingCodes = [...new Set(trackingCodes.map(toText).filter(Boolean))];
  if (!cleanTrackingCodes.length) return new Map();

  const docs = await DataPurchaseOrder.find({
    sourceId: SHEET_ID,
    sourceName: SHEET_NAME,
    $or: [
      { logisticsTrackingCode: { $in: cleanTrackingCodes } },
      { col25: { $in: cleanTrackingCodes } }
    ]
  }).select('col3 logisticsTrackingCode col25').lean();

  const orderIdByTrackingCode = new Map();
  docs.forEach(doc => {
    const orderId = normalizeImportOrderId(doc.col3);
    if (!orderId) return;
    [doc.logisticsTrackingCode, doc.col25].forEach(value => {
      const trackingCode = toText(value);
      if (trackingCode && !orderIdByTrackingCode.has(trackingCode)) {
        orderIdByTrackingCode.set(trackingCode, orderId);
      }
    });
  });

  return orderIdByTrackingCode;
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

function makeDashboardRow(ngay) {
  return {
    ngay,
    maDonHang: 0,
    slHang: 0,
    maVanDon: 0,
    mvdVe: 0,
    chuaCoMvd: 0,
    chuaCoMvdRaw: 0,
    huy: 0,
    thieuHang: 0,
    saiHang: 0,
    veThua: 0,
    thatLac: 0,
    chuaCoMvdNote: '',
    chuaCoMvdNotes: []
  };
}

function addDashboardMetrics(target, source) {
  DASHBOARD_METRIC_KEYS.forEach(key => {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  });
  if (source.chuaCoMvdNote) {
    target.chuaCoMvdNotes = [
      ...(target.chuaCoMvdNotes || []),
      `${source.ngay}: ${source.chuaCoMvdNote}`
    ];
  }
  target.chuaCoMvdNote = buildDashboardManualNote(target);
  return target;
}

function getDashboardQuantityTotal(row = {}) {
  const primaryQuantity = parseNumber(row.quantity);
  if (primaryQuantity > 0) return primaryQuantity;
  return parseNumber(row.quantityFallback);
}

function parseNonNegativeInteger(value) {
  const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

async function getDashboardCancellationMap() {
  const config = await Config.findOne({ key: CONFIG_KEY })
    .select('purchaseOrderDashboardCancellations')
    .lean();
  return config?.purchaseOrderDashboardCancellations || {};
}

async function getDashboardNoteMap() {
  const config = await Config.findOne({ key: CONFIG_KEY })
    .select('purchaseOrderDashboardNotes')
    .lean();
  return config?.purchaseOrderDashboardNotes || {};
}

async function updatePurchaseOrderDashboardCancellation(dateKey, canceledCount) {
  const normalizedDateKey = normalizeDateKey(dateKey);
  if (!normalizedDateKey) throw new Error('Ngay dashboard khong hop le');

  const safeCanceledCount = parseNonNegativeInteger(canceledCount);
  const updatePath = `purchaseOrderDashboardCancellations.${normalizedDateKey}`;
  await Config.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $set: {
        [updatePath]: safeCanceledCount,
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true }
  ).lean();

  return {
    dateKey: normalizedDateKey,
    huy: safeCanceledCount
  };
}

async function updatePurchaseOrderDashboardNote(dateKey, note) {
  const normalizedDateKey = normalizeDateKey(dateKey);
  if (!normalizedDateKey) throw new Error('Ngay dashboard khong hop le');

  const safeNote = toText(note).slice(0, 5000);
  const updatePath = `purchaseOrderDashboardNotes.${normalizedDateKey}`;
  await Config.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $set: {
        [updatePath]: safeNote,
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true }
  ).lean();

  return {
    dateKey: normalizedDateKey,
    note: safeNote
  };
}

function buildDashboardManualNote(row = {}) {
  const notes = Array.isArray(row.chuaCoMvdNotes) ? row.chuaCoMvdNotes.filter(Boolean) : [];
  return notes.join('\n\n');
}

function toDashboardApiRow(row = {}) {
  const { chuaCoMvdNotes, ...apiRow } = row;
  return apiRow;
}

async function findManualPurchaseOrderRows(orderIds = [], select = '') {
  const rows = [];
  const uniqueOrderIds = [...new Set(orderIds.filter(Boolean))];
  const chunkSize = 5000;

  for (let start = 0; start < uniqueOrderIds.length; start += chunkSize) {
    let query = PurchaseOrder.find({
      sourceId: SHEET_ID,
      sourceName: SHEET_NAME,
      orderId: { $in: uniqueOrderIds.slice(start, start + chunkSize) }
    });
    if (select) query = query.select(select);
    rows.push(...await query.lean());
  }

  return rows;
}

function getIsoWeekInfo(dateKey = '') {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { key: dateKey, label: dateKey };

  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((current - yearStart) / 86400000) + 1) / 7);
  const year = current.getUTCFullYear();

  return {
    key: `${year}-W${String(weekNumber).padStart(2, '0')}`,
    label: `Tong Ket Tuan ${weekNumber}/${year}`
  };
}

function getMonthInfo(dateKey = '') {
  const [year, month] = String(dateKey || '').split('-');
  return {
    key: `${year || ''}-${month || ''}`,
    label: `Tong Ket Thang ${Number(month || 0) || ''}`.trim()
  };
}

function buildDashboardRowsWithTotals(dailyStats = []) {
  const result = [];
  let weekTotal = null;
  let monthTotal = null;
  let currentWeekKey = '';
  let currentMonthKey = '';

  dailyStats.forEach(day => {
    const weekInfo = getIsoWeekInfo(day.ngay);
    const monthInfo = getMonthInfo(day.ngay);

    if (currentWeekKey && currentWeekKey !== weekInfo.key && weekTotal) {
      result.push({ ...weekTotal, isWeekTotal: true });
      weekTotal = null;
    }

    if (currentMonthKey && currentMonthKey !== monthInfo.key && monthTotal) {
      result.push({ ...monthTotal, isMonthTotal: true });
      monthTotal = null;
    }

    if (!weekTotal) {
      weekTotal = makeDashboardRow(weekInfo.label);
      currentWeekKey = weekInfo.key;
    }
    addDashboardMetrics(weekTotal, day);

    if (!monthTotal) {
      monthTotal = makeDashboardRow(monthInfo.label);
      currentMonthKey = monthInfo.key;
    }
    addDashboardMetrics(monthTotal, day);

    result.push(day);
  });

  if (weekTotal) result.push({ ...weekTotal, isWeekTotal: true });
  if (monthTotal) result.push({ ...monthTotal, isMonthTotal: true });

  return result;
}

async function getPurchaseOrderDashboard({ fromDate = '', toDate = '' } = {}) {
  const dateFilter = buildDateFilter(fromDate, toDate);
  const cancellationMap = await getDashboardCancellationMap();
  const noteMap = await getDashboardNoteMap();
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
        orderId: { $first: '$col3' },
        rowNumber: { $first: '$rowNumber' },
        orderDateKey: { $first: '$orderDateKey' },
        orderDateTime: { $first: '$orderDateTime' },
        orderDateRawCol4: { $first: '$col4' },
        orderDateFallback: { $first: '$col25' },
        trackingCandidates: { $push: '$logisticsTrackingCode' },
        fallbackTrackingCandidates: { $push: '$col25' },
        accountName: { $first: '$col1' },
        productAttribute: { $first: '$spec' },
        productAttributeFallback: { $first: '$col13' },
        quantity: { $first: '$productQuantity' },
        quantityFallback: { $first: '$col15' }
      }
    },
    { $sort: { orderDateKey: 1, rowNumber: 1 } }
  ]).allowDiskUse(true);

  const orderIds = groupedRows.map(row => row.orderId).filter(Boolean);
  const manualRows = await findManualPurchaseOrderRows(orderIds, 'orderId status');
  const manualByOrderId = new Map(manualRows.map(row => [row.orderId, row]));
  const dailyMap = new Map();

  groupedRows.forEach(row => {
    const orderDate = getOrderDateTime(
      row.orderDateTime,
      row.orderDateRawCol4,
      row.orderDateFallback
    );
    const dateKey = row.orderDateKey || normalizeDateKey(orderDate);
    if (!dateKey || !isDateInRange(dateKey, fromDate, toDate)) return;

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, makeDashboardRow(dateKey));
    }

    const day = dailyMap.get(dateKey);
    const trackingCode = getLastValidTracking(row.trackingCandidates) || getLastValidTracking(row.fallbackTrackingCandidates);
    const status = normalizeStatus(manualByOrderId.get(row.orderId)?.status);
    const quantity = getDashboardQuantityTotal(row);

    day.maDonHang += 1;
    day.slHang += quantity;
    if (trackingCode) {
      day.maVanDon += 1;
    } else {
      day.chuaCoMvd += 1;
      day.chuaCoMvdRaw += 1;
    }
    if (ARRIVED_STATUS_VALUES.has(status)) day.mvdVe += 1;
    if (status === 've_thieu') day.thieuHang += 1;
    if (status === 'sai_hang') day.saiHang += 1;
    if (status === 've_thua') day.veThua += 1;
    if (status === 'that_lac') day.thatLac += 1;
  });

  const dailyStats = Array.from(dailyMap.values()).sort((a, b) => a.ngay.localeCompare(b.ngay));
  dailyStats.forEach(day => {
    day.chuaCoMvdRaw = Number(day.chuaCoMvdRaw || day.chuaCoMvd || 0);
    day.huy = parseNonNegativeInteger(cancellationMap[day.ngay]);
    day.chuaCoMvd = Math.max(0, day.chuaCoMvdRaw - day.huy);
    day.chuaCoMvdNote = toText(noteMap[day.ngay]);
  });

  const rows = buildDashboardRowsWithTotals(dailyStats);
  const totals = dailyStats.reduce((acc, day) => addDashboardMetrics(acc, day), makeDashboardRow('Tong Cong'));

  return {
    dailyStats: rows.map(toDashboardApiRow),
    totals: toDashboardApiRow(totals),
    source: 'data-purchase-orders'
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
  const manualRows = await findManualPurchaseOrderRows(orderIds);
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

async function importPurchaseOrderStatusesFromCsvText(csvText = '') {
  const parsed = buildStatusImportRows(csvText);
  if (!parsed.items.length) {
    throw new Error('Khong co dong trang thai hop le de import');
  }

  const trackingCodeMap = await getOrderIdsByTrackingCodes(
    parsed.items
      .filter(item => !item.orderId && item.trackingCode)
      .map(item => item.trackingCode)
  );
  const itemByOrderId = new Map();
  let skippedUnmatchedTracking = 0;

  parsed.items.forEach(item => {
    const orderId = item.orderId || trackingCodeMap.get(item.trackingCode) || '';
    if (!orderId) {
      skippedUnmatchedTracking += 1;
      return;
    }
    itemByOrderId.set(orderId, { ...item, orderId });
  });

  const orderIds = [...itemByOrderId.keys()];
  if (!orderIds.length) {
    throw new Error('Khong tim thay ma don hop le de import trang thai');
  }

  const existingOrderIds = new Set(await DataPurchaseOrder.distinct('col3', {
    sourceId: SHEET_ID,
    sourceName: SHEET_NAME,
    col3: { $in: orderIds }
  }));
  const now = new Date();
  const operations = orderIds.map(orderId => {
    const item = itemByOrderId.get(orderId);
    const update = {
      status: item.status,
      updatedAt: now
    };
    if (item.receivedQuantity) update.receivedQuantity = item.receivedQuantity;
    if (item.skuManual) update.skuManual = item.skuManual;

    return {
      updateOne: {
        filter: { sourceId: SHEET_ID, sourceName: SHEET_NAME, orderId },
        update: {
          $set: update,
          $setOnInsert: {
            sourceId: SHEET_ID,
            sourceName: SHEET_NAME,
            orderId,
            createdAt: now
          }
        },
        upsert: true
      }
    };
  });
  const totals = {
    matched: 0,
    modified: 0,
    upserted: 0
  };
  const chunkSize = 1000;

  for (let start = 0; start < operations.length; start += chunkSize) {
    const result = await PurchaseOrder.bulkWrite(operations.slice(start, start + chunkSize), { ordered: false });
    totals.matched += result.matchedCount || 0;
    totals.modified += result.modifiedCount || 0;
    totals.upserted += result.upsertedCount || 0;
  }

  return {
    ok: true,
    imported: operations.length,
    rowsRead: parsed.items.length,
    matched: totals.matched,
    modified: totals.modified,
    upserted: totals.upserted,
    matchedInData: existingOrderIds.size,
    unmatchedInData: Math.max(0, orderIds.length - existingOrderIds.size),
    skippedNoOrder: parsed.skippedNoOrder,
    skippedNoStatus: parsed.skippedNoStatus,
    skippedInvalidStatus: parsed.skippedInvalidStatus,
    skippedUnmatchedTracking,
    invalidStatuses: parsed.invalidStatuses,
    importedAt: now.toISOString()
  };
}

module.exports = {
  STATUS_OPTIONS,
  getPurchaseOrderDashboard,
  getPurchaseOrders,
  importPurchaseOrderStatusesFromCsvText,
  updatePurchaseOrderDashboardCancellation,
  updatePurchaseOrderDashboardNote,
  updatePurchaseOrder
};
