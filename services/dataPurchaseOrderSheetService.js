const axios = require('axios');
const crypto = require('crypto');
const Config = require('../models/Config');
const DataPurchaseOrder = require('../models/DataPurchaseOrder');
const { parseBoundedInt } = require('../utils/number');

const SHEET_ID = process.env.DATA_PURCHASE_ORDERS_SHEET_ID || '1Btx1zA2X19t0Ta7hZzTfBu8PJypMf8Extoe4s9qk7MM';
const SHEET_NAME = process.env.DATA_PURCHASE_ORDERS_SHEET_NAME || 'Data';
const SHEET_RANGE = process.env.DATA_PURCHASE_ORDERS_SHEET_RANGE || 'A:AH';
const SHEET_QUERY = process.env.DATA_PURCHASE_ORDERS_SHEET_QUERY || 'select A,B,C,D,K,M,O,P,X,Y,AA';
const REQUEST_TIMEOUT_MS = parseBoundedInt(process.env.DATA_PURCHASE_ORDERS_TIMEOUT_MS, 90000, 10000, 300000);
const BULK_WRITE_SIZE = parseBoundedInt(process.env.DATA_PURCHASE_ORDERS_BULK_SIZE, 1000, 100, 5000);
const CONFIG_KEY = 'app';

const SELECTED_COLUMNS = [
  { key: 'col1', fallbackLabel: 'Col1', rawIndex: 0 },
  { key: 'col2', fallbackLabel: 'Col2', rawIndex: 1 },
  { key: 'col3', fallbackLabel: 'Col3', rawIndex: 2 },
  { key: 'col4', fallbackLabel: 'Col4', rawIndex: 3 },
  { key: 'col11', fallbackLabel: 'Col11', rawIndex: 10 },
  { key: 'col13', fallbackLabel: 'Col13', rawIndex: 12 },
  { key: 'col15', fallbackLabel: 'Col15', rawIndex: 14 },
  { key: 'col16', fallbackLabel: 'Col16', rawIndex: 15 },
  { key: 'col24', fallbackLabel: 'Col24', rawIndex: 23 },
  { key: 'col25', fallbackLabel: 'Col25', rawIndex: 24 },
  { key: 'col27', fallbackLabel: 'Col27', rawIndex: 26 }
];

const STORED_COLUMNS = [
  { key: 'col1', fallbackLabel: 'Col1', rawIndex: 0 },
  { key: 'col2', fallbackLabel: 'Col2', rawIndex: 1 },
  { key: 'col3', fallbackLabel: 'Col3', rawIndex: 2 },
  { key: 'col4', fallbackLabel: 'Col4', rawIndex: 3 },
  { key: 'col5', fallbackLabel: 'Col5', rawIndex: 4 },
  { key: 'col6', fallbackLabel: 'Col6', rawIndex: 5 },
  { key: 'col7', fallbackLabel: 'Col7', rawIndex: 6 },
  { key: 'col8', fallbackLabel: 'Col8', rawIndex: 7 },
  { key: 'col10', fallbackLabel: 'Col10', rawIndex: 9 },
  { key: 'col11', fallbackLabel: 'Col11', rawIndex: 10 },
  { key: 'col13', fallbackLabel: 'Col13', rawIndex: 12 },
  { key: 'col15', fallbackLabel: 'Col15', rawIndex: 14 },
  { key: 'col16', fallbackLabel: 'Col16', rawIndex: 15 },
  { key: 'col24', fallbackLabel: 'Col24', rawIndex: 23 },
  { key: 'col25', fallbackLabel: 'Col25', rawIndex: 24 },
  { key: 'col27', fallbackLabel: 'Col27', rawIndex: 26 }
];

const DEFAULT_HEADERS = SELECTED_COLUMNS.map(column => ({
  key: column.key,
  label: column.fallbackLabel
}));

