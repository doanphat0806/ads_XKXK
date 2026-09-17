import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';

import { parseOrdersFile, parseClickReportFile } from './parseFile';
import { generateDemoOrders, generateDemoClicksBySubId, generateDemoCpcDefaults } from './demoData';
import {
  filterOrders, computeKpis, buildSubIdMatrix, computePlatformDistribution,
  computeHourlyDistribution, computeTopProducts, computeTopShops, computeWarnings
} from './calculations';
import { downloadTextFile, rowsToCsv } from './utils';
import { loadState, saveState, clearState } from './storage';
import { fetchAdsSpendBySubId2 } from './adsSpendApi';
import { importOrdersToServer, fetchSavedOrders, deleteSavedOrders } from './ordersApi';

import UploadPanel from './components/UploadPanel';
import FiltersBar from './components/FiltersBar';
import KpiCards from './components/KpiCards';
import SubIdMatrix from './components/SubIdMatrix';
import PlatformDonutChart from './components/PlatformDonutChart';
import HourlyBarChart from './components/HourlyBarChart';
import Leaderboards from './components/Leaderboards';
import OrdersTable from './components/OrdersTable';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateRangeOf(orders) {
  const times = orders.map(o => o.orderTime).filter(Boolean).map(d => d.getTime());
  // No parseable order dates in this file (e.g. the date column wasn't recognized) —
  // leave the range unset so the date filter doesn't silently hide every row.
  if (!times.length) return { fromDate: null, toDate: null };
  const toStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { fromDate: toStr(new Date(Math.min(...times))), toDate: toStr(new Date(Math.max(...times))) };
}

const DEFAULT_FILTERS = { platformKey: 'all', status: 'all', search: '' };

