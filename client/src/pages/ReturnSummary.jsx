import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppContext } from '../contexts/AppContext';
import { api, formatNumber, formatVND } from '../lib/api';

const EMPTY_ARRAY = [];
const BUCKET_KEYS = ['san', 'sale', 'sale119', 'od'];
const CPO_WARNING_LIMIT = 120000;
const PRODUCT_RETURN_RATE_BOXES = [
  { key: 'total', label: 'Tổng' },
  { key: 'sale', label: 'Sale' },
  { key: 'san', label: 'Sẵn' },
  { key: 'od', label: 'Order' },
  { key: 'sale119', label: 'Sale119+99' }
];

function displayDate(dateKey = '') {
  const [year, month, day] = String(dateKey || '').split('-');
  if (!year || !month || !day) return dateKey || '-';
  return `${day}/${month}/${year}`;
}

function getCategory(row = {}, key = '') {
  return (row.categories || EMPTY_ARRAY).find(item => item.key === key) || {
    key,
    label: key,
    orderCount: 0,
    amount: 0,
    costPerOrder: 0
  };
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2).replace('.', ',')}%`;
}

function formatCpo(value) {
  return Number(value || 0) > 0 ? formatVND(value) : '-';
}

function getCpoClassName(value) {
  return `text-right mono-sm${Number(value || 0) > CPO_WARNING_LIMIT ? ' return-cpo-warn' : ''}`;
}

export default function ReturnSummary() {
  const { provider } = useAppContext();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadSummary = async ({ refresh = false } = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ provider });
      if (refresh) params.set('refresh', 'true');

      const data = await api('GET', `/return-summary?${params.toString()}`, null, { timeoutMs: 180000 });
      setSummary(data);
    } catch (error) {
      toast.error(`Lỗi tải Tổng hoàn: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryRows = summary?.categories || EMPTY_ARRAY;
  const dailyRows = summary?.dailyRows || EMPTY_ARRAY;
  const productReturnTotal = summary?.productReturnTotal;
  const productReturnCategoryRows = summary?.productReturnCategories || EMPTY_ARRAY;
  const total = summary?.total || {};
  const productReturnRateRows = useMemo(() => {
    const byKey = productReturnCategoryRows.reduce((acc, item) => {
      if (item?.key) acc[item.key] = item;
      return acc;
    }, {});

    return PRODUCT_RETURN_RATE_BOXES.map(box => ({
      ...box,
      ...(box.key === 'total' ? productReturnTotal : byKey[box.key])
    }));
  }, [productReturnCategoryRows, productReturnTotal]);
  const activeDayCount = useMemo(() => dailyRows.filter(row => (
    Number(row.total?.orderCount || 0) > 0 || Number(row.total?.amount || 0) > 0
  )).length, [dailyRows]);
  const dateRangeLabel = 'Toàn thời gian';

  return (
    <div id="page-return-summary">
      <div className="return-summary-grid section-gap">
        <div className="stat g">
          <div className="stat-label">Tổng đơn</div>
          <div className="stat-value">{formatNumber(total.orderCount || 0)}</div>
          <div className="stat-sub">Toàn bộ đơn</div>
        </div>
        <div className="stat teal">
          <div className="stat-label">Tỉ lệ ship</div>
          <div className="stat-value">{formatPercent(total.shipRate || 0)}</div>
          <div className="stat-sub">
            {formatNumber(total.shippedOrderCount || 0)} / {formatNumber(total.orderCount || 0)}
          </div>
        </div>
        <div className="stat o">
          <div className="stat-label">Tổng tiền</div>
          <div className="stat-value stat-value-compact">{formatVND(total.amount || 0)}</div>
          <div className="stat-sub">Theo tên quảng cáo</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Chi phí / đơn</div>
          <div className="stat-value stat-value-compact">
            {Number(total.costPerOrder || 0) > 0 ? formatVND(total.costPerOrder) : '-'}
          </div>
          <div className="stat-sub">Tổng tiền / tổng đơn</div>
        </div>
        <div className="stat p">
          <div className="stat-label">Ngày có dữ liệu</div>
          <div className="stat-value">{formatNumber(activeDayCount)}</div>
          <div className="stat-sub">{dateRangeLabel}</div>
        </div>
      </div>

      <div className="card section-gap return-toolbar-card">
        <div className="card-header">
          <div className="return-product-rate-panel">
            <div className="card-title">Tỉ lệ hoàn theo sản phẩm</div>
            <div className="return-product-rate-grid">
              {productReturnRateRows.map(row => (
                <div className="return-product-rate-box" key={row.key}>
                  <div className="return-product-rate-label">{row.label}</div>
                  <div className="return-product-rate-value">{formatPercent(row.rate || 0)}</div>
                  <div className="return-product-rate-sub">
                    {formatNumber(row.returnCount || 0)} / {formatNumber(row.denominator || 0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Tổng theo nhóm</div>
        </div>
        <div className="tbl-wrap return-table-wrap">
          {loading && !summary ? (
            <div className="empty"><span className="spin">...</span><p>Đang tải...</p></div>
          ) : categoryRows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chưa có dữ liệu</p></div>
          ) : (
            <table className="tbl return-summary-table">
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th className="text-right">Số đơn</th>
                  <th className="text-right">Số tiền</th>
                  <th className="text-right">Chi phí / đơn</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map(row => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td className="text-right mono-sm">{formatNumber(row.orderCount || 0)}</td>
                    <td className="text-right mono-sm">{formatVND(row.amount || 0)}</td>
                    <td className={getCpoClassName(row.costPerOrder)}>{formatCpo(row.costPerOrder)}</td>
                  </tr>
                ))}
                <tr className="return-total-row">
                  <td>Tổng</td>
                  <td className="text-right mono-sm">{formatNumber(total.orderCount || 0)}</td>
                  <td className="text-right mono-sm">{formatVND(total.amount || 0)}</td>
                  <td className={getCpoClassName(total.costPerOrder)}>{formatCpo(total.costPerOrder)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Chi tiết theo ngày</div>
        </div>
        <div className="tbl-wrap return-table-wrap">
          {loading && !summary ? (
            <div className="empty"><span className="spin">...</span><p>Đang tải...</p></div>
          ) : dailyRows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Không có dữ liệu trong khoảng ngày này</p></div>
          ) : (
            <table className="tbl return-daily-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  {BUCKET_KEYS.map(key => {
                    const label = getCategory({ categories: categoryRows }, key).label;
                    return (
                      <React.Fragment key={key}>
                        <th className="text-right">{label} đơn</th>
                        <th className="text-right">{label} tiền</th>
                        <th className="text-right">{label} CPO</th>
                      </React.Fragment>
                    );
                  })}
                  <th className="text-right">Tổng đơn</th>
                  <th className="text-right">Tỉ lệ ship</th>
                  <th className="text-right">Tổng tiền</th>
                  <th className="text-right">Tổng CPO</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map(row => (
                  <tr key={row.date}>
                    <td className="mono-sm">{displayDate(row.date)}</td>
                    {BUCKET_KEYS.map(key => {
                      const item = getCategory(row, key);
                      return (
                        <React.Fragment key={key}>
                          <td className="text-right mono-sm">{formatNumber(item.orderCount || 0)}</td>
                          <td className="text-right mono-sm">{formatVND(item.amount || 0)}</td>
                          <td className={getCpoClassName(item.costPerOrder)}>{formatCpo(item.costPerOrder)}</td>
                        </React.Fragment>
                      );
                    })}
                    <td className="text-right mono-sm">{formatNumber(row.total?.orderCount || 0)}</td>
                    <td className="text-right mono-sm">{formatPercent(row.total?.shipRate || 0)}</td>
                    <td className="text-right mono-sm">{formatVND(row.total?.amount || 0)}</td>
                    <td className={getCpoClassName(row.total?.costPerOrder)}>{formatCpo(row.total?.costPerOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
