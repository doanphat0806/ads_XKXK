import { api } from '../../lib/api';

// Real Facebook ad spend/clicks, attributed to Shopee affiliate orders via SubID2
// (campaigns in this system are created with SubID2 embedded in the campaign name).
export async function fetchAdsSpendBySubId2(fromDate, toDate) {
  if (!fromDate || !toDate) return {};
  const result = await api('GET', `/shopee-social/ads-spend?from=${fromDate}&to=${toDate}`);
  return result?.bySubId2 || {};
}
