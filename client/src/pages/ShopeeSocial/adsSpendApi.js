import { api } from '../../lib/api';

// Real Facebook ad spend/clicks, attributed to Shopee affiliate orders via SubID2
// (campaigns in this system are created with SubID2 embedded in the campaign name).
// Returns the flat per-campaign list (carries accountId, date, subId2, spend, clicks) —
// callers re-aggregate it client-side, scoped to whichever date range/ad account(s) are
// relevant. See accountTrend.js resolveAdAccountScope/campaignBelongsToScope.
export async function fetchAdsSpend(fromDate, toDate) {
  if (!fromDate || !toDate) return { campaigns: [] };
  const result = await api('GET', `/shopee-social/ads-spend?from=${fromDate}&to=${toDate}`);
  return { campaigns: result?.campaigns || [] };
}
