import { api } from '../../lib/api';

// Real Facebook ad spend/clicks, attributed to Shopee affiliate orders via SubID2
// (campaigns in this system are created with SubID2 embedded in the campaign name).
// Returns the day-by-day breakdown — callers that need a range total (e.g. scoped to
// a narrower window than what was fetched) re-aggregate it client-side from this.
export async function fetchAdsSpend(fromDate, toDate) {
  if (!fromDate || !toDate) return { bySubId2Daily: {} };
  const result = await api('GET', `/shopee-social/ads-spend?from=${fromDate}&to=${toDate}`);
  return { bySubId2Daily: result?.bySubId2Daily || {} };
}
