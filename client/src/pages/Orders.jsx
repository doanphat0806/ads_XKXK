import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
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

const normalizeStatus = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const getStatusClass = (rawStatus = '') => {
  const status = normalizeStatus(rawStatus);
  if (['da giao', 'thanh cong', 'success', 'completed', 'da nhan'].some(key => status.includes(key))) {
    return 'active';
  }
  if (['hoan tra', 'dang hoan', 'da hoan', 'da huy', 'huy', 'cancelled', 'returned'].some(key => status.includes(key))) {
    return 'error';
  }
  return 'paused';
};

const getFirstItem = (raw = {}) => {
  const items = [raw.items, raw.line_items, raw.products, raw.details].find(Array.isArray) || [];
  return asObject(items[0]);
};

const getItemSku = (item = {}, sheet = {}) => {
  const variationInfo = asObject(item.variation_info);
  return toText(
    sheet.col4 ||
      variationInfo.product_display_id ||
      variationInfo.display_id ||
      item.sku ||
      item.item_code ||
      item.product_name ||
      item.name
  );
};

const getItemQuantity = (item = {}, sheet = {}) => toText(
  sheet.col7 ||
    item.quantity ||
    item.qty ||
    item.amount ||
    item.count,
  '1'
);

const getItemSize = (item = {}, sheet = {}) => {
  const variationInfo = asObject(item.variation_info);
  return toText(
    sheet.col11 ||
      item.size ||
      item.variation_value ||
      variationInfo.detail ||
      variationInfo.name
  );
};

const mapSheetOrder = (order, index) => {
  const raw = asObject(order.rawData);
  const sheet = asObject(raw.sheetColumns);
  const item = getFirstItem(raw);
  const statusRaw = toText(sheet.col8 || raw.status_name || raw.status || order.status, '');
  const tags = Array.isArray(raw.tags) ? raw.tags.join(', ') : '';

  return {
    key: `${raw.rowNumber || order.orderId || index}-${sheet.col4 || index}`,
    rowNumber: raw.rowNumber || '',
    dateStr: toText(sheet.col2, formatCreatedAt(order.createdAt)),
    orderId: toText(order.orderId || sheet.col12),
    sku: getItemSku(item, sheet),
    qty: getItemQuantity(item, sheet),
    posStatus: statusRaw || '-',
    size: getItemSize(item, sheet),
    tagsStr: toText(sheet.col13 || tags, '-'),
    statusClass: getStatusClass(statusRaw)
  };
};

const getStatusSummary = (statusCounts = {}) => {
  const entries = Object.entries(statusCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3);

  if (!entries.length) return '-';
  return entries.map(([status, count]) => `${status}: ${Number(count).toLocaleString('vi-VN')}`).join(' | ');
};

