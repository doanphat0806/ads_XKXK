import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, formatVND, todayString } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';

function vnd(v) { return formatVND(Number(v || 0)); }
function num(v) { return formatNumber(Number(v || 0)); }
function pctRatio(v) {
  if (v === null || v === undefined) return '-';
  return `${(Number(v) * 100).toFixed(1)}%`;
}
function firstDayOfMonth() {
  return `${todayString().slice(0, 7)}-01`;
}

export default function ShopeeStats() {
  const [fromDate, setFromDate] = useState(firstDayOfMonth());
  const [toDate, setToDate]     = useState(todayString());
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(async (dateRange = {}) => {
    const activeFromDate = dateRange.fromDate || fromDate;
    const activeToDate = dateRange.toDate || toDate;
    setLoading(true);
    try {
      const result = await api('GET', `/reports/shopee-stats?from=${activeFromDate}&to=${activeToDate}`);
      setData(result);
    } catch (err) {
      toast.error(`Lỗi tải thống kê: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function handleExportExcel() {
    if (!data?.rows?.length) return;
    const XLSX = await import('xlsx');
    const headers = ['Tên Tk', 'Số TKQC', 'Camps Đang Chạy', 'Ads', 'HH', 'Ads/HH', 'HH sau thuế 30', 'HH sau thuế 35'];
    const aoa = [headers];
    for (const r of data.rows) {
      aoa.push([
        r.accountName,
        r.accountCount,
        r.campsRunning,
        r.ads,
        r.commission,
        r.adsPerHH === null ? '' : r.adsPerHH,
        r.hhAfterTax30,
        r.hhAfterTax35,
      ]);
    }
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!cols'] = headers.map(() => ({ wch: 16 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Thống kê Shopee');
    XLSX.writeFile(workbook, `thong-ke-shopee-${fromDate}_${toDate}.xlsx`);
  }

  return (
    <div id="page-shopee-stats">
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">Thống Kê Shopee</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onChange={(nextFrom, nextTo) => {
                setFromDate(nextFrom);
                setToDate(nextTo);
                load({ fromDate: nextFrom, toDate: nextTo });
              }}
              centered
            />
            <button className="btn btn-primary btn-sm" onClick={() => load()} disabled={loading}>
              {loading ? '⏳ Đang tải...' : '🔄 Tải lại'}
            </button>
            <button className="btn btn-sm" onClick={handleExportExcel} disabled={!data?.rows?.length}>
              📊 Xuất Excel
            </button>
          </div>
        </div>
      </div>

      {data?.totals && (
        <div className="shopee-stats-summary-grid">
          <div className="stat o">
            <div className="stat-label">Tổng Ads</div>
            <div className="stat-value stat-value-compact">{vnd(data.totals.ads)}</div>
          </div>
          <div className="stat g">
            <div className="stat-label">Tổng HH</div>
            <div className="stat-value stat-value-compact">{vnd(data.totals.commission)}</div>
          </div>
          <div className="stat teal">
            <div className="stat-label">Ads/HH</div>
            <div className="stat-value">{pctRatio(data.totals.adsPerHH)}</div>
          </div>
          <div className="stat b">
            <div className="stat-label">HH sau thuế 30</div>
            <div className="stat-value stat-value-compact">{vnd(data.totals.hhAfterTax30)}</div>
          </div>
          <div className="stat p">
            <div className="stat-label">HH sau thuế 35</div>
            <div className="stat-value stat-value-compact">{vnd(data.totals.hhAfterTax35)}</div>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="empty"><div className="ei">📊</div><p>Chọn khoảng ngày và nhấn "Tải lại" để xem thống kê</p></div>
      )}

      {data && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <colgroup>
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Tên Tk</th>
                  <th>Số TKQC</th>
                  <th className="text-right">Camps Đang Chạy</th>
                  <th className="text-right">Ads</th>
                  <th className="text-right">HH</th>
                  <th className="text-right">Ads/HH</th>
                  <th className="text-right">HH sau thuế 30</th>
                  <th className="text-right">HH sau thuế 35</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.affAccountId} style={i % 2 === 0 ? {} : { background: 'rgba(255,255,255,0.025)' }}>
                    <td>{r.accountName}</td>
                    <td className="mono-sm" title={r.adAccountId}>{r.accountCount}</td>
                    <td className="text-right mono-sm">{num(r.campsRunning)}</td>
                    <td className="text-right mono-sm">{vnd(r.ads)}</td>
                    <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{vnd(r.commission)}</td>
                    <td className="text-right mono-sm">{pctRatio(r.adsPerHH)}</td>
                    <td className="text-right mono-sm">{vnd(r.hhAfterTax30)}</td>
                    <td className="text-right mono-sm">{vnd(r.hhAfterTax35)}</td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--muted2)' }}>Không có dữ liệu trong khoảng ngày đã chọn</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
