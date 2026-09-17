import React, { useState } from 'react';
import { formatNumber, formatVND } from '../../../lib/api';

const WIDTH = 720;
const HEIGHT = 200;
const PAD_LEFT = 30;
const PAD_BOTTOM = 22;
const PAD_TOP = 10;

const BASE_COLOR = '#6da7ec'; // sequential blue, step 300
const PEAK_COLOR = '#eb6834'; // categorical slot 2 (orange) — emphasis on golden hours

export default function HourlyBarChart({ data }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map(d => d.orders), 1);
  const plotWidth = WIDTH - PAD_LEFT - 8;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barGap = 3;
  const barWidth = plotWidth / data.length - barGap;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="shopee-social-bar-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="shopee-social-bar-svg" role="img" aria-label="Phân bổ đơn hàng theo khung giờ">
        {gridLines.map(g => {
          const y = PAD_TOP + plotHeight * (1 - g);
          return (
            <g key={g}>
              <line x1={PAD_LEFT} x2={WIDTH - 4} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted2)">
                {Math.round(max * g)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const barHeight = max > 0 ? (d.orders / max) * plotHeight : 0;
          const x = PAD_LEFT + i * (barWidth + barGap);
          const y = PAD_TOP + plotHeight - barHeight;
          const color = d.isPeak ? PEAK_COLOR : BASE_COLOR;
          const isHovered = hovered === i;
          return (
            <g key={d.hour} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
              <rect
                x={x}
                y={y}
                width={Math.max(barWidth, 2)}
                height={Math.max(barHeight, 1)}
                rx={2}
                fill={color}
                opacity={hovered !== null && !isHovered ? 0.5 : 1}
              >
                <title>{`${d.hour}h: ${formatNumber(d.orders)} đơn — ${formatVND(d.commissionTotal)}`}</title>
              </rect>
              {d.isPeak && (
                <circle cx={x + barWidth / 2} cy={y - 6} r="2.5" fill={PEAK_COLOR} />
              )}
              {i % 2 === 0 && (
                <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" fontSize="9" fill="var(--muted2)">
                  {d.hour}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="shopee-social-bar-legend">
        <span><i className="shopee-social-dot" style={{ background: PEAK_COLOR }} /> Giờ vàng (đơn nhiều nhất)</span>
        <span><i className="shopee-social-dot" style={{ background: BASE_COLOR }} /> Khung giờ còn lại</span>
      </div>
    </div>
  );
}