export default function Orders() {
  const { provider, loadAll } = useAppContext();
  const [orderRows, setOrderRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({
    totalQuantity: 0,
    uniqueSkus: 0,
    statusCounts: {}
  });
  const [source, setSource] = useState('google_sheet');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filterFromDate, setFilterFromDate] = useState(() => daysAgoString(7));
  const [filterToDate, setFilterToDate] = useState(() => daysAgoString(0));
  const [searchTerm, setSearchTerm] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [ordersPerPage, setOrdersPerPage] = useState(DEFAULT_ORDERS_PER_PAGE);

  const loadOrders = async ({ shouldSync = false, page = currentPage } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const fromDate = filterFromDate;
      const toDate = filterToDate;
      const search = searchTerm.trim();

      if (shouldSync) {
        toast.info('Đang tải dữ liệu từ Google Sheet...');
        const result = await api('POST', '/orders/sync', { fromDate, toDate, queue: true }, { timeoutMs: 60000 });
        let synced = result.synced ?? 0;

        if (result.queued && result.jobId) {
          let done = false;
          while (!done) {
            await wait(1200);
            const status = await api('GET', `/orders/sync/${result.jobId}`, null, { timeoutMs: 60000 });
            const job = status.job || {};
            done = ORDER_SYNC_DONE_STATES.has(job.state);
            synced = job.synced ?? synced;
            if (job.state === 'failed') {
              throw new Error(job.error || job.message || 'Tải đơn hàng lỗi');
            }
          }
        }

        toast.success(`Đã tải ${Number(synced || 0).toLocaleString('vi-VN')} dòng đơn hàng`);
      }

      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', String(ordersPerPage));

      const data = await api('GET', `/orders?${params.toString()}`, null, { timeoutMs: 180000 });
      const orders = Array.isArray(data) ? data : data.orders || [];
      const rows = orders.map((order, index) => mapSheetOrder(order, index));

      setOrderRows(rows);
      setTotalRows(Array.isArray(data) ? rows.length : Number(data.total || 0));
      setTotalPages(Array.isArray(data) ? 1 : Number(data.totalPages || 1));
      setSummary(data?.stats || { totalQuantity: 0, uniqueSkus: 0, statusCounts: {} });
      setSource(data?.source || 'google_sheet');
      setLastSyncedAt(data?.cachedAt || '');
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

  useEffect(() => {
    setCurrentPage(1);
  }, [ordersPerPage, filterFromDate, filterToDate, searchTerm]);

  const pageRows = useMemo(() => orderRows, [orderRows]);
  const rangeStart = totalRows === 0 ? 0 : ((currentPage - 1) * ordersPerPage) + 1;
  const rangeEnd = Math.min(totalRows, currentPage * ordersPerPage);
  const sourceLabel = source === 'google_sheet' ? 'Google Sheet' : 'Cơ sở dữ liệu';

  if (provider === 'shopee') {
    return (
      <div id="page-orders">
        <div className="card">
          <div className="card-header"><div className="card-title">Đơn hàng không khả dụng với Shopee</div></div>
          <div className="card-body orders-card-body">
            <p>Trang Đơn hàng chỉ hiển thị với Facebook.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="page-orders">
      <div className="card section-gap orders-filter-card">
        <div className="card-header">
          <div>
            <div className="card-title">Bảng đặt hàng từ Google Sheet</div>
            <div className="orders-source-note">
              Nguồn: {sourceLabel}
              {lastSyncedAt ? ` | Cache: ${formatCreatedAt(lastSyncedAt)}` : ''}
            </div>
          </div>
          <button className="btn btn-g btn-sm" onClick={() => loadOrders({ shouldSync: true, page: 1 })} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            {loading ? 'Đang tải' : 'Tải từ Sheet'}
          </button>
        </div>

        <div className="orders-filter-body">
          <div className="form-grid orders-filter-grid">
            <div className="form-group">
              <label>Từ ngày</label>
              <input type="date" value={filterFromDate} onChange={e => setFilterFromDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Đến ngày</label>
              <input type="date" value={filterToDate} onChange={e => setFilterToDate(e.target.value)} />
            </div>
            <div className="form-group orders-search-field">
              <label>Tìm đơn / SKU / trạng thái</label>
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') loadOrders({ page: 1 });
                }}
                placeholder="Nhập mã đơn, mã sản phẩm..."
              />
            </div>
            <div className="form-group orders-filter-action">
              <button className="btn btn-ghost" onClick={() => loadOrders({ page: 1 })} disabled={loading}>
                <Search size={14} />
                Lọc dữ liệu
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="orders-summary-grid section-gap">
        <div className="stat">
          <div className="stat-label">Dòng đơn hàng</div>
          <div className="stat-value">{totalRows.toLocaleString('vi-VN')}</div>
          <div className="stat-sub">{rangeStart.toLocaleString('vi-VN')} - {rangeEnd.toLocaleString('vi-VN')} đang hiển thị</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Tổng số lượng</div>
          <div className="stat-value b">{Number(summary.totalQuantity || 0).toLocaleString('vi-VN')}</div>
          <div className="stat-sub">Theo bộ lọc hiện tại</div>
        </div>
        <div className="stat teal">
          <div className="stat-label">Mã sản phẩm</div>
          <div className="stat-value teal">{Number(summary.uniqueSkus || 0).toLocaleString('vi-VN')}</div>
          <div className="stat-sub">SKU duy nhất</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Trạng thái nhiều nhất</div>
          <div className="stat-value orders-status-summary">{getStatusSummary(summary.statusCounts)}</div>
          <div className="stat-sub">Top 3 trạng thái</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header orders-table-header">
          <div className="card-title">
            Chi tiết đơn hàng (<span id="orderCount">{totalRows.toLocaleString('vi-VN')} dòng</span>)
          </div>
          <div className="orders-page-size">
            <span>Hiển thị</span>
            <select value={ordersPerPage} onChange={e => setOrdersPerPage(Number(e.target.value))}>
              <option value="100">100 / trang</option>
              <option value="500">500 / trang</option>
              <option value="1000">1000 / trang</option>
            </select>
          </div>
        </div>

        <div className="tbl-wrap orders-table-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Đang tải dữ liệu...</p></div>
          ) : error ? (
            <div className="empty"><p className="orders-error">Lỗi: {error}</p></div>
          ) : pageRows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chưa có đơn hàng nào</p></div>
          ) : (
            <table className="tbl orders-table">
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>Ngày tạo đơn</th>
                  <th>ID2 (Mã đơn)</th>
                  <th>Mã sản phẩm</th>
                  <th className="text-center">Số lượng</th>
                  <th>Trạng thái</th>
                  <th>Thuộc tính size</th>
                  <th>Thẻ</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.key}>
                    <td className="orders-row-number">{row.rowNumber || '-'}</td>
                    <td className="orders-date">{row.dateStr}</td>
                    <td className="orders-id">{row.orderId}</td>
                    <td className="orders-sku">{row.sku}</td>
                    <td className="orders-qty">{row.qty}</td>
                    <td><span className={`badge ${row.statusClass}`}>{row.posStatus}</span></td>
                    <td className="orders-size">{row.size}</td>
                    <td><span className="orders-tag">{row.tagsStr}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalRows > 0 && (
          <div className="orders-pagination">
            <div className="orders-range">
              {rangeStart.toLocaleString('vi-VN')} - {rangeEnd.toLocaleString('vi-VN')} / {totalRows.toLocaleString('vi-VN')} dòng
            </div>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || loading}
              title="Trang trước"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="orders-current-page">
              {currentPage.toLocaleString('vi-VN')} / {totalPages.toLocaleString('vi-VN')}
            </div>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || loading}
              title="Trang sau"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
