import { api } from '../../lib/api';

// The user's saved list of Shopee Affiliate account names (server-side, per user),
// so the upload panel can offer a "pick one" dropdown instead of retyping a name.

export async function fetchShopeeAffAccounts() {
  const result = await api('GET', '/shopee-social/accounts');
  return result?.accounts || [];
}

export async function createShopeeAffAccount(name, subIdPrefix = '', adAccountIds = []) {
  const result = await api('POST', '/shopee-social/accounts', { name, subIdPrefix, adAccountIds });
  return result?.account;
}

export async function updateShopeeAffAccount(id, { name, subIdPrefix, adAccountIds } = {}) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (subIdPrefix !== undefined) body.subIdPrefix = subIdPrefix;
  if (adAccountIds !== undefined) body.adAccountIds = adAccountIds;
  const result = await api('PATCH', `/shopee-social/accounts/${id}`, body);
  return result?.account;
}

export async function deleteShopeeAffAccount(id) {
  return api('DELETE', `/shopee-social/accounts/${id}`);
}

// Real ad accounts (Facebook accounts running Shopee affiliate campaigns, tagged
// provider="shopee" in this app) — offered as a pick-list so a Shopee AFF account can
// be pinned to specific ad account(s) instead of relying only on SubID2 code matching.
export async function fetchShopeeAdAccounts() {
  const result = await api('GET', '/accounts?provider=shopee');
  return Array.isArray(result) ? result.map(a => ({ _id: a._id, name: a.name })) : [];
}
