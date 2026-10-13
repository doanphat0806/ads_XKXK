'use strict';

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const CampaignRule = require('../models/CampaignRule');
const { withUserFilter } = require('../services/userService');
const { normalizeCampaignRuleLimits } = require('../utils/campaignRuleLimits');

const router = express.Router();
const CAMPAIGN_RULE_MODES = new Set(['skip', 'custom']);

async function findOwnedAccount(req, res) {
  const { accountId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    res.status(404).json({ error: 'Khong tim thay tai khoan' });
    return null;
  }
  const account = await Account.findOne(withUserFilter(req, { _id: accountId })).select('_id ownerUserId').lean();
  if (!account) res.status(404).json({ error: 'Khong tim thay tai khoan' });
  return account;
}

/**
 * GET /api/campaign-rules - danh sach quy tac rieng cua cac camp (theo user)
 */
router.get('/', async (req, res) => {
  try {
    const filter = withUserFilter(req, {});
    if (req.query.accountId && mongoose.Types.ObjectId.isValid(req.query.accountId)) {
      filter.accountId = req.query.accountId;
    }
    const rules = await CampaignRule.find(filter).sort({ updatedAt: -1 }).lean();
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
      ownerUserId: account.ownerUserId || req.currentUser?._id,
      campaignName: String(body.campaignName || '').slice(0, 500),
      mode,
      limits: mode === 'custom' ? normalizeCampaignRuleLimits(body.limits) : {},
      updatedAt: new Date()
    };
    if (mode === 'custom' && Object.keys(update.limits).length === 0) {
      return res.status(400).json({ error: 'Nhap it nhat 1 nguong rieng, hoac chon "Bo qua auto"' });
    }

    const rule = await CampaignRule.findOneAndUpdate(
      { accountId: account._id, campaignId },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/campaign-rules/:accountId/:campaignId - xoa quy tac, camp quay ve cau hinh chung
 */
router.delete('/:accountId/:campaignId', async (req, res) => {
  try {
    const account = await findOwnedAccount(req, res);
    if (!account) return;
    await CampaignRule.deleteOne({ accountId: account._id, campaignId: String(req.params.campaignId || '').trim() });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
