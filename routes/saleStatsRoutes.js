'use strict';

const express = require('express');
const Config = require('../models/Config');
const { getAppConfig, clearAppConfigCache } = require('../services/configService');
const { buildSaleStaffStats } = require('../services/pancakePageStatsService');
const { isAdminUser, requireAdminUser } = require('../utils/authUtils');
const { todayStr } = require('../utils/timeUtils');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGES = 50;

function getStoredPages(config = {}) {
  return (Array.isArray(config.pancakeStatsPages) ? config.pancakeStatsPages : [])
    .filter(page => page && page.pageId);
}

// Id nhan vien Pancake duoc tinh la sale (rong = hien tat ca nhan vien co hoat dong)
function getSaleStaffIds(config = {}) {
  return (Array.isArray(config.saleStaffIds) ? config.saleStaffIds : []).map(String).filter(Boolean);
}

// Body: { staffIds: [id Pancake] } - chi admin
router.put('/sale-staff', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const staffIds = [...new Set((Array.isArray(req.body?.staffIds) ? req.body.staffIds : [])
      .map(id => String(id || '').trim())
      .filter(id => /^[\w-]{6,64}$/.test(id)))].slice(0, 500);
    await Config.updateOne(
      { key: 'app' },
      { $set: { saleStaffIds: staffIds, updatedAt: new Date() } },
      { upsert: true }
    );
    clearAppConfigCache();
    res.json({ staffIds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Khong tra token ra client, chi 4 ky tu cuoi de nhan biet
function maskPages(pages) {
  return pages.map(page => ({
    pageId: page.pageId,
    name: page.name || '',
    hasToken: Boolean(page.accessToken),
    tokenHint: page.accessToken ? `...${String(page.accessToken).slice(-4)}` : ''
  }));
}

// GET /api/sale-stats/staff?fromDate=&toDate=&pageId=&fresh=1&debug=1 (fresh=1 bo cache 5 phut)
router.get('/staff', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || todayStr()).trim();
    const toDate = String(req.query.toDate || fromDate).trim();
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
      return res.status(400).json({ error: 'fromDate/toDate phai dang YYYY-MM-DD' });
    }
    const config = await getAppConfig();
    const pages = getStoredPages(config);
    if (!pages.length) {
      return res.json({ fromDate, toDate, pages: [], rows: [], errors: [], needsSetup: true });
    }
    const report = await buildSaleStaffStats({
      pages,
      fromDate,
      toDate,
      pageId: String(req.query.pageId || '').trim(),
      staffIds: getSaleStaffIds(config),
      fresh: req.query.fresh === '1',
      // response tho chi cho admin (de doi chieu ten truong khi Pancake doi format)
      debug: req.query.debug === '1' && isAdminUser(req.currentUser)
    });
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/pages', async (req, res) => {
  try {
    res.json({ pages: maskPages(getStoredPages(await getAppConfig())) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Body: { pages: [{ pageId, name, accessToken }] }. accessToken rong = giu token cu cua page do.
router.put('/pages', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const input = Array.isArray(req.body?.pages) ? req.body.pages.slice(0, MAX_PAGES) : [];
    const current = new Map(getStoredPages(await getAppConfig({ fresh: true })).map(page => [page.pageId, page]));
    const pages = [];
    const seen = new Set();
    for (const item of input) {
      const pageId = String(item?.pageId || '').trim();
      if (!/^\d{5,25}$/.test(pageId) || seen.has(pageId)) continue;
      seen.add(pageId);
      const accessToken = String(item?.accessToken || '').trim() || current.get(pageId)?.accessToken || '';
      pages.push({ pageId, name: String(item?.name || '').trim().slice(0, 100), accessToken });
    }
    await Config.updateOne(
      { key: 'app' },
      { $set: { pancakeStatsPages: pages, updatedAt: new Date() } },
      { upsert: true }
    );
    clearAppConfigCache();
    res.json({ pages: maskPages(pages) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
