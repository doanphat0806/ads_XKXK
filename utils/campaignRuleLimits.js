'use strict';

// Cac nguong auto ma quy tac rieng tung camp duoc ghi de. Ten key trung voi
// cau hinh chung (User/Config) de ghep thang vao `limits` cua getAutoPauseDecision.
const CAMPAIGN_RULE_LIMIT_KEYS = [
  // Facebook - theo tin nhan
  'dailyZeroMessageSpendLimit', 'lifetimeZeroMessageSpendLimit',
  'dailyOneMessageSpendLimit', 'lifetimeOneMessageSpendLimit',
  'dailyHighCostPerMessageLimit', 'lifetimeHighCostPerMessageLimit',
  'dailyHighCostSpendLimit', 'lifetimeHighCostSpendLimit',
  'dailyCheapMessageCostLimit', 'lifetimeCheapMessageCostLimit',
  'dailyCheapMessageSpendLimit', 'lifetimeCheapMessageSpendLimit',
  // Facebook - theo don hang
  'autoPauseZeroOrderSpendLimit', 'autoPauseZeroOrderSpendLimitLifetime',
  'autoPauseCpoLimit', 'autoPauseCpoLimitLifetime',
  'autoPauseMultiOrderThreshold', 'autoPauseMultiOrderThresholdLifetime',
  'autoPauseMultiOrderCpoLimit', 'autoPauseMultiOrderCpoLimitLifetime',
  // Shopee
  'autoPauseShopeeMinSpendLimit',
  'dailyCpcLimit', 'lifetimeCpcLimit',
  'dailyClickLimit', 'lifetimeClickLimit'
];

// getPauseReason so sanh `spend >= limit` khong kiem tra limit > 0, nen 0 se tat
// moi camp 0/1 tin nhan ngay lap tuc. O quy tac rieng, 0 nghia la "bo qua dieu
// kien" -> doi thanh Infinity de dieu kien khong bao gio dung.
const ZERO_MEANS_DISABLED_KEYS = new Set([
  'dailyZeroMessageSpendLimit', 'lifetimeZeroMessageSpendLimit',
  'dailyOneMessageSpendLimit', 'lifetimeOneMessageSpendLimit'
]);

// Chi giu key hop le co gia tri so >= 0; o de trong (null/'') = dung cau hinh chung
function normalizeCampaignRuleLimits(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const limits = {};
  for (const key of CAMPAIGN_RULE_LIMIT_KEYS) {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Math.round(Number(raw));
    if (Number.isFinite(value) && value >= 0) limits[key] = value;
  }
  return limits;
}

function applyCampaignRuleLimits(config, rule) {
  if (!rule || rule.mode !== 'custom') return config;
  const limits = normalizeCampaignRuleLimits(rule.limits);
  const next = { ...config };
  for (const [key, value] of Object.entries(limits)) {
    next[key] = value === 0 && ZERO_MEANS_DISABLED_KEYS.has(key) ? Infinity : value;
  }
  return next;
}

module.exports = {
  CAMPAIGN_RULE_LIMIT_KEYS,
  normalizeCampaignRuleLimits,
  applyCampaignRuleLimits
};
