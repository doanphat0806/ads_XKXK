'use strict';

const express = require('express');
const Config = require('../models/Config');
const { getAppConfig, clearAppConfigCache } = require('../services/configService');
const {
  DEFAULT_LISTING_STAFF_NAMES,
  buildListingWeeklyReport,
  upsertListingNewCodes
} = require('../services/listingService');

const router = express.Router();
const MAX_NEW_CODES_PER_UPLOAD = 20000;

function getStoredStaffNames(config = {}) {
  const value = config.listingStaffNames;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStaffNames(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([letter, name]) => [String(letter || '').trim().toUpperCase(), String(name ?? '').trim().slice(0, 60)])
      .filter(([letter]) => /^[A-Z]$/.test(letter))
  );
}

// GET /api/listing/weekly?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD (chia tuan 7 ngay tinh nguoc tu toDate)
router.get('/weekly', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();
    if ([fromDate, toDate].some(value => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      return res.status(400).json({ error: 'fromDate/toDate phai dang YYYY-MM-DD' });
    }
    const config = await getAppConfig();
    const report = await buildListingWeeklyReport({
      fromDate,
      toDate,
      staffNames: getStoredStaffNames(config)
    });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/staff', async (req, res) => {
  try {
    const config = await getAppConfig();
    res.json({ staffNames: { ...DEFAULT_LISTING_STAFF_NAMES, ...getStoredStaffNames(config) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Luu ca map chu cai -> ten. Ten rong = an ten (hien "Chua gan ten"). $set 1 truong nen khong de len cac truong Config khac.
router.put('/staff', async (req, res) => {
  try {
    const staffNames = normalizeStaffNames(req.body?.staffNames);
    await Config.updateOne(
      { key: 'app' },
      { $set: { listingStaffNames: staffNames, updatedAt: new Date() } },
      { upsert: true }
    );
    clearAppConfigCache();
    res.json({ staffNames: { ...DEFAULT_LISTING_STAFF_NAMES, ...staffNames } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Body: { codes: [{ code, postedDate: 'YYYY-MM-DD' }] } - client da doc file Excel ma moi.
router.post('/new-codes', async (req, res) => {
  try {
    const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
    if (!codes.length) return res.status(400).json({ error: 'Khong co ma moi nao de luu' });
    if (codes.length > MAX_NEW_CODES_PER_UPLOAD) {
      return res.status(400).json({ error: `Toi da ${MAX_NEW_CODES_PER_UPLOAD} ma moi moi lan upload` });
    }
    res.json(await upsertListingNewCodes(codes));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
