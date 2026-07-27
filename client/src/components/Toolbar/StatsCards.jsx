import React from 'react';
import { formatCompactInt, formatPercent } from '../../utils/formatters';

const CARDS = [
  { key: 'totalOrders', icon: '📦', label: 'Tổng Mã', accent: 'blue', render: value => `${formatCompactInt(value)} Mã` },
  { key: 'totalQuantity', icon: '👕', label: 'Tổng SL', accent: 'green', render: value => `${formatCompactInt(value)} sp` },
  { key: 'averageRate', icon: '📊', label: 'TB TL Đặt', accent: 'orange', render: value => formatPercent(value) },
  { key: 'totalShipped', icon: '🚚', label: 'Đã Ship', accent: 'purple', render: value => `${formatCompactInt(value)} sp` }
];

export default function StatsCards({ stats, loading = false }) {
  return (
    <div className="deal-stats-grid">
      {CARDS.map(card => (
        <div key={card.key} className={`deal-stat-card accent-${card.accent}`}>
          <div className="deal-stat-label">{card.icon} {card.label}</div>
          <div className="deal-stat-value">{loading ? '…' : card.render(stats[card.key] || 0)}</div>
        </div>
      ))}
    </div>
  );
}
