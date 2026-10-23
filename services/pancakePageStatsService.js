'use strict';

const Order = require('../models/Order');
const { buildOrderQuery, classifyReturnOrderTagBucket } = require('./orderService');

const PAGES_API_BASE = 'https://pages.fm/api/public_api/v1';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RANGE_DAYS = 31;
const PAGE_CONCURRENCY = 3;
const RATE_LIMIT_RETRIES = 4;
const CACHE_TTL_MS = 5 * 60 * 1000;
const statsCache = new Map();

// Cac truong cong don theo gio trong statistics/users -> cot cua bang (dung ten nhu man Thong ke nhan vien cua Pancake)
const SUM_FIELDS = {
  commentInbox: 'private_reply_count',
  comments: 'comment_count',
  commentSessions: 'unique_comment_count',
  messages: 'inbox_count',
  inboxSessions: 'unique_inbox_count',
  phones: 'phone_number_count'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// "2026-10-20" -> "20/10/2026"
function toPancakeDate(dateKey) {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

async function fetchPagesApi(path, params) {
  const url = new URL(`${PAGES_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let data;
    try {
      const response = await fetch(url, { signal: controller.signal });
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Pancake tra ve khong phai JSON (HTTP ${response.status})`);
      }
      // Pancake tra loi phan lon loi bang HTTP 200 + success:false; goi nhieu page lien tiep de bi "Too many requests"
      const rateLimited = response.status === 429 || /too many requests/i.test(String(data?.message || ''));
      if (rateLimited && attempt < RATE_LIMIT_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Pancake khong phan hoi (timeout)');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Response: data.statistics = { [userId]: [ { hour, comment_count, inbox_count, average_response_time, ... } ] },
 * data.users = { [userId]: { user_name, ... } }. Gop cac gio thanh 1 dong / nhan vien.
 * Thoi gian phan hoi TB = trung binh cac gio, trong so theo inbox_count.
 */
function summarizePageStats(payload) {
  const statistics = payload?.data?.statistics || {};
  const users = payload?.data?.users || {};
  const rows = [];

  for (const [userId, hours] of Object.entries(statistics)) {
    if (!Array.isArray(hours)) continue;
    const row = { id: userId, name: String(users[userId]?.user_name || ''), avatar: '', orders: 0, responseWeighted: 0, responseWeight: 0 };
    Object.keys(SUM_FIELDS).forEach(field => { row[field] = 0; });
    for (const hour of hours) {
      for (const [field, key] of Object.entries(SUM_FIELDS)) row[field] += toNumber(hour[key]);
      const inbox = toNumber(hour.inbox_count);
      const avg = toNumber(hour.average_response_time);
      if (inbox > 0 && avg > 0) {
        row.responseWeighted += avg * inbox;
        row.responseWeight += inbox;
      }
    }
    rows.push(row);
  }
  return rows;
}

async function fetchPageUserStats(page, { fromDate, toDate }) {
  const cacheKey = `${page.pageId}:${fromDate}:${toDate}`;
  const cached = statsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const payload = await fetchPagesApi(`/pages/${encodeURIComponent(page.pageId)}/statistics/users`, {
    page_access_token: page.accessToken,
    date_range: `${toPancakeDate(fromDate)} - ${toPancakeDate(toDate)}`
  });
  const value = { payload, rows: summarizePageStats(payload) };
  statsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// Chay toi da `limit` page cung luc de khong bi Pancake chan
async function mapWithConcurrency(items, limit, iteratee) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await iteratee(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Nhom don theo the chinh cho bang sale (cung cach chia voi bao cao hoan): "Oder + Sẵn" tinh la Order; Sale 119/99 tinh la Sale
const ORDER_TYPE_FIELDS = { sale: 'ordersSale', sale119: 'ordersSale', san: 'ordersSan', od: 'ordersOrder' };
const ORDER_TYPE_KEYS = ['ordersSale', 'ordersSan', 'ordersOrder'];

function classifySaleOrderType(tags = []) {
  return classifyReturnOrderTagBucket(Array.isArray(tags) ? tags : []);
}

/**
 * Dem don POS theo nhan vien chot (rawData.seller_id) trong khoang ngay tao don, bo don huy/xoa nhu cac bao cao don khac.
 * Moi nhan vien: tong don + so don Sale / Sẵn / Order / Order + Sẵn (theo the don).
 * withoutSeller: don chua co truong seller_id (luu truoc khi them truong -> chay scripts/backfillPosSeller.js);
 * don co seller_id rong = POS khong gan ai, backfill cung khong bo sung duoc.
 */
async function countPosOrdersBySeller({ fromDate, toDate, pageId = '' }) {
  const match = buildOrderQuery({ fromDate, toDate });
  match['rawData.source'] = 'pancake_pos';
  if (pageId) match['rawData.page_id'] = pageId;

  const bySeller = new Map();
  let total = 0;
  let withoutSeller = 0;
  const cursor = Order.find(match)
    .select('rawData.seller_id rawData.seller_name rawData.seller_avatar rawData.tags')
    .lean()
    .cursor();

  for await (const order of cursor) {
    total += 1;
    const raw = order.rawData || {};
    if (raw.seller_id === undefined) {
      withoutSeller += 1;
      continue;
    }
    if (!raw.seller_id) continue;
    if (!bySeller.has(raw.seller_id)) {
      bySeller.set(raw.seller_id, {
        id: raw.seller_id,
        name: raw.seller_name || '',
        avatar: raw.seller_avatar || '',
        orders: 0,
        ...Object.fromEntries(ORDER_TYPE_KEYS.map(key => [key, 0]))
      });
    }
    const seller = bySeller.get(raw.seller_id);
    seller.orders += 1;
    const field = ORDER_TYPE_FIELDS[classifySaleOrderType(raw.tags)];
    if (field) seller[field] += 1;
    if (raw.seller_avatar) seller.avatar = raw.seller_avatar;
  }

  return { sellers: [...bySeller.values()], total, withoutSeller };
}

// Thu 2 (YYYY-MM-DD) cua tuan chua dateKey
function mondayOf(dateKey) {
  const time = Date.parse(`${dateKey}T00:00:00Z`);
  const weekday = new Date(time).getUTCDay();
  return new Date(time - ((weekday + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

/**
 * Lich ca theo tuan: schedules = { [Thu 2 YYYY-MM-DD]: { shifts, days: [7 mang Thu 2..CN cac { shift, staffId }] } }.
 * Tuan khong co lich rieng dung lich cua tuan gan nhat truoc do (khong co thi tuan som nhat).
 * Tra { weekStart, schedule, own } - own=false la dang muon lich tuan khac.
 */
function resolveWeekSchedule(schedules = {}, dateKey) {
  const weekStart = mondayOf(dateKey);
  const keys = Object.keys(schedules || {}).filter(key => schedules[key]?.days?.some(day => day?.length)).sort();
  if (!keys.length) return { weekStart, schedule: null, sourceWeek: '', own: false };
  if (keys.includes(weekStart)) return { weekStart, schedule: schedules[weekStart], sourceWeek: weekStart, own: true };
  const sourceWeek = keys.filter(key => key < weekStart).pop() || keys[0];
  return { weekStart, schedule: schedules[sourceWeek], sourceWeek, own: false };
}

// Dem so ca moi nhan vien lam trong [fromDate, toDate] (1 o trong lich = 1 ca) + cac tuan dang muon lich tuan khac
function countScheduledShifts(schedules, fromDate, toDate) {
  const counts = {};
  const borrowedWeeks = new Map();
  for (let time = Date.parse(`${fromDate}T00:00:00Z`); time <= Date.parse(`${toDate}T00:00:00Z`); time += 86400000) {
    const dateKey = new Date(time).toISOString().slice(0, 10);
    const { weekStart, schedule, sourceWeek, own } = resolveWeekSchedule(schedules, dateKey);
    if (!schedule) continue;
    if (!own) borrowedWeeks.set(weekStart, sourceWeek);
    const weekdayIndex = (new Date(time).getUTCDay() + 6) % 7;
    for (const entry of schedule.days?.[weekdayIndex] || []) {
      if (entry?.staffId) counts[entry.staffId] = (counts[entry.staffId] || 0) + 1;
    }
  }
  return {
    counts,
    borrowedWeeks: [...borrowedWeeks.entries()].map(([weekStart, sourceWeek]) => ({ weekStart, sourceWeek }))
  };
}

async function buildSaleStaffStats({ pages = [], fromDate, toDate, pageId = '', staffIds = [], shiftSchedules = {}, debug = false, fresh = false }) {
  const days = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000) + 1;
  if (days < 1) throw new Error('Khoang ngay khong hop le');
  if (days > MAX_RANGE_DAYS) throw new Error(`Pancake chi cho xem toi da ${MAX_RANGE_DAYS} ngay moi lan`);
  if (fresh) statsCache.clear();

  const targetPages = pages.filter(page => page.pageId && page.accessToken && (!pageId || page.pageId === pageId));
  const results = await mapWithConcurrency(targetPages, PAGE_CONCURRENCY, page => fetchPageUserStats(page, { fromDate, toDate }));

  const byUser = new Map();
  const errors = [];
  let rawSample = null;

  results.forEach((result, index) => {
    const page = targetPages[index];
    const pageName = page.name || page.pageId;
    if (result.status === 'rejected') {
      errors.push({ pageId: page.pageId, name: pageName, error: result.reason?.message || String(result.reason) });
      return;
    }
    if (debug && rawSample === null) rawSample = result.value.payload;
    for (const row of result.value.rows) {
      const current = byUser.get(row.id);
      if (!current) {
        byUser.set(row.id, { ...row, pages: [pageName] });
        continue;
      }
      Object.keys(SUM_FIELDS).forEach(field => { current[field] += row[field]; });
      current.responseWeighted += row.responseWeighted;
      current.responseWeight += row.responseWeight;
      if (!current.name && row.name) current.name = row.name;
      current.pages.push(pageName);
    }
  });

  // So don chot lay tu don POS (order_count ben Pages luon 0 vi don tao tren POS), ghep theo id nhan vien Pancake
  const posOrders = await countPosOrdersBySeller({ fromDate, toDate, pageId });
  for (const seller of posOrders.sellers) {
    const current = byUser.get(seller.id);
    if (current) {
      current.orders = seller.orders;
      ORDER_TYPE_KEYS.forEach(key => { current[key] = seller[key]; });
      if (seller.avatar) current.avatar = seller.avatar;
      if (!current.name) current.name = seller.name;
      continue;
    }
    byUser.set(seller.id, {
      id: seller.id,
      name: seller.name,
      avatar: seller.avatar,
      ...Object.fromEntries(Object.keys(SUM_FIELDS).map(field => [field, 0])),
      orders: seller.orders,
      ...Object.fromEntries(ORDER_TYPE_KEYS.map(key => [key, seller[key]])),
      responseWeighted: 0,
      responseWeight: 0,
      pages: []
    });
  }

  const { counts: shiftCounts, borrowedWeeks } = countScheduledShifts(shiftSchedules, fromDate, toDate);
  const rows = [...byUser.values()]
    .map(({ responseWeighted, responseWeight, ...row }) => ({
      ...row,
      avgResponseSeconds: responseWeight > 0 ? responseWeighted / responseWeight : null,
      shifts: shiftCounts[row.id] || 0,
      ordersPerShift: shiftCounts[row.id] ? row.orders / shiftCounts[row.id] : null
    }))
    // Bo nhan vien khong co hoat dong nao trong khoang
    .filter(row => row.orders > 0 || Object.keys(SUM_FIELDS).some(field => row[field] > 0));

  return {
    fromDate,
    toDate,
    pages: targetPages.map(page => ({ pageId: page.pageId, name: page.name || page.pageId })),
    // Chi giu nhan vien sale da chon (rong = hien tat ca); allStaff de admin chon lai
    rows: staffIds.length ? rows.filter(row => staffIds.includes(row.id)) : rows,
    allStaff: rows.map(row => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    staffIds,
    hasShiftSchedule: Object.keys(shiftSchedules || {}).length > 0,
    // Tuan trong khoang chua co lich rieng (dang dung tam lich tuan sourceWeek)
    borrowedShiftWeeks: borrowedWeeks,
    posOrdersTotal: posOrders.total,
    posOrdersWithoutSeller: posOrders.withoutSeller,
    errors,
    ...(debug ? { rawSample } : {})
  };
}

module.exports = {
  MAX_RANGE_DAYS,
  buildSaleStaffStats,
  countScheduledShifts,
  mondayOf,
  resolveWeekSchedule,
  summarizePageStats
};
