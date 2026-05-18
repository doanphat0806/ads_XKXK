import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, formatVND, todayString, uploadForm } from '../lib/api';

const DEFAULT_FROM_DATE = '2026-04-27';
const EMPTY_ARRAY = [];
const OPTIMIZATION_BADGE_CLASS = {
  pause: 'paused',
  warning: 'warning',
  testing: 'neutral',
  keep: 'active',
  scale: 'active',
  scale_strong: 'active'
};

function getOptimization(row = {}) {
  if (row.optimization) return row.optimization;

  const spend = Number(row.spend || 0);
  const commission = Number(row.commission || 0);
  const profit = commission - spend;
  const roi = spend > 0 ? (profit / spend) * 100 : (profit > 0 ? 100 : 0);

  if (spend >= 500000 && commission <= 0) {
    return { action: 'pause', label: 'TAT', reason: 'Tieu tu 500.000d nhung chua co hoa hong', roi };
  }
  if (spend >= 500000 && profit < 0) {
    return { action: 'pause', label: 'TAT', reason: 'Doanh thu am sau khi tieu tu 500.000d', roi };
  }
  if (spend >= 1000000 && profit <= 0) {
    return { action: 'pause', label: 'TAT', reason: 'Du nguong chi tieu va dang lo', roi };
  }
  if (spend > 0 && roi < 10) {
    return { action: 'pause', label: 'TAT', reason: 'ROI duoi 10%', roi };
  }
  if (profit < 0) {
    return { action: 'warning', label: 'AM DT', reason: 'Doanh thu dang am nhung chi tieu chua den nguong tat', roi };
  }
  if (spend >= 1000000 && roi < 15) {
    return { action: 'warning', label: 'CANH BAO', reason: 'ROI duoi 15%', roi };
  }
  if (spend >= 1000000 && roi >= 80) return { action: 'scale_strong', label: 'SCALE MANH', reason: 'ROI tu 80%', roi };
  if (spend >= 1000000 && roi >= 40) return { action: 'scale', label: 'SCALE NHE', reason: 'ROI tu 40%', roi };
  return { action: spend >= 1000000 ? 'keep' : 'testing', label: spend >= 1000000 ? 'GIU' : 'TEST THEM', reason: '', roi };
}

export default function ShopeeCommission() {
  const [fromDate, setFromDate] = useState(DEFAULT_FROM_DATE);
  const [toDate, setToDate] = useState(() => todayString());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const data = await api('GET', `/shopee/commission-summary?${params.toString()}`);
      setSummary(data);
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

  const commissionBySubId = summary?.commissionBySubId || EMPTY_ARRAY;
  const avgDailySpend = useMemo(() => {
    const dayCount = Number(summary?.activeDayCount || 0);
    return dayCount > 0 ? Number(summary?.totalSpend || 0) / dayCount : 0;
  }, [summary]);

  const importCommissionCsv = async (file) => {
    if (!file || importingCsv) return;

    setImportingCsv(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadForm('/shopee/commission-import-csv', formData, { timeoutMs: 10 * 60 * 1000 });
      toast.success(`Da import ${formatNumber(result.imported || 0)} dong tong hop hoa hong`);
      await loadSummary();
    } catch (error) {
      toast.error(`Loi import hoa hong Shopee: ${error.message}`);
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div id="page-shopee-commission">
      <div className="stats-grid inventory-stats">
        <div className="stat g">
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
        <div className="stat g">
          <div className="stat-label">Tong hoa hong</div>
          <div className="stat-value stat-value-compact">{formatVND(summary?.totalCommission || 0)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Thong ke Shopee</div>
          <div className="inventory-search">
            <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
            <button className="btn btn-ghost btn-sm" onClick={loadSummary} disabled={loading}>
              {loading ? 'Dang tai...' : 'Tai lai'}
            </button>
          </div>
        </div>
        <div style={{ padding: '0 20px 16px', color: 'var(--muted2)', fontSize: '12px' }}>
          Dang thong ke chi tieu camp va hoa hong da import theo khoang ngay da chon.
        </div>
        <div style={{ padding: '0 20px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Import CSV hoa hong</label>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importingCsv}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                importCommissionCsv(file);
              }}
            />
          </div>
          <div style={{ color: 'var(--muted2)', fontSize: '12px' }}>
            Lay cot Sub_id2, Thoi Gian Dat Hang va Tong hoa hong don hang trong file AffiliateCommissionReport.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Hoa hong theo SUB_ID2</div>
        </div>
        <div className="tbl-wrap">
          {loading && !summary ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : commissionBySubId.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co du lieu hoa hong da import</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>SUB_ID2</th>
                  <th className="text-right">Chi tieu</th>
                  <th className="text-right">Hoa hong</th>
                  <th className="text-right">Doanh thu</th>
                  <th className="text-right">%HH/ADS</th>
                  <th className="text-right">ROI</th>
                  <th>De xuat</th>
                </tr>
              </thead>
              <tbody>
                {commissionBySubId.map(row => {
                  const optimization = getOptimization(row);
                  const hhAdsPercent = Number(row.hhAdsPercent ?? (row.commission > 0 ? (row.doanhThu / row.commission) * 100 : 0));
                  const roi = Number(row.roi ?? (row.spend > 0 ? (row.doanhThu / row.spend) * 100 : 0));
                  const badgeClass = OPTIMIZATION_BADGE_CLASS[optimization.action] || 'neutral';
                  return (
                    <tr key={row.subId2}>
                      <td>{row.subId2}</td>
                      <td className="text-right mono-sm">{formatVND(row.spend || 0)}</td>
                      <td className="text-right mono-sm">{formatVND(row.commission || 0)}</td>
                      <td className="text-right mono-sm">{formatVND(row.doanhThu || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(hhAdsPercent)}%</td>
                      <td className="text-right mono-sm">{formatNumber(roi)}%</td>
                      <td>
                        <span className={`badge ${badgeClass}`} title={optimization.reason || ''}>
                          {optimization.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
