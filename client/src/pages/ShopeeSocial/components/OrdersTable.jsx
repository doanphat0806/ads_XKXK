import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { formatVND } from '../../../lib/api';
import { STATUS_LABELS, CHANNEL_LABELS } from '../utils';

const STATUS_BADGE = { completed: 'active', pending: 'warning', cancelled: 'paused', other: 'neutral' };
const CHANNEL_BADGE = { social: 'active', video: 'neutral', live: 'neutral', other: 'neutral' };
const PAGE_SIZES = [10, 25, 50];

function formatDateTime(d) {
  if (!d) return '-';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

export default function OrdersTable({ orders, onExport }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => orders.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
    [orders, clampedPage, pageSize]
  );
  const showAccountColumn = useMemo(() => orders.some(o => o.accountName), [orders]);

  return (
    <div className="card shopee-social-orders-card">
      <div className="card-header">
        <div className="card-title">Danh Sách Đơn Hàng Chi Tiết ({orders.length})</div>
        <button type="button" className="btn btn-sm" onClick={onExport} disabled={!orders.length}>
          <Download size={14} strokeWidth={2} /> Xuất CSV đã lọc
        </button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {showAccountColumn && <th>Tài khoản</th>}
              <th>Mã đơn</th>
              <th>Sản phẩm</th>
              <th>Shop</th>
              <th>SubID</th>
              <th>Kênh</th>
              <th>Trạng thái</th>
              <th className="text-right">GMV</th>
              <th className="text-right">Hoa hồng</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(order => (
              <tr key={order.id}>
                {showAccountColumn && <td className="mono-sm">{order.accountName || '-'}</td>}
                <td className="mono-sm">{order.orderId}</td>
                <td>{order.itemName}</td>
                <td>{order.shopName}</td>
                <td className="mono-sm" title={order.subIdKey}>{order.subIdKey}</td>
                <td><span className={`badge ${CHANNEL_BADGE[order.channel]}`}>{CHANNEL_LABELS[order.channel] || order.channel}</span></td>
                <td><span className={`badge ${STATUS_BADGE[order.status]}`}>{STATUS_LABELS[order.status] || order.status}</span></td>
                <td className="text-right mono-sm">{formatVND(order.gmv)}</td>
                <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{formatVND(order.commissionTotal)}</td>
                <td className="mono-sm">{formatDateTime(order.orderTime)}</td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr><td colSpan={showAccountColumn ? 10 : 9} style={{ textAlign: 'center', padding: 20, color: 'var(--muted2)' }}>Không có đơn hàng phù hợp</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="shopee-social-pagination">
        <select className="shopee-social-input" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
          {PAGE_SIZES.map(size => <option key={size} value={size}>{size} đơn/trang</option>)}
        </select>
        <div className="shopee-social-pagination-controls">
          <button type="button" className="btn btn-sm btn-ghost" disabled={clampedPage <= 1} onClick={() => setPage(p => p - 1)}>← Trước</button>
          <span>Trang {clampedPage}/{totalPages}</span>
          <button type="button" className="btn btn-sm btn-ghost" disabled={clampedPage >= totalPages} onClick={() => setPage(p => p + 1)}>Sau →</button>
        </div>
      </div>
    </div>
  );
}
