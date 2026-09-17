import React, { useState } from 'react';
import { formatVND } from '../../../lib/api';
import { formatPercent } from '../../../utils/formatters';

// Fixed categorical order (validated palette) — hue is assigned by platform identity, never by data rank.
const PLATFORM_COLORS = {
  facebook: '#2a78d6',
  tiktok: '#eb6834',
  telegram: '#1baf7a',
  zalo: '#eda100',
  threads: '#e87ba4',
  youtube: '#008300',
  instagram: '#4a3aa7',
  khac: '#898781'
};

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 76;
const STROKE = 26;
const GAP_DEG = 2;

function polarToCartesian(angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + RADIUS * Math.cos(rad), y: CENTER + RADIUS * Math.sin(rad) };
}

function describeArc(startAngle, endAngle) {
  const start = polarToCartesian(endAngle);
  const end = polarToCartesian(startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function labelPoint(angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const r = RADIUS;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

export default function PlatformDonutChart({ data }) {
  const [hovered, setHovered] = useState(null);
  const total = data.reduce((s, d) => s + d.commissionTotal, 0);

  const segments = data.reduce((acc, d) => {
    const cursor = acc.cursor;
    const share = total > 0 ? d.commissionTotal / total : 0;
    const sweep = share * 360;
    const startAngle = cursor + GAP_DEG / 2;
    const endAngle = cursor + sweep - GAP_DEG / 2;
    acc.cursor += sweep;
    acc.rows.push({ ...d, share, startAngle: Math.min(startAngle, endAngle), endAngle: Math.max(startAngle, endAngle) });
    return acc;
  }, { cursor: 0, rows: [] }).rows;

  if (!total) {
    return <div className="empty" style={{ minHeight: 200 }}><p>Chưa có dữ liệu để vẽ biểu đồ</p></div>;
  }

  return (
    <div className="shopee-social-donut-wrap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="shopee-social-donut-svg" role="img" aria-label="Phân bổ hoa hồng theo nền tảng">
        {segments.map(seg => {
          const color = PLATFORM_COLORS[seg.platformKey] || PLATFORM_COLORS.khac;
          const isHovered = hovered === seg.platformKey;
          return (
            <path
              key={seg.platformKey}
              d={describeArc(seg.startAngle, seg.endAngle)}
              stroke={color}
              strokeWidth={isHovered ? STROKE + 4 : STROKE}
              strokeLinecap="round"
              fill="none"
              opacity={hovered && !isHovered ? 0.45 : 1}
              onMouseEnter={() => setHovered(seg.platformKey)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer', transition: 'stroke-width 120ms ease, opacity 120ms ease' }}
            >
              <title>{`${seg.platformLabel}: ${formatVND(seg.commissionTotal)} (${formatPercent(seg.share)})`}</title>
            </path>
          );
        })}
        {segments.filter(s => s.share >= 0.08).map(seg => {
          const mid = (seg.startAngle + seg.endAngle) / 2;
          const pt = labelPoint(mid);
          return (
            <text
              key={`label-${seg.platformKey}`}
              x={pt.x}
              y={pt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fontWeight="700"
              fill="#ffffff"
              style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
            >
              {formatPercent(seg.share)}
            </text>
          );
        })}
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" fontSize="12" fill="var(--muted2)">Tổng HH</text>
        <text x={CENTER} y={CENTER + 14} textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--txt)">
          {formatVND(total).replace('₫', '').trim()}
        </text>
      </svg>

      <div className="shopee-social-legend">
        {segments.sort((a, b) => b.commissionTotal - a.commissionTotal).map(seg => (
          <div
            key={seg.platformKey}
            className={`shopee-social-legend-row ${hovered === seg.platformKey ? 'is-hovered' : ''}`}
            onMouseEnter={() => setHovered(seg.platformKey)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="shopee-social-legend-swatch" style={{ background: PLATFORM_COLORS[seg.platformKey] || PLATFORM_COLORS.khac }} />
            <span className="shopee-social-legend-label">{seg.platformLabel}</span>
            <span className="shopee-social-legend-value">{formatVND(seg.commissionTotal)}</span>
            <span className="shopee-social-legend-share">{formatPercent(seg.share)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
