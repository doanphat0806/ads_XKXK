'use strict';

const axios = require('axios');
const Order = require('../models/Order');
const ListingNewCode = require('../models/ListingNewCode');
const { buildOrderQuery, getOrderItemsFromRaw, getOrderItemSku, normalizeSkuKey } = require('./orderService');
const { todayStr, normalizeCampaignDate } = require('../utils/timeUtils');
const { parseCsvRows } = require('../utils/csvImport');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WEEKS = 26;

// File Google Sheet "tim ma" cua moi nguoi (tab theo gid). Doi file/tab qua env neu can.
const LISTING_CODE_SHEET_ID = process.env.LISTING_CODE_SHEET_ID || '1nE0BVs0Kkczjdsn9qZ1EdF80rZNQqHRctLkeR2q3i_s';
const LISTING_CODE_SHEET_GID = String(process.env.LISTING_CODE_SHEET_GID || '852335313');
const SHEET_TIMEOUT_MS = 60000;
const LISTING_CODE_RE = /^(MS\s*)?[A-Z]{2}\s*\d{5,}$/i;

// Ten mac dinh theo chu cai dau ma (lay tu bang Hieu qua Listing). Sua duoc tren trang, luu vao Config.listingStaffNames.
const DEFAULT_LISTING_STAFF_NAMES = {
  A: 'Ninh', B: 'Ly', C: 'Tình', D: 'Khuyên', E: 'Mi', F: 'Linh Sale', G: 'Mai', H: 'Hoa Bé',
  J: 'Dương sale', K: 'Chị Linh', L: 'Lan Sale', M: 'Thùy Dương', N: 'Cua', O: 'Bống', P: 'Thúy', Q: 'Chi',
  R: 'Mến', S: 'Linh Listing', T: 'Hiếu', V: 'Phương', X: 'Hoa Lớn', Z: 'Hiếu'
};

// "MS DH2608478" / "msdh2608478" / "DH2608478" -> "DH2608478"
function canonicalListingCode(value) {
  const key = normalizeSkuKey(value);
  return key.replace(/^MS(?=[A-Z]{2}\d)/, '');
}

function getListingLetter(code) {
  const first = String(code || '').charAt(0);
  return /^[A-Z]$/.test(first) ? first : '';
}

