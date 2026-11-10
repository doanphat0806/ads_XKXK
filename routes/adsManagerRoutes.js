'use strict';

// Trinh quan ly quang cao: tach 1 camp ra nhom quang cao (adset) / quang cao (ad) / bai viet.
// Doc tu MongoDB (services/adObjectService.js), chi goi Facebook khi du lieu chua co / da cu.
// Bai viet = gom cac quang cao theo effective_object_story_id (client tu gom tu danh sach ad).

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const { withUserFilter } = require('../services/userService');
const { getAdObjects, getAccountFbToken, normalizeAdAccountId, updateAdObjectStatus } = require('../services/adObjectService');
const { fbGet, fbPost, mapWithConcurrency } = require('../utils/fbApi');
const { clearCampaignReadCache } = require('../utils/cacheManager');
const { todayStr } = require('../utils/timeUtils');
const { buildAccountProviderFilter } = require('../lib/normalizers');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FB_ID_RE = /^\d{1,32}$/;
const MAX_CAMPAIGNS = 5000;
const MAX_RANGE_DAYS = 400;
const LEVELS = new Set(['adset', 'ad']);
const ALLOWED_STATUSES = new Set(['ACTIVE', 'PAUSED']);

function parseCampaignItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const seen = new Set();
  const items = [];
  for (const raw of rawItems) {
    const accountId = String(raw?.accountId || '').trim();
    const campaignId = String(raw?.campaignId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(accountId) || !FB_ID_RE.test(campaignId)) continue;
    const key = `${accountId}:${campaignId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ accountId, campaignId });
  }
  return items;
}

// POST /api/ads-manager/children
// { level: 'adset' | 'ad', fromDate, toDate, items?: [{ accountId, campaignId }], accountId?, refresh?: true }
// Khong co items -> tat ca nhom QC / quang cao cua moi tai khoan Facebook (hoac chi accountId neu co)
// -> { rows, errors, refreshing } ; refreshing = dang lam moi ngam, goi lai sau vai giay de lay so moi
router.post('/children', async (req, res) => {
  const startedAt = Date.now();
  try {
    const level = String(req.body?.level || '').trim();
    if (!LEVELS.has(level)) return res.status(400).json({ error: 'level phai la adset hoac ad' });
    const fromDate = String(req.body?.fromDate || todayStr()).trim();
    const toDate = String(req.body?.toDate || fromDate).trim();
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return res.status(400).json({ error: 'Ngay khong hop le' });
    if (fromDate > toDate) return res.status(400).json({ error: '"fromDate" phai truoc "toDate"' });
    const rangeDays = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;
    if (rangeDays > MAX_RANGE_DAYS) return res.status(400).json({ error: `Toi da ${MAX_RANGE_DAYS} ngay` });

    const items = parseCampaignItems(req.body?.items);
    if (items.length > MAX_CAMPAIGNS) return res.status(400).json({ error: `Chi chon toi da ${MAX_CAMPAIGNS} camp` });
    const onlyAccountId = String(req.body?.accountId || '').trim();
    if (onlyAccountId && !mongoose.Types.ObjectId.isValid(onlyAccountId)) return res.status(400).json({ error: 'accountId khong hop le' });

    // Chi lay tai khoan Facebook cua user hien tai
    const accountFilter = { ...buildAccountProviderFilter('facebook') };
    if (items.length) accountFilter._id = { $in: [...new Set(items.map(item => item.accountId))] };
    else if (onlyAccountId) accountFilter._id = onlyAccountId;
    const accounts = (await Account.find(withUserFilter(req, accountFilter))
      .select('_id name adAccountId provider fbToken ownerUserId')
      .lean()).filter(account => account.adAccountId);
    const ownedIds = new Set(accounts.map(account => String(account._id)));

    // Map<accountId, campaignIds[] | null> (null = tat ca camp cua tai khoan)
    const campaignIdsByAccount = new Map();
    if (items.length) {
      for (const item of items) {
        if (!ownedIds.has(item.accountId)) continue;
        if (!campaignIdsByAccount.has(item.accountId)) campaignIdsByAccount.set(item.accountId, []);
        campaignIdsByAccount.get(item.accountId).push(item.campaignId);
      }
    } else {
      for (const accountId of ownedIds) campaignIdsByAccount.set(accountId, null);
    }

    const result = await getAdObjects(level, accounts, campaignIdsByAccount, {
      fromDate,
      toDate,
      forceRefresh: req.body?.refresh === true
    });
    console.log(`[ads-manager:${level}] ${fromDate}..${toDate} campaigns=${items.length || 'tat ca'} accounts=${campaignIdsByAccount.size} rows=${result.rows.length} errors=${result.errors.length}${result.refreshing ? ' (lam moi ngam)' : ''} ${Date.now() - startedAt}ms`);
    res.json(result);
  } catch (error) {
    console.error(`[ads-manager] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ---- Thanh toan TKQC: nguong thanh toan / tong chi tieu / so du (lay tu Facebook) ----
// Facebook tra so tien theo don vi nho nhat cua tien te (USD = cent), VND/JPY... khong co phan le.
const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'PYG', 'TWD', 'UGX']);
const BILLING_CACHE_MS = 5 * 60 * 1000;
const billingCache = new Map(); // accountId -> { at, data }

