import React, { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, Link2, Pencil, Loader2 } from 'lucide-react';
import { formatVND, formatNumber } from '../../../lib/api';
import { formatPercent } from '../../../utils/formatters';

const SORT_OPTIONS = [
  { value: 'profit_desc', label: 'Lợi nhuận cao nhất' },
  { value: 'profit_asc', label: 'Lỗ nhiều nhất' },
  { value: 'orders_desc', label: 'Đơn nhiều nhất' },
  { value: 'cvr_desc', label: 'CVR cao nhất' },
  { value: 'commission_desc', label: 'Hoa hồng cao nhất' }
];

const EVAL_BADGE_CLASS = { good: 'active', critical: 'paused', warning: 'warning', neutral: 'neutral' };

const SOURCE_INFO = {
  campaign: { icon: Link2, label: 'Tự động từ Campaign', className: 'is-campaign' },
  manual: { icon: Pencil, label: 'Đã chỉnh tay', className: 'is-manual' },
  none: { icon: null, label: 'Chưa có dữ liệu', className: 'is-none' }
};

function sortRows(rows, sortKey) {
  const copy = [...rows];
  switch (sortKey) {
    case 'profit_asc': return copy.sort((a, b) => a.profit - b.profit);
    case 'orders_desc': return copy.sort((a, b) => b.orders - a.orders);
    case 'cvr_desc': return copy.sort((a, b) => b.cvr - a.cvr);
    case 'commission_desc': return copy.sort((a, b) => b.commissionTotal - a.commissionTotal);
    case 'profit_desc':
    default:
      return copy.sort((a, b) => b.profit - a.profit);
  }
}

function SourceBadge({ source }) {
  const info = SOURCE_INFO[source] || SOURCE_INFO.none;
  const Icon = info.icon;
  return (
    <span className={`shopee-social-source-badge ${info.className}`} title={info.label}>
      {Icon && <Icon size={11} strokeWidth={2.2} />}
    </span>
  );
}

function EditableCell({ value, onCommit, suffix = 'đ' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <td
        className="text-right mono-sm shopee-social-editable-cell"
        title="Nhấp đúp để chỉnh sửa"
        onDoubleClick={() => { setDraft(String(value)); setEditing(true); }}
      >
        {formatNumber(value)}{suffix}
      </td>
    );
  }

  function commit() {
    const n = Number(draft.replace(/[^\d.-]/g, ''));
    onCommit(Number.isFinite(n) ? Math.max(0, n) : 0);
    setEditing(false);
  }

  return (
    <td className="text-right">
      <input
        autoFocus
        className="shopee-social-input shopee-social-inline-input"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    </td>
  );
}

export default function SubIdMatrix({ rows, onCpcChange, onClicksChange, adsSpendLoading }) {
  const [sortKey, setSortKey] = useState('profit_desc');
  const sorted = useMemo(() => sortRows(rows, sortKey), [rows, sortKey]);

  return (
    <div className="card shopee-social-matrix-card">
      <div className="card-header">
        <div className="card-title">
          Ma Trận Hiệu Quả SubID2
          {adsSpendLoading && <Loader2 size={13} strokeWidth={2.5} className="shopee-social-spin" />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowDownWideNarrow size={15} strokeWidth={2} />
          <select className="shopee-social-input" value={sortKey} onChange={e => setSortKey(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="shopee-social-helper">
        <span className="shopee-social-source-badge is-campaign"><Link2 size={11} strokeWidth={2.2} /></span> Chi phí lấy tự động từ Campaign thật (khớp theo SubID2) ·
        <span className="shopee-social-source-badge is-manual"><Pencil size={11} strokeWidth={2.2} /></span> Đã chỉnh tay ·
        Nhấp đúp vào ô <strong>Clicks</strong> hoặc <strong>CPC</strong> để tự sửa khi cần.
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>SubID2</th>
              <th>Nền tảng</th>
              <th className="text-right">Clicks</th>
              <th className="text-right">Đơn</th>
              <th className="text-right">GMV</th>
              <th className="text-right">Hoa hồng</th>
              <th className="text-right">CPC</th>
              <th className="text-right">Chi phí Ads</th>
              <th className="text-right">Lợi nhuận</th>
              <th className="text-right">EPC</th>
              <th className="text-right">CVR</th>
              <th>Nguồn</th>
              <th>Đánh giá</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.subIdKey}>
                <td className="mono-sm" title={row.subIdKey}>{row.subIdKey}</td>
                <td>{row.platformLabel}</td>
                <EditableCell value={row.clicks} suffix="" onCommit={v => onClicksChange(row.subIdKey, v)} />
                <td className="text-right mono-sm">{formatNumber(row.orders)}</td>
                <td className="text-right mono-sm">{formatVND(row.gmv)}</td>
                <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{formatVND(row.commissionTotal)}</td>
                <EditableCell value={row.cpc} onCommit={v => onCpcChange(row.subIdKey, v)} />
                <td className="text-right mono-sm">{formatVND(row.adSpend)}</td>
                <td className="text-right mono-sm" style={{ color: row.profit >= 0 ? 'var(--g)' : 'var(--r)', fontWeight: 700 }}>
                  {formatVND(row.profit)}
                </td>
                <td className="text-right mono-sm">{formatVND(row.epc)}</td>
                <td className="text-right mono-sm">{formatPercent(row.cvr)}</td>
                <td><SourceBadge source={row.spendSource} /></td>
                <td><span className={`badge ${EVAL_BADGE_CLASS[row.evaluation.tone] || 'neutral'}`}>{row.evaluation.label}</span></td>
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: 20, color: 'var(--muted2)' }}>Không có dữ liệu SubID2 phù hợp bộ lọc</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
