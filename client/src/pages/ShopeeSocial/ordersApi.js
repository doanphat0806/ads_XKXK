import { api } from '../../lib/api';

// Persists uploaded orders to MongoDB (scoped to the logged-in user) so the report
// survives across browsers/devices instead of living only in this browser's localStorage.

export async function importOrdersToServer(orders, sourceFileName) {
  return api('POST', '/shopee-social/orders/import', { orders, sourceFileName });
}

export async function fetchSavedOrders() {
  const result = await api('GET', '/shopee-social/orders');
  const rows = result?.orders || [];
  return rows.map(row => ({
    id: row.orderId,
    orderId: row.orderId,
    itemId: row.itemId || '',
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

export async function deleteSavedOrders() {
  return api('DELETE', '/shopee-social/orders');
}
