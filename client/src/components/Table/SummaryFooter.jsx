import React from 'react';
import { formatCompactInt, formatCurrency, formatPercent } from '../../utils/formatters';

export default function SummaryFooter({ summary }) {
  return (
    <div className="deal-summary-footer">
      <span>TỔNG CỘNG</span>
      <span>Σ KĐ: {formatCompactInt(summary.slKhachDat)}</span>
      <span>Σ TĐ: {formatCompactInt(summary.slThucDat)}</span>
      <span>TB CPO: {formatCurrency(summary.cpo)}</span>
      <span>Σ Đang Gửi: {formatCompactInt(summary.dangGuiHang)}</span>
      <span>Σ Ship: {formatCompactInt(summary.tongDaShip)}</span>
      <span>TB TL Đặt: {formatPercent(summary.tiLeDat)}</span>
      <span>TB TL Hoàn: {formatPercent(summary.tiLeHoan)}</span>
      <span>TB TL Ship: {formatPercent(summary.tiLeShip)}</span>
    </div>
  );
}
