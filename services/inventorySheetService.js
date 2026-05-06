const axios = require('axios');
const { parseBoundedInt } = require('../utils/number');

const DEFAULT_INVENTORY_SHEET_ID = '1z4MJGri19dTEX7n5YyKXaB1CAGc0ajVtFaTEanyWKjU';
const DEFAULT_INVENTORY_SHEET_GID = '1745813569';
const INVENTORY_SHEET_ID = process.env.INVENTORY_SHEET_ID || DEFAULT_INVENTORY_SHEET_ID;
const INVENTORY_SHEET_GID = process.env.INVENTORY_SHEET_GID || DEFAULT_INVENTORY_SHEET_GID;
const INVENTORY_SHEET_RANGE = process.env.INVENTORY_SHEET_RANGE || 'A1:Z200000';
const INVENTORY_SHEET_CACHE_TTL_MS = parseBoundedInt(process.env.INVENTORY_SHEET_CACHE_TTL_MS, 5 * 60 * 1000, 5000, 30 * 60 * 1000);
const INVENTORY_SHEET_TIMEOUT_MS = parseBoundedInt(process.env.INVENTORY_SHEET_TIMEOUT_MS, 90000, 10000, 300000);
const INVENTORY_SHEET_RETRIES = parseBoundedInt(process.env.INVENTORY_SHEET_RETRIES, 3, 1, 5);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const inventorySheetCache = {
  fetchedAt: 0,
  title: '',
  rawRows: null,
  priceColumnIndex: -1
};

