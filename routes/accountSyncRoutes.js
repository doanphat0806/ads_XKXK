'use strict';

// GET /api/account-sync/progress?provider=facebook|shopee
// Tra tien do dong bo lich su cua tung TKQC (cua user hien tai) de tab "Tai khoan quang cao" ve thanh %.

const express = require('express');
const Account = require('../models/Account');
const { withUserFilter } = require('../services/userService');
const { buildAccountProviderFilter, normalizeProvider } = require('../lib/normalizers');
const { getAccountSyncProgress } = require('../services/accountSyncProgressService');

const router = express.Router();

router.get('/progress', async (req, res) => {
  try {
    const provider = String(req.query.provider || '').trim();
    const filter = withUserFilter(req, provider ? buildAccountProviderFilter(normalizeProvider(provider)) : {});
    const accounts = await Account.find(filter).select('_id').lean();
    const progress = getAccountSyncProgress(accounts.map(account => account._id));
    res.json({ progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
