import React, { useMemo } from 'react';
import { formatVND } from '../../../lib/api';
import { summarizeAccountTrend } from '../accountTrend';

export default function AccountsSummaryTable({ accountTrends }) {
  const rows = useMemo(
    () => accountTrends.map(({ accountName, series }) => ({ accountName, ...summarizeAccountTrend(series) })),
    [accountTrends]
  );

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    totalCommission: acc.totalCommission + r.totalCommission,
    totalAdSpend: acc.totalAdSpend + r.totalAdSpend,
    totalActualReceived: acc.totalActualReceived + r.totalActualReceived,
    reportProfitTotal: acc.reportProfitTotal + r.reportProfitTotal
  }), { totalCommission: 0, totalAdSpend: 0, totalActualReceived: 0, reportProfitTotal: 0 }), [rows]);

  const totalAdsOverCommission = totals.totalCommission > 0 ? (totals.totalAdSpend / totals.totalCommission) * 100 : 0;
  const totalReceivedOverReported = totals.totalCommission > 0 ? (totals.totalActualReceived / totals.totalCommission) * 100 : 0;
  const totalRealProfit = totals.totalActualReceived - totals.totalAdSpend;

  if (!rows.length) return null;

  return (
    <div className="card shopee-social-accounts-summary-card">
      <div className="card-header">
        <div className="card-title">Tổng Hợp Theo Tài Khoản</div>
      </div>

      {/* CSS grid, not an HTML table — every row (head/data/foot) shares the exact same
          grid-template-columns, so columns are guaranteed to line up regardless of how
          long a header label or a value is (a real <table> lets header text width push
          its whole column wider than the data needs, throwing columns out of line). */}
      <div className="shopee-social-summary-grid">
        <div className="shopee-social-summary-row shopee-social-summary-head">
          <div>Tài khoản</div>
          <div className="text-right">Hoa hồng</div>
          <div className="text-right">Chi phí Ads</div>
          <div className="text-right">Lợi nhuận (báo cáo)</div>
          <div className="text-right">Hoa hồng thực nhận</div>
          <div className="text-right">Lợi nhuận thực</div>
          <div className="text-right">ADS/HH</div>
          <div className="text-right">Đã nhận/Báo cáo</div>
        </div>

        {rows.map(r => (
          <div className="shopee-social-summary-row" key={r.accountName}>
            <div>{r.accountName}</div>
            <div className="text-right mono-sm">{formatVND(r.totalCommission)}</div>
            <div className="text-right mono-sm">{formatVND(r.totalAdSpend)}</div>
            <div className="text-right mono-sm" style={{ color: r.reportProfitTotal >= 0 ? 'var(--g)' : 'var(--r)', fontWeight: 600 }}>
              {formatVND(r.reportProfitTotal)}
            </div>
            <div className="text-right mono-sm" style={{ color: 'var(--g)' }}>{formatVND(r.totalActualReceived)}</div>
            <div className="text-right mono-sm" style={{ color: r.realProfit >= 0 ? 'var(--g)' : 'var(--r)', fontWeight: 600 }}>
              {formatVND(r.realProfit)}
            </div>
            <div className="text-right mono-sm">{r.adsOverCommission.toFixed(1)}%</div>
            <div className="text-right mono-sm">{r.receivedOverReported.toFixed(0)}%</div>
          </div>
        ))}

        <div className="shopee-social-summary-row shopee-social-summary-foot">
          <div><strong>Tổng cộng</strong></div>
          <div className="text-right mono-sm"><strong>{formatVND(totals.totalCommission)}</strong></div>
          <div className="text-right mono-sm"><strong>{formatVND(totals.totalAdSpend)}</strong></div>
          <div className="text-right mono-sm" style={{ color: totals.reportProfitTotal >= 0 ? 'var(--g)' : 'var(--r)' }}>
            <strong>{formatVND(totals.reportProfitTotal)}</strong>
          </div>
          <div className="text-right mono-sm" style={{ color: 'var(--g)' }}><strong>{formatVND(totals.totalActualReceived)}</strong></div>
          <div className="text-right mono-sm" style={{ color: totalRealProfit >= 0 ? 'var(--g)' : 'var(--r)' }}>
            <strong>{formatVND(totalRealProfit)}</strong>
          </div>
          <div className="text-right mono-sm"><strong>{totalAdsOverCommission.toFixed(1)}%</strong></div>
          <div className="text-right mono-sm"><strong>{totalReceivedOverReported.toFixed(0)}%</strong></div>
        </div>
      </div>
    </div>
  );
}
