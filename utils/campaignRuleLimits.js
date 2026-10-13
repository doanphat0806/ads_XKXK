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

// Quy tac rieng duoc UU TIEN: camp co quy tac rieng chi bi tat theo cac dieu kien da nhap.
// "Dieu kien tat" (muc chi tieu / CPO / CPC... de tat camp): o trong = KHONG xet (tat han
// dieu kien do), khong lay muc chung. Gia tri tat duoc chon theo cach getPauseReason /
// getAutoPauseDecision so sanh:
// - Infinity: cac phep so sanh `spend >= limit` / `cpc > limit` khong kiem tra limit > 0
//   (0 se tat ngay, CPC 0 bi doi thanh 600) -> Infinity de khong bao gio dung.
// - 0: cac dieu kien da co kiem tra `limit > 0`.
const DISABLE_WITH_INFINITY_KEYS = [
  'dailyZeroMessageSpendLimit', 'lifetimeZeroMessageSpendLimit',
  'dailyOneMessageSpendLimit', 'lifetimeOneMessageSpendLimit',
  'dailyCpcLimit', 'lifetimeCpcLimit'
];
const DISABLE_WITH_ZERO_KEYS = [
  'dailyHighCostSpendLimit', 'lifetimeHighCostSpendLimit',
  'dailyCheapMessageSpendLimit', 'lifetimeCheapMessageSpendLimit',
  'autoPauseZeroOrderSpendLimit', 'autoPauseZeroOrderSpendLimitLifetime',
  'autoPauseCpoLimit', 'autoPauseCpoLimitLifetime',
  'autoPauseMultiOrderCpoLimit', 'autoPauseMultiOrderCpoLimitLifetime',
  'dailyClickLimit', 'lifetimeClickLimit',
  // Dieu kien "duoi N tin nhan" khong co trong bang quy tac rieng -> luon tat
  'dailyFewMessageThreshold', 'lifetimeFewMessageThreshold',
  'dailyFewMessageSpendLimit', 'lifetimeFewMessageSpendLimit'
];
// "Tham so" (gia TN dat/re, nguong nhieu don, chi tieu toi thieu Shopee) chi dinh nghia
// dieu kien, tu no khong tat camp -> o trong thi van dung muc chung:
// dailyHighCostPerMessageLimit, dailyCheapMessageCostLimit, autoPauseMultiOrderThreshold,
// autoPauseShopeeMinSpendLimit (va ban lifetime).

// Chi giu key hop le co gia tri so >= 0; o de trong (null/'') = khong luu
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
  for (const key of DISABLE_WITH_INFINITY_KEYS) next[key] = Infinity;
  for (const key of DISABLE_WITH_ZERO_KEYS) next[key] = 0;
  for (const [key, value] of Object.entries(limits)) {
    // Nhap 0 = bo qua dieu kien (giu gia tri "tat" o tren)
    if (value === 0 && DISABLE_WITH_INFINITY_KEYS.includes(key)) continue;
    next[key] = value;
  }
  return next;
}

module.exports = {
  CAMPAIGN_RULE_LIMIT_KEYS,
  normalizeCampaignRuleLimits,
  applyCampaignRuleLimits
};
