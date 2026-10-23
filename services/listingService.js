'use strict';

const Order = require('../models/Order');
const ListingNewCode = require('../models/ListingNewCode');
const { buildOrderQuery, getOrderItemsFromRaw, getOrderItemSku, normalizeSkuKey } = require('./orderService');
const { todayStr, normalizeCampaignDate } = require('../utils/timeUtils');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WEEKS = 26;

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
  return { orders: 0, skuCounts: {}, newCodes: 0, newCodesWithOrders: 0 };
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
    if (orderedCodesByWeek[weekIndex].has(row.code)) cell.newCodesWithOrders += 1;
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
        newCodeHitRate: cell.newCodes > 0 ? (cell.newCodesWithOrders / cell.newCodes) * 100 : null
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

  const now = new Date();
  const result = await ListingNewCode.bulkWrite(docs.map(doc => ({
    updateOne: {
      filter: { code: doc.code },
      update: { $set: { ...doc, updatedAt: now } },
      upsert: true
    }
  })), { ordered: false });

  return {
    saved: docs.length,
    inserted: result.upsertedCount || 0,
    skipped: entries.length - docs.length
  };
}

module.exports = {
  DEFAULT_LISTING_STAFF_NAMES,
  MAX_WEEKS,
  canonicalListingCode,
  buildListingWeeklyReport,
  upsertListingNewCodes
};
