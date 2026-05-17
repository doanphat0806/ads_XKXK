import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, todayString } from '../lib/api';

const DEFAULT_FROM_DATE = '2026-04-01';
const EMPTY_ARRAY = [];

export default function OderDashboard() {
  const [fromDate, setFromDate] = useState(DEFAULT_FROM_DATE);
  const [toDate, setToDate] = useState(() => todayString());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const result = await api('GET', `/oder/dashboard?${params.toString()}`);
      setData(result);
    } catch (error) {
      toast.error(`Loi tai dashboard: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dailyStats = data?.dailyStats || EMPTY_ARRAY;
  const totals = data?.totals || {};

  return (
    <div id="page-oder-dashboard">
      <div className="card">
        <div className="card-header">
          <div className="card-title">Dashboard Đơn Hàng</div>
          <div className="inventory-search">
            <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
            <button className="btn btn-ghost btn-sm" onClick={loadData} disabled={loading}>
              {loading ? 'Dang tai...' : 'Tai lai'}
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          {loading && !data ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : dailyStats.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co du lieu</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th className="text-right">Mã đơn hàng</th>
                  <th className="text-right">SL Hàng</th>
                  <th className="text-right">Mã Vận Đơn</th>
                  <th className="text-right">MVĐ Về</th>
                  <th className="text-right">Chưa có MVĐ</th>
                  <th className="text-right">Tỉ Lệ MVĐ/Đơn</th>
                  <th className="text-right">Thiếu Hàng</th>
                  <th className="text-right">Sai Hàng</th>
                  <th className="text-right">Về Thừa</th>
                  <th className="text-right">Thất Lạc</th>
                </tr>
              </thead>
              <tbody>
                {dailyStats.map(row => {
                  const tiLePercent = row.maDonHang > 0 ? (row.maVanDon / row.maDonHang) * 100 : 0;
                  const isWeekTotal = row.isWeekTotal;
                  const isMonthTotal = row.isMonthTotal;
                  const rowClass = isMonthTotal ? 'row-month-total' : isWeekTotal ? 'row-week-total' : '';

                  return (
                    <tr key={row.ngay} className={rowClass}>
                      <td>{row.ngay}</td>
                      <td className="text-right mono-sm">{formatNumber(row.maDonHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.slHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.maVanDon || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.mvdVe || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.chuaCoMvd || 0)}</td>
                      <td className="text-right mono-sm" style={{
                        backgroundColor: tiLePercent < 90 ? '#ff4444' : tiLePercent < 95 ? '#ff9933' : 'transparent',
                        color: tiLePercent < 90 ? 'white' : 'inherit'
                      }}>
                        {tiLePercent.toFixed(2)}%
                      </td>
                      <td className="text-right mono-sm">{formatNumber(row.thieuHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.saiHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.veThua || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.thatLac || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
