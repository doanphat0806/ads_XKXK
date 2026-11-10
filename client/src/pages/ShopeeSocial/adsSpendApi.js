import { api } from '../../lib/api';

// Real Facebook ad spend/clicks, attributed to Shopee affiliate orders via SubID2
// (campaigns in this system are created with SubID2 embedded in the campaign name).
// Returns the flat per-campaign list (carries accountId, date, subId2, spend, clicks) —
// callers re-aggregate it client-side, scoped to whichever date range/ad account(s) are
// relevant. See accountTrend.js resolveAdAccountScope/campaignBelongsToScope.
export async function fetchAdsSpend(fromDate, toDate) {
  if (!fromDate || !toDate) return { campaigns: [] };
  const result = await api('GET', `/shopee-social/ads-spend?from=${fromDate}&to=${toDate}`);
  // ledger: trang thai so cai chi phi ads (da luu xong chua), source: 'ledger' | 'campaigns'
  return { campaigns: result?.campaigns || [], ledger: result?.ledger || null, source: result?.source || '' };
}

// Trang thai so cai chi phi ads Shopee (luu xong chua, bao nhieu dong, luu luc nao)
export async function fetchAdsSpendStatus() {
  return api('GET', '/shopee-social/ads-spend/status');
}