function toMajorAmount(value, currency) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return ZERO_DECIMAL_CURRENCIES.has(String(currency || '').toUpperCase()) ? num : num / 100;
}

async function fetchAccountBilling(account) {
  const fbToken = await getAccountFbToken(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');
  const actId = normalizeAdAccountId(account.adAccountId);
  // Luu y: Graph API (v21+) da bo truong adspaymentcycle nen khong lay duoc nguong thanh toan
  const info = await fbGet(fbToken, actId, {
    fields: 'currency,amount_spent,balance,spend_cap,account_status,is_prepay_account'
  }, { retries: 1, rateLimitRetries: 1 });
  const currency = info?.currency || '';
  const spendCap = toMajorAmount(info?.spend_cap, currency);
  return {
    currency,
    isPrepay: Boolean(info?.is_prepay_account),
    amountSpent: toMajorAmount(info?.amount_spent, currency), // tong chi tieu tron doi TK
    balance: toMajorAmount(info?.balance, currency), // so du chua thanh toan
    spendCap: spendCap && spendCap > 0 ? spendCap : null, // gioi han chi tieu TK (0 = khong gioi han)
    accountStatus: info?.account_status ?? null
  };
}

// GET /api/ads-manager/account-billing?provider=facebook&refresh=1
router.get('/account-billing', async (req, res) => {
  try {
    const provider = String(req.query.provider || '').trim();
    const refresh = req.query.refresh === '1';
    const filter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const accounts = await Account.find(filter).select('_id adAccountId fbToken ownerUserId').lean();
    const now = Date.now();
    const billing = {};

    await mapWithConcurrency(accounts, async account => {
      const key = String(account._id);
      const cached = billingCache.get(key);
      if (!refresh && cached && now - cached.at < BILLING_CACHE_MS) {
        billing[key] = cached.data;
        return;
      }
      try {
        const data = await fetchAccountBilling(account);
        billingCache.set(key, { at: Date.now(), data });
        billing[key] = data;
      } catch (error) {
        // Loi thi tra du lieu cu (neu co) kem thong bao loi
        billing[key] = { ...(cached?.data || {}), error: error.message };
      }
    }, 4);

    res.json({ billing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// POST /api/ads-manager/status { accountId, objectId, status: 'ACTIVE' | 'PAUSED' } - bat/tat nhom QC hoac quang cao
router.post('/status', async (req, res) => {
  try {
    const accountId = String(req.body?.accountId || '').trim();
    const objectId = String(req.body?.objectId || '').trim();
    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!mongoose.Types.ObjectId.isValid(accountId) || !FB_ID_RE.test(objectId)) {
      return res.status(400).json({ error: 'Thieu accountId / objectId' });
    }
    if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ error: 'status phai la ACTIVE hoac PAUSED' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }))
      .select('_id name adAccountId fbToken ownerUserId')
      .lean();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const fbToken = await getAccountFbToken(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    // Doi tuong phai thuoc dung tai khoan quang cao cua user
    const target = await fbGet(fbToken, objectId, { fields: 'account_id' });
    if (normalizeAdAccountId(target?.account_id) !== normalizeAdAccountId(account.adAccountId)) {
      return res.status(403).json({ error: 'Doi tuong khong thuoc tai khoan nay' });
    }

    await fbPost(fbToken, objectId, { status });
    await updateAdObjectStatus(objectId, status);
    clearCampaignReadCache();
    res.json({ ok: true, status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
