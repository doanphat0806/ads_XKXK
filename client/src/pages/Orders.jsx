import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import { toast } from 'react-toastify';


const DEFAULT_ORDERS_PER_PAGE = 100;
const ORDER_SYNC_DONE_STATES = new Set(['completed', 'completed_with_errors', 'failed']);

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function daysAgoString(days) {
  const vnDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  vnDate.setUTCDate(vnDate.getUTCDate() - days);
  return vnDate.toISOString().split('T')[0];
}

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const formatCreatedAt = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
};

// Trạng thái → badge class
const getStatusClass = (rawStatus = '') => {
  const s = String(rawStatus).toLowerCase().trim();
  if (['đã giao', 'da giao', 'thành công', 'thanh cong', 'success', 'completed'].some(k => s.includes(k))) return 'active';
  if (['hoàn trả', 'hoan tra', 'đã hủy', 'da huy', 'cancelled', 'returned'].some(k => s.includes(k))) return 'error';
  return 'paused';
};

// Map đơn từ Google Sheet
// col12(L)=ID2(Mã đơn), col2(B)=Ngày tạo, col4(D)=Mã SP,
// col7(G)=Số lượng, col8(H)=Trạng thái, col11(K)=SIZE, col13(M)=Thẻ
const mapSheetOrder = (order) => {
  const raw = asObject(order.rawData);
  const sheet = asObject(raw.sheetColumns);
  const statusRaw = toText(sheet.col8 || raw.status_name || order.status, '');

  return [{
    rawDate:     new Date(order.createdAt),
    dateStr:     toText(sheet.col2, formatCreatedAt(order.createdAt)),
    orderId:     toText(order.orderId || sheet.col12),
    sku:         toText(sheet.col4),
    qty:         toText(sheet.col7, '1'),
    posStatus:   statusRaw || '-',
    size:        toText(sheet.col11),
    tagsStr:     toText(sheet.col13),
    statusClass: getStatusClass(statusRaw)
  }];
};

export default function Orders() {
  const { provider, loadAll } = useAppContext();
  const [allOrderRows, setAllOrderRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filterFromDate, setFilterFromDate] = useState(() => daysAgoString(7));
  const [filterToDate, setFilterToDate] = useState(() => daysAgoString(0));

  const [currentPage, setCurrentPage] = useState(1);
  const [ordersPerPage, setOrdersPerPage] = useState(DEFAULT_ORDERS_PER_PAGE);

  const loadOrders = async ({ shouldSync = false, page = currentPage } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const fromDate = filterFromDate;
      const toDate = filterToDate;

      if (shouldSync) {
        toast.info('Đang tải dữ liệu từ Google Sheet...');
        const result = await api('POST', '/orders/sync', { fromDate, toDate });
        let synced = result.synced ?? 0;

        if (result.queued && result.jobId) {
          let done = false;
          while (!done) {
            await wait(1200);
            const status = await api('GET', `/orders/sync/${result.jobId}`);
            const job = status.job || {};
            done = ORDER_SYNC_DONE_STATES.has(job.state);
            synced = job.synced ?? synced;
            if (job.state === 'failed') {
              throw new Error(job.error || job.message || 'Tải đơn hàng lỗi');
            }
          }
        }

        toast.success(`Đã tải ${synced} dòng đơn hàng`);
      }

      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      params.set('page', String(page));
      params.set('limit', String(ordersPerPage));

      const data = await api('GET', `/orders?${params.toString()}`);
      const orders = Array.isArray(data) ? data : data.orders || [];
      const rows = orders.flatMap(order => mapSheetOrder(order));

      setAllOrderRows(rows);
      setTotalRows(Array.isArray(data) ? rows.length : data.total || 0);
      setCurrentPage(page);
      if (shouldSync) loadAll?.();
    } catch (e) {
      setError(e.message);
      toast.error(`Lỗi: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (provider !== 'shopee') loadOrders({ page: currentPage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, currentPage, ordersPerPage]);

  const pageRows = useMemo(() => allOrderRows, [allOrderRows]);
  const totalPages = Math.ceil(totalRows / ordersPerPage) || 1;

  useEffect(() => { setCurrentPage(1); }, [ordersPerPage, filterFromDate, filterToDate]);

  if (provider === 'shopee') {
    return (
      <div id="page-orders">
        <div className="card">
          <div className="card-header"><div className="card-title">Đơn hàng không khả dụng với Shopee</div></div>
          <div className="card-body" style={{ padding: '20px' }}>
            <p>Trang Đơn hàng chỉ hiển thị với Facebook.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="page-orders">
      {/* Bộ lọc lấy dữ liệu */}
      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Dữ liệu đơn hàng từ Google Sheet</div>
          <button className="btn btn-g btn-sm" onClick={() => loadOrders({ shouldSync: true, page: 1 })} disabled={loading}>
            {loading ? 'Đang tải...' : 'Tải lại'}
          </button>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="form-group">
              <label>Từ ngày</label>
              <input type="date" value={filterFromDate} onChange={e => setFilterFromDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Đến ngày</label>
              <input type="date" value={filterToDate} onChange={e => setFilterToDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => loadOrders({ page: 1 })} disabled={loading}>
                Lọc dữ liệu
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bảng chi tiết */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Chi tiết đơn hàng (<span id="orderCount">{totalRows.toLocaleString('vi-VN')} dòng</span>)
          </div>
        </div>

        <div className="tbl-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p style={{ marginTop: '10px' }}>Đang tải dữ liệu...</p></div>
          ) : error ? (
            <div className="empty"><p style={{ color: 'var(--r)' }}>Lỗi: {error}</p></div>
          ) : pageRows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chưa có đơn hàng nào</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ngày tạo đơn</th>
                  <th>ID2 (Mã đơn)</th>
                  <th>Mã sản phẩm</th>
                  <th style={{ textAlign: 'center' }}>Số lượng</th>
                  <th>Trạng thái</th>
                  <th>Thuộc tính SIZE</th>
                  <th>Thẻ</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, index) => (
                  <tr key={index} style={{ verticalAlign: 'middle' }}>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{row.dateStr}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 'bold' }}>{row.orderId}</td>
                    <td style={{ fontWeight: 600, color: '#1890ff', whiteSpace: 'nowrap' }}>{row.sku}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--mono)' }}>{row.qty}</td>
                    <td><span className={`badge ${row.statusClass}`}>{row.posStatus}</span></td>
                    <td style={{ fontWeight: 600 }}>{row.size}</td>
                    <td><span style={{ fontSize: '11px', background: 'var(--s2)', padding: '2px 6px', borderRadius: '4px', color: 'var(--txt)' }}>{row.tagsStr}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalRows > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '12px', background: 'var(--s1)', borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px', fontWeight: 'bold' }}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>&lt;</button>
            <div style={{ border: '1px solid #1890ff', color: '#1890ff', padding: '4px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px', background: 'rgba(24,144,255,0.1)' }}>
              {currentPage} / {totalPages}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px', fontWeight: 'bold' }}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>&gt;</button>
            <select className="form-control"
              style={{ width: 'auto', height: '32px', fontSize: '13px', marginLeft: '10px', background: 'var(--s3)', color: 'var(--txt)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0 8px' }}
              value={ordersPerPage} onChange={e => setOrdersPerPage(Number(e.target.value))}>
              <option value="100">100 / trang</option>
              <option value="500">500 / trang</option>
              <option value="1000">1000 / trang</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
