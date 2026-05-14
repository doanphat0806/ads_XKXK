import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { toast } from 'react-toastify';
import { api, uploadForm } from '../lib/api';

const DEFAULT_LIMIT = 100;

function formatNumber(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });
}

function isUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isImageUrl(value = '') {
  return /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(String(value || '').trim())
    || /^https?:\/\/.+(alicdn|pinduoduo|img|image|photo)/i.test(String(value || '').trim());
}

function shortText(value = '') {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

export default function DataPurchaseOrders() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [search, setSearch] = useState('');
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [error, setError] = useState('');

  const loadRows = async ({ nextPage = page } = {}) => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit)
      });
      if (search.trim()) params.set('search', search.trim());

      const data = await api('GET', `/data-purchase-orders?${params.toString()}`, null, { timeoutMs: 180000 });
      setHeaders(Array.isArray(data.headers) ? data.headers : []);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total || 0));
      setTotalPages(Number(data.totalPages || 1));
      setMeta({
        sheetName: data.sheetName || 'Data',
        range: data.range || 'A:AH',
        query: data.query || '',
        lastSyncAt: data.lastSyncAt || '',
        lastSyncSourceType: data.lastSyncSourceType || '',
        lastSyncCount: Number(data.lastSyncCount || 0),
        lastSyncDeleted: Number(data.lastSyncDeleted || 0)
      });
      setPage(nextPage);
    } catch (err) {
      setError(err.message);
      toast.error(`Lỗi tải DATA ĐẶT HÀNG: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const syncSheetToDatabase = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError('');

    try {
      const result = await api('POST', '/data-purchase-orders/sync', null, { timeoutMs: 10 * 60 * 1000 });
      toast.success(`Đã lưu ${formatNumber(result.imported)} dòng vào database`);
      await loadRows({ nextPage: 1 });
    } catch (err) {
      setError(err.message);
      toast.error(`Lỗi đồng bộ Sheet: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const importCsvFile = async (file) => {
    if (!file || importingCsv) return;
    setImportingCsv(true);
    setError('');

    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadForm('/data-purchase-orders/import-csv', formData, { timeoutMs: 10 * 60 * 1000 });
      toast.success(`Đã lưu ${formatNumber(result.imported)} dòng CSV vào database`);
      await loadRows({ nextPage: 1 });
    } catch (err) {
      setError(err.message);
      toast.error(`Lỗi import CSV: ${err.message}`);
    } finally {
      setImportingCsv(false);
    }
  };

  useEffect(() => {
    loadRows({ nextPage: page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  useEffect(() => {
    setPage(1);
  }, [search, limit]);

  const visibleHeaders = useMemo(() => headers.length ? headers : [], [headers]);
  const firstRow = total ? ((page - 1) * limit) + 1 : 0;
  const lastRow = Math.min(total, page * limit);

  const renderCell = (header, value) => {
    if (!value) return '-';
    if (header.key === 'col2' && isImageUrl(value)) {
      return (
        <a href={value} target="_blank" rel="noreferrer" title="Mở ảnh">
          <img className="data-po-thumb" src={value} alt="" loading="lazy" />
        </a>
      );
    }
    if (isUrl(value)) {
      return <a href={value} target="_blank" rel="noreferrer">{shortText(value)}</a>;
    }
    return value;
  };

  return (
    <div id="page-data-purchase-orders">
      <div className="card section-gap data-po-filter-card">
        <div className="card-header">
          <div>
            <div className="card-title">DATA ĐẶT HÀNG</div>
            <div className="data-po-source">
              {meta.sheetName || 'Data'}!{meta.range || 'A:AH'}
              {meta.lastSyncAt ? ` | DB: ${formatDateTime(meta.lastSyncAt)} | ${formatNumber(meta.lastSyncCount)} dòng` : ''}
            </div>
          </div>
          <button className="btn btn-g btn-sm" onClick={syncSheetToDatabase} disabled={loading || refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Đang đồng bộ' : 'Đồng bộ vào DB'}
          </button>
        </div>

        <div className="data-po-filter-body">
          <div className="data-po-toolbar">
            <div className="form-group data-po-search">
              <label>Tìm dữ liệu</label>
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') loadRows({ nextPage: 1 });
                }}
                placeholder="Mã đơn, mã vận đơn, tài khoản, thuộc tính..."
              />
            </div>
            <button className="btn btn-ghost" onClick={() => loadRows({ nextPage: 1 })} disabled={loading}>
              <Search size={14} />
              Lọc dữ liệu
            </button>
          </div>
          <div className="data-po-query">
            SELECT Col1, Col2, Col3, Col4, Col11, Col13, Col15, Col16, Col24, Col25, Col27
          </div>
          <div className="data-po-import-row">
            <div className="form-group">
              <label>Import CSV</label>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={importingCsv}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  importCsvFile(file);
                }}
              />
            </div>
            <div className="data-po-import-note">
              Hỗ trợ CSV đủ cột A:AH hoặc CSV đã lọc sẵn 11 cột theo query.
            </div>
          </div>
        </div>
      </div>

      <div className="card data-po-table-card">
        <div className="card-header data-po-table-header">
          <div className="card-title">Bảng DATA ĐẶT HÀNG ({formatNumber(total)} dòng)</div>
          <div className="data-po-page-size">
            <span>Hiển thị</span>
            <select value={limit} onChange={event => setLimit(Number(event.target.value))}>
              <option value="100">100 / trang</option>
              <option value="500">500 / trang</option>
              <option value="1000">1000 / trang</option>
            </select>
          </div>
        </div>

        <div className="tbl-wrap data-po-table-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Đang tải DATA ĐẶT HÀNG...</p></div>
          ) : error ? (
            <div className="empty"><p className="data-po-error">Lỗi: {error}</p></div>
          ) : rows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chưa có dữ liệu DATA ĐẶT HÀNG</p></div>
          ) : (
            <table className="tbl data-po-table">
              <thead>
                <tr>
                  <th>Dòng</th>
                  {visibleHeaders.map(header => (
                    <th key={header.key}>{header.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.rowNumber}>
                    <td className="data-po-row-number">{row.rowNumber}</td>
                    {visibleHeaders.map(header => {
                      const cell = row.values?.find(item => item.key === header.key);
                      return (
                        <td key={`${row.rowNumber}-${header.key}`}>
                          {renderCell(header, cell?.value || '')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 && (
          <div className="data-po-pagination">
            <div className="data-po-range">{formatNumber(firstRow)} - {formatNumber(lastRow)} / {formatNumber(total)} dòng</div>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setPage(current => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              title="Trang trước"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="data-po-current-page">{formatNumber(page)} / {formatNumber(totalPages)}</div>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setPage(current => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || loading}
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
