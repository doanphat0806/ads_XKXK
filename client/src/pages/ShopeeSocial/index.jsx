import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';

import { parseOrdersFile, parseClickReportFile } from './parseFile';
import {
  filterOrders, computeKpis, buildSubIdMatrix, computePlatformDistribution,
  computeHourlyDistribution, computeTopProducts, computeTopShops, computeWarnings
} from './calculations';
import { downloadTextFile, rowsToCsv } from './utils';
import { loadState, saveState, clearState } from './storage';
import { fetchAdsSpend } from './adsSpendApi';
import { importOrdersToServer, fetchSavedOrders, deleteSavedOrders } from './ordersApi';
import { fetchShopeeAffAccounts, createShopeeAffAccount, updateShopeeAffAccount, deleteShopeeAffAccount } from './accountsApi';
import { fetchCommissionReceipts, createCommissionReceipt, deleteCommissionReceipt } from './commissionReceiptsApi';
import { buildAccountTrendSeries, toDayStr } from './accountTrend';

import UploadPanel from './components/UploadPanel';
import FiltersBar from './components/FiltersBar';
import KpiCards from './components/KpiCards';
import SubIdMatrix from './components/SubIdMatrix';
import PlatformDonutChart from './components/PlatformDonutChart';
import HourlyBarChart from './components/HourlyBarChart';
import Leaderboards from './components/Leaderboards';
import OrdersTable from './components/OrdersTable';
import CommissionReceiptsPanel from './components/CommissionReceiptsPanel';
import AccountTrendChart from './components/AccountTrendChart';
import AccountsSummaryTable from './components/AccountsSummaryTable';

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

const DEFAULT_FILTERS = { platformKey: 'all', status: 'all', search: '', accountName: 'all' };