export default function ShopeeSocial() {
  const [orders, setOrders] = useState([]);
  const [fileName, setFileName] = useState('');
  const [defaultCpc, setDefaultCpc] = useState(0);
  const [cpcBySubId, setCpcBySubId] = useState({});
  const [clicksBySubId, setClicksBySubId] = useState({});
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, fromDate: todayStr(), toDate: todayStr() });
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [adsSpendBySubId2, setAdsSpendBySubId2] = useState({});
  const [adsSpendLoading, setAdsSpendLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const local = loadState();

    function restoreFrom(sourceOrders, opts = {}) {
      if (cancelled) return;
      setOrders(sourceOrders);
      setFileName(opts.fileName || local?.fileName || '');
      setDefaultCpc(local?.defaultCpc || 0);
      setCpcBySubId(local?.cpcBySubId || {});
      setClicksBySubId(local?.clicksBySubId || {});
      setFilters({ ...DEFAULT_FILTERS, ...dateRangeOf(sourceOrders) });
    }

    (async () => {
      try {
        const serverOrders = await fetchSavedOrders();
        if (serverOrders.length) {
          restoreFrom(serverOrders, { fileName: serverOrders[0]?.sourceFileName });
        } else if (local?.orders?.length) {
          // Report uploaded before server persistence existed — migrate it up now.
          restoreFrom(local.orders);
          importOrdersToServer(local.orders, local.fileName).catch(() => {});
        }
      } catch {
        // Server unreachable — fall back to the local cache so the page still works.
        if (local?.orders?.length) restoreFrom(local.orders);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveState({ orders, fileName, defaultCpc, cpcBySubId, clicksBySubId });
  }, [hydrated, orders, fileName, defaultCpc, cpcBySubId, clicksBySubId]);

  // Real Facebook ad spend, matched to orders by SubID2 (see adsSpendApi.js). Refetches
  // whenever the selected date range changes so spend always lines up with what's on screen.
  useEffect(() => {
    if (!orders.length || !filters.fromDate || !filters.toDate) {
      setAdsSpendBySubId2({});
      return;
    }
    let cancelled = false;
    setAdsSpendLoading(true);
    fetchAdsSpendBySubId2(filters.fromDate, filters.toDate)
      .then(map => { if (!cancelled) setAdsSpendBySubId2(map); })
      .catch(err => { if (!cancelled) toast.error(`Lỗi tải chi phí Ads: ${err.message}`); })
      .finally(() => { if (!cancelled) setAdsSpendLoading(false); });
    return () => { cancelled = true; };
  }, [orders.length, filters.fromDate, filters.toDate]);

  const applyNewDataset = useCallback((nextOrders, name, nextClicks = {}, nextCpc = {}, nextDefaultCpc = 0) => {
    setOrders(nextOrders);
    setFileName(name);
    setClicksBySubId(nextClicks);
    setCpcBySubId(nextCpc);
    setDefaultCpc(nextDefaultCpc);
    setFilters({ ...DEFAULT_FILTERS, ...dateRangeOf(nextOrders) });
  }, []);

  async function handleFile(file) {
    setLoading(true);
    try {
      const parsed = await parseOrdersFile(file);
      if (!parsed.length) {
        toast.error('Không tìm thấy đơn hàng nào trong file.');
        return;
      }
      applyNewDataset(parsed, file.name, {}, {}, 0);
      try {
        await importOrdersToServer(parsed, file.name);
        toast.success(`Đã tải và lưu ${parsed.length} đơn hàng từ "${file.name}"`);
      } catch (syncErr) {
        toast.error(`Đã tải ${parsed.length} đơn nhưng lưu vào server thất bại: ${syncErr.message}`);
      }
    } catch (err) {
      toast.error(`Lỗi đọc file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleClickReportFile(file) {
    setLoading(true);
    try {
      const clicksMap = await parseClickReportFile(file);
      setClicksBySubId(prev => ({ ...prev, ...clicksMap }));
      toast.success(`Đã cập nhật số click cho ${Object.keys(clicksMap).length} SubID`);
    } catch (err) {
      toast.error(`Lỗi đọc báo cáo click: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleLoadDemo() {
    const demoOrders = generateDemoOrders();
    const demoClicksByKey = generateDemoClicksBySubId(demoOrders);
    const platformCpc = generateDemoCpcDefaults();
    const cpcByKey = {};
    demoOrders.forEach(o => {
      const key = o.subIds[1] || '(Không gắn SubID2)';
      if (cpcByKey[key] === undefined) cpcByKey[key] = platformCpc[o.subIds[0]] ?? 0;
    });
    applyNewDataset(demoOrders, 'Dữ liệu mẫu (demo)', demoClicksByKey, cpcByKey, 0);
    toast.success('Đã nạp dữ liệu mẫu để trải nghiệm Dashboard');
  }

  async function handleClear() {
    setOrders([]);
    setFileName('');
    setCpcBySubId({});
    setClicksBySubId({});
    setDefaultCpc(0);
    setFilters({ ...DEFAULT_FILTERS, fromDate: todayStr(), toDate: todayStr() });
    clearState();
    try {
      await deleteSavedOrders();
    } catch (err) {
      toast.error(`Lỗi xóa dữ liệu trên server: ${err.message}`);
    }
  }

  const availablePlatforms = useMemo(() => new Set(orders.map(o => o.platformKey)), [orders]);
  const filteredOrders = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const kpis = useMemo(() => computeKpis(filteredOrders), [filteredOrders]);

  const matrixRows = useMemo(
    () => buildSubIdMatrix(filteredOrders, { cpcBySubId, defaultCpc, clicksBySubId, adsSpendBySubId2 }),
    [filteredOrders, cpcBySubId, defaultCpc, clicksBySubId, adsSpendBySubId2]
  );

  const netProfit = useMemo(() => matrixRows.reduce((s, r) => s + r.profit, 0), [matrixRows]);
  const totalAdSpend = useMemo(() => matrixRows.reduce((s, r) => s + r.adSpend, 0), [matrixRows]);
  const totalClicks = useMemo(() => matrixRows.reduce((s, r) => s + r.clicks, 0), [matrixRows]);
  const platformDistribution = useMemo(() => computePlatformDistribution(filteredOrders), [filteredOrders]);
  const hourlyDistribution = useMemo(() => computeHourlyDistribution(filteredOrders), [filteredOrders]);
  const topProducts = useMemo(() => computeTopProducts(filteredOrders), [filteredOrders]);
  const topShops = useMemo(() => computeTopShops(filteredOrders), [filteredOrders]);
  const warnings = useMemo(() => computeWarnings(kpis, matrixRows), [kpis, matrixRows]);

  function handleCpcChange(subIdKey, value) {
    setCpcBySubId(prev => ({ ...prev, [subIdKey]: value }));
  }
  function handleClicksChange(subIdKey, value) {
    setClicksBySubId(prev => ({ ...prev, [subIdKey]: value }));
  }

  function handleExportCsv() {
    const cpcLookup = new Map(matrixRows.map(r => [r.subIdKey, r]));
    const headers = [
      'Mã đơn', 'Sản phẩm', 'Shop', 'SubID (đầy đủ)', 'SubID2', 'Nền tảng', 'Kênh', 'Trạng thái',
      'GMV', 'Hoa hồng Shopee', 'Hoa hồng Xtra', 'Tổng hoa hồng', 'CPC SubID2', 'Nguồn chi phí', 'Lợi nhuận SubID2', 'Thời gian đặt'
    ];
    const rows = filteredOrders.map(o => {
      const subId2Key = o.subIds[1] || '(Không gắn SubID2)';
      const matrix = cpcLookup.get(subId2Key);
      return [
        o.orderId, o.itemName, o.shopName, o.subIdKey, subId2Key, o.platformLabel, o.channel, o.status,
        o.gmv, o.commissionShopee, o.commissionXtra, o.commissionTotal,
        matrix?.cpc ?? defaultCpc, matrix?.spendSource ?? 'none', matrix?.profit ?? '', o.orderTime ? o.orderTime.toISOString() : ''
      ];
    });
    downloadTextFile(`shopee-social-affiliate-${todayStr()}.csv`, rowsToCsv(headers, rows));
  }

  return (
    <div id="page-shopee-social">
      <UploadPanel
        fileName={fileName}
        orderCount={orders.length}
        onFile={handleFile}
        onClickReportFile={handleClickReportFile}
        onLoadDemo={handleLoadDemo}
        onClear={handleClear}
        loading={loading}
      />

      {!orders.length ? (
        <div className="empty" style={{ marginTop: 12 }}>
          <div className="ei">📊</div>
          <p>Tải lên báo cáo đơn hàng Shopee Affiliate hoặc bấm "Xem thử dữ liệu mẫu" để bắt đầu phân tích Social & SubID.</p>
        </div>
      ) : (
        <>
          <FiltersBar filters={filters} onChange={setFilters} availablePlatforms={availablePlatforms} />
          <KpiCards kpis={kpis} netProfit={netProfit} totalAdSpend={totalAdSpend} totalClicks={totalClicks} />

          <div className="shopee-social-charts-grid">
            <div className="card">
              <div className="card-header"><div className="card-title">Phân Bổ Nền Tảng (theo Hoa hồng)</div></div>
              <PlatformDonutChart data={platformDistribution} />
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title">Khung Giờ Vàng Social</div></div>
              <HourlyBarChart data={hourlyDistribution} />
            </div>
          </div>

          <div className="card shopee-social-cpc-default-card">
            <label>
              CPC mặc định (chỉ áp dụng cho SubID2 không khớp được Campaign nào trong hệ thống):
              <input
                type="number"
                min="0"
                className="shopee-social-input"
                style={{ width: 140, marginLeft: 10 }}
                value={defaultCpc}
                onChange={e => setDefaultCpc(Math.max(0, Number(e.target.value) || 0))}
              />
              <span style={{ marginLeft: 6, color: 'var(--muted2)' }}>đ/click</span>
            </label>
          </div>

          <SubIdMatrix
            rows={matrixRows}
            onCpcChange={handleCpcChange}
            onClicksChange={handleClicksChange}
            adsSpendLoading={adsSpendLoading}
          />

          <Leaderboards topProducts={topProducts} topShops={topShops} warnings={warnings} />

          <OrdersTable orders={filteredOrders} onExport={handleExportCsv} />
        </>
      )}
    </div>
  );
}
