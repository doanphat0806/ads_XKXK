'use strict';

const express = require('express');
const Config = require('../models/Config');
const User = require('../models/User');
const { clearAllReadCache } = require('../utils/cacheManager');
const {
  AUTO_PAUSE_CPO_LIMIT,
  AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT,
  AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT,
  getAppConfig,
  clearAppConfigCache,
  mergeAutoConfig,
  getShopeeAutoMinSpendLimit
} = require('../services/configService');

const router = express.Router();
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

router.get('/config', async (req, res) => {
  try {
    const config = await getAppConfig();
    const user = await User.findById(req.currentUser._id).select(
      'fbToken fbTokenExpiresAt fbTokenLastRefreshTime fbTokenLastDebugTime fbTokenLastRefreshError ' +
      'autoRuleStartTime autoRuleEndTime shopeeAutoRuleStartTime shopeeAutoRuleEndTime scheduledDuplicatePauseTime ' +
      'dailyZeroMessageSpendLimit dailyOneMessageSpendLimit dailyFewMessageThreshold dailyFewMessageSpendLimit dailyCheapMessageCostLimit dailyCheapMessageSpendLimit dailyHighCostPerMessageLimit dailyHighCostSpendLimit ' +
      'dailyClickLimit dailyCpcLimit lifetimeZeroMessageSpendLimit lifetimeOneMessageSpendLimit lifetimeFewMessageThreshold lifetimeFewMessageSpendLimit lifetimeCheapMessageCostLimit lifetimeCheapMessageSpendLimit lifetimeHighCostPerMessageLimit ' +
      'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit autoPauseCpoLimitLifetime autoPauseMultiOrderThreshold autoPauseMultiOrderThresholdLifetime autoPauseMultiOrderCpoLimit autoPauseMultiOrderCpoLimitLifetime autoPauseZeroOrderSpendLimit autoPauseZeroOrderSpendLimitLifetime autoPauseShopeeMinSpendLimit autoPauseShopeeHhAdsPercent'
    ).lean();
    const autoConfig = mergeAutoConfig(config || {}, user || {});

    res.json({
      hasFbToken: Boolean(user?.fbToken || config?.fbToken),
      fbTokenExpiresAt: user?.fbTokenExpiresAt || config?.fbTokenExpiresAt || null,
      fbTokenLastRefreshTime: user?.fbTokenLastRefreshTime || config?.fbTokenLastRefreshTime || null,
      fbTokenLastDebugTime: user?.fbTokenLastDebugTime || config?.fbTokenLastDebugTime || null,
      fbTokenLastRefreshError: user?.fbTokenLastRefreshError || config?.fbTokenLastRefreshError || '',
      hasGeminiKey: Boolean(config?.geminiKey),
      hasClaudeKey: Boolean(config?.claudeKey),
      hasFbAppId: Boolean(config?.fbAppId),
      hasFbAppSecret: Boolean(config?.fbAppSecret),
      hasPancakeApiKey: Boolean(config?.pancakeApiKey),
      hasPancakeShopId: Boolean(config?.pancakeShopId),
      pancakeShopId: config?.pancakeShopId || '',
      ...autoConfig
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    const updates = { updatedAt: new Date() };
    if (typeof req.body.geminiKey === 'string' && req.body.geminiKey.trim()) updates.geminiKey = req.body.geminiKey.trim();
    if (typeof req.body.claudeKey === 'string' && req.body.claudeKey.trim()) updates.claudeKey = req.body.claudeKey.trim();
    if (typeof req.body.fbAppId === 'string' && req.body.fbAppId.trim()) updates.fbAppId = req.body.fbAppId.trim();
    if (typeof req.body.fbAppSecret === 'string' && req.body.fbAppSecret.trim()) updates.fbAppSecret = req.body.fbAppSecret.trim();
    if (typeof req.body.pancakeApiKey === 'string' && req.body.pancakeApiKey.trim()) updates.pancakeApiKey = req.body.pancakeApiKey.trim();
    if (typeof req.body.pancakeShopId === 'string' && req.body.pancakeShopId.trim()) updates.pancakeShopId = req.body.pancakeShopId.trim();

    const config = await Config.findOneAndUpdate(
      { key: 'app' },
      { $set: updates, $setOnInsert: { key: 'app' } },
      { upsert: true, new: true }
    );
    clearAppConfigCache();

    // Luu key Pancake khi server da khoi dong ma chua co key -> bat dong bo POS ngay, khong can restart
    if (updates.pancakeApiKey) {
      require('../services/posOrderService').startPosOrderSync()
        .catch(error => console.error(`[pos-orders] khoi dong dong bo loi: ${error.message}`));
    }

    if (typeof req.body.fbToken === 'string' && req.body.fbToken.trim()) {
      await User.findByIdAndUpdate(req.currentUser._id, {
        fbToken: req.body.fbToken.trim(),
        fbTokenLastRefreshTime: new Date(),
        fbTokenLastRefreshError: '',
        updatedAt: new Date()
      });
      clearAllReadCache();
    }

    res.json({
      ok: true,
      hasFbToken: Boolean(req.body.fbToken?.trim() || config.fbToken),
      hasGeminiKey: Boolean(config.geminiKey),
      hasClaudeKey: Boolean(config.claudeKey),
      hasFbAppId: Boolean(config.fbAppId),
      hasFbAppSecret: Boolean(config.fbAppSecret),
      hasPancakeApiKey: Boolean(config.pancakeApiKey),
      hasPancakeShopId: Boolean(config.pancakeShopId)
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/auto-limits', async (req, res) => {
  try {
    const limits = {
      dailyZeroMessageSpendLimit: Number(req.body.dailyZeroMessageSpendLimit),
      dailyOneMessageSpendLimit: Number(req.body.dailyOneMessageSpendLimit),
      dailyFewMessageThreshold: Number(req.body.dailyFewMessageThreshold || 0),
      dailyFewMessageSpendLimit: Number(req.body.dailyFewMessageSpendLimit || 0),
      dailyCheapMessageCostLimit: Number(req.body.dailyCheapMessageCostLimit || 0),
      dailyCheapMessageSpendLimit: Number(req.body.dailyCheapMessageSpendLimit || 0),
      dailyHighCostPerMessageLimit: Number(req.body.dailyHighCostPerMessageLimit),
      dailyHighCostSpendLimit: Number(req.body.dailyHighCostSpendLimit),
      dailyClickLimit: Number(req.body.dailyClickLimit || 0),
      dailyCpcLimit: Number(req.body.dailyCpcLimit || 0),
      lifetimeZeroMessageSpendLimit: Number(req.body.lifetimeZeroMessageSpendLimit),
      lifetimeOneMessageSpendLimit: Number(req.body.lifetimeOneMessageSpendLimit),
      lifetimeFewMessageThreshold: Number(req.body.lifetimeFewMessageThreshold || 0),
      lifetimeFewMessageSpendLimit: Number(req.body.lifetimeFewMessageSpendLimit || 0),
      lifetimeCheapMessageCostLimit: Number(req.body.lifetimeCheapMessageCostLimit || 0),
      lifetimeCheapMessageSpendLimit: Number(req.body.lifetimeCheapMessageSpendLimit || 0),
      lifetimeHighCostPerMessageLimit: Number(req.body.lifetimeHighCostPerMessageLimit),
      lifetimeHighCostSpendLimit: Number(req.body.lifetimeHighCostSpendLimit),
      lifetimeClickLimit: Number(req.body.lifetimeClickLimit || 0),
      lifetimeCpcLimit: Number(req.body.lifetimeCpcLimit || 0),
      autoPauseCpoLimit: Number(req.body.autoPauseCpoLimit ?? AUTO_PAUSE_CPO_LIMIT),
      autoPauseCpoLimitLifetime: Number(req.body.autoPauseCpoLimitLifetime ?? AUTO_PAUSE_CPO_LIMIT),
      autoPauseMultiOrderThreshold: Number(req.body.autoPauseMultiOrderThreshold ?? 2),
      autoPauseMultiOrderThresholdLifetime: Number(req.body.autoPauseMultiOrderThresholdLifetime ?? 2),
      autoPauseMultiOrderCpoLimit: Number(req.body.autoPauseMultiOrderCpoLimit || 0),
      autoPauseMultiOrderCpoLimitLifetime: Number(req.body.autoPauseMultiOrderCpoLimitLifetime || 0),
      autoPauseZeroOrderSpendLimit: Number(req.body.autoPauseZeroOrderSpendLimit ?? AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
      autoPauseZeroOrderSpendLimitLifetime: Number(req.body.autoPauseZeroOrderSpendLimitLifetime ?? AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
      autoPauseShopeeMinSpendLimit: getShopeeAutoMinSpendLimit({ autoPauseShopeeMinSpendLimit: req.body.autoPauseShopeeMinSpendLimit }),
      autoPauseShopeeHhAdsPercent: Number(req.body.autoPauseShopeeHhAdsPercent ?? AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT),
      updatedAt: new Date()
    };

    await User.findByIdAndUpdate(req.currentUser._id, { $set: limits }, { new: true });
    res.json({ ok: true, limits });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/scheduled-duplicate-pause-time', async (req, res) => {
  try {
    const pauseTime = String(req.body.pauseTime || '').trim();
    if (!timeRegex.test(pauseTime)) {
      return res.status(400).json({ error: 'Dinh dang thoi gian khong hop le (HH:MM)' });
    }

    await User.findByIdAndUpdate(
      req.currentUser._id,
      { $set: { scheduledDuplicatePauseTime: pauseTime, updatedAt: new Date() } },
      { new: true }
    );

    res.json({ ok: true, scheduledDuplicatePauseTime: pauseTime });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Phuong an cot Dashboard (dung chung trong 1 tai khoan dang nhap) ──
// Chi luu danh sach phuong an; cot dang hien / phuong an dang chon luu rieng tung may (localStorage)
// de nhieu nguoi dung chung 1 tai khoan khong ghi de lua chon cua nhau.
// Them / xoa tung phuong an (khong gui ca danh sach) -> 2 nguoi luu cung luc khong mat cua nhau.
const COLUMN_ID_REGEX = /^[A-Za-z0-9_]{1,64}$/;
const MAX_COLUMN_IDS = 300;
const MAX_COLUMN_PRESETS = 50;

function sanitizeColumnIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && COLUMN_ID_REGEX.test(id)))].slice(0, MAX_COLUMN_IDS);
}

function sanitizeColumnPreset(value = {}) {
  const name = typeof value?.name === 'string' ? value.name.trim().slice(0, 40) : '';
  if (!name) return null;
  return { name, order: sanitizeColumnIds(value.order), hidden: sanitizeColumnIds(value.hidden) };
}

async function getColumnPresets(userId) {
  const user = await User.findById(userId).select('dashboardColumns.presets').lean();
  const presets = user?.dashboardColumns?.presets;
  return Array.isArray(presets) ? presets : [];
}

router.get('/dashboard-columns', async (req, res) => {
  try {
    res.json({ ok: true, presets: await getColumnPresets(req.currentUser._id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Them hoac ghi de (trung ten) 1 phuong an
router.put('/dashboard-columns/presets', async (req, res) => {
  try {
    const preset = sanitizeColumnPreset(req.body);
    if (!preset) return res.status(400).json({ error: 'Thieu ten phuong an' });
    // Update pipeline: bo ban cu cung ten roi them ban moi trong 1 lenh (khong doc-sua-ghi)
    await User.updateOne({ _id: req.currentUser._id }, [{
      $set: {
        'dashboardColumns.presets': {
          $slice: [{
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$dashboardColumns.presets', []] },
                  cond: { $ne: ['$$this.name', preset.name] }
                }
              },
              [{ $literal: preset }]
            ]
          }, -MAX_COLUMN_PRESETS]
        },
        updatedAt: '$$NOW'
      }
    }]);
    res.json({ ok: true, presets: await getColumnPresets(req.currentUser._id) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/dashboard-columns/presets/:name', async (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    await User.updateOne(
      { _id: req.currentUser._id },
      { $pull: { 'dashboardColumns.presets': { name } }, $set: { updatedAt: new Date() } }
    );
    res.json({ ok: true, presets: await getColumnPresets(req.currentUser._id) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
