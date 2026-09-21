import { api } from '../../lib/api';

// The user's saved list of Shopee Affiliate account names (server-side, per user),
// so the upload panel can offer a "pick one" dropdown instead of retyping a name.

export async function fetchShopeeAffAccounts() {
  const result = await api('GET', '/shopee-social/accounts');
  return result?.accounts || [];
}

export async function createShopeeAffAccount(name, subIdPrefix = '') {
  const result = await api('POST', '/shopee-social/accounts', { name, subIdPrefix });
  return result?.account;
}

export async function updateShopeeAffAccount(id, { name, subIdPrefix } = {}) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (subIdPrefix !== undefined) body.subIdPrefix = subIdPrefix;
  const result = await api('PATCH', `/shopee-social/accounts/${id}`, body);
  return result?.account;
}

export async function deleteShopeeAffAccount(id) {
  return api('DELETE', `/shopee-social/accounts/${id}`);
}
