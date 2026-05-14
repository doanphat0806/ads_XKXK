import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, formatVND, todayString } from '../lib/api';

const DEFAULT_FROM_DATE = '2026-04-27';

function normalizeShopeeColumnName(value) {
  return String(value || '')
    .replace(/[\u0111\u0110]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findShopeeSubIdColumn(columns = []) {
  return columns.find(column => {
    const normalized = normalizeShopeeColumnName(column.name);
    return normalized.includes('subid2') || normalized.includes('subid') || normalized === 'sub';
  }) || null;
}

function findShopeeCommissionColumn(columns = []) {
  return columns.find(column => {
    const normalized = normalizeShopeeColumnName(column.name);
    return normalized.includes('hoahong') || normalized.includes('commission');
  }) || null;
}

function parseShopeeMoney(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return 0;

  let cleaned = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/(?!^)-/g, '');
  if (!cleaned || cleaned === '-') return 0;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    cleaned = lastComma > lastDot
      ? cleaned.replace(/\./g, '').split(',')[0]
      : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    cleaned = cleaned.split(',')[0].replace(/,/g, '');
  } else if (lastDot >= 0) {
    const parts = cleaned.split('.');
    cleaned = parts.length === 2 && parts[1].length === 3
      ? cleaned.replace(/\./g, '')
      : parts[0];
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  const subIdColumn = useMemo(() => findShopeeSubIdColumn(selectedDataColumns), [selectedDataColumns]);
  const commissionColumn = useMemo(() => findShopeeCommissionColumn(selectedDataColumns), [selectedDataColumns]);
  const selectedColumnPositionByIndex = useMemo(() => (
    new Map(selectedDataColumns.map((column, index) => [column.index, index]))
  ), [selectedDataColumns]);
  const commissionBySubId = useMemo(() => {
    if (!subIdColumn || !commissionColumn) return [];

    const subIdPosition = selectedColumnPositionByIndex.get(subIdColumn.index);
    const commissionPosition = selectedColumnPositionByIndex.get(commissionColumn.index);
    if (!Number.isInteger(subIdPosition) || !Number.isInteger(commissionPosition)) return [];

    const groups = new Map();
    for (const row of selectedRows) {
      const subId = String(row.cells?.[subIdPosition] || '').trim();
      if (!subId) continue;

      const commission = parseShopeeMoney(row.cells?.[commissionPosition]);
      if (!groups.has(subId)) {
        groups.set(subId, { subId, commission: 0, rowCount: 0 });
      }
      const group = groups.get(subId);
      group.commission += commission;
      group.rowCount += 1;
    }

    return [...groups.values()]
      .map(group => ({
        ...group,
        commission: Math.round(group.commission)
      }))
      .sort((a, b) => b.commission - a.commission || a.subId.localeCompare(b.subId));
  }, [commissionColumn, selectedColumnPositionByIndex, selectedRows, subIdColumn]);
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
            Bang nay tong hop hoa hong theo tung SUB_ID2 va lam tron so tien hoa hong.
            {selectedData.error ? ` Loi doc sheet: ${selectedData.error}` : ''}
          </div>
        )}
        <div className="tbl-wrap">
          {loading && !summary ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : savedColumns.length > 0 ? (
            commissionBySubId.length > 0 ? (
              <table className="tbl" style={{ minWidth: '620px' }}>
                <thead>
                  <tr>
                    <th>SUB_ID2</th>
                    <th className="text-right">Tong hoa hong</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionBySubId.map(row => (
                    <tr key={row.subId}>
                      <td>{row.subId}</td>
                      <td className="text-right mono-sm">{formatVND(row.commission || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : selectedRows.length === 0 ? (
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
