'use strict';

// VIA = tai khoan Facebook ca nhan da dang nhap (FbProfile). Moi VIA giu token rieng,
// tai khoan quang cao nhap tu VIA nao thi dung token cua VIA do.

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const FbProfile = require('../models/FbProfile');
const { fetchAllFbEdge } = require('../utils/fbApi');
const { clearAllReadCache } = require('../utils/cacheManager');
const { getAppConfig } = require('../services/configService');
const {
  normalizeProvider,
  buildAccountProviderFilter,
  isShopeeAdAccountName,
  normalizeAdAccountId
} = require('../lib/normalizers');

const router = express.Router();

const AD_ACCOUNT_STATUS_LABELS = {
  1: 'Hoạt động',
  2: 'Vô hiệu hóa',
  3: 'Chưa thanh toán',
  7: 'Đang xét duyệt',
  8: 'Chờ quyết toán',
  9: 'Trong thời gian ân hạn',
  100: 'Chờ đóng',
  101: 'Đã đóng'
};

function adAccountIdVariants(actId) {
  const id = normalizeAdAccountId(actId);
  return [id, id.replace(/^act_/, '')];
}

async function findOwnedProfile(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404).json({ error: 'Khong tim thay VIA' });
    return null;
  }
  const profile = await FbProfile.findOne({ _id: req.params.id, ownerUserId: req.currentUser._id }).lean();
  if (!profile) res.status(404).json({ error: 'Khong tim thay VIA' });
  return profile;
}

/**
 * GET /api/fb-profiles - danh sach VIA (khong tra token)
 */
