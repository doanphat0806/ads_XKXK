'use strict';

const express = require('express');
const Account = require('../models/Account');
const { withUserFilter } = require('../services/userService');
const { getCampaignMinuteWindow, parseTimeOfDay } = require('../services/campaignSnapshotService');
const { buildAccountProviderFilter } = require('../lib/normalizers');
const { getReadCache, setReadCache } = require('../utils/cacheManager');
const { todayStr } = require('../utils/timeUtils');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_SPEND_MAX_DAYS = 7;

// Chi tieu/don Meta... theo khung gio:phut, tinh tu snapshot luu sau moi lan sync
// (do chi tiet = chu ky sync). Chi co so lieu tu luc bat dau luu snapshot.
router.get('/minute-spend', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { provider } = req.query;
    const fromDate = String(req.query.fromDate || todayStr()).trim();
    const toDate = String(req.query.toDate || req.query.fromDate || todayStr()).trim();
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return res.status(400).json({ error: 'Ngay khong hop le' });
    if (fromDate > toDate) return res.status(400).json({ error: '"fromDate" phai truoc "toDate"' });
    const rangeDays = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;
    if (rangeDays > MINUTE_SPEND_MAX_DAYS) {
      return res.status(400).json({ error: `Chi tieu theo phut chi ho tro toi da ${MINUTE_SPEND_MAX_DAYS} ngay` });
    }
    let fromTime = parseTimeOfDay(req.query.fromTime, '00:00');
    let toTime = parseTimeOfDay(req.query.toTime, '23:59');
    if (fromTime > toTime) [fromTime, toTime] = [toTime, fromTime];

    const cacheKey = `${req.currentUser?._id || 'public'}:minute-spend:${provider || 'all'}:${fromDate}:${toDate}:${fromTime}:${toTime}`;
    const cached = getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const accountFilter = provider ? buildAccountProviderFilter(provider) : {};
    const accounts = await Account.find(withUserFilter(req, accountFilter)).select('_id name').lean();
    const window = await getCampaignMinuteWindow({ accounts, fromDate, toDate, fromTime, toTime });

    const result = { fromDate, toDate, fromTime, toTime, ...window };
    console.log(`[campaigns:minute-spend] provider=${provider || 'all'} ${fromDate}..${toDate} ${fromTime}-${toTime} accounts=${accounts.length} ${Date.now() - startedAt}ms`);
    res.json(setReadCache(cacheKey, result));
  } catch (error) {
    console.error(`[campaigns:minute-spend] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
