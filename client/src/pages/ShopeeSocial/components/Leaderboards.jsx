import React from 'react';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { formatVND, formatNumber } from '../../../lib/api';
import { formatPercent } from '../../../utils/formatters';

export default function Leaderboards({ topProducts, topShops, warnings }) {
  return (
    <div className="shopee-social-leaderboard-grid">
      <div className="card">
        <div className="card-header"><div className="card-title">Top Sản Phẩm Hot Trên Social</div></div>
        <ul className="shopee-social-rank-list">
          {topProducts.map((p, i) => (
            <li key={p.itemId || p.itemName}>
              <span className="shopee-social-rank-index">{i + 1}</span>
              <div className="shopee-social-rank-main">
                <div className="shopee-social-rank-title">{p.itemName}</div>
                <div className="shopee-social-rank-sub">{formatNumber(p.orders)} đơn · Xtra {formatPercent(p.xtraRate)}</div>
              </div>
              <div className="shopee-social-rank-value">{formatVND(p.commissionTotal)}</div>
            </li>
          ))}
          {!topProducts.length && <li className="shopee-social-rank-empty">Chưa có dữ liệu</li>}
        </ul>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Top Shop Chuyển Đổi Tốt Nhất</div></div>
        <ul className="shopee-social-rank-list">
          {topShops.map((s, i) => (
            <li key={s.shopId || s.shopName}>
              <span className="shopee-social-rank-index">{i + 1}</span>
              <div className="shopee-social-rank-main">
                <div className="shopee-social-rank-title">{s.shopName}</div>
                <div className="shopee-social-rank-sub">{formatNumber(s.orders)} đơn · Hủy {formatPercent(s.cancelRate)}</div>
              </div>
              <div className="shopee-social-rank-value">{formatVND(s.commissionTotal)}</div>
            </li>
          ))}
          {!topShops.length && <li className="shopee-social-rank-empty">Chưa có dữ liệu</li>}
        </ul>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Cảnh Báo Thông Minh</div></div>
        {warnings.length ? (
          <ul className="shopee-social-warning-list">
            {warnings.map((w, i) => (
              <li key={i} className={`shopee-social-warning-item ${w.level}`}>
                {w.level === 'critical' ? <TrendingDown size={16} strokeWidth={2} /> : <AlertTriangle size={16} strokeWidth={2} />}
                <div>
                  <div className="shopee-social-warning-title">{w.title}</div>
                  <div className="shopee-social-warning-detail">{w.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty" style={{ minHeight: 120 }}>
            <TrendingUp size={22} strokeWidth={2} />
            <p>Không có cảnh báo nào — mọi thứ đang ổn định</p>
          </div>
        )}
      </div>
    </div>
  );
}