function addDays(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function shortDate(dateKey) {
  const [, m, d] = dateKey.split('-');
  return `${d}/${m}`;
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

// Thu 2 cua tuan chua dateKey
function mondayOf(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0 = CN
  return addDays(dateKey, -((weekday + 6) % 7));
}

// Chia [fromDate, toDate] theo tuan thuc te Thu 2 -> CN; tuan dau/cuoi co the le (bi cat o fromDate/toDate).
function buildListingWeeks(fromDate, toDate) {
  const weeks = [];
  for (let weekStart = mondayOf(fromDate); weekStart <= toDate; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const from = weekStart < fromDate ? fromDate : weekStart;
    const to = weekEnd > toDate ? toDate : weekEnd;
    weeks.push({ key: `W${weeks.length + 1}`, from, to, label: `${shortDate(from)}–${shortDate(to)}` });
  }
  return weeks;
}

function findWeekIndex(weeks, dateKey) {
  if (!dateKey || dateKey < weeks[0].from || dateKey > weeks[weeks.length - 1].to) return -1;
  return Math.floor(daysBetween(mondayOf(weeks[0].from), dateKey) / 7);
}

function vnDateKey(date) {
  return new Date(new Date(date).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function createWeekCell() {
  return { orders: 0, skuCounts: {}, newCodes: 0, newCodesWithOrders: 0, newCodeOrders: 0 };
}

/**
 * Bang toan shop theo nguoi: moi chu cai dau ma = 1 nguoi, moi tuan dem so dong ma (cap don + ma, khong lap ma trong 1 don).
 * Ma moi: ma co ngay dang trong tuan; "ra don" = co it nhat 1 don trong chinh tuan do.
 */
async function buildListingWeeklyReport({ fromDate, toDate, staffNames = {} } = {}) {
  const endDate = normalizeCampaignDate(toDate || todayStr());
  // Mac dinh 5 tuan (T2 cua 4 tuan truoc -> endDate); khoang qua dai thi cat con MAX_WEEKS tuan gan nhat
  const minStart = addDays(mondayOf(endDate), -7 * (MAX_WEEKS - 1));
  let startDate = fromDate && fromDate <= endDate ? fromDate : addDays(mondayOf(endDate), -28);
  if (startDate < minStart) startDate = minStart;
  const weeks = buildListingWeeks(startDate, endDate);
  const names = { ...DEFAULT_LISTING_STAFF_NAMES, ...staffNames };

  const byLetter = new Map();
  const getCell = (letter, weekIndex) => {
    if (!byLetter.has(letter)) byLetter.set(letter, weeks.map(createWeekCell));
    return byLetter.get(letter)[weekIndex];
  };
  const orderedCodesByWeek = weeks.map(() => new Set());

  const query = buildOrderQuery({ fromDate: weeks[0].from, toDate: endDate });
  const cursor = Order.find(query)
    .select('createdAt rawData.items rawData.line_items rawData.products rawData.details')
    .lean()
    .cursor();

  for await (const order of cursor) {
    const weekIndex = findWeekIndex(weeks, vnDateKey(order.createdAt));
    if (weekIndex < 0) continue;
    const codes = new Set();
    for (const item of getOrderItemsFromRaw(order.rawData || {})) {
      const code = canonicalListingCode(getOrderItemSku(item));
      if (code) codes.add(code);
    }
    for (const code of codes) {
      const letter = getListingLetter(code);
      if (!letter) continue;
      const cell = getCell(letter, weekIndex);
      cell.orders += 1;
      cell.skuCounts[code] = (cell.skuCounts[code] || 0) + 1;
      orderedCodesByWeek[weekIndex].add(code);
    }
  }

  const newCodes = await ListingNewCode.find({ postedDate: { $gte: weeks[0].from, $lte: endDate } })
    .select('code letter postedDate')
    .lean();
  for (const row of newCodes) {
    const weekIndex = findWeekIndex(weeks, row.postedDate);
    const letter = row.letter || getListingLetter(row.code);
    if (weekIndex < 0 || !letter) continue;
    const cell = getCell(letter, weekIndex);
    cell.newCodes += 1;
    if (orderedCodesByWeek[weekIndex].has(row.code)) {
      cell.newCodesWithOrders += 1;
      // Don tu ma moi = so don trong chinh tuan dang cua ma do
      cell.newCodeOrders += cell.skuCounts[row.code] || 0;
    }
  }

  // Hien du ca bang chu cai A-Z, ke ca chu chua co don
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (!byLetter.has(letter)) byLetter.set(letter, weeks.map(createWeekCell));
  }

  // Cac chu cai cung ten thi gop thanh 1 nguoi (vd T gop vao Hieu: Z,T)
  const groups = new Map();
  for (const [letter, cells] of byLetter.entries()) {
    const name = String(names[letter] || '').trim();
    const groupKey = name ? `name:${name.toLowerCase()}` : `letter:${letter}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { letters: [], name, cells: weeks.map(createWeekCell) });
    }
    const group = groups.get(groupKey);
    group.letters.push(letter);
    cells.forEach((cell, index) => {
      const target = group.cells[index];
      target.orders += cell.orders;
      target.newCodes += cell.newCodes;
      target.newCodesWithOrders += cell.newCodesWithOrders;
      target.newCodeOrders += cell.newCodeOrders;
      for (const [code, count] of Object.entries(cell.skuCounts)) {
        target.skuCounts[code] = (target.skuCounts[code] || 0) + count;
      }
    });
  }

  const rows = [...groups.values()].map(({ letters, name, cells }) => ({
    letter: letters.sort().join(','),
    name,
    known: Boolean(name),
    weeks: cells.map(cell => {
      const top = Object.entries(cell.skuCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return {
        orders: cell.orders,
        top1Share: cell.orders > 0 && top[0] ? (top[0][1] / cell.orders) * 100 : null,
        top3: top.map(([code, count]) => ({ code: `MS ${code}`, count })),
        newCodes: cell.newCodes,
        newCodesWithOrders: cell.newCodesWithOrders,
        newCodeHitRate: cell.newCodes > 0 ? (cell.newCodesWithOrders / cell.newCodes) * 100 : null,
        newCodeOrders: cell.newCodeOrders
      };
    })
  }));

  const totals = weeks.map((_, index) => rows.reduce((sum, row) => sum + row.weeks[index].orders, 0));

  return { fromDate: startDate, toDate: endDate, weeks, rows, totals, newCodeCount: newCodes.length };
}

async function upsertListingNewCodes(entries = []) {
  const byCode = new Map();
  for (const entry of entries) {
    const code = canonicalListingCode(entry?.code);
    const postedDate = String(entry?.postedDate || '').trim();
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(postedDate)) continue;
    byCode.set(code, { code, letter: getListingLetter(code), postedDate });
  }
  const docs = [...byCode.values()];
  if (!docs.length) return { saved: 0, skipped: entries.length };

  // File ma co >100k ma: chi ghi ma moi hoac doi ngay dang, khong ghi lai ca file moi lan dong bo
  const existing = new Map();
  for (let index = 0; index < docs.length; index += 20000) {
    const chunk = docs.slice(index, index + 20000).map(doc => doc.code);
    const found = await ListingNewCode.find({ code: { $in: chunk } }).select('code postedDate -_id').lean();
    found.forEach(row => existing.set(row.code, row.postedDate));
  }
  const changed = docs.filter(doc => existing.get(doc.code) !== doc.postedDate);

  const now = new Date();
  let inserted = 0;
  for (let index = 0; index < changed.length; index += 2000) {
    const result = await ListingNewCode.bulkWrite(changed.slice(index, index + 2000).map(doc => ({
      updateOne: {
        filter: { code: doc.code },
        update: { $set: { ...doc, updatedAt: now } },
        upsert: true
      }
    })), { ordered: false });
    inserted += result.upsertedCount || 0;
  }

  return {
    saved: docs.length,
    inserted,
    updated: changed.length - inserted,
    skipped: entries.length - docs.length
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateKey(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Ngay khong co nam -> lay nam gan nhat khong vuot qua hom nay
function dateKeyWithoutYear(month, day) {
  const today = todayStr();
  const year = Number(today.slice(0, 4));
  const thisYear = toDateKey(year, month, day);
  if (thisYear && thisYear <= today) return thisYear;
  return toDateKey(year - 1, month, day);
}

// "DH2608478" = dang ngay 26/08
function dateFromListingCode(code) {
  const match = String(code || '').match(/^[A-Z]{2}(\d{2})(\d{2})/);
  return match ? dateKeyWithoutYear(Number(match[2]), Number(match[1])) : '';
}

// O ngay trong sheet: "dd/mm/yyyy", "dd/mm", "yyyy-mm-dd", so serial
function parseSheetDate(value) {
  if (typeof value === 'number' && value > 30000 && value < 70000) {
    const date = new Date(Math.round((value - 25569) * DAY_MS));
    return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (match) return toDateKey(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return toDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (match) return dateKeyWithoutYear(Number(match[2]), Number(match[1]));
  return '';
}

function normalizeHeaderText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();
}

function findListingSheetColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    const cells = (rows[r] || []).map(normalizeHeaderText);
    const dateCol = cells.findIndex(cell => /ngay|date/.test(cell));
    const codeCol = cells.findIndex(cell => /^ma\b|ma (sp|san pham|hang)|sku|code/.test(cell));
    if (dateCol >= 0 || codeCol >= 0) return { headerRow: r, dateCol, codeCol };
  }
  return { headerRow: -1, dateCol: -1, codeCol: -1 };
}

function isListingCodeCell(cell) {
  return LISTING_CODE_RE.test(String(cell ?? '').trim());
}

/**
 * Doc bang ma tu sheet: co cot ma thi lay cot do, khong thi quet moi o dang "MS XX123456".
 * Ngay dang: cot ngay -> o ngay cung dong (khi dong chi co 1 ma) -> doc tu ma.
 */
function parseListingCodeRows(rows = []) {
  const { headerRow, dateCol, codeCol } = findListingSheetColumns(rows);
  const entries = new Map();
  const fromCodeSet = new Set();

  rows.forEach((row = [], index) => {
    if (index === headerRow) return;
    const rawCodes = codeCol >= 0 && isListingCodeCell(row[codeCol]) ? [row[codeCol]] : row.filter(isListingCodeCell);
    if (!rawCodes.length) return;

    let rowDate = dateCol >= 0 ? parseSheetDate(row[dateCol]) : '';
    if (!rowDate && dateCol < 0 && rawCodes.length === 1) {
      const dateCell = row.find(cell => cell !== rawCodes[0] && parseSheetDate(cell));
      rowDate = dateCell ? parseSheetDate(dateCell) : '';
    }

    for (const rawCode of rawCodes) {
      const code = canonicalListingCode(rawCode);
      if (!code) continue;
      if (entries.has(code) && !rowDate) continue;
      const postedDate = rowDate || dateFromListingCode(code);
      if (!postedDate) continue;
      entries.set(code, { code, postedDate });
      if (rowDate) fromCodeSet.delete(code);
      else fromCodeSet.add(code);
    }
  });

  return { codes: [...entries.values()], fromCode: fromCodeSet.size };
}

// Moi tab trong file = ma cua 1 nguoi -> doc het cac tab trong 1 lan batchGet
async function fetchListingSheetWithApi(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${LISTING_CODE_SHEET_ID}`;
  const meta = await axios.get(base, {
    headers,
    params: { fields: 'sheets.properties(sheetId,title)' },
    timeout: SHEET_TIMEOUT_MS
  });
  const titles = (meta.data?.sheets || []).map(item => item.properties?.title).filter(Boolean);
  if (!titles.length) throw new Error('File ma khong co tab nao');
  const params = new URLSearchParams({ majorDimension: 'ROWS' });
  titles.forEach(title => params.append('ranges', `'${title.replace(/'/g, "''")}'`));
  const response = await axios.get(`${base}/values:batchGet?${params.toString()}`, {
    headers,
    timeout: SHEET_TIMEOUT_MS
  });
  const valueRanges = response.data?.valueRanges || [];
  return titles.map((title, index) => ({ title, rows: valueRanges[index]?.values || [] }));
}

async function fetchPublicText(url) {
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: SHEET_TIMEOUT_MS,
    transformResponse: [data => data],
    validateStatus: () => true
  });
  return { status: response.status, text: String(response.data || '') };
}

// File share "Bat ky ai co link": trang htmlview liet ke ten + gid tung tab -> khong can ket noi Google van doc du tab
async function listPublicListingTabs() {
  const { status, text } = await fetchPublicText(`https://docs.google.com/spreadsheets/d/${LISTING_CODE_SHEET_ID}/htmlview`);
  if (status !== 200) return [];
  const tabs = new Map();
  for (const match of text.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
    const title = match[1].replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\(.)/g, '$1');
    tabs.set(match[2], title.trim());
  }
  return [...tabs.entries()].map(([gid, title]) => ({ gid, title }));
}

async function fetchListingSheetWithGviz() {
  const tabs = await listPublicListingTabs();
  if (!tabs.length) tabs.push({ gid: LISTING_CODE_SHEET_GID, title: `gid=${LISTING_CODE_SHEET_GID}` });

  const results = [];
  // Doc 4 tab 1 luc cho nhanh ma khong spam Google
  for (let index = 0; index < tabs.length; index += 4) {
    const batch = await Promise.all(tabs.slice(index, index + 4).map(async tab => {
      const { status, text } = await fetchPublicText(
        `https://docs.google.com/spreadsheets/d/${LISTING_CODE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${tab.gid}`
      );
      if (status !== 200 || !text || text.trimStart().startsWith('<')) return null;
      return { title: tab.title, rows: parseCsvRows(text) };
    }));
    results.push(...batch.filter(Boolean));
  }
  if (!results.length) {
    throw new Error('Khong doc duoc file ma: hay share file "Bat ky ai co link" hoac ket noi Google bang tai khoan co quyen xem file');
  }
  return results;
}

// Doc sheet ma -> luu vao ListingNewCode. Co token thi dung Sheets API; loi/khong co token thi thu link CSV cong khai.
async function syncListingCodesFromSheet({ accessToken = '' } = {}) {
  let tabs = null;
  let apiError = null;
  if (accessToken) {
    try {
      tabs = await fetchListingSheetWithApi(accessToken);
    } catch (error) {
      apiError = error;
    }
  }
  if (!tabs) {
    try {
      tabs = await fetchListingSheetWithGviz();
    } catch (error) {
      const apiMessage = apiError?.response?.data?.error?.message || apiError?.message;
      throw new Error(apiMessage ? `${error.message} (Google API: ${apiMessage})` : error.message);
    }
  }

  // Moi tab co header rieng -> parse tung tab; 1 ma nam o nhieu tab thi lay ngay dang som nhat
  const byCode = new Map();
  let fromCode = 0;
  const tabStats = tabs.map(tab => {
    const parsed = parseListingCodeRows(tab.rows);
    fromCode += parsed.fromCode;
    for (const entry of parsed.codes) {
      const existing = byCode.get(entry.code);
      if (!existing || entry.postedDate < existing.postedDate) byCode.set(entry.code, entry);
    }
    return { title: tab.title, codes: parsed.codes.length };
  });

  const codes = [...byCode.values()];
  if (!codes.length) throw new Error('Khong tim thay ma nao dang "MS XX123456" trong file ma');
  const result = await upsertListingNewCodes(codes);
  return {
    ...result,
    fromCode,
    tabs: tabStats,
    source: apiError || !accessToken ? 'csv' : 'google_api'
  };
}

module.exports = {
  DEFAULT_LISTING_STAFF_NAMES,
  MAX_WEEKS,
  canonicalListingCode,
  buildListingWeeklyReport,
  parseListingCodeRows,
  syncListingCodesFromSheet,
  upsertListingNewCodes
};