function toSheetText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeHeader(value) {
  return toSheetText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseCsvRows(text = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
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

function parseSheetNumber(value, fallback = 0) {
  const clean = toSheetText(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseA1Range(value) {
  const raw = String(value || 'A1:Z200000').trim();
  const bangIndex = raw.indexOf('!');
  const range = bangIndex >= 0 ? raw.slice(bangIndex + 1) : raw;
  return range || 'A1:Z200000';
}

function findHeaderIndex(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex(header => candidates.some(candidate => header === candidate || header.includes(candidate)));
}

function getCell(row, index) {
  return index >= 0 ? toSheetText(row[index]) : '';
}

function mergeRowNumbers(current = [], incoming = []) {
  return Array.from(new Set([...(current || []), ...(incoming || [])]))
    .map(value => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function getInventorySheetPriceColumnIndex(csvRows = []) {
  if (!csvRows.length) return -1;
  const headerRow1 = csvRows[0] || [];
  const headerRow2 = csvRows[1] || [];
  const directIndex = headerRow1.findIndex(cell => normalizeHeader(cell) === 'gia');
  if (directIndex >= 0) return directIndex;
  return headerRow2.findIndex(cell => normalizeHeader(cell) === 'gia');
}

function toA1ColumnLabel(index) {
  let current = Number(index);
  if (!Number.isInteger(current) || current < 0) {
    throw new Error('Chi so cot Google Sheet khong hop le');
  }

  let label = '';
  while (current >= 0) {
    label = String.fromCharCode((current % 26) + 65) + label;
    current = Math.floor(current / 26) - 1;
  }
  return label;
}

function isSizeHeader(value) {
  const normalized = normalizeHeader(value);
  return ['s', 'm', 'l', 'xl', 'xxl', 'xxxl', 'fz', 'free', 'freesize', 'soft'].includes(normalized);
}

function normalizeSizeLabel(value) {
  const normalized = normalizeHeader(value);
  if (normalized === 'free' || normalized === 'freesize') return 'FZ';
  if (normalized === 'soft') return 'SOFT';
  return normalized.toUpperCase();
}

function mapInventorySizeGridRows(csvRows = [], options = {}) {
  const { dedupe = true } = options;
  const headerRow1 = csvRows[0] || [];
  const headerRow2 = csvRows[1] || [];
  const warehouseIndex = 0;
  const codeIndex = headerRow1.findIndex(cell => normalizeHeader(cell) === 'ma');
  const colorIndex = headerRow1.findIndex(cell => normalizeHeader(cell) === 'mau');
  const noteIndex = headerRow1.findIndex(cell => normalizeHeader(cell).includes('ghichu'));
  const totalIndex = headerRow1.findIndex(cell => normalizeHeader(cell).includes('slchot'));
  const priceIndex = getInventorySheetPriceColumnIndex(csvRows);
  const sizeColumns = headerRow2
    .map((cell, index) => (isSizeHeader(cell) ? { index, label: normalizeSizeLabel(cell) } : null))
    .filter(Boolean);

  if (codeIndex < 0 || !sizeColumns.length) return [];

  const rows = [];
  const seen = new Map();
  let currentWarehouseName = '';

  csvRows.slice(2).forEach((row, index) => {
    const warehouseCell = getCell(row, warehouseIndex);
    if (warehouseCell) currentWarehouseName = warehouseCell;

    const barcode = getCell(row, codeIndex).replace(/\s+/g, ' ').trim();
    if (!barcode) return;

    const sizeValues = {};
    let quantity = 0;
    sizeColumns.forEach(({ index: colIndex, label }) => {
      const value = Math.max(0, parseSheetNumber(getCell(row, colIndex), 0));
      if (value > 0) sizeValues[label] = value;
      quantity += value;
    });
    const sheetTotalQuantity = totalIndex >= 0
      ? Math.max(0, parseSheetNumber(getCell(row, totalIndex), 0))
      : 0;
    if (!quantity && sheetTotalQuantity > 0) {
      quantity = sheetTotalQuantity;
    }

    const color = getCell(row, colorIndex);
    const note = getCell(row, noteIndex);
    const salePrice = getCell(row, priceIndex);
    const name = [barcode, color, note].filter(Boolean).join(' - ');
    const item = {
      rowNumber: index + 3,
      rowNumbers: [index + 3],
      warehouseName: currentWarehouseName,
      barcode,
      name: name || barcode,
      salePrice,
      quantity,
      sheetTotalQuantity,
      sizeValues
    };

    if (!dedupe) {
      rows.push(item);
      return;
    }

    if (seen.has(barcode)) {
      const existing = seen.get(barcode);
      existing.quantity += item.quantity;
      existing.sheetTotalQuantity += item.sheetTotalQuantity;
      existing.sizeValues = mergeSizeValues(existing.sizeValues, item.sizeValues);
      existing.rowNumbers = mergeRowNumbers(existing.rowNumbers, item.rowNumbers);
      if (!existing.salePrice && item.salePrice) existing.salePrice = item.salePrice;
      if (!existing.name && item.name) existing.name = item.name;
      return;
    }

    seen.set(barcode, item);
    rows.push(item);
  });

  return rows;
}

function mapInventorySheetRows(csvRows = [], options = {}) {
  const { dedupe = true } = options;
  if (!csvRows.length) return [];

  const sizeGridRows = mapInventorySizeGridRows(csvRows, options);
  if (sizeGridRows.length) return sizeGridRows;

  const headers = csvRows[0];
  const barcodeIndex = findHeaderIndex(headers, ['mavach', 'barcode', 'masp', 'masanpham', 'sku', 'mahang', 'ma']);
  const nameIndex = findHeaderIndex(headers, ['tensanpham', 'tenhang', 'sanpham', 'name']);
  const quantityIndex = findHeaderIndex(headers, ['tonkho', 'soluongton', 'soluong', 'sl', 'slchot', 'qty', 'quantity']);
  const priceIndex = findHeaderIndex(headers, ['gia', 'giasale', 'pricesale', 'price']);

  if (barcodeIndex < 0) {
    throw new Error('Khong tim thay cot ma vach/ma san pham trong Google Sheet');
  }

  const rows = [];
  const seen = new Map();
  let currentWarehouseName = '';

  csvRows.slice(1).forEach((row, index) => {
    const warehouseCell = getCell(row, 0);
    if (warehouseCell) currentWarehouseName = warehouseCell;

    const barcode = getCell(row, barcodeIndex).replace(/\s+/g, '');
    if (!barcode) return;

    const item = {
      rowNumber: index + 2,
      rowNumbers: [index + 2],
      warehouseName: currentWarehouseName,
      barcode,
      name: getCell(row, nameIndex),
      salePrice: getCell(row, priceIndex),
      quantity: Math.max(0, parseSheetNumber(getCell(row, quantityIndex), 0)),
      sheetTotalQuantity: Math.max(0, parseSheetNumber(getCell(row, quantityIndex), 0)),
      sizeValues: {}
    };

    if (!dedupe) {
      rows.push(item);
      return;
    }

    if (seen.has(barcode)) {
      const existing = seen.get(barcode);
      existing.quantity += item.quantity;
      existing.sheetTotalQuantity += item.sheetTotalQuantity;
      existing.rowNumbers = mergeRowNumbers(existing.rowNumbers, item.rowNumbers);
      if (!existing.salePrice && item.salePrice) existing.salePrice = item.salePrice;
      if (!existing.name && item.name) existing.name = item.name;
      return;
    }

    seen.set(barcode, item);
    rows.push(item);
  });

  return rows;
}

async function fetchInventorySheetItems() {
  if (!INVENTORY_SHEET_ID) {
    throw new Error('Chua cau hinh INVENTORY_SHEET_ID');
  }

  const params = new URLSearchParams({
    tqx: 'out:csv',
    gid: INVENTORY_SHEET_GID,
    range: INVENTORY_SHEET_RANGE
  });
  const url = `https://docs.google.com/spreadsheets/d/${INVENTORY_SHEET_ID}/gviz/tq?${params.toString()}`;

  let response;
  let lastError = null;
  for (let attempt = 1; attempt <= INVENTORY_SHEET_RETRIES; attempt += 1) {
    try {
      response = await axios.get(url, {
        responseType: 'text',
        timeout: INVENTORY_SHEET_TIMEOUT_MS,
        transformResponse: [(data) => data]
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new Error('Google Sheet kho dang private voi server. Hay share file quyen Anyone with the link can view.');
      }
      if (attempt < INVENTORY_SHEET_RETRIES) await delay(1000 * attempt);
    }
  }

  if (lastError) throw lastError;

  const csv = String(response.data || '').trim();
  if (!csv || csv.startsWith('<')) {
    throw new Error('Khong doc duoc Google Sheet kho. Hay kiem tra quyen share va gid.');
  }

  return mapInventorySheetRows(parseCsvRows(csv));
}

async function fetchInventorySheetItemsWithGoogleAccess(accessToken, options = {}) {
  const rawRows = await fetchInventorySheetRawRowsWithGoogleAccess(accessToken, options);
  return mapInventorySheetRows(rawRows);
}

async function fetchInventorySheetRowsWithGoogleAccess(accessToken, options = {}) {
  const rawRows = await fetchInventorySheetRawRowsWithGoogleAccess(accessToken, options);
  return mapInventorySheetRows(rawRows, { dedupe: false });
}

async function fetchInventorySheetRawRowsWithGoogleAccess(accessToken, options = {}) {
  const { refresh = false } = options;
  if (!INVENTORY_SHEET_ID) {
    throw new Error('Chua cau hinh INVENTORY_SHEET_ID');
  }
  if (!accessToken) {
    throw new Error('Chua co Google access token');
  }

  const now = Date.now();
  if (
    !refresh &&
    inventorySheetCache.rawRows &&
    now - inventorySheetCache.fetchedAt < INVENTORY_SHEET_CACHE_TTL_MS
  ) {
    return inventorySheetCache.rawRows;
  }

  const metadataResponse = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${INVENTORY_SHEET_ID}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { fields: 'sheets(properties(sheetId,title))' },
    timeout: INVENTORY_SHEET_TIMEOUT_MS
  });

  const targetSheetId = Number(INVENTORY_SHEET_GID);
  const sheet = (metadataResponse.data?.sheets || []).find(item => Number(item?.properties?.sheetId) === targetSheetId);
  if (!sheet?.properties?.title) {
    throw new Error(`Khong tim thay tab Google Sheet co gid=${INVENTORY_SHEET_GID}`);
  }

  const valueRange = `${sheet.properties.title}!${parseA1Range(INVENTORY_SHEET_RANGE)}`;
  const valuesResponse = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${INVENTORY_SHEET_ID}/values/${encodeURIComponent(valueRange)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { majorDimension: 'ROWS' },
      timeout: INVENTORY_SHEET_TIMEOUT_MS
    }
  );

  inventorySheetCache.rawRows = valuesResponse.data?.values || [];
  inventorySheetCache.title = sheet.properties.title;
  inventorySheetCache.priceColumnIndex = getInventorySheetPriceColumnIndex(inventorySheetCache.rawRows);
  inventorySheetCache.fetchedAt = now;
  return inventorySheetCache.rawRows;
}

async function updateInventorySheetSalePriceWithGoogleAccess(accessToken, rowNumbers = [], salePrice, options = {}) {
  const { refresh = false } = options;
  const uniqueRowNumbers = mergeRowNumbers([], rowNumbers);
  if (!uniqueRowNumbers.length) return { updated: 0 };
  if (!accessToken) {
    throw new Error('Chua co Google access token');
  }

  await fetchInventorySheetRawRowsWithGoogleAccess(accessToken, { refresh });

  if (!inventorySheetCache.title) {
    throw new Error('Khong tim thay ten tab Google Sheet kho');
  }
  if (!Number.isInteger(inventorySheetCache.priceColumnIndex) || inventorySheetCache.priceColumnIndex < 0) {
    throw new Error('Khong tim thay cot Gia trong Google Sheet kho');
  }

  const columnLabel = toA1ColumnLabel(inventorySheetCache.priceColumnIndex);
  const data = uniqueRowNumbers.map(rowNumber => ({
    range: `${inventorySheetCache.title}!${columnLabel}${rowNumber}`,
    values: [[String(salePrice || '').trim()]]
  }));

  try {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${INVENTORY_SHEET_ID}/values:batchUpdate`,
      {
        valueInputOption: 'USER_ENTERED',
        data
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: INVENTORY_SHEET_TIMEOUT_MS
      }
    );
  } catch (error) {
    const status = error.response?.status;
    const googleMessage = error.response?.data?.error?.message || error.message;
    if (status === 403) {
      throw new Error(`Google Sheet khong cho ghi gia. Hay dang nhap lai Google de cap quyen sua Sheet. Chi tiet: ${googleMessage}`);
    }
    throw new Error(`Khong cap nhat duoc gia len Google Sheet: ${googleMessage}`);
  }

  uniqueRowNumbers.forEach(rowNumber => {
    const rowIndex = rowNumber - 1;
    if (!Array.isArray(inventorySheetCache.rawRows?.[rowIndex])) {
      inventorySheetCache.rawRows[rowIndex] = [];
    }
    inventorySheetCache.rawRows[rowIndex][inventorySheetCache.priceColumnIndex] = String(salePrice || '').trim();
  });

  return { updated: uniqueRowNumbers.length };
}

function mergeSizeValues(current = {}, incoming = {}) {
  const merged = { ...current };
  Object.entries(incoming).forEach(([size, value]) => {
    merged[size] = Number(merged[size] || 0) + Number(value || 0);
  });
  return merged;
}

module.exports = {
  fetchInventorySheetItems,
  fetchInventorySheetRowsWithGoogleAccess,
  fetchInventorySheetItemsWithGoogleAccess,
  inventorySheetCache,
  mapInventorySheetRows,
  updateInventorySheetSalePriceWithGoogleAccess
};
