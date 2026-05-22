import React from 'react';
import { formatCompactInt, formatPercent } from '../../utils/formatters';

export default function GroupHeader({ group, expanded, onToggle, columnCount }) {
  return (
    <tr className="deal-group-header-row">
      <td colSpan={columnCount}>
        <button type="button" className="deal-group-header" onClick={onToggle}>
          <span className="deal-group-chevron">{expanded ? '▼' : '▶'}</span>
          <span className={`deal-staff-badge badge-${group.color}`}>[{group.prefix}]</span>
          <span className="deal-staff-name">{group.name}</span>
          <span className="deal-group-meta">{formatCompactInt(group.rows.length)} đơn</span>
          <span className="deal-group-meta">Tổng KĐ: {formatCompactInt(group.summary.slKhachDat)}</span>
          <span className="deal-group-meta">TB TLĐ: {formatPercent(group.summary.tiLeDat)}</span>
        </button>
      </td>
    </tr>
  );
}
