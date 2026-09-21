import { api } from '../../lib/api';

// Manual ledger of actual Shopee AFF commission payouts (ghi tay khi tiền thực về),
// kept separate from the report's provisional commissionTotal.

export async function fetchCommissionReceipts() {
  const result = await api('GET', '/shopee-social/commission-receipts');
  const rows = result?.receipts || [];
  return rows.map(r => ({
    id: r._id,
    accountName: r.accountName || '',
    date: r.date ? new Date(r.date) : null,
    amount: Number(r.amount || 0),
    note: r.note || ''
  }));
}

export async function createCommissionReceipt({ accountName, date, amount, note }) {
  const result = await api('POST', '/shopee-social/commission-receipts', { accountName, date, amount, note });
  const r = result?.receipt;
  return r && {
    id: r._id,
    accountName: r.accountName || '',
    date: r.date ? new Date(r.date) : null,
    amount: Number(r.amount || 0),
    note: r.note || ''
  };
}

export async function deleteCommissionReceipt(id) {
  return api('DELETE', `/shopee-social/commission-receipts/${id}`);
}