export default function ShopeeSocial() {
  const [orders, setOrders] = useState([]);
  const [fileName, setFileName] = useState('');
  const [defaultCpc, setDefaultCpc] = useState(0);
  const [cpcBySubId, setCpcBySubId] = useState({});
  const [clicksBySubId, setClicksBySubId] = useState({});
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, fromDate: todayStr(), toDate: todayStr() });
  const [hydrated, setHydrated] = useState(false);
  const [adsSpendBySubId2Daily, setAdsSpendBySubId2Daily] = useState({});
  const [adsSpendLoading, setAdsSpendLoading] = useState(false);
  const [shopeeAccounts, setShopeeAccounts] = useState([]);
  const [commissionReceipts, setCommissionReceipts] = useState([]);

  useEffect(() => {
    fetchShopeeAffAccounts().then(setShopeeAccounts).catch(() => {});
    fetchCommissionReceipts().then(setCommissionReceipts).catch(() => {});
  }, []);

  async function handleAddCommissionReceipt(entry) {
    try {
      const receipt = await createCommissionReceipt(entry);
      if (receipt) setCommissionReceipts(prev => [receipt, ...prev]);
      return receipt;
    } catch (err) {
      toast.error(`Lỗi lưu hoa hồng thực nhận: ${err.message}`);
      return null;
    }
  }

  async function handleDeleteCommissionReceipt(id) {
    try {
      await deleteCommissionReceipt(id);
      setCommissionReceipts(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      toast.error(`Lỗi xóa: ${err.message}`);
    }
  }

  async function handleCreateAccount(name, subIdPrefix = '') {
    try {
      const account = await createShopeeAffAccount(name, subIdPrefix);
      setShopeeAccounts(prev => (prev.some(a => a._id === account._id) ? prev : [...prev, account].sort((a, b) => a.name.localeCompare(b.name))));
      return account;
    } catch (err) {
      toast.error(`Lỗi tạo tài khoản: ${err.message}`);
      return null;
    }
  }

  async function handleUpdateAccount(id, patch) {
    try {
      const account = await updateShopeeAffAccount(id, patch);
      setShopeeAccounts(prev => prev.map(a => (a._id === id ? account : a)));
      return account;
    } catch (err) {
      toast.error(`Lỗi cập nhật tài khoản: ${err.message}`);
      return null;
    }
  }

  async function handleDeleteAccount(id) {
    try {
      await deleteShopeeAffAccount(id);
      setShopeeAccounts(prev => prev.filter(a => a._id !== id));
    } catch (err) {
      toast.error(`Lỗi xóa tài khoản: ${err.message}`);
    }
  }

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

  // Widened date range: the top filter's range PLUS any commission-receipt dates
  // outside it, so a receipt logged for e.g. "today" while filters still show an older
  // report's range still gets its own day — WITH matching ad-spend data fetched for
  // it — on the per-account trend charts, instead of silently landing outside the
  // fetched window and showing adSpend=0 for that day.
  const widenedDateRange = useMemo(() => {
    let fromDate = filters.fromDate;
    let toDate = filters.toDate;
    commissionReceipts.forEach(r => {
      if (!r.date) return;
      const day = toDayStr(r.date);
      if (!fromDate || day < fromDate) fromDate = day;
      if (!toDate || day > toDate) toDate = day;
    });
    return { fromDate, toDate };
  }, [filters.fromDate, filters.toDate, commissionReceipts]);

  // Real Facebook ad spend, matched to orders by SubID2 (see adsSpendApi.js). Refetches
  // whenever the selected date range changes so spend always lines up with what's on screen.
  useEffect(() => {
    if (!orders.length || !widenedDateRange.fromDate || !widenedDateRange.toDate) {
      setAdsSpendBySubId2Daily({});
      return;
    }
    let cancelled = false;
    setAdsSpendLoading(true);
    fetchAdsSpend(widenedDateRange.fromDate, widenedDateRange.toDate)
      .then(({ bySubId2Daily }) => {
        if (cancelled) return;
        setAdsSpendBySubId2Daily(bySubId2Daily);
      })
      .catch(err => { if (!cancelled) toast.error(`Lỗi tải chi phí Ads: ${err.message}`); })
      .finally(() => { if (!cancelled) setAdsSpendLoading(false); });
    return () => { cancelled = true; };
  }, [orders.length, widenedDateRange.fromDate, widenedDateRange.toDate]);

  const applyNewDataset = useCallback((nextOrders, name, nextClicks = {}, nextCpc = {}, nextDefaultCpc = 0) => {
    setOrders(nextOrders);
    setFileName(name);
    setClicksBySubId(nextClicks);
    setCpcBySubId(nextCpc);
    setDefaultCpc(nextDefaultCpc);
    setFilters({ ...DEFAULT_FILTERS, ...dateRangeOf(nextOrders) });
  }, []);

  async function handleFile(file, accountName) {
    try {
      const parsed = await parseOrdersFile(file);
      if (!parsed.length) {
        toast.error('Không tìm thấy đơn hàng nào trong file.');
        return;
      }
      const taggedOrders = parsed.map(o => ({ ...o, accountName }));
      try {
        await importOrdersToServer(taggedOrders, file.name, accountName);
        // Re-fetch the full merged dataset (all accounts) instead of only showing this
        // upload's rows, so accounts already saved on the server stay visible/filterable.
        const merged = await fetchSavedOrders();
        applyNewDataset(merged, file.name, {}, {}, 0);
        toast.success(`Đã tải và lưu ${parsed.length} đơn hàng từ "${file.name}" (tài khoản ${accountName})`);
      } catch (syncErr) {
        applyNewDataset(taggedOrders, file.name, {}, {}, 0);
        toast.error(`Đã tải ${parsed.length} đơn nhưng lưu vào server thất bại: ${syncErr.message}`);
      }
    } catch (err) {
      toast.error(`Lỗi đọc file: ${err.message}`);
    }
  }

  async function handleClickReportFile(file) {
    try {
      const clicksMap = await parseClickReportFile(file);
      setClicksBySubId(prev => ({ ...prev, ...clicksMap }));
      toast.success(`Đã cập nhật số click cho ${Object.keys(clicksMap).length} SubID`);
    } catch (err) {
      toast.error(`Lỗi đọc báo cáo click: ${err.message}`);
    }
  }

  async function handleClear() {
    const targetAccount = filters.accountName !== 'all' ? filters.accountName : '';
    const confirmMsg = targetAccount
      ? `Xóa toàn bộ dữ liệu đã lưu của tài khoản "${targetAccount}"?`
      : 'Xóa TOÀN BỘ dữ liệu Shopee Affiliate đã lưu (tất cả tài khoản)?';
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteSavedOrders(targetAccount);
    } catch (err) {
      toast.error(`Lỗi xóa dữ liệu trên server: ${err.message}`);
      return;
    }

    if (targetAccount) {
      setOrders(prev => prev.filter(o => o.accountName !== targetAccount));
      setFilters(prev => ({ ...prev, accountName: 'all' }));
    } else {
      setOrders([]);
      setFileName('');
      setCpcBySubId({});
      setClicksBySubId({});
      setDefaultCpc(0);
      setFilters({ ...DEFAULT_FILTERS, fromDate: todayStr(), toDate: todayStr() });
      clearState();
    }
    toast.success('Đã xóa dữ liệu');
  }

  const availablePlatforms = useMemo(() => new Set(orders.map(o => o.platformKey)), [orders]);
  const availableAccounts = useMemo(
    () => Array.from(new Set(orders.map(o => o.accountName).filter(Boolean))).sort(),
    [orders]
  );
  // Also offer accounts that have no orders yet (freshly created) in the filter dropdown —
  // otherwise a brand-new account is invisible there until its first report is uploaded.
  const filterableAccounts = useMemo(() => {
    const names = new Set(availableAccounts);
    shopeeAccounts.forEach(a => names.add(a.name));
    return Array.from(names).sort();
  }, [availableAccounts, shopeeAccounts]);
  const filteredOrders = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const kpis = useMemo(() => computeKpis(filteredOrders), [filteredOrders]);

  // KPI/matrix totals must stay scoped to exactly the visible filter range — the fetch
  // above may cover a WIDER range (to backfill per-account trend charts when a receipt
  // falls outside the filter window), so re-aggregate from the daily breakdown down to
  // just [filters.fromDate, filters.toDate] rather than using the wider fetched range.
  const adsSpendBySubId2 = useMemo(() => {
    if (!filters.fromDate || !filters.toDate) return {};
    const result = {};
    Object.entries(adsSpendBySubId2Daily).forEach(([subId2, byDay]) => {
      let spend = 0;
      let clicks = 0;
      Object.entries(byDay).forEach(([day, v]) => {
        if (day < filters.fromDate || day > filters.toDate) return;
        spend += v.spend || 0;
        clicks += v.clicks || 0;
      });
      if (spend || clicks) result[subId2] = { spend, clicks, cpc: clicks > 0 ? spend / clicks : 0 };
    });
    return result;
  }, [adsSpendBySubId2Daily, filters.fromDate, filters.toDate]);

  const matrixRows = useMemo(
    () => buildSubIdMatrix(filteredOrders, { cpcBySubId, defaultCpc, clicksBySubId, adsSpendBySubId2 }),
    [filteredOrders, cpcBySubId, defaultCpc, clicksBySubId, adsSpendBySubId2]
  );

  // When one specific account is selected and it has a configured SubID2 prefix (e.g.
  // "1307A" vs "1307B" for two accounts sharing a "1307" batch code), scope the
  // "unmatched campaign" fallback below to that prefix — otherwise another account's
  // zero-order campaigns would leak into this account's totals.
  const selectedAccountPrefix = useMemo(() => {
    if (filters.accountName === 'all') return '';
    return shopeeAccounts.find(a => a.name === filters.accountName)?.subIdPrefix || '';
  }, [filters.accountName, shopeeAccounts]);

  // Total ad spend/clicks must count every campaign in the selected date range, including
  // SubID2s that spent money but produced zero matching orders. matrixRows only has a row
  // per SubID2 that already appears in an order, so summing just that silently dropped
  // spend on campaigns with zero conversions — understating "Chi phí Ads" and inflating
  // "Lợi nhuận ròng". Matched SubID2s still use matrixRows' figure (which respects manual
  // CPC/click overrides); unmatched ones are added straight from the real campaign data.
  const totalAdSpend = useMemo(() => {
    const matchedKeys = new Set(matrixRows.map(r => r.subIdKey));
    const matrixSpend = matrixRows.reduce((s, r) => s + r.adSpend, 0);
    const unmatched = Object.entries(adsSpendBySubId2).filter(([key]) => !matchedKeys.has(key));
    const scoped = selectedAccountPrefix ? unmatched.filter(([key]) => key.startsWith(selectedAccountPrefix)) : unmatched;
    const unmatchedSpend = scoped.reduce((s, [, v]) => s + (v.spend || 0), 0);
    return matrixSpend + unmatchedSpend;
  }, [matrixRows, adsSpendBySubId2, selectedAccountPrefix]);
  const totalClicks = useMemo(() => {
    const matchedKeys = new Set(matrixRows.map(r => r.subIdKey));
    const matrixClicks = matrixRows.reduce((s, r) => s + r.clicks, 0);
    const unmatched = Object.entries(adsSpendBySubId2).filter(([key]) => !matchedKeys.has(key));
    const scoped = selectedAccountPrefix ? unmatched.filter(([key]) => key.startsWith(selectedAccountPrefix)) : unmatched;
    const unmatchedClicks = scoped.reduce((s, [, v]) => s + (v.clicks || 0), 0);
    return matrixClicks + unmatchedClicks;
  }, [matrixRows, adsSpendBySubId2, selectedAccountPrefix]);
  const netProfit = kpis.commissionTotal - totalAdSpend;

  // "Hoa hồng thực nhận" is a running cash ledger, not a report metric tied to the order
  // date range — a payout entered for today shouldn't vanish from the KPI just because
  // the date filter (driven by the imported report's order dates) doesn't cover today.
  // Only the account filter applies; date range is intentionally ignored here.
  const totalActualReceived = useMemo(() => {
    return commissionReceipts
      .filter(r => filters.accountName === 'all' || r.accountName === filters.accountName)
      .reduce((s, r) => s + r.amount, 0);
  }, [commissionReceipts, filters.accountName]);
  const realProfit = totalActualReceived - totalAdSpend;
  const platformDistribution = useMemo(() => computePlatformDistribution(filteredOrders), [filteredOrders]);
  const hourlyDistribution = useMemo(() => computeHourlyDistribution(filteredOrders), [filteredOrders]);
  const topProducts = useMemo(() => computeTopProducts(filteredOrders), [filteredOrders]);
  const topShops = useMemo(() => computeTopShops(filteredOrders), [filteredOrders]);
  const warnings = useMemo(() => computeWarnings(kpis, matrixRows), [kpis, matrixRows]);

  const accountTrends = useMemo(() => {
    // Union with the managed account list (not just accounts that already have orders) —
    // an account whose campaigns are still running but haven't produced a completed
    // order yet would otherwise have no chart at all, hiding its ad spend entirely.
    const names = new Set(availableAccounts);
    shopeeAccounts.forEach(a => { if (a.subIdPrefix) names.add(a.name); });
    return Array.from(names).sort().map(accountName => {
      const subIdPrefix = shopeeAccounts.find(a => a.name === accountName)?.subIdPrefix || '';

      // Widen the range to cover this account's own commission-receipt dates — otherwise
      // a receipt entered for a day outside the top date filter (e.g. today, while the
      // filter still shows an older report's date range) silently has no day to land on
      // and the chart looks unchanged even though the entry was saved fine.
      let fromDate = filters.fromDate;
      let toDate = filters.toDate;
      commissionReceipts.forEach(r => {
        if (r.accountName !== accountName || !r.date) return;
        const day = toDayStr(r.date);
        if (!fromDate || day < fromDate) fromDate = day;
        if (!toDate || day > toDate) toDate = day;
      });

      return {
        accountName,
        series: buildAccountTrendSeries({
          orders, accountName, subIdPrefix, fromDate, toDate,
          adsSpendBySubId2Daily, commissionReceipts
        })
      };
    });
  }, [availableAccounts, shopeeAccounts, orders, filters.fromDate, filters.toDate, adsSpendBySubId2Daily, commissionReceipts]);

  function handleCpcChange(subIdKey, value) {
    setCpcBySubId(prev => ({ ...prev, [subIdKey]: value }));
  }
  function handleClicksChange(subIdKey, value) {
    setClicksBySubId(prev => ({ ...prev, [subIdKey]: value }));
  }

  function handleExportCsv() {
    const cpcLookup = new Map(matrixRows.map(r => [r.subIdKey, r]));
    const headers = [
      'Tài khoản', 'Mã đơn', 'Sản phẩm', 'Shop', 'SubID (đầy đủ)', 'SubID2', 'Nền tảng', 'Kênh', 'Trạng thái',
      'GMV', 'Hoa hồng Shopee', 'Hoa hồng Xtra', 'Tổng hoa hồng', 'CPC SubID2', 'Nguồn chi phí', 'Lợi nhuận SubID2', 'Thời gian đặt'
    ];
    const rows = filteredOrders.map(o => {
      const subId2Key = o.subIds[1] || '(Không gắn SubID2)';
      const matrix = cpcLookup.get(subId2Key);
      return [
        o.accountName || '', o.orderId, o.itemName, o.shopName, o.subIdKey, subId2Key, o.platformLabel, o.channel, o.status,
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
        accounts={shopeeAccounts}
        onCreateAccount={handleCreateAccount}
        onUpdateAccount={handleUpdateAccount}
        onDeleteAccount={handleDeleteAccount}
        onFile={handleFile}
        onClickReportFile={handleClickReportFile}
        onClear={handleClear}
      />

      <CommissionReceiptsPanel
        accounts={shopeeAccounts}
        receipts={commissionReceipts}
        onAdd={handleAddCommissionReceipt}
        onDelete={handleDeleteCommissionReceipt}
      />

      {/* Account trend charts are independent of `orders` — an account with a configured
          SubID2 prefix but zero orders yet (campaigns running, no completed order so
          far) must still get a chart, so this can't live inside the `!orders.length`
          branch below or it would never render for that account. */}
      {accountTrends.length > 0 && (
        <>
          <AccountsSummaryTable accountTrends={accountTrends} />
          <div className="shopee-social-account-trend-grid">
            {accountTrends.map(({ accountName, series }) => (
              <AccountTrendChart key={accountName} accountName={accountName} series={series} />
            ))}
          </div>
        </>
      )}

      {!orders.length ? (
        !accountTrends.length && (
          <div className="empty" style={{ marginTop: 12 }}>
            <div className="ei">📊</div>
            <p>Tải lên báo cáo đơn hàng Shopee Affiliate hoặc bấm "Xem thử dữ liệu mẫu" để bắt đầu phân tích Social & SubID.</p>
          </div>
        )
      ) : (
        <>
          <FiltersBar filters={filters} onChange={setFilters} availablePlatforms={availablePlatforms} availableAccounts={filterableAccounts} />
          <KpiCards
            kpis={kpis}
            netProfit={netProfit}
            totalAdSpend={totalAdSpend}
            totalClicks={totalClicks}
            totalActualReceived={totalActualReceived}
            realProfit={realProfit}
          />

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
