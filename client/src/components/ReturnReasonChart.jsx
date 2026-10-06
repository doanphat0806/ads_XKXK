import React, { useMemo, useState } from 'react';
import { formatNumber } from '../lib/api';

const NO_REASON_LABEL = 'Chưa ghi lý do';
const MAX_BARS = 8;
const GROUPS = [
  { key: 'total', label: 'Tổng' },
  { key: 'sale', label: 'Sale' },
  { key: 'san', label: 'Sẵn' },
  { key: 'od', label: 'Order' },
  { key: 'sale119', label: 'Sale119+99' }
];

const formatShare = value => `${(Number(value || 0) * 100).toFixed(1).replace('.', ',')}%`;

// Bieu do thanh ngang: ly do hoan (the POS) tren cac don da hoan / dang hoan.
// % tinh tren so don hoan CO ghi ly do; don chua ghi ly do hien o dong mo ta.
export default function ReturnReasonChart({ data, loading = false, source = '' }) {
  const [groupKey, setGroupKey] = useState('total');
  const [hovered, setHovered] = useState(null);
  const [showTable, setShowTable] = useState(false);

  const view = useMemo(() => {
    const group = data?.[groupKey] || { returnCount: 0, reasons: [] };
    const noReason = group.reasons.find(item => item.label === NO_REASON_LABEL)?.count || 0;
    const withReason = Math.max(0, group.returnCount - noReason);
    const reasons = group.reasons.filter(item => item.label !== NO_REASON_LABEL);
    const shown = reasons.slice(0, MAX_BARS);
    const rest = reasons.slice(MAX_BARS);
    if (rest.length) {
      shown.push({ label: `Khác (${rest.length} lý do)`, count: rest.reduce((sum, item) => sum + item.count, 0) });
    }
    const rows = shown.map(item => ({ ...item, share: withReason > 0 ? item.count / withReason : 0 }));
    const max = Math.max(1, ...rows.map(item => item.count));
    return { returnCount: group.returnCount, noReason, withReason, rows, max };
  }, [data, groupKey]);

  const isSheetSource = source === 'google_sheet';

  return (
    <div className="card section-gap return-reason-card">
      <div className="card-header return-reason-header">
        <div>
          <div className="card-title">Lý do hoàn của khách</div>
          <div className="return-reason-sub">
            {view.returnCount > 0 && !isSheetSource ? (
              <>
                {formatNumber(view.withReason)} / {formatNumber(view.returnCount)} đơn hoàn có ghi lý do
                {view.noReason > 0 && <> · {formatNumber(view.noReason)} đơn chưa ghi ({formatShare(view.noReason / view.returnCount)})</>}
                {' · '}% tính trên đơn có ghi lý do, 1 đơn có thể có nhiều lý do
              </>
            ) : 'Đơn đã hoàn và đang hoàn, theo thẻ trên Pancake POS'}
          </div>
        </div>
        <div className="return-reason-controls">
          <div className="return-reason-tabs" role="tablist" aria-label="Nhóm đơn">
            {GROUPS.map(group => (
              <button
                key={group.key}
                type="button"
                role="tab"
                aria-selected={groupKey === group.key}
                className={`return-reason-tab${groupKey === group.key ? ' active' : ''}`}
                onClick={() => setGroupKey(group.key)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTable(value => !value)}>
            {showTable ? 'Xem biểu đồ' : 'Xem bảng'}
          </button>
        </div>
      </div>

      <div className="return-reason-body">
        {loading && !data ? (
          <div className="empty"><span className="spin">...</span><p>Đang tải...</p></div>
        ) : isSheetSource ? (
          <div className="empty"><p>Lý do hoàn lấy từ thẻ đơn trên Pancake POS. Đang dùng Google Sheet (chưa tải xong lịch sử đơn POS hoặc chưa cấu hình API key POS) nên chưa có dữ liệu.</p></div>
        ) : view.rows.length === 0 ? (
          <div className="empty"><div className="ei">0</div><p>Chưa có đơn hoàn ghi lý do</p></div>
        ) : showTable ? (
          <table className="tbl return-reason-table">
            <thead>
              <tr>
                <th>Lý do</th>
                <th className="text-right">Số đơn</th>
                <th className="text-right">% đơn có lý do</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map(row => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="text-right mono-sm">{formatNumber(row.count)}</td>
                  <td className="text-right mono-sm">{formatShare(row.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="return-reason-bars" role="img" aria-label="Biểu đồ lý do hoàn">
            {view.rows.map((row, index) => (
              <div
                key={row.label}
                className={`return-reason-row${hovered !== null && hovered !== index ? ' dim' : ''}`}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="return-reason-label" title={row.label}>{row.label}</div>
                <div className="return-reason-track">
                  <div className="return-reason-bar" style={{ width: `${(row.count / view.max) * 100}%` }} />
                  {hovered === index && (
                    <div className="return-reason-tooltip" role="tooltip">
                      <b>{row.label}</b>
                      <span>{formatNumber(row.count)} đơn · {formatShare(row.share)} đơn hoàn có lý do</span>
                    </div>
                  )}
                </div>
                <div className="return-reason-value">
                  <span className="return-reason-count">{formatNumber(row.count)}</span>
                  <span className="return-reason-share">{formatShare(row.share)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
