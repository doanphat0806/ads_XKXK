/*
 * So sanh du lieu don hang giua Pancake POS API va Google Sheet cho 1 ngay cu the.
 * Chi de KIEM CHUNG du lieu truoc khi quyet dinh thay sheet bang API - khong dung
 * trong production, khong ghi vao DB.
 *
 * Usage:
 *   node scripts/test-pancake-vs-sheet.js [YYYY-MM-DD]
 * Neu khong truyen ngay, mac dinh lay ngay hom qua (theo gio VN).
 */
require('dotenv').config();
const axios = require('axios');
const {
  classifyReturnStatus
} = require('../services/orderService');

// Map DUNG TEN CHINH XAC tag cua Pancake -> bucket, thay vi dung bo loc mo
// (classifyReturnOrderTagBucket) vi bo dau tieng Viet lam "Sẵn" va "Đơn nhiều
// sản phẩm" trung thanh cung 1 chuoi "san" -> tinh nham "Don nhieu san pham"
// vao bucket "san" (con hang). Tag nao khong co trong map thi bo qua, dung nhu
// cach Sheet hien chi giu 1 trong 4 loai tag chinh.
const PANCAKE_TAG_BUCKET = {
  'oder': 'od',
  'order': 'od',
  'oder+sẵn': 'od',
  'sẵn': 'san',
  'sale': 'sale',
  'sale119': 'sale119'
};

function classifyPancakeTagBucket(tagNames = []) {
  for (const name of tagNames) {
    const key = String(name || '').trim().toLowerCase().replace(/\s+/g, '');
    if (PANCAKE_TAG_BUCKET[key]) return PANCAKE_TAG_BUCKET[key];
  }
  return '';
}

// Bang ma trang thai Pancake -> nhan tieng Viet tuong duong, do dc bang cach goi
// GET /orders?status=<code>&page_size=1 cho tung ma 0..11 va doc status_name tra ve.
// Map sang cum tu de lot qua dung tu khoa ma classifyReturnStatus/isUnshippedSummaryStatus dang tim.
const PANCAKE_STATUS_LABEL = {
  new: 'Mới',
  waitting: 'Chờ hàng',
  pending: 'Chờ chuyển hàng',
  submitted: 'Đã xác nhận',
  shipped: 'Đã gửi hàng',
  delivered: 'Đã nhận hàng',
  returning: 'Đang hoàn hàng',
  returned: 'Đã hoàn hàng',
  canceled: 'Đã hủy',
  removed: 'Đã xóa'
};

const PANCAKE_API_KEY = process.env.PANCAKE_API_KEY;
const PANCAKE_SHOP_ID = process.env.PANCAKE_SHOP_ID;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const ORDERS_SHEET_ID = process.env.ORDERS_SHEET_ID || '12fPfFQQSKX5SE3748rfWGNnLsgvzzWCtRHrAKLAh7lg';
const ORDERS_SHEET_NAME = process.env.ORDERS_SHEET_NAME || 'ĐƠN HÀNG(Tổng Hoàn)';
const ORDERS_SHEET_RANGE = process.env.ORDERS_SHEET_RANGE || 'A1:M200000';
const ORDERS_SHEET_QUERY = process.env.ORDERS_SHEET_QUERY || 'select L,B,D,G,H,K,M where B is not null';

function targetDateKey() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  const yesterday = new Date(Date.now() - VN_OFFSET_MS - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().split('T')[0];
}

// ---------- Pancake side ----------

async function fetchPancakeOrdersForDate(dateKey) {
  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    throw new Error('Thieu PANCAKE_API_KEY / PANCAKE_SHOP_ID trong .env');
  }
  const startSec = Math.floor((new Date(`${dateKey}T00:00:00+07:00`)).getTime() / 1000);
  const endSec = Math.floor((new Date(`${dateKey}T23:59:59+07:00`)).getTime() / 1000);

  const pageSize = 100;
  let page = 1;
  let totalPages = 1;
  const orders = [];

  do {
    const res = await axios.get(`https://pos.pages.fm/api/v1/shops/${PANCAKE_SHOP_ID}/orders`, {
      params: {
        api_key: PANCAKE_API_KEY,
        page_size: pageSize,
        page_number: page,
        startDateTime: startSec,
        endDateTime: endSec
      },
      timeout: 30000
    });
    const body = res.data || {};
    totalPages = body.total_pages || 1;
    for (const order of body.data || []) orders.push(order);
    page += 1;
  } while (page <= totalPages);

  return orders;
}

