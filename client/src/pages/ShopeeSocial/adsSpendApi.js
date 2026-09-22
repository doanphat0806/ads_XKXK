import { api } from '../../lib/api';

// Real Facebook ad spend/clicks, attributed to Shopee affiliate orders via SubID2
// (campaigns in this system are created with SubID2 embedded in the campaign name).
// Returns the day-by-day breakdown — callers that need a range total (e.g. scoped to
// a narrower window than what was fetched) re-aggregate it client-side from this.
// `campaigns` is the flat per-campaign list (carries accountId) used to attribute spend
// to a specific ad account — see accountTrend.js resolveAdAccountScope/campaignBelongsToScope.
export async function fetchAdsSpend(fromDate, toDate) {
  if (!fromDate || !toDate) return { bySubId2Daily: {}, campaigns: [] };
  const result = await api('GET', `/shopee-social/ads-spend?from=${fromDate}&to=${toDate}`);
  return { bySubId2Daily: result?.bySubId2Daily || {}, campaigns: result?.campaigns || [] };
}
