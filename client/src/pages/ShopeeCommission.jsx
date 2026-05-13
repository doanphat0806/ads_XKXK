import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, formatVND, todayString } from '../lib/api';

const DEFAULT_FROM_DATE = '2026-04-27';

export default function ShopeeCommission() {
  const [fromDate, setFromDate] = useState(DEFAULT_FROM_DATE);
  const [toDate, setToDate] = useState(() => todayString());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourcePreview, setSourcePreview] = useState(null);
  const [selectedColumnIndexes, setSelectedColumnIndexes] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [savingSource, setSavingSource] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const data = await api('GET', `/shopee/commission-summary?${params.toString()}`);
      setSummary(data);
      if (data.source?.url) setSourceUrl(data.source.url);
    } catch (error) {
      toast.error(`Loi tai thong ke Shopee: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDate = summary?.byDate || [];
  const columns = sourcePreview?.columns || [];
  const selectedColumns = useMemo(() => {
    const selectedSet = new Set(selectedColumnIndexes);
    return columns.filter(column => selectedSet.has(column.index));
  }, [columns, selectedColumnIndexes]);
  const sampleRows = sourcePreview?.sampleRows || [];
  const savedSource = summary?.source || {};
  const savedColumns = savedSource.columns || [];
  const selectedData = summary?.selectedData || {};
  const selectedRows = selectedData.rows || [];
  const selectedDataColumns = selectedData.columns || savedColumns;
  const avgDailySpend = useMemo(() => {
    const dayCount = Number(summary?.activeDayCount || 0);
    return dayCount > 0 ? Number(summary?.totalSpend || 0) / dayCount : 0;
  }, [summary]);

  const previewSource = async () => {
    const url = sourceUrl.trim();
    if (!url) {
      toast.error('Nhap link du lieu Shopee');
      return;
    }

    setPreviewLoading(true);
    try {
      const data = await api('POST', '/shopee/commission-source/preview', { url });
      setSourcePreview(data);
      setSelectedColumnIndexes((data.columns || []).map(column => column.index));
      toast.success(`Da doc ${formatNumber(data.columns?.length || 0)} cot`);
    } catch (error) {
      toast.error(`Khong doc duoc link: ${error.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleColumn = (columnIndex) => {
    setSelectedColumnIndexes(current => (
      current.includes(columnIndex)
        ? current.filter(index => index !== columnIndex)
        : [...current, columnIndex].sort((a, b) => a - b)
    ));
  };

  const saveSelectedColumns = async () => {
    const url = sourceUrl.trim();
    if (!url) {
      toast.error('Nhap link du lieu Shopee');
      return;
    }
    if (!selectedColumns.length) {
      toast.error('Chon it nhat 1 cot de luu');
      return;
    }

    setSavingSource(true);
    try {
      const data = await api('PUT', '/shopee/commission-source', {
        url,
        columns: selectedColumns.map(column => ({
          index: column.index,
          number: column.number,
          letter: column.letter,
          name: column.name
        }))
      });
      setSummary(current => ({
        ...(current || {}),
        source: data.source
      }));
      await loadSummary();
      toast.success('Da luu cac cot Shopee da chon');
    } catch (error) {
      toast.error(`Loi luu cot: ${error.message}`);
    } finally {
      setSavingSource(false);
    }
  };

  return (
    <div id="page-shopee-commission">
      <div className="stats-grid inventory-stats">
        <div className="stat g">
          <div className="stat-label">Chi tieu tu 27/04</div>
          <div className="stat-value stat-value-compact">{formatVND(summary?.totalSpend || 0)}</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Tai khoan Shopee</div>
          <div className="stat-value">{formatNumber(summary?.accountCount || 0)}</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Ngay co du lieu</div>
          <div className="stat-value">{formatNumber(summary?.activeDayCount || 0)}</div>
        </div>
        <div className="stat p">
          <div className="stat-label">TB chi tieu/ngay</div>
          <div className="stat-value stat-value-compact">{avgDailySpend > 0 ? formatVND(avgDailySpend) : '-'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Thong ke hoa hong Shopee</div>
          <div className="inventory-search">
            <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
            <button className="btn btn-ghost btn-sm" onClick={loadSummary} disabled={loading}>
              {loading ? 'Dang tai...' : 'Tai lai'}
            </button>
          </div>
        </div>
        <div style={{ padding: '0 20px 16px', color: 'var(--muted2)', fontSize: '12px' }}>
          Hien tai dang thong ke chi tieu camp. File hoa hong theo ma/ngay se noi vao day o buoc sau.
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Nguon du lieu Shopee</div>
          <div className="inventory-search" style={{ flex: 1 }}>
            <input
              value={sourceUrl}
              onChange={event => setSourceUrl(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') previewSource();
              }}
              placeholder="Dan link CSV hoac Google Sheet Shopee..."
              style={{ minWidth: '420px', flex: 1 }}
            />
            <button className="btn btn-ghost btn-sm" onClick={previewSource} disabled={previewLoading}>
              {previewLoading ? 'Dang doc...' : 'Xem cot'}
            </button>
          </div>
        </div>
        <div style={{ padding: '0 20px 16px', color: 'var(--muted2)', fontSize: '12px' }}>
          Dan link file hoa hong Shopee de xem ten cot va dong mau. Link Google Sheet can share quyen xem hoac dung link CSV export.
        </div>
        {columns.length > 0 && (
          <div style={{ padding: '0 20px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--muted2)', fontSize: '12px' }}>
                Dang chon {formatNumber(selectedColumns.length)} / {formatNumber(columns.length)} cot de xem.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedColumnIndexes(columns.map(column => column.index))}>
                  Chon tat ca
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedColumnIndexes([])}>
                  Bo chon
                </button>
                <button className="btn btn-p btn-sm" onClick={saveSelectedColumns} disabled={savingSource || selectedColumns.length === 0}>
                  {savingSource ? 'Dang luu...' : 'Luu cot da chon'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              {columns.map(column => {
                const selected = selectedColumnIndexes.includes(column.index);
                return (
                  <label
                    key={column.index}
                    title={`${column.letter} / #${column.number}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      minHeight: '32px',
                      maxWidth: '260px',
                      padding: '6px 10px',
                      border: `1px solid ${selected ? 'var(--p)' : 'var(--border)'}`,
                      borderRadius: '8px',
                      background: selected ? 'rgba(236, 72, 153, 0.10)' : 'var(--s1)',
                      color: 'var(--txt)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleColumn(column.index)}
                      aria-label={`Chon cot ${column.name}`}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.name}</span>
                  </label>
                );
              })}
            </div>

            {sampleRows.length > 0 && (
              <div className="tbl-wrap">
                {selectedColumns.length === 0 ? (
                  <div className="empty"><div className="ei">0</div><p>Chon cot de xem dong mau</p></div>
                ) : (
                <table className="tbl" style={{ minWidth: `${Math.max(700, selectedColumns.length * 140)}px` }}>
                  <thead>
                    <tr>
                      <th style={{ width: '70px' }}>Dong</th>
                      {selectedColumns.map(column => (
                        <th key={column.index}>{column.letter}. {column.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.slice(0, 5).map(row => (
                      <tr key={row.rowNumber}>
                        <td className="mono-sm">{row.rowNumber}</td>
                        {selectedColumns.map(column => (
                          <td key={column.index}>{row.cells?.[column.index] || ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Chi tieu theo ngay</div>
        </div>
        {savedColumns.length > 0 && (
          <div style={{ padding: '0 20px 16px', color: 'var(--muted2)', fontSize: '12px' }}>
            Bang nay chi hien cac cot sheet da luu. Cot cuoi la so tien chi tieu theo ngay khop voi cot thoi gian da chon.
            {selectedData.error ? ` Loi doc sheet: ${selectedData.error}` : ''}
          </div>
        )}
        <div className="tbl-wrap">
          {loading && !summary ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : savedColumns.length > 0 ? (
            selectedRows.length === 0 ? (
              <div className="empty"><div className="ei">0</div><p>Chua co du lieu sheet da luu</p></div>
            ) : (
              <table className="tbl" style={{ minWidth: `${Math.max(760, selectedDataColumns.length * 150 + 180)}px` }}>
                <thead>
                  <tr>
                    {selectedDataColumns.map(column => (
                      <th key={column.index}>{column.name}</th>
                    ))}
                    <th className="text-right">So tien chi tieu</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map(row => (
                    <tr key={row.rowNumber}>
                      {selectedDataColumns.map((column, index) => (
                        <td key={column.index}>{row.cells?.[index] || ''}</td>
                      ))}
                      <td className="text-right mono-sm">{row.spend > 0 ? formatVND(row.spend) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : byDate.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co du lieu chi tieu</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ngay</th>
                  <th className="text-right">Chi tieu</th>
                  <th className="text-right">Clicks</th>
                  <th className="text-right">Dong camp</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map(item => (
                  <tr key={item.date}>
                    <td>{String(item.date || '').split('-').reverse().join('/')}</td>
                    <td className="text-right mono-sm">{formatVND(item.spend || 0)}</td>
                    <td className="text-right mono-sm">{formatNumber(item.clicks || 0)}</td>
                    <td className="text-right mono-sm">{formatNumber(item.campaignRows || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
