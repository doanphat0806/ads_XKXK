'use strict';

const Config = require('../models/Config');

const AUTO_PAUSE_CPO_LIMIT = 100000;
const AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT = 60000;
const AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT = 15;
const AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT = 50000;

let appConfigCache = null;
let appConfigCachedAt = 0;
const APP_CONFIG_CACHE_TTL_MS = 30 * 1000;

async function getAppConfig(options = {}) {
  if (!options.fresh && appConfigCache && Date.now() - appConfigCachedAt < APP_CONFIG_CACHE_TTL_MS) {
    return appConfigCache;
  }
  const config = await Config.findOne({ key: 'app' }).lean();
  appConfigCache = config || {};
  appConfigCachedAt = Date.now();
  return appConfigCache;
}

function clearAppConfigCache() {
  appConfigCache = null;
  appConfigCachedAt = 0;
}

function pickDefinedValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function getShopeeAutoMinSpendLimit(limits = {}) {
  const value = Number(limits?.autoPauseShopeeMinSpendLimit);
  return Number.isFinite(value) && value > 0
    ? value
    : AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT;
}

// Chot camp tieu thap theo nhieu bac: moi bac { time: 'HH:MM', limit } quet 1 lan/ngay
const LOW_SPEND_CUTOFF_MAX_TIERS = 8;
const LOW_SPEND_CUTOFF_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeLowSpendCutoffTiers(value) {
  if (!Array.isArray(value)) return null;
  const byTime = new Map();
  for (const tier of value) {
    const time = String(tier?.time || '').trim();
    const limit = Number(tier?.limit || 0);
    if (!LOW_SPEND_CUTOFF_TIME_REGEX.test(time) || !Number.isFinite(limit) || limit < 0) continue;
    byTime.set(time, { time, limit });
  }
  return [...byTime.values()]
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, LOW_SPEND_CUTOFF_MAX_TIERS);
}

function resolveLowSpendCutoffTiers(globalConfig = {}, userConfig = {}) {
  const userTiers = normalizeLowSpendCutoffTiers(userConfig.lowSpendCutoffTiers);
  if (userTiers) return userTiers;
  const globalTiers = normalizeLowSpendCutoffTiers(globalConfig.lowSpendCutoffTiers);
  if (globalTiers) return globalTiers;
  // Chua luu danh sach bac: them bac 9h duoi 2k + giu moc cu (lowSpendCutoffTime/Limit, mac dinh 11h duoi 10k)
  return normalizeLowSpendCutoffTiers([
    { time: '09:00', limit: 2000 },
    {
      time: pickDefinedValue(userConfig.lowSpendCutoffTime, globalConfig.lowSpendCutoffTime, '11:00'),
      limit: pickDefinedValue(userConfig.lowSpendCutoffLimit, globalConfig.lowSpendCutoffLimit, 10000)
    }
  ]);
}