router.get('/', async (req, res) => {
  try {
    const profiles = await FbProfile.find({ ownerUserId: req.currentUser._id })
      .select('-token')
      .sort({ lastLoginAt: -1 })
      .lean();
    const counts = await Account.aggregate([
      { $match: { ownerUserId: req.currentUser._id, fbProfileId: { $in: profiles.map(p => p._id) } } },
      { $group: { _id: '$fbProfileId', count: { $sum: 1 } } }
    ]);
    const countById = new Map(counts.map(row => [String(row._id), row.count]));
    res.json(profiles.map(profile => ({
      ...profile,
      accountCount: countById.get(String(profile._id)) || 0,
      expired: Boolean(profile.expiresAt && new Date(profile.expiresAt).getTime() < Date.now())
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/fb-profiles/:id/adaccounts?provider=facebook - TKQC ma VIA nay truy cap duoc
 */
router.get('/:id/adaccounts', async (req, res) => {
  try {
    const profile = await findOwnedProfile(req, res);
    if (!profile) return;
    const provider = normalizeProvider(req.query.provider);

    const { items } = await fetchAllFbEdge(profile.token, 'me/adaccounts', {
      fields: 'name,account_id,account_status,currency,business{id,name}',
      limit: 200
    }, { maxPages: 50, pageTimeoutMs: 20000, requestOptions: { retries: 1, rateLimitRetries: 1 } });

    const existing = await Account.find(
      { ownerUserId: req.currentUser._id, ...buildAccountProviderFilter(provider) },
      'adAccountId fbProfileId'
    ).lean();
    const existingById = new Map();
    for (const account of existing) {
      existingById.set(normalizeAdAccountId(account.adAccountId), account);
    }

    const seen = new Set();
    const adAccounts = [];
    for (const item of items) {
      const actId = normalizeAdAccountId(item.account_id || item.id);
      if (!actId || seen.has(actId)) continue;
      seen.add(actId);
      const isShopeeName = isShopeeAdAccountName(item.name);
      if (provider === 'shopee' ? !isShopeeName : isShopeeName) continue;
      const existingAccount = existingById.get(actId);
      adAccounts.push({
        adAccountId: actId,
        name: String(item.name || `Account ${item.account_id}`),
        status: Number(item.account_status || 0),
        statusLabel: AD_ACCOUNT_STATUS_LABELS[item.account_status] || `Mã ${item.account_status}`,
        currency: item.currency || '',
        businessName: item.business?.name || '',
        exists: Boolean(existingAccount),
        usesThisVia: Boolean(existingAccount && String(existingAccount.fbProfileId || '') === String(profile._id))
      });
    }

    adAccounts.sort((a, b) => Number(a.exists) - Number(b.exists) || (a.status === 1 ? -1 : 0) - (b.status === 1 ? -1 : 0) || a.name.localeCompare(b.name));
    res.json({ profile: { _id: profile._id, name: profile.name }, provider, totalFetched: items.length, adAccounts });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/fb-profiles/:id/import { provider, adAccountIds: [] }
 * Tao TKQC moi dung token cua VIA; TKQC da co duoc chuyen sang dung VIA nay.
 */
router.post('/:id/import', async (req, res) => {
  try {
    const profile = await findOwnedProfile(req, res);
    if (!profile) return;
    const provider = normalizeProvider(req.body.provider);
    const requested = Array.isArray(req.body.adAccountIds) ? req.body.adAccountIds : [];
    const ids = [...new Set(requested.map(normalizeAdAccountId).filter(id => /^act_\d+$/.test(id)))];
    if (!ids.length) return res.status(400).json({ error: 'Chua chon tai khoan quang cao nao' });

    // Chi nhan TKQC ma VIA nay that su truy cap duoc
    const { items } = await fetchAllFbEdge(profile.token, 'me/adaccounts', {
      fields: 'name,account_id',
      limit: 200
    }, { maxPages: 50, pageTimeoutMs: 20000, requestOptions: { retries: 1, rateLimitRetries: 1 } });
    const reachable = new Map(items.map(item => [normalizeAdAccountId(item.account_id || item.id), item]));

    const config = await getAppConfig();
    const viaToken = provider === 'facebook' ? profile.token : '';
    const created = [];
    const switched = [];
    const skipped = [];

    for (const actId of ids) {
      const fbItem = reachable.get(actId);
      if (!fbItem) {
        skipped.push({ adAccountId: actId, error: 'VIA này không có quyền với TKQC này' });
        continue;
      }
      const name = String(fbItem.name || `Account ${fbItem.account_id}`).trim();
      const existing = await Account.findOne({
        ownerUserId: req.currentUser._id,
        ...buildAccountProviderFilter(provider),
        adAccountId: { $in: adAccountIdVariants(actId) }
      });

      if (existing) {
        existing.fbProfileId = profile._id;
        if (viaToken) existing.fbToken = viaToken;
        await existing.save();
        switched.push({ id: existing._id, name: existing.name, adAccountId: actId });
        continue;
      }

      const account = await Account.create({
        ownerUserId: req.currentUser._id,
        name,
        provider,
        fbToken: viaToken,
        fbProfileId: profile._id,
        adAccountId: actId,
        geminiKey: String(config?.geminiKey || '').trim(),
        spendThreshold: 20000,
        checkInterval: 60,
        autoEnabled: false,
        linkedPageIds: []
      });
      created.push({ id: account._id, name, adAccountId: actId });
    }

    clearAllReadCache();
    res.json({
      ok: true,
      created,
      switched,
      skipped,
      message: `VIA ${profile.name}: thêm mới ${created.length}, chuyển sang VIA này ${switched.length}${skipped.length ? `, bỏ qua ${skipped.length}` : ''}.`
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/fb-profiles/:id - xoa VIA. TKQC giu nguyen token hien tai (chay den khi token het han).
 */
router.delete('/:id', async (req, res) => {
  try {
    const profile = await findOwnedProfile(req, res);
    if (!profile) return;
    await Account.updateMany(
      { ownerUserId: req.currentUser._id, fbProfileId: profile._id },
      { $unset: { fbProfileId: 1 } }
    );
    await FbProfile.deleteOne({ _id: profile._id });
    clearAllReadCache();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
