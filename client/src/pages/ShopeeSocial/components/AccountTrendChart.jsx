import React, { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatVND } from '../../../lib/api';
import { summarizeAccountTrend } from '../accountTrend';

const WIDTH = 640;
const HEIGHT = 130;
const PAD_LEFT = 50;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

const LINES = [
  { key: 'commission', label: 'Hoa hồng (ngày)', color: '#6da7ec' },
  { key: 'adSpend', label: 'Chi phí Ads (ngày)', color: '#eb6834' },
  { key: 'reportProfit', label: 'Lợi nhuận theo báo cáo (ngày)', color: '#18c9c8' },
  { key: 'reportProfitCumulative', label: 'Lợi nhuận theo báo cáo (lũy kế)', color: '#8b5cf6' }
];

// "Lợi nhuận theo báo cáo" (hoa hồng báo cáo − ads, theo ngày đặt đơn) là đường chính —
// có ngay không cần chờ. KHÔNG dùng "hoa hồng thực nhận" cho đường ngày vì Shopee trả
// tiền sau khi đơn hoàn thành (lệch 5-14 ngày), so thực nhận với Ads cùng ngày sẽ luôn
// ra "lỗ giả" ở ngày mới chi Ads. Thực nhận chỉ dùng để đối chiếu ở dòng "Đã nhận/Báo cáo".
const PRIMARY_KEY = 'reportProfit';

export default function AccountTrendChart({ accountName, series }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const gradientId = useId();
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const summary = useMemo(() => summarizeAccountTrend(series), [series]);

  const { min, max } = useMemo(() => {
    let mn = 0;
    let mx = 0;
    series.forEach(pt => {
      LINES.forEach(l => {
        mn = Math.min(mn, pt[l.key]);
        mx = Math.max(mx, pt[l.key]);
      });
    });
    if (mn === mx) { mn -= 1; mx += 1; }
    return { min: mn, max: mx };
  }, [series]);

  const xFor = i => PAD_LEFT + (series.length > 1 ? (i / (series.length - 1)) * plotWidth : plotWidth / 2);
  const yFor = v => PAD_TOP + plotHeight - ((v - min) / (max - min)) * plotHeight;

  function pathFor(key) {
    return series.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(pt[key]).toFixed(1)}`).join(' ');
  }

  function areaPathFor(key) {
    const baseline = HEIGHT - PAD_BOTTOM;
    const line = pathFor(key);
    const lastX = xFor(series.length - 1).toFixed(1);
    const firstX = xFor(0).toFixed(1);
    return `${line} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;
  }

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const ratio = plotWidth > 0 ? (xPx - PAD_LEFT) / plotWidth : 0;
    const idx = Math.round(ratio * (series.length - 1));
    setHoverIndex(Math.min(Math.max(idx, 0), series.length - 1));
  }

  const kpiRow = (
    <div className="shopee-social-account-kpi-row">
      <span>Lợi nhuận (báo cáo): <b style={{ color: summary.reportProfitTotal >= 0 ? 'var(--g)' : 'var(--r)' }}>{formatVND(summary.reportProfitTotal)}</b></span>
      <span>Chi phí Ads: <b>{formatVND(summary.totalAdSpend)}</b></span>
      <span>Hoa hồng: <b>{formatVND(summary.totalCommission)}</b></span>
      <span>Hoa hồng thực nhận: <b style={{ color: 'var(--g)' }}>{formatVND(summary.totalActualReceived)}</b></span>
      <span>Lợi nhuận thực: <b style={{ color: summary.realProfit >= 0 ? 'var(--g)' : 'var(--r)' }}>{formatVND(summary.realProfit)}</b></span>
      <span>ADS/HH: <b>{summary.adsOverCommission.toFixed(1)}%</b></span>
      <span>Đã nhận/Báo cáo: <b>{summary.receivedOverReported.toFixed(0)}%</b></span>
    </div>
  );

  if (!series.length) {
    return (
      <div className="card shopee-social-account-trend-card">
        <div className="card-header"><div className="card-title">{accountName}</div></div>
        <div className="empty" style={{ padding: 20, fontSize: 12 }}>Chưa có dữ liệu trong khoảng ngày đã chọn</div>
      </div>
    );
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const zeroY = yFor(0);
  const hovered = hoverIndex !== null ? series[hoverIndex] : null;
  const labelStep = Math.max(1, Math.ceil(series.length / 6));

  return (
    <div className="card shopee-social-account-trend-card">
      <button type="button" className="shopee-social-account-trend-header" onClick={() => setExpanded(v => !v)}>
        {expanded ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
        <span className="shopee-social-account-trend-name">{accountName}</span>
        {kpiRow}
      </button>

      {expanded && (
        <div className="shopee-social-bar-wrap">
          <div className="shopee-social-account-trend-summary">
            <strong>Lợi nhuận theo báo cáo theo ngày</strong>
            <span>
              Tổng: <b>{formatVND(summary.reportProfitTotal)}</b> · TB/ngày: <b>{formatVND(summary.avgDaily)}</b>
              {summary.peak && <> · Cao nhất: <b>{formatVND(summary.peak.reportProfit)}</b> ({summary.peak.date.slice(5)})</>}
            </span>
            <span style={{ color: 'var(--muted2)', fontSize: 11 }}>
              Đã ghi nhận thực nhận: <b>{formatVND(summary.totalActualReceived)}</b> / Hoa hồng báo cáo <b>{formatVND(summary.totalCommission)}</b>
              {' '}(<b>{summary.receivedOverReported.toFixed(0)}%</b>) — hoa hồng chỉ về sau khi đơn hoàn thành (5-14 ngày).
            </span>
          </div>

          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="shopee-social-trend-svg"
            role="img"
            aria-label={`Biểu đồ xu hướng tài khoản ${accountName}`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#18c9c8" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#18c9c8" stopOpacity="0" />
              </linearGradient>
            </defs>

            {gridLines.map(g => {
              const v = min + (max - min) * g;
              const y = yFor(v);
              return (
                <g key={g}>
                  <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
                  <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted2)">
                    {Math.round(v / 1000)}k
                  </text>
                </g>
              );
            })}
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={zeroY} y2={zeroY} stroke="var(--muted2)" strokeWidth="1" strokeDasharray="3 3" />

            <path d={areaPathFor(PRIMARY_KEY)} fill={`url(#${gradientId})`} stroke="none" />

            {LINES.map(l => (
              <path key={l.key} d={pathFor(l.key)} fill="none" stroke={l.color} strokeWidth={l.key === PRIMARY_KEY ? 2.5 : 1.5} />
            ))}

            {hoverIndex !== null && (
              <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="var(--border2)" strokeWidth="1" />
            )}

            {series.map((pt, i) => (i % labelStep === 0) && (
              <text key={pt.date} x={xFor(i)} y={HEIGHT - 8} textAnchor="middle" fontSize="9" fill="var(--muted2)">
                {pt.date.slice(5)}
              </text>
            ))}
          </svg>

          <div className="shopee-social-bar-legend">
            {LINES.map(l => (
              <span key={l.key}><i className="shopee-social-dot" style={{ background: l.color }} /> {l.label}</span>
            ))}
          </div>

          {hovered && (
            <div className="shopee-social-trend-tooltip">
              <strong>{hovered.date}</strong>
              {LINES.map(l => (
                <span key={l.key}>{l.label}: <b style={{ color: l.color }}>{formatVND(hovered[l.key])}</b></span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
