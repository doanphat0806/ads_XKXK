'use strict';

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const CampaignRule = require('../models/CampaignRule');
const { withUserFilter } = require('../services/userService');
const { normalizeAdAccountId } = require('../lib/normalizers');
const { normalizeCampaignRuleLimits } = require('../utils/campaignRuleLimits');

const router = express.Router();
const CAMPAIGN_RULE_MODES = new Set(['skip', 'custom']);

// Quy tac dung chung theo TKQC: user thay/sua duoc quy tac cua moi TKQC ma user co
async function getUserAdAccountIds(req) {
  const accounts = await Account.find(withUserFilter(req, {})).select('adAccountId').lean();
  return [...new Set(accounts.map(account => normalizeAdAccountId(account.adAccountId)).filter(Boolean))];
}

async function findOwnedAccount(req, res) {
  const { accountId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    res.status(404).json({ error: 'Khong tim thay tai khoan' });
    return null;
  }
  const account = await Account.findOne(withUserFilter(req, { _id: accountId })).select('_id adAccountId').lean();
  const adAccountId = normalizeAdAccountId(account?.adAccountId);
  if (!account || !adAccountId) {
    res.status(404).json({ error: 'Khong tim thay tai khoan' });
    return null;
  }
  return { ...account, adAccountId };
}

function getUserDisplayName(user = {}) {
  return String(user.displayName || user.username || '').slice(0, 100);
}

/**
 * GET /api/campaign-rules - quy tac rieng cua cac camp thuoc TKQC ma user co (dung chung giua cac user)
 */
router.get('/', async (req, res) => {
  try {
    let adAccountIds = await getUserAdAccountIds(req);
    if (req.query.accountId && mongoose.Types.ObjectId.isValid(req.query.accountId)) {
      const account = await Account.findOne(withUserFilter(req, { _id: req.query.accountId })).select('adAccountId').lean();
      const adAccountId = normalizeAdAccountId(account?.adAccountId);
      adAccountIds = adAccountId ? [adAccountId] : [];
    }
    if (!adAccountIds.length) return res.json([]);
    const rules = await CampaignRule.find({ adAccountId: { $in: adAccountIds } }).sort({ updatedAt: -1 }).lean();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/campaign-rules/:accountId/:campaignId - tao/cap nhat quy tac cho 1 camp
 */
router.put('/:accountId/:campaignId', async (req, res) => {
  try {
    const account = await findOwnedAccount(req, res);
    if (!account) return;

    const campaignId = String(req.params.campaignId || '').trim();
    if (!/^\d+$/.test(campaignId)) {
      return res.status(400).json({ error: 'Campaign ID khong hop le' });
    }

    const body = req.body || {};
    const mode = String(body.mode || '').trim();
    if (!CAMPAIGN_RULE_MODES.has(mode)) {
      return res.status(400).json({ error: 'Che do quy tac khong hop le' });
    }

    const update = {
      accountId: account._id,
      campaignName: String(body.campaignName || '').slice(0, 500),
      mode,
      limits: mode === 'custom' ? normalizeCampaignRuleLimits(body.limits) : {},
      updatedBy: { userId: req.currentUser?._id, name: getUserDisplayName(req.currentUser) },
      updatedAt: new Date()
    };
    if (mode === 'custom' && Object.keys(update.limits).length === 0) {
      return res.status(400).json({ error: 'Nhap it nhat 1 nguong rieng, hoac chon "Bo qua auto"' });
    }

    const rule = await CampaignRule.findOneAndUpdate(
      { adAccountId: account.adAccountId, campaignId },
      { $set: update, $setOnInsert: { ownerUserId: req.currentUser?._id, createdAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/campaign-rules/:accountId/:campaignId - xoa quy tac, camp quay ve cau hinh chung (cho moi user)
 */
router.delete('/:accountId/:campaignId', async (req, res) => {
  try {
    const account = await findOwnedAccount(req, res);
    if (!account) return;
    await CampaignRule.deleteOne({ adAccountId: account.adAccountId, campaignId: String(req.params.campaignId || '').trim() });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
