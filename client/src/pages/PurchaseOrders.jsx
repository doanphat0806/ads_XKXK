import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import DateRangePicker from '../components/DateRangePicker';
import { api, formatNumber, todayString, uploadForm } from '../lib/api';

const DEFAULT_LIMIT = 100;
const DATA_SYNC_DONE_STATES = new Set(['completed', 'failed']);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toLocaleString('vi-VN', {
    maximumFractionDigits: 1
  })}%`;
}

function isUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isImageUrl(value = '') {
  return /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(String(value || '').trim())
    || /^https?:\/\/.+(alicdn|pinduoduo|img|image|photo)/i.test(String(value || '').trim());
}

function shortText(value = '', maxLength = 42) {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatStatusEditorMeta(name = '', updatedAt = '') {
  const safeName = String(name || '').trim();
  if (!safeName) return '';

  const date = updatedAt ? new Date(updatedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return safeName;

  return `${safeName} • ${date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  })}`;
}

function parseSkuPasteValues(value = '') {
  const text = String(value || '').replace(/\r/g, '');
  if (!/[\n\t]/.test(text)) return [];

  return text
    .split('\n')
    .map(line => line.split('\t').find(cell => cell.trim()) || '')
    .map(cell => cell.trim())
    .filter(Boolean);
}

export default function PurchaseOrders() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [statusOptions, setStatusOptions] = useState([]);
  const [fromDate, setFromDate] = useState(todayString());
  const [toDate, setToDate] = useState(todayString());
  const [useDateFilter, setUseDateFilter] = useState(false);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncingData, setSyncingData] = useState(false);
  const [importingStatusCsv, setImportingStatusCsv] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const statusCsvInputRef = useRef(null);

  const loadRows = async ({ nextPage = page } = {}) => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit)
      });
      if (useDateFilter) {
        params.set('fromDate', fromDate);
        params.set('toDate', toDate);
      }
      if (activeSearch.trim()) params.set('search', activeSearch.trim());

      const data = await api('GET', `/purchase-orders?${params.toString()}`, null, { timeoutMs: 180000 });
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setSummary(data.summary || {});
      setStatusOptions(Array.isArray(data.statusOptions) ? data.statusOptions : []);
      setTotal(Number(data.total || 0));
      setTotalPages(Number(data.totalPages || 1));
      setPage(nextPage);
    } catch (err) {
      setError(err.message);
      toast.error(`Lỗi tải Đặt Hàng: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const syncDataPurchaseOrders = async () => {
    if (syncingData) return;
    setSyncingData(true);
    setError('');

    try {
      const result = await api('POST', '/data-purchase-orders/sync', null, { timeoutMs: 60000 });
      let imported = Number(result.imported || 0);

      if (result.queued && result.jobId) {
        toast.info(result.message || 'Đã bắt đầu đồng bộ DATA trong nền');
        let done = false;
        let finalJob = result.job || {};

        while (!done) {
          await wait(1500);
          let status;
          try {
            status = await api('GET', `/data-purchase-orders/sync/${result.jobId}`, null, { timeoutMs: 30000 });
          } catch (pollError) {
            if ([502, 503, 504].includes(Number(pollError.status)) || /request qua lau|may chu xu ly qua lau/i.test(pollError.message || '')) {
              continue;
            }
            throw pollError;
          }
          finalJob = status.job || {};
          done = DATA_SYNC_DONE_STATES.has(finalJob.state);

          if (finalJob.state === 'failed') {
            throw new Error(finalJob.error || finalJob.message || 'Đồng bộ DATA lỗi');
          }
        }

        imported = Number(finalJob.imported || 0);
      }

      toast.success(`Đã đồng bộ ${formatNumber(imported)} dòng DATA vào database`);
      try {
        await loadRows({ nextPage: 1 });
      } catch (refreshError) {
        toast.warning(`Da dong bo xong, nhung tai lai bang cham: ${refreshError.message}`);
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Lỗi đồng bộ DATA: ${err.message}`);
    } finally {
      setSyncingData(false);
    }
  };

  const importStatusCsvFile = async (file) => {
    if (!file || importingStatusCsv) return;
    setImportingStatusCsv(true);
    setError('');

    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadForm('/purchase-orders/import-status-csv', formData, { timeoutMs: 10 * 60 * 1000 });
      const skippedRows = Number(result.skippedNoOrder || 0)
        + Number(result.skippedNoUpdate || 0)
        + Number(result.skippedUnmatchedTracking || 0);
      const skippedStatusFields = Number(result.skippedNoStatus || 0)
        + Number(result.skippedInvalidStatus || 0);
      const statusImported = Number(result.statusImported ?? result.imported ?? 0);
      const skuImported = Number(result.skuImported || 0);
      const receivedQuantityImported = Number(result.receivedQuantityImported || 0);
      const importedParts = [];
      if (statusImported) importedParts.push(`${formatNumber(statusImported)} trạng thái`);
      if (skuImported) importedParts.push(`${formatNumber(skuImported)} mã SP`);
      if (receivedQuantityImported) importedParts.push(`${formatNumber(receivedQuantityImported)} SL hàng về`);
      if (!importedParts.length) importedParts.push(`${formatNumber(result.imported || 0)} dòng`);
      const notes = [];
      if (Number(result.unmatchedInData || 0)) notes.push(`${formatNumber(result.unmatchedInData)} mã chưa có DATA`);
      if (skippedRows) notes.push(`${formatNumber(skippedRows)} dòng bỏ qua`);
      if (skippedStatusFields) notes.push(`${formatNumber(skippedStatusFields)} trạng thái bỏ qua`);
      toast.success(`Đã nhập ${importedParts.join(', ')}${notes.length ? ` (${notes.join(', ')})` : ''}`);
      await loadRows({ nextPage: 1 });
    } catch (err) {
      setError(err.message);
      toast.error(`Lỗi import trạng thái/Mã SP: ${err.message}`);
    } finally {
      setImportingStatusCsv(false);
    }
  };

  const updateLocalRow = (orderId, patch) => {
    setRows(currentRows => currentRows.map(row => (
      row.orderId === orderId ? { ...row, ...patch } : row
    )));
  };

  const adjustSummaryTracking = (row, previousSupplementalValue, nextSupplementalValue) => {
    const baseTracking = Boolean(String(row?.trackingCode || '').trim());
    const hadTracking = baseTracking || Boolean(String(previousSupplementalValue || '').trim());
    const hasTracking = baseTracking || Boolean(String(nextSupplementalValue || '').trim());
    if (hadTracking === hasTracking) return;

    setSummary(current => ({
      ...current,
      trackingCount: Math.max(0, Number(current.trackingCount || 0) + (hasTracking ? 1 : -1))
    }));
  };

  const adjustSummaryStatus = (previousStatus, nextStatus) => {
    const summaryKeyByStatus = {
      ve_du: 'receivedFull',
      ve_thieu: 'missing',
      sai_hang: 'wrong',
      ve_thua: 'extra',
      that_lac: 'lost'
    };
    const previousKey = summaryKeyByStatus[previousStatus];
    const nextKey = summaryKeyByStatus[nextStatus];
    if (previousKey === nextKey) return;

    setSummary(current => {
      const nextSummary = { ...current };
      if (previousKey) nextSummary[previousKey] = Math.max(0, Number(nextSummary[previousKey] || 0) - 1);
      if (nextKey) nextSummary[nextKey] = Number(nextSummary[nextKey] || 0) + 1;
      return nextSummary;
    });
  };

  const saveRow = async (orderId, patch) => {
    if (!orderId) return;
    const key = `${orderId}:${Object.keys(patch).join(',')}`;
    setSavingKey(key);

    try {
      const result = await api('PATCH', `/purchase-orders/${encodeURIComponent(orderId)}`, patch);
      if (result.order) updateLocalRow(orderId, result.order);
    } catch (err) {
      toast.error(`Lỗi lưu đơn ${orderId}: ${err.message}`);
      await loadRows({ nextPage: page });
    } finally {
      setSavingKey('');
    }
  };

  const pasteSkuColumn = async (event, rowIndex) => {
    const values = parseSkuPasteValues(event.clipboardData?.getData('text') || '');
    if (values.length <= 1) return;

    event.preventDefault();
    const patches = rows
      .slice(rowIndex, rowIndex + values.length)
      .map((row, index) => ({
        orderId: row.orderId,
        skuManual: values[index]
      }))
      .filter(item => item.orderId);

    if (!patches.length) return;

    const patchByOrderId = new Map(patches.map(item => [item.orderId, item.skuManual]));
    setRows(currentRows => currentRows.map(row => (
      patchByOrderId.has(row.orderId)
        ? { ...row, skuManual: patchByOrderId.get(row.orderId) }
        : row
    )));
    setSavingKey('bulk-sku');

    try {
      await Promise.all(patches.map(item => (
        api('PATCH', `/purchase-orders/${encodeURIComponent(item.orderId)}`, {
          skuManual: item.skuManual
        })
      )));
      toast.success(`Đã paste ${formatNumber(patches.length)} mã SP`);
    } catch (err) {
      toast.error(`Lỗi paste mã SP: ${err.message}`);
      await loadRows({ nextPage: page });
    } finally {
      setSavingKey('');
    }
  };

  const handleSearchChange = (event) => {
    const nextSearch = event.target.value;
    setSearch(nextSearch);
    if (!nextSearch.trim() && activeSearch) {
      setActiveSearch('');
    }
  };

  useEffect(() => {
    loadRows({ nextPage: page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, useDateFilter, page, limit, activeSearch]);

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, useDateFilter, limit, activeSearch]);

  const summaryColumns = useMemo(() => ([
    { key: 'orderCount', label: 'Mã Đơn Hàng', value: formatNumber(summary.orderCount || 0) },
    { key: 'totalProductQuantity', label: 'Tổng SL SP', value: formatNumber(summary.totalProductQuantity || 0) },
    { key: 'trackingCount', label: 'Mã Vận Đơn', value: formatNumber(summary.trackingCount || 0) },
    { key: 'receivedFull', label: 'Về Đủ', value: formatNumber(summary.receivedFull || 0) },
    { key: 'missing', label: 'Thiếu', value: formatNumber(summary.missing || 0) },
    { key: 'wrong', label: 'Sai Hàng', value: formatNumber(summary.wrong || 0) },
    { key: 'extra', label: 'Về Thừa', value: formatNumber(summary.extra || 0) },
    { key: 'lost', label: 'Thất Lạc', value: formatNumber(summary.lost || 0) },
    { key: 'mvdRatio', label: 'Tỉ Lệ MVD/Đơn', value: formatPercent(summary.mvdRatio || 0) }
  ]), [summary]);

  const firstRow = total ? ((page - 1) * limit) + 1 : 0;
  const lastRow = Math.min(total, page * limit);

  return (
    <div id="page-purchase-orders">
      <div className="card section-gap purchase-toolbar-card">
        <div className="card-header purchase-toolbar-header">
          <div>
            <div className="card-title">Đặt Hàng</div>
            <div className="purchase-source">
              Nguồn: DATA ĐẶT HÀNG trong database | {useDateFilter ? `${fromDate} ~ ${toDate}` : 'Tất cả ngày đặt'}
            </div>
          </div>
          <div className="purchase-header-actions">
            <button className="btn btn-g btn-sm" onClick={syncDataPurchaseOrders} disabled={loading || syncingData}>
              <RefreshCw size={14} className={syncingData ? 'spin' : ''} />
              {syncingData ? 'Đang đồng bộ' : 'Đồng bộ DATA'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => statusCsvInputRef.current?.click()}
              disabled={loading || importingStatusCsv}
              title="Import CSV trạng thái và mã SP"
            >
              <Upload size={14} />
              {importingStatusCsv ? 'Đang nhập' : 'Nhập TT + Mã SP'}
            </button>
            <input
              ref={statusCsvInputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={importingStatusCsv}
              style={{ display: 'none' }}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                importStatusCsvFile(file);
              }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => loadRows({ nextPage: page })} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Làm mới
            </button>
          </div>
        </div>

        <div className="purchase-filters">
          <div className="purchase-date-control">
            <label>Ngày đặt</label>
            <div className="purchase-date-actions">
              <button
                type="button"
                className={`purchase-date-mode ${!useDateFilter ? 'active' : ''}`}
                onClick={() => setUseDateFilter(false)}
              >
                Tất cả
              </button>
              <button
                type="button"
                className={`purchase-date-mode ${useDateFilter ? 'active' : ''}`}
                onClick={() => setUseDateFilter(true)}
              >
                Theo ngày
              </button>
            </div>
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onChange={(nextFrom, nextTo) => {
                setFromDate(nextFrom);
                setToDate(nextTo);
                setUseDateFilter(true);
              }}
              centered
            />
          </div>

          <div className="form-group purchase-search">
            <label>Tìm đơn</label>
            <input
              value={search}
              onChange={handleSearchChange}
              onKeyDown={event => {
                if (event.key === 'Enter') setActiveSearch(search.trim());
              }}
              onPaste={event => {
                setTimeout(() => {
                  const pastedValue = event.target.value;
                  setSearch(pastedValue);
                  setActiveSearch(pastedValue.trim());
                }, 0);
              }}
              placeholder="Mã đơn, MVD, mã SP, thuộc tính, tài khoản..."
            />
          </div>

          <button className="btn btn-g purchase-search-btn" onClick={() => setActiveSearch(search.trim())} disabled={loading}>
            <Search size={14} />
            Lọc
          </button>
        </div>
      </div>

      <div className="card section-gap purchase-summary-card">
        <div className="purchase-summary-grid">
          {summaryColumns.map(item => (
            <div className="purchase-summary-item" key={item.key}>
              <div className="purchase-summary-label">{item.label}</div>
              <div className="purchase-summary-value">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card purchase-table-card">
        <div className="card-header purchase-table-header">
          <div className="card-title">Bảng đặt hàng ({formatNumber(total)} đơn)</div>
          <div className="purchase-page-size">
            <span>Hiển thị</span>
            <select value={limit} onChange={event => setLimit(Number(event.target.value))}>
              <option value="50">50 / trang</option>
              <option value="100">100 / trang</option>
              <option value="500">500 / trang</option>
            </select>
          </div>
        </div>

        <div className="tbl-wrap purchase-table-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Đang tải đặt hàng...</p></div>
          ) : error ? (
            <div className="empty"><p className="purchase-error">Lỗi: {error}</p></div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="ei">0</div>
              <p>{useDateFilter ? 'Không có đơn trong ngày đang chọn. Bấm Tất cả hoặc đổi ngày đặt.' : 'Chưa có dữ liệu đặt hàng. Bấm Đồng bộ DATA để lấy dữ liệu từ Sheet vào database.'}</p>
            </div>
          ) : (
            <table className="tbl purchase-table">
              <thead>
                <tr>
                  <th>Mã Đơn Hàng</th>
                  <th>Mã vận đơn hàng về</th>
                  <th>Mã vđ bù</th>
                  <th>Trạng Thái</th>
                  <th>Số lượng hàng về</th>
                  <th>Mã SP</th>
                  <th>Thuộc tính sp</th>
                  <th>Số Lượng</th>
                  <th>Ảnh</th>
                  <th>Tên tài khoản</th>
                  <th>Tổng tiền</th>
                  <th>Ngày đặt</th>
                  <th>Link sp</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const statusSaving = savingKey === `${row.orderId}:status`;
                  return (
                    <tr key={row.orderId}>
                      <td className="purchase-order-id">{row.orderId}</td>
                      <td>{row.trackingCode || '-'}</td>
                      <td>
                        <textarea
                          className="purchase-supplemental-tracking-input"
                          value={row.supplementalTrackingCode || ''}
                          onFocus={event => {
                            event.currentTarget.dataset.previousValue = row.supplementalTrackingCode || '';
                          }}
                          onChange={event => updateLocalRow(row.orderId, { supplementalTrackingCode: event.target.value })}
                          onBlur={event => {
                            const nextValue = event.target.value;
                            adjustSummaryTracking(row, event.currentTarget.dataset.previousValue || '', nextValue);
                            saveRow(row.orderId, { supplementalTrackingCode: nextValue });
                          }}
                        />
                      </td>
                      <td>
                        <div className="purchase-status-cell">
                          <select
                          className={`purchase-status-select ${row.statusClass || ''}`}
                          value={row.status || ''}
                          disabled={statusSaving}
                          onChange={event => {
                            const previousStatus = row.status || '';
                            const nextStatus = event.target.value;
                            const option = statusOptions.find(item => item.value === event.target.value);
                            updateLocalRow(row.orderId, {
                              status: nextStatus,
                              statusLabel: option?.label || '',
                              statusClass: option?.className || ''
                            });
                            adjustSummaryStatus(previousStatus, nextStatus);
                            saveRow(row.orderId, { status: nextStatus });
                          }}
                        >
                          <option value="">Chọn</option>
                          {statusOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                          <div className="purchase-status-editor" title={formatStatusEditorMeta(row.statusUpdatedByName, row.statusUpdatedAt)}>
                            {formatStatusEditorMeta(row.statusUpdatedByName, row.statusUpdatedAt) || '\u00A0'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <input
                          className="purchase-inline-input"
                          value={row.receivedQuantity || ''}
                          onChange={event => updateLocalRow(row.orderId, { receivedQuantity: event.target.value })}
                          onBlur={event => saveRow(row.orderId, { receivedQuantity: event.target.value })}
                        />
                      </td>
                      <td>
                        <textarea
                          className="purchase-sku-input"
                          value={row.skuManual || ''}
                          onChange={event => updateLocalRow(row.orderId, { skuManual: event.target.value })}
                          onPaste={event => pasteSkuColumn(event, rowIndex)}
                          onBlur={event => saveRow(row.orderId, { skuManual: event.target.value })}
                        />
                      </td>
                      <td title={row.productAttribute || ''}>{row.productAttribute || '-'}</td>
                      <td className="purchase-qty">{row.quantity || '-'}</td>
                      <td>
                        {isImageUrl(row.imageUrl) ? (
                          <a href={row.imageUrl} target="_blank" rel="noreferrer" title="Mở ảnh">
                            <img className="purchase-thumb" src={row.imageUrl} alt="" loading="lazy" />
                          </a>
                        ) : '-'}
                      </td>
                      <td title={row.accountName || ''}>{row.accountName || '-'}</td>
                      <td className="purchase-amount">{row.totalAmount || '-'}</td>
                      <td>{row.orderDate || '-'}</td>
                      <td>
                        {isUrl(row.productLink) ? (
                          <a href={row.productLink} target="_blank" rel="noreferrer">{shortText(row.productLink)}</a>
                        ) : (row.productLink || '-')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 && (
          <div className="purchase-pagination">
            <div className="purchase-range">{formatNumber(firstRow)} - {formatNumber(lastRow)} / {formatNumber(total)} đơn</div>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setPage(current => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              title="Trang trước"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="purchase-current-page">{formatNumber(page)} / {formatNumber(totalPages)}</div>
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
