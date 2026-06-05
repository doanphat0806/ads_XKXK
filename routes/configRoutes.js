'use strict';

const express = require('express');
const Config = require('../models/Config');
const User = require('../models/User');
const { clearAllReadCache } = require('../utils/cacheManager');
const { normalizeProvider } = require('../utils/authUtils');
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
      'lifetimeHighCostSpendLimit lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit autoPauseCpoLimitLifetime autoPauseZeroOrderSpendLimit autoPauseZeroOrderSpendLimitLifetime autoPauseShopeeMinSpendLimit autoPauseShopeeHhAdsPercent'
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

router.put('/auto-rules', async (req, res) => {
  try {
    const { startTime, endTime } = req.body;
    const provider = normalizeProvider(req.body.provider);
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Thieu startTime hoac endTime' });
    }
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ error: 'Dinh dang thoi gian khong hop le (HH:MM)' });
    }

    const timeUpdates = provider === 'shopee'
      ? { shopeeAutoRuleStartTime: startTime, shopeeAutoRuleEndTime: endTime, updatedAt: new Date() }
      : { autoRuleStartTime: startTime, autoRuleEndTime: endTime, updatedAt: new Date() };
    const user = await User.findByIdAndUpdate(req.currentUser._id, { $set: timeUpdates }, { new: true });

    res.json({
      ok: true,
      provider,
      autoRuleStartTime: user.autoRuleStartTime,
      autoRuleEndTime: user.autoRuleEndTime,
      shopeeAutoRuleStartTime: user.shopeeAutoRuleStartTime,
      shopeeAutoRuleEndTime: user.shopeeAutoRuleEndTime
    });
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

module.exports = router;