function mergeAutoConfig(globalConfig = {}, userConfig = {}) {
  const shopeeMinSpendLimit = pickDefinedValue(
    userConfig.autoPauseShopeeMinSpendLimit,
    globalConfig.autoPauseShopeeMinSpendLimit,
    AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT
  );

  return {
    autoRuleStartTime: pickDefinedValue(userConfig.autoRuleStartTime, globalConfig.autoRuleStartTime, '00:00'),
    autoRuleEndTime: pickDefinedValue(userConfig.autoRuleEndTime, globalConfig.autoRuleEndTime, '09:00'),
    shopeeAutoRuleStartTime: pickDefinedValue(userConfig.shopeeAutoRuleStartTime, globalConfig.shopeeAutoRuleStartTime, userConfig.autoRuleStartTime, globalConfig.autoRuleStartTime, '00:00'),
    shopeeAutoRuleEndTime: pickDefinedValue(userConfig.shopeeAutoRuleEndTime, globalConfig.shopeeAutoRuleEndTime, userConfig.autoRuleEndTime, globalConfig.autoRuleEndTime, '09:00'),
    scheduledDuplicatePauseTime: pickDefinedValue(userConfig.scheduledDuplicatePauseTime, globalConfig.scheduledDuplicatePauseTime, '21:00'),
    dailyZeroMessageSpendLimit: pickDefinedValue(userConfig.dailyZeroMessageSpendLimit, globalConfig.dailyZeroMessageSpendLimit, 25000),
    dailyOneMessageSpendLimit: pickDefinedValue(userConfig.dailyOneMessageSpendLimit, globalConfig.dailyOneMessageSpendLimit, 25000),
    dailyFewMessageThreshold: pickDefinedValue(userConfig.dailyFewMessageThreshold, globalConfig.dailyFewMessageThreshold, 0),
    dailyFewMessageSpendLimit: pickDefinedValue(userConfig.dailyFewMessageSpendLimit, globalConfig.dailyFewMessageSpendLimit, 0),
    dailyCheapMessageCostLimit: pickDefinedValue(userConfig.dailyCheapMessageCostLimit, globalConfig.dailyCheapMessageCostLimit, 0),
    dailyCheapMessageSpendLimit: pickDefinedValue(userConfig.dailyCheapMessageSpendLimit, globalConfig.dailyCheapMessageSpendLimit, 0),
    dailyHighCostPerMessageLimit: pickDefinedValue(userConfig.dailyHighCostPerMessageLimit, globalConfig.dailyHighCostPerMessageLimit, 20000),
    dailyHighCostSpendLimit: pickDefinedValue(userConfig.dailyHighCostSpendLimit, globalConfig.dailyHighCostSpendLimit, 50000),
    dailyClickLimit: pickDefinedValue(userConfig.dailyClickLimit, globalConfig.dailyClickLimit, 0),
    dailyCpcLimit: pickDefinedValue(userConfig.dailyCpcLimit, globalConfig.dailyCpcLimit, 600),
    lifetimeZeroMessageSpendLimit: pickDefinedValue(userConfig.lifetimeZeroMessageSpendLimit, globalConfig.lifetimeZeroMessageSpendLimit, 25000),
    lifetimeOneMessageSpendLimit: pickDefinedValue(userConfig.lifetimeOneMessageSpendLimit, globalConfig.lifetimeOneMessageSpendLimit, 25000),
    lifetimeFewMessageThreshold: pickDefinedValue(userConfig.lifetimeFewMessageThreshold, globalConfig.lifetimeFewMessageThreshold, 0),
    lifetimeFewMessageSpendLimit: pickDefinedValue(userConfig.lifetimeFewMessageSpendLimit, globalConfig.lifetimeFewMessageSpendLimit, 0),
    lifetimeCheapMessageCostLimit: pickDefinedValue(userConfig.lifetimeCheapMessageCostLimit, globalConfig.lifetimeCheapMessageCostLimit, 0),
    lifetimeCheapMessageSpendLimit: pickDefinedValue(userConfig.lifetimeCheapMessageSpendLimit, globalConfig.lifetimeCheapMessageSpendLimit, 0),
    lifetimeHighCostPerMessageLimit: pickDefinedValue(userConfig.lifetimeHighCostPerMessageLimit, globalConfig.lifetimeHighCostPerMessageLimit, 20000),
    lifetimeHighCostSpendLimit: pickDefinedValue(userConfig.lifetimeHighCostSpendLimit, globalConfig.lifetimeHighCostSpendLimit, 50000),
    lifetimeClickLimit: pickDefinedValue(userConfig.lifetimeClickLimit, globalConfig.lifetimeClickLimit, 0),
    lifetimeCpcLimit: pickDefinedValue(userConfig.lifetimeCpcLimit, globalConfig.lifetimeCpcLimit, 600),
    autoPauseCpoLimit: pickDefinedValue(userConfig.autoPauseCpoLimit, globalConfig.autoPauseCpoLimit, AUTO_PAUSE_CPO_LIMIT),
    autoPauseCpoLimitLifetime: pickDefinedValue(userConfig.autoPauseCpoLimitLifetime, globalConfig.autoPauseCpoLimitLifetime, AUTO_PAUSE_CPO_LIMIT),
    autoPauseMultiOrderThreshold: pickDefinedValue(userConfig.autoPauseMultiOrderThreshold, globalConfig.autoPauseMultiOrderThreshold, 2),
    autoPauseMultiOrderThresholdLifetime: pickDefinedValue(userConfig.autoPauseMultiOrderThresholdLifetime, globalConfig.autoPauseMultiOrderThresholdLifetime, 2),
    autoPauseMultiOrderCpoLimit: pickDefinedValue(userConfig.autoPauseMultiOrderCpoLimit, globalConfig.autoPauseMultiOrderCpoLimit, 0),
    autoPauseMultiOrderCpoLimitLifetime: pickDefinedValue(userConfig.autoPauseMultiOrderCpoLimitLifetime, globalConfig.autoPauseMultiOrderCpoLimitLifetime, 0),
    autoPauseZeroOrderSpendLimit: pickDefinedValue(userConfig.autoPauseZeroOrderSpendLimit, globalConfig.autoPauseZeroOrderSpendLimit, AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
    autoPauseZeroOrderSpendLimitLifetime: pickDefinedValue(userConfig.autoPauseZeroOrderSpendLimitLifetime, globalConfig.autoPauseZeroOrderSpendLimitLifetime, AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
    autoPauseShopeeMinSpendLimit: getShopeeAutoMinSpendLimit({ autoPauseShopeeMinSpendLimit: shopeeMinSpendLimit }),
    autoPauseShopeeHhAdsPercent: pickDefinedValue(userConfig.autoPauseShopeeHhAdsPercent, globalConfig.autoPauseShopeeHhAdsPercent, AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT),
    lowSpendCutoffTiers: resolveLowSpendCutoffTiers(globalConfig, userConfig)
  };
}

module.exports = {
  AUTO_PAUSE_CPO_LIMIT,
  AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT,
  AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT,
  AUTO_PAUSE_SHOPEE_MIN_SPEND_LIMIT,
  getAppConfig,
  clearAppConfigCache,
  pickDefinedValue,
  getShopeeAutoMinSpendLimit,
  LOW_SPEND_CUTOFF_MAX_TIERS,
  normalizeLowSpendCutoffTiers,
  mergeAutoConfig
};
