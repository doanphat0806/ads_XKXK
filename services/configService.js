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
    autoPauseZeroOrderSpendLimit: pickDefinedValue(userConfig.autoPauseZeroOrderSpendLimit, globalConfig.autoPauseZeroOrderSpendLimit, AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
    autoPauseZeroOrderSpendLimitLifetime: pickDefinedValue(userConfig.autoPauseZeroOrderSpendLimitLifetime, globalConfig.autoPauseZeroOrderSpendLimitLifetime, AUTO_PAUSE_ZERO_ORDER_SPEND_LIMIT),
    autoPauseShopeeMinSpendLimit: getShopeeAutoMinSpendLimit({ autoPauseShopeeMinSpendLimit: shopeeMinSpendLimit }),
    autoPauseShopeeHhAdsPercent: pickDefinedValue(userConfig.autoPauseShopeeHhAdsPercent, globalConfig.autoPauseShopeeHhAdsPercent, AUTO_PAUSE_SHOPEE_HH_ADS_PERCENT)
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
  mergeAutoConfig
};
