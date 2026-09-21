import { api } from '../../lib/api';

// Persists uploaded orders to MongoDB (scoped to the logged-in user) so the report
// survives across browsers/devices instead of living only in this browser's localStorage.

export async function importOrdersToServer(orders, sourceFileName, accountName = '') {
  return api('POST', '/shopee-social/orders/import', { orders, sourceFileName, accountName });
}

export async function fetchSavedOrders() {
  const result = await api('GET', '/shopee-social/orders');
  const rows = result?.orders || [];
  return rows.map(row => ({
    // Same composite as mapping.js's client-side id — an order can have several item/
    // variant/promotion rows, and keying on orderId alone gave them duplicate React keys.
    id: `${row.orderId}__${row.itemId || ''}__${row.modelId || ''}__${row.promotionId || ''}`,
    accountName: row.accountName || '',
    orderId: row.orderId,
    itemId: row.itemId || '',
    modelId: row.modelId || '',
    promotionId: row.promotionId || '',
    itemName: row.itemName || '',
    shopId: row.shopId || '',
    shopName: row.shopName || '',
    gmv: Number(row.gmv || 0),
    commissionShopee: Number(row.commissionShopee || 0),
    commissionXtra: Number(row.commissionXtra || 0),
    commissionTotal: Number(row.commissionTotal || 0),
    channelRaw: row.channelRaw || '',
    channel: row.channel || 'other',
    statusRaw: row.statusRaw || '',
    status: row.status || 'other',
    orderTime: row.orderTime ? new Date(row.orderTime) : null,
    clicksHint: 0,
    subIds: Array.isArray(row.subIds) ? row.subIds : ['', '', '', '', ''],
    subIdKey: row.subIdKey || '',
    platformKey: row.platformKey || 'khac',
    platformLabel: row.platformLabel || 'Khác',
    sourceFileName: row.sourceFileName || ''
  }));
}

export async function deleteSavedOrders(accountName = '') {
  const query = accountName ? `?accountName=${encodeURIComponent(accountName)}` : '';
  return api('DELETE', `/shopee-social/orders${query}`);
}