const EMPTY_LOGISTICS_VALUES = new Set(['未知', '合并订单暂无']);
const QUESTION_MARK_LOGISTICS_PATTERN = /^[?\uFFFD\uFF1F\s]+$/;
const LOGISTICS_EDGE_REPLACEMENT_PATTERN = /^[?\uFFFD\uFF1F\s:,\-;|/\\]+|[?\uFFFD\uFF1F\s:,\-;|/\\]+$/g;

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeLogisticsTrackingCode(value = '') {
  const text = toText(value);
  if (!text || EMPTY_LOGISTICS_VALUES.has(text) || QUESTION_MARK_LOGISTICS_PATTERN.test(text)) return '';

  const cleaned = text.replace(LOGISTICS_EDGE_REPLACEMENT_PATTERN, '').trim();
  if (!cleaned || EMPTY_LOGISTICS_VALUES.has(cleaned) || QUESTION_MARK_LOGISTICS_PATTERN.test(cleaned)) return '';
  return cleaned;
}

function normalizeSearch(value) {
  return toText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDateKey(value = '') {
  const text = toText(value);
  if (!text) return '';

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slashMatch) {
    let [, first, second, year] = slashMatch;
    if (year.length === 2) year = `20${year}`;

    const firstNumber = Number(first);
    const day = firstNumber > 12 ? first : second;
    const month = firstNumber > 12 ? second : first;

    if (Number(year) && Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
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

function getOrderDateTime(fields = {}) {
  const candidates = [fields.orderDateTime, fields.col4];
  const dateValue = candidates.find(looksLikeDateTime);
  return toText(dateValue || '');
}

function getTotalAmount(fields = {}) {
  const candidates = [fields.totalAmount, fields.col5, fields.col16];
  const amountValue = candidates.find(value => {
    const text = toText(value);
    return text && !looksLikeDateTime(text) && !/^https?:\/\//i.test(text);
  });
  return toText(amountValue || '');
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

function buildHeaders(headerRow = [], shape = 'selected') {
  return SELECTED_COLUMNS.map((column, index) => ({
    key: column.key,
    label: toText(headerRow[shape === 'raw' ? column.rawIndex : index], column.fallbackLabel)
  }));
}

function looksLikeDataRow(row = []) {
  return row.some(cell => /^https?:\/\//i.test(toText(cell)))
    || row.some(cell => /^\d{6}-\d+/i.test(toText(cell)))
    || row.some(cell => looksLikeDateTime(cell));
}

function headersLookLikeData(headers = []) {
  return looksLikeDataRow((headers || []).map(header => header?.label || ''));
}

function normalizeHeader(value = '') {
  return toText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function findHeaderIndex(headerRow = [], names = []) {
  const normalizedNames = new Set(names.map(normalizeHeader));
  return headerRow.findIndex(cell => normalizedNames.has(normalizeHeader(cell)));
}

function checksumValues(values) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(values.map(cell => [cell.key, cell.value])))
    .digest('hex');
}

function getValueByShape(row, column, selectedIndex, shape) {
  if (shape === 'raw') return toText(row[column.rawIndex]);
  const displayIndex = SELECTED_COLUMNS.findIndex(item => item.key === column.key);
  return displayIndex >= 0 ? toText(row[displayIndex]) : '';
}

function mapRows(rows = [], shape = 'selected') {
  const firstRow = rows[0] || [];
  const firstRowIsData = looksLikeDataRow(firstRow);
  const headerRow = firstRowIsData ? [] : firstRow;
  const dataRows = rows.slice(firstRowIsData ? 0 : 1);
  const rowNumberOffset = firstRowIsData ? 1 : 2;
  const headers = buildHeaders(headerRow, shape);
  const specIndex = findHeaderIndex(headerRow, ['规格']);
  const productQuantityIndex = findHeaderIndex(headerRow, ['数量']);
  const logisticsTrackingCodeIndex = findHeaderIndex(headerRow, ['物流单号']);
  const orderDateTimeIndex = findHeaderIndex(headerRow, ['下单时间']);
  const totalAmountIndex = findHeaderIndex(headerRow, [
    '总金额',
    '总价',
    '订单金额',
    '实付金额',
    '支付金额',
    '金额',
    '合计',
    '商品总价',
    '总计',
    '单价'
  ]);
  const mappedRows = dataRows
    .map((row, index) => {
      const values = SELECTED_COLUMNS.map((column, selectedIndex) => ({
        key: column.key,
        value: getValueByShape(row, column, selectedIndex, shape)
      }));
      const fields = STORED_COLUMNS.reduce((acc, column, selectedIndex) => {
        acc[column.key] = getValueByShape(row, column, selectedIndex, shape);
        return acc;
      }, {});
      fields.spec = specIndex >= 0 ? toText(row[specIndex]) : toText(fields.col13 || fields.col7);
      fields.productQuantity = productQuantityIndex >= 0 ? toText(row[productQuantityIndex]) : fields.col15;
      fields.logisticsTrackingCode = normalizeLogisticsTrackingCode(
        logisticsTrackingCodeIndex >= 0 ? row[logisticsTrackingCodeIndex] : fields.col25
      );
      fields.orderDateTime = orderDateTimeIndex >= 0 ? toText(row[orderDateTimeIndex]) : getOrderDateTime(fields);
      fields.totalAmount = totalAmountIndex >= 0 ? toText(row[totalAmountIndex]) : getTotalAmount(fields);

      if (!Object.values(fields).some(Boolean)) return null;

      return {
        rowNumber: index + rowNumberOffset,
        values,
        fields,
        searchText: normalizeSearch(Object.values(fields).join(' ')),
        checksum: checksumValues([
          ...STORED_COLUMNS.map(column => ({ key: column.key, value: fields[column.key] || '' })),
          { key: 'spec', value: fields.spec || '' },
          { key: 'productQuantity', value: fields.productQuantity || '' },
          { key: 'logisticsTrackingCode', value: fields.logisticsTrackingCode || '' },
          { key: 'orderDateTime', value: fields.orderDateTime || '' },
          { key: 'totalAmount', value: fields.totalAmount || '' }
        ]),
        orderDateTime: fields.orderDateTime,
        orderDateKey: normalizeDateKey(fields.orderDateTime)
      };
    })
    .filter(Boolean);

  return { headers, rows: mappedRows, hasHeader: !firstRowIsData };
}

function detectCsvShape(rows = []) {
  const widestRow = rows.slice(0, 20).reduce((max, row) => Math.max(max, row.length), 0);
  return widestRow > SELECTED_COLUMNS.length ? 'raw' : 'selected';
}

function makeBatchId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function rowToDocument(row, { sourceType, batchAt, batchId }) {
  return {
    sourceId: SHEET_ID,
    sourceName: SHEET_NAME,
    sourceType,
    rowNumber: row.rowNumber,
    ...(row.fields || {}),
    values: row.values,
    searchText: row.searchText,
    checksum: row.checksum,
    batchId,
    orderDateTime: row.orderDateTime,
    totalAmount: row.fields?.totalAmount || '',
    orderDateKey: row.orderDateKey,
    importedAt: batchAt,
    updatedAt: batchAt
  };
}

async function saveDataPurchaseOrderMeta(meta) {
  await Config.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $set: {
        dataPurchaseOrderMeta: {
          ...meta,
          sheetId: SHEET_ID,
          sheetName: SHEET_NAME,
          range: SHEET_RANGE,
          query: SHEET_QUERY
        },
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
}

async function getDataPurchaseOrderMeta() {
  const config = await Config.findOne({ key: CONFIG_KEY })
    .select('dataPurchaseOrderMeta')
    .lean();
  const meta = config?.dataPurchaseOrderMeta || {};
  return {
    headers: Array.isArray(meta.headers) && meta.headers.length ? meta.headers : DEFAULT_HEADERS,
    lastSyncAt: meta.lastSyncAt || '',
    lastSyncSourceType: meta.lastSyncSourceType || '',
    lastSyncCount: Number(meta.lastSyncCount || 0),
    lastSyncDeleted: Number(meta.lastSyncDeleted || 0),
    lastSyncError: meta.lastSyncError || '',
    sheetId: meta.sheetId || SHEET_ID,
    sheetName: meta.sheetName || SHEET_NAME,
    range: meta.range || SHEET_RANGE,
    query: meta.query || SHEET_QUERY
  };
}

async function getNextDataPurchaseOrderRowNumber() {
  const lastRow = await DataPurchaseOrder.findOne({
    sourceId: SHEET_ID,
    sourceName: SHEET_NAME
  })
    .sort({ rowNumber: -1 })
    .select('rowNumber')
    .lean();

  return Number(lastRow?.rowNumber || 0) + 1;
}

async function persistDataPurchaseOrderRows({ headers, rows, sourceType, mode = 'replace' }) {
  if (!rows.length) {
    throw new Error('Không có dòng dữ liệu hợp lệ để lưu vào database');
  }

  const batchAt = new Date();
  const batchId = makeBatchId();
  const appendMode = mode === 'append';
  const firstRowNumber = appendMode ? await getNextDataPurchaseOrderRowNumber() : null;
  const rowsToPersist = appendMode
    ? rows.map((row, index) => ({ ...row, rowNumber: firstRowNumber + index }))
    : rows;
  const totals = {
    matched: 0,
    modified: 0,
    upserted: 0
  };

  for (let start = 0; start < rowsToPersist.length; start += BULK_WRITE_SIZE) {
    const chunk = rowsToPersist.slice(start, start + BULK_WRITE_SIZE);
    const operations = chunk.map(row => {
      const document = rowToDocument(row, { sourceType, batchAt, batchId });
      return {
        updateOne: {
          filter: {
            sourceId: SHEET_ID,
            sourceName: SHEET_NAME,
            rowNumber: row.rowNumber
          },
          update: {
            $set: document,
            $setOnInsert: { createdAt: batchAt }
          },
          upsert: true
        }
      };
    });

    const result = await DataPurchaseOrder.bulkWrite(operations, { ordered: false });
    totals.matched += result.matchedCount || 0;
    totals.modified += result.modifiedCount || 0;
    totals.upserted += result.upsertedCount || 0;
  }

  const deleteResult = appendMode
    ? { deletedCount: 0 }
    : await DataPurchaseOrder.deleteMany({
      sourceId: SHEET_ID,
      sourceName: SHEET_NAME,
      batchId: { $ne: batchId }
    });

  const totalCount = appendMode
    ? await DataPurchaseOrder.countDocuments({ sourceId: SHEET_ID, sourceName: SHEET_NAME })
    : rows.length;

  await saveDataPurchaseOrderMeta({
    headers,
    lastSyncAt: batchAt.toISOString(),
    lastSyncSourceType: sourceType,
    lastSyncCount: totalCount,
    lastSyncDeleted: deleteResult.deletedCount || 0,
    lastSyncError: ''
  });

  return {
    ok: true,
    imported: rows.length,
    matched: totals.matched,
    modified: totals.modified,
    upserted: totals.upserted,
    deleted: deleteResult.deletedCount || 0,
    headers,
    sheetId: SHEET_ID,
    sheetName: SHEET_NAME,
    range: SHEET_RANGE,
    query: SHEET_QUERY,
    syncedAt: batchAt.toISOString(),
    sourceType,
    mode: appendMode ? 'append' : 'replace',
    startRowNumber: appendMode ? firstRowNumber : 0,
    endRowNumber: appendMode ? firstRowNumber + rows.length - 1 : 0,
    total: totalCount
  };
}

async function fetchWithGoogleApi(accessToken = '') {
  const range = `${SHEET_NAME}!${SHEET_RANGE}`;
  const response = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { majorDimension: 'ROWS' },
      timeout: REQUEST_TIMEOUT_MS
    }
  );
  return mapRows(response.data?.values || [], 'raw');
}

async function fetchWithGviz() {
  const params = new URLSearchParams({
    tqx: 'out:csv',
    sheet: SHEET_NAME,
    range: SHEET_RANGE
  });
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params.toString()}`;
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: REQUEST_TIMEOUT_MS,
    transformResponse: [(data) => data]
  });
  const csv = toText(response.data);

  if (!csv || csv.startsWith('<')) {
    throw new Error('Google Sheet không trả về dữ liệu CSV. Kiểm tra quyền share file hoặc đăng nhập Google.');
  }

  return mapRows(parseCsvRows(csv), 'raw');
}

async function fetchDataPurchaseOrderRows({ accessToken = '' } = {}) {
  return accessToken
    ? fetchWithGoogleApi(accessToken)
    : fetchWithGviz();
}

async function syncDataPurchaseOrdersFromSheet({ accessToken = '' } = {}) {
  try {
    const result = await fetchDataPurchaseOrderRows({ accessToken });
    return await persistDataPurchaseOrderRows({
      headers: result.headers,
      rows: result.rows,
      sourceType: accessToken ? 'google_sheet_api' : 'google_sheet_csv'
    });
  } catch (error) {
    await saveDataPurchaseOrderMeta({
      ...(await getDataPurchaseOrderMeta()),
      lastSyncError: error.message
    });
    throw error;
  }
}

async function importDataPurchaseOrdersFromCsvText(csvText = '') {
  const rows = parseCsvRows(String(csvText || '').replace(/^\uFEFF/, ''));
  if (!rows.length) {
    throw new Error('File CSV không có dữ liệu');
  }

  const shape = detectCsvShape(rows);
  const result = mapRows(rows, shape);
  let headers = result.headers;
  if (!result.hasHeader) {
    const meta = await getDataPurchaseOrderMeta();
    headers = headersLookLikeData(meta.headers) ? DEFAULT_HEADERS : meta.headers;
  }

  return persistDataPurchaseOrderRows({
    headers,
    rows: result.rows,
    sourceType: `${shape === 'raw' ? 'csv_raw' : 'csv_selected'}${result.hasHeader ? '' : '_no_header'}`,
    mode: 'append'
  });
}

function docToApiRow(doc) {
  const values = Array.isArray(doc.values) && doc.values.length
    ? doc.values
    : SELECTED_COLUMNS.map(column => ({
      key: column.key,
      value: toText(doc[column.key])
    }));

  return {
    rowNumber: doc.rowNumber,
    values
  };
}

function getRegexSearchFilter(term) {
  const regex = new RegExp(escapeRegExp(term), 'i');
  return { searchText: regex };
}

async function runOrderQuery({ filter, page, limit }) {
  const [total, docs] = await Promise.all([
    DataPurchaseOrder.countDocuments(filter),
    DataPurchaseOrder.find(filter)
      .sort({ rowNumber: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('rowNumber values col1 col2 col3 col4 col11 col13 col15 col16 col24 col25 col27')
      .lean()
  ]);

  return {
    total,
    rows: docs.map(docToApiRow)
  };
}

async function getDataPurchaseOrders({ page = 1, limit = 100, search = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const term = normalizeSearch(search);
  const meta = await getDataPurchaseOrderMeta();
  const sourceFilter = {
    sourceId: SHEET_ID,
    sourceName: SHEET_NAME
  };

  let queryResult;
  if (term) {
    try {
      queryResult = await runOrderQuery({
        filter: {
          ...sourceFilter,
          $text: { $search: term, $caseSensitive: false, $diacriticSensitive: false }
        },
        page: safePage,
        limit: safeLimit
      });
    } catch (error) {
      if (!/text index|required|not found/i.test(error.message || '')) throw error;
      queryResult = await runOrderQuery({
        filter: {
          ...sourceFilter,
          ...getRegexSearchFilter(term)
        },
        page: safePage,
        limit: safeLimit
      });
    }
  } else {
    queryResult = await runOrderQuery({
      filter: sourceFilter,
      page: safePage,
      limit: safeLimit
    });
  }

  return {
    headers: meta.headers,
    rows: queryResult.rows,
    total: queryResult.total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(queryResult.total / safeLimit) || 1,
    sheetId: meta.sheetId,
    sheetName: meta.sheetName,
    range: meta.range,
    query: meta.query,
    lastSyncAt: meta.lastSyncAt,
    lastSyncSourceType: meta.lastSyncSourceType,
    lastSyncCount: meta.lastSyncCount,
    lastSyncDeleted: meta.lastSyncDeleted,
    lastError: meta.lastSyncError
  };
}

module.exports = {
  SELECTED_COLUMNS,
  STORED_COLUMNS,
  SHEET_ID,
  SHEET_NAME,
  SHEET_RANGE,
  SHEET_QUERY,
  fetchDataPurchaseOrderRows,
  getDataPurchaseOrders,
  importDataPurchaseOrdersFromCsvText,
  normalizeDateKey,
  syncDataPurchaseOrdersFromSheet
};
