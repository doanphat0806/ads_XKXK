'use strict';

const express = require('express');
const Config = require('../models/Config');
const User = require('../models/User');
const { getAppConfig, clearAppConfigCache } = require('../services/configService');
const { getGoogleOAuthConfig, getGoogleAccessTokenForUser } = require('../utils/googleOAuth');
const {
  DEFAULT_LISTING_STAFF_NAMES,
  buildListingWeeklyReport,
  syncListingCodesFromSheet,
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
    res.json({ ...report, codeSheetSync: config.listingCodeSheetSync || null });
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

// Token Google: user hien tai truoc, khong co thi dung tai khoan admin (file ma la file chung). Khong co token -> doc CSV cong khai.
async function getListingSheetAccessToken(req) {
  const config = getGoogleOAuthConfig(req);
  if (!config.clientId || !config.clientSecret) return '';
  const admin = await User.findOne({ username: 'admin', active: true }).select('_id').lean();
  const userIds = [req.currentUser?._id, admin?._id].filter(Boolean);
  for (const userId of userIds) {
    try {
      const token = await getGoogleAccessTokenForUser(userId, config);
      if (token) return token;
    } catch {
      // user chua ket noi Google -> thu nguoi tiep theo
    }
  }
  return '';
}

// POST /api/listing/sync-sheet - doc file Google Sheet ma cua moi nguoi -> cap nhat ma dang theo tuan
router.post('/sync-sheet', async (req, res) => {
  try {
    const result = await syncListingCodesFromSheet({ accessToken: await getListingSheetAccessToken(req) });
    const syncMeta = {
      at: new Date().toISOString(),
      saved: result.saved,
      inserted: result.inserted,
      tabCount: result.tabs.length,
      source: result.source
    };
    await Config.updateOne(
      { key: 'app' },
      { $set: { listingCodeSheetSync: syncMeta, updatedAt: new Date() } },
      { upsert: true }
    );
    clearAppConfigCache();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