function summarizePancakeOrders(orders) {
  // Dem theo tung dong san pham (item), giong don vi tinh cua Sheet (moi dong
  // sheet = 1 SKU), thay vi theo tung don hang - de so sanh cho cong bang.
  const byBucket = new Map();
  const byReturnStatus = new Map();
  let lineCount = 0;

  for (const order of orders) {
    const tagNames = (Array.isArray(order.tags) ? order.tags : []).map(t => t?.name || '');
    const bucketKey = classifyPancakeTagBucket(tagNames) || '(khong khop bucket nao)';

    const vnStatus = PANCAKE_STATUS_LABEL[order.status_name] || order.status_name || `status_${order.status}`;
    const returnStatus = classifyReturnStatus({ status: vnStatus }) || '(khac)';

    const itemCount = Array.isArray(order.items) && order.items.length ? order.items.length : 1;
    lineCount += itemCount;
    byBucket.set(bucketKey, (byBucket.get(bucketKey) || 0) + itemCount);
    byReturnStatus.set(returnStatus, (byReturnStatus.get(returnStatus) || 0) + itemCount);
  }

  return { orderCount: orders.length, lineCount, byBucket, byReturnStatus };
}

// ---------- Google Sheet side (tu doc lai, khong dung DB) ----------

function parseCsvRows(text = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
      continue;
    }
    if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else { cell += ch; }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toSheetText(value) {
  return String(value ?? '').trim();
}

function getSheetCell(row, index) {
  return toSheetText(row[index] || '');
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
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return '';
}

async function fetchSheetRowsForDate(dateKey) {
  const params = new URLSearchParams({
    tqx: 'out:csv',
    sheet: ORDERS_SHEET_NAME,
    range: ORDERS_SHEET_RANGE,
    tq: ORDERS_SHEET_QUERY
  });
  const url = `https://docs.google.com/spreadsheets/d/${ORDERS_SHEET_ID}/gviz/tq?${params.toString()}`;
  const res = await axios.get(url, { responseType: 'text', timeout: 90000, transformResponse: [(d) => d] });
  const csv = String(res.data || '').trim();
  const csvRows = parseCsvRows(csv);
  const rawRows = csvRows.slice(1);

  const matched = [];
  for (const row of rawRows) {
    const queriedShape = row.length <= 7;
    const col2 = getSheetCell(row, queriedShape ? 1 : 1);
    const rowDateKey = parseSheetDateKey(col2);
    if (rowDateKey !== dateKey) continue;
    matched.push({
      status: getSheetCell(row, queriedShape ? 4 : 7) || 'unknown',
      tag: getSheetCell(row, queriedShape ? 6 : 12) || ''
    });
  }
  return matched;
}

function summarizeSheetRows(rows) {
  const byBucket = new Map();
  const byReturnStatus = new Map();
  for (const row of rows) {
    const bucketKey = classifyPancakeTagBucket([row.tag]) || '(khong khop bucket nao)';
    byBucket.set(bucketKey, (byBucket.get(bucketKey) || 0) + 1);

    const returnStatus = classifyReturnStatus({ status: row.status }) || '(khac)';
    byReturnStatus.set(returnStatus, (byReturnStatus.get(returnStatus) || 0) + 1);
  }
  return { lineCount: rows.length, byBucket, byReturnStatus };
}

// ---------- Report ----------

function printMap(title, map) {
  console.log(`  ${title}:`);
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of entries) console.log(`    ${key}: ${count}`);
}

async function main() {
  const dateKey = targetDateKey();
  console.log(`So sanh du lieu ngay ${dateKey} (gio VN)\n`);

  const [pancakeOrders, sheetRows] = await Promise.all([
    fetchPancakeOrdersForDate(dateKey).catch(err => { console.error('Loi khi goi Pancake API:', err.message); return []; }),
    fetchSheetRowsForDate(dateKey).catch(err => { console.error('Loi khi doc Google Sheet:', err.message); return []; })
  ]);

  const pancakeSummary = summarizePancakeOrders(pancakeOrders);
  const sheetSummary = summarizeSheetRows(sheetRows);

  console.log('== PANCAKE ==');
  console.log(`  So don hang: ${pancakeSummary.orderCount}`);
  console.log(`  So dong san pham (items): ${pancakeSummary.lineCount}`);
  printMap('Theo bucket tag (san/sale/sale119/od)', pancakeSummary.byBucket);
  printMap('Theo return status (returned/returning/received)', pancakeSummary.byReturnStatus);

  console.log('\n== GOOGLE SHEET ==');
  console.log(`  So dong: ${sheetSummary.lineCount}`);
  printMap('Theo bucket tag (san/sale/sale119/od)', sheetSummary.byBucket);
  printMap('Theo return status (returned/returning/received)', sheetSummary.byReturnStatus);

  console.log('\n== NHAN XET ==');
  console.log(`  Pancake items: ${pancakeSummary.lineCount} vs Sheet rows: ${sheetSummary.lineCount}`);
  console.log('  Luu y: sheet co the da loc/gan tay status & tag khac voi luc Pancake ghi nhan ban dau (vi du don doi trang thai sau ngay tao),');
  console.log('  va bien gio Pancake API co the la gio VN hoac UTC (chua xac nhan 100% tu tai lieu chinh thuc) nen so lieu sat bien ngay co the lech vai gio.');
}

main().catch(err => {
  console.error('Script that bai:', err);
  process.exit(1);
});
