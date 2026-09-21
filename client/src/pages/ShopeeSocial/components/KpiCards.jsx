import React from 'react';
import { formatVND, formatNumber } from '../../../lib/api';
import { formatPercent } from '../../../utils/formatters';

function Kpi({ tone, label, value, sub }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value stat-value-compact ${tone}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function KpiCards({ kpis, netProfit, totalAdSpend, totalClicks, totalActualReceived, realProfit }) {
  const blendedCpc = totalClicks > 0 ? totalAdSpend / totalClicks : 0;
  return (
    <div className="shopee-social-kpi-grid">
      <Kpi tone="b" label="Tổng GMV" value={formatVND(kpis.gmv)} />
      <Kpi
        tone="g"
        label="Tổng Hoa Hồng"
        value={formatVND(kpis.commissionTotal)}
        sub={`Shopee ${formatVND(kpis.commissionShopee)} · Xtra ${formatVND(kpis.commissionXtra)}`}
      />
      <Kpi
        tone="r"
        label="Chi Phí Ads"
        value={formatVND(totalAdSpend)}
        sub={`${formatNumber(totalClicks)} clicks · CPC TB ${formatVND(blendedCpc)}`}
      />
      <Kpi
        tone={netProfit >= 0 ? 'g' : 'r'}
        label="Lợi Nhuận Ròng"
        value={formatVND(netProfit)}
        sub="Hoa hồng − Chi phí Ads"
      />
      <Kpi
        tone="teal"
        label="Hoa Hồng Thực Nhận"
        value={formatVND(totalActualReceived)}
        sub="Ghi tay · tổng cộng dồn (không theo ngày lọc)"
      />
      <Kpi
        tone={realProfit >= 0 ? 'g' : 'r'}
        label="Lợi Nhuận Thực"
        value={formatVND(realProfit)}
        sub="Thực nhận − Chi phí Ads"
      />
      <Kpi
        tone="o"
        label="Chất Lượng"
        value={`${formatPercent(kpis.commissionOverGmv)} HH/GMV`}
        sub={`Đơn 0đ ${formatPercent(kpis.zeroValueRate)} · Hủy ${formatPercent(kpis.cancelRate)}`}
      />
    </div>
  );
}
