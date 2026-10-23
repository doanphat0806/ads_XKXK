'use strict';

const Order = require('../models/Order');
const { buildOrderQuery } = require('./orderService');

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

/**
 * Thong ke nhan vien sale tu Pancake Pages cho cac page da cau hinh, gop theo nhan vien (id Pancake dung chung giua cac page).
 * debug=true tra kem response tho cua page dau tien de doi chieu.
 */
/**
 * Dem don POS theo nhan vien chot (rawData.seller_id) trong khoang ngay tao don, bo don huy/xoa nhu cac bao cao don khac.
 * withoutSeller: don chua co seller_id (don luu truoc khi them truong -> chay scripts/backfillPosSeller.js).
 */
async function countPosOrdersBySeller({ fromDate, toDate, pageId = '' }) {
  const match = buildOrderQuery({ fromDate, toDate });
  match['rawData.source'] = 'pancake_pos';
  if (pageId) match['rawData.page_id'] = pageId;

  const [result] = await Order.aggregate([
    { $match: match },
    {
      $facet: {
        sellers: [
          { $match: { 'rawData.seller_id': { $nin: [null, ''] } } },
          {
            $group: {
              _id: '$rawData.seller_id',
              orders: { $sum: 1 },
              name: { $last: '$rawData.seller_name' },
              avatar: { $last: '$rawData.seller_avatar' }
            }
          }
        ],
        total: [{ $count: 'count' }],
        withoutSeller: [
          // Chi don chua co truong seller_id (luu truoc khi them truong); don co seller_id rong = POS khong gan ai, backfill cung khong bo sung duoc
          { $match: { 'rawData.seller_id': { $exists: false } } },
          { $count: 'count' }
        ]
      }
    }
  ]);

  return {
    sellers: (result?.sellers || []).map(item => ({ id: item._id, orders: item.orders, name: item.name || '', avatar: item.avatar || '' })),
    total: result?.total?.[0]?.count || 0,
    withoutSeller: result?.withoutSeller?.[0]?.count || 0
  };
}

async function buildSaleStaffStats({ pages = [], fromDate, toDate, pageId = '', staffIds = [], debug = false, fresh = false }) {
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
      responseWeighted: 0,
      responseWeight: 0,
      pages: []
    });
  }

  const rows = [...byUser.values()]
    .map(({ responseWeighted, responseWeight, ...row }) => ({
      ...row,
      avgResponseSeconds: responseWeight > 0 ? responseWeighted / responseWeight : null
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
    posOrdersTotal: posOrders.total,
    posOrdersWithoutSeller: posOrders.withoutSeller,
    errors,
    ...(debug ? { rawSample } : {})
  };
}

module.exports = {
  MAX_RANGE_DAYS,
  buildSaleStaffStats,
  summarizePageStats
};
