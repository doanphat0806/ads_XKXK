import React, { useCallback, useDeferredValue, useMemo, useState, useEffect, useRef, useTransition } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatVND, formatNumber, todayString, dateTimeString, api, cachedApi, readResponseCache } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { toast } from 'react-toastify';

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

const SortIcon = ({ field, sortField, sortDir }) => {
  if (sortField !== field) return <span style={{ opacity: 0.3, marginLeft: '4px' }}>↕</span>;
  return <span style={{ marginLeft: '4px', color: 'var(--b)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
};

const formatPercent = (value) => `${(Number(value || 0) * 100).toFixed(2).replace('.', ',')}%`;
const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return dateTimeString(date);
};
const normalizeCampaignDuplicateKey = (campaign) => {
  const name = String(campaign.name || '').toUpperCase().replace(/\s+/g, '').trim();
  return name;
};

const getCampaignSkuCandidates = (campaignName) => {
  const rawName = String(campaignName || '').toUpperCase().trim();
  const compactName = rawName.replace(/\s+/g, '');
  const firstNineChars = rawName.slice(0, 9).replace(/\s+/g, '');
  const firstToken = rawName.split(/\s+/)[0]?.replace(/\s+/g, '') || '';

  return [...new Set([firstNineChars, firstToken, compactName].filter(Boolean))]
    .map(code => `MS${code}`);
};

const keepCurrentSortStatus = (campaign) => ({
  ...campaign,
  sortStatus: String(campaign.sortStatus || campaign.status || '').toUpperCase()
});

const ACTIVE_CAMPAIGN_STATUSES = new Set([
  'ACTIVE',
  'SCHEDULED',
  'PENDING_REVIEW',
  'PENDING_BILLING_INFO',
  'CAMPAIGN_PAUSED'
]);

function normalizeStatus(status) {
  return String(status || '').toUpperCase().trim();
}

function isCampaignActiveStatus(status) {
  return ACTIVE_CAMPAIGN_STATUSES.has(normalizeStatus(status));
}

const DASHBOARD_CAMPAIGNS_PER_PAGE = 500;
const DASHBOARD_INITIAL_RENDER_ROWS = 300;
const DASHBOARD_RENDER_BATCH_ROWS = 300;
const CAMPAIGN_TOGGLE_RELOAD_DELAY_MS = 2 * 60 * 1000;
const CAMPAIGN_RETURN_STATS_FROM_DATE = '2026-02-22';
const CPO_WARNING_THRESHOLD = 100000;
const ORDER_REFRESH_MS = 10000;
const EMPTY_RETURN_STATS = { returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 };

const CampaignRow = React.memo(function CampaignRow({
  campaign,
  isActive,
  isToggling,
  isEditingCampaign,
  editingCampaignName,
  isRenamingCampaign,
  isEditingBudget,
  editingBudget,
  isSavingBudget,
  isShopee,
  showOrders,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggleStatus,
  onStartEditBudget,
  onSaveBudget,
  onCancelEditBudget,
  setEditingCampaignName,
  setEditingBudget
}) {
  const budget = campaign.dailyBudget || campaign.lifetimeBudget || 0;

  return (
    <tr>
      <td>
        {isEditingCampaign ? (
          <input
            value={editingCampaignName}
            autoFocus
            disabled={isRenamingCampaign}
            onChange={e => setEditingCampaignName(e.target.value.toUpperCase())}
            onBlur={() => onSaveRename(campaign)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveRename(campaign); if (e.key === 'Escape') onCancelRename(); }}
            style={{ width: '100%', minWidth: '120px', height: '28px', border: '1px solid var(--border2)', borderRadius: '4px', padding: '0 8px', fontWeight: 600, fontSize: '13px', color: 'var(--txt)', background: 'var(--s1)' }}
          />
        ) : (
          <button type="button" onClick={() => onStartRename(campaign)} title="Click de sua ten camp" style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--txt)', cursor: 'text' }}>
            {isRenamingCampaign ? '...' : toText(campaign.name)}
          </button>
        )}
        <div style={{ fontSize: '10px', color: 'var(--muted2)' }}>{campaign.campaignId}</div>
      </td>
      <td className="text-center" style={{ fontWeight: 'bold', color: campaign.sameDayDuplicateCount > 1 ? 'var(--r)' : 'var(--txt)' }}>
        {campaign.sameDayDuplicateCount || 1}
      </td>
      <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{formatDateTime(campaign.createdTime || campaign.created_time)}</td>
      <td className="text-center">
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: isToggling ? 0.7 : 1 }}>
          <label className="tgl" title={isActive ? 'Tat camp' : 'Bat camp'} style={{ cursor: isToggling ? 'wait' : 'pointer' }}>
            <input
              type="checkbox"
              checked={isActive}
              disabled={isToggling}
              onChange={() => onToggleStatus(campaign)}
            />
            <div className="tgl-track"></div>
            <div className="tgl-thumb"></div>
          </label>
        </div>
      </td>
      <td style={{ fontWeight: 500 }}>{campaign.accountId?.name || '-'}</td>
      <td className="text-center"><span className={`badge ${isActive ? 'active' : 'paused'}`}>{isActive ? 'ACTIVE' : 'PAUSE'}</span></td>
      {showOrders && <td className="text-center" style={{ fontWeight: 'bold', color: 'var(--txt)' }}>{campaign.orderCount || '-'}</td>}
      {showOrders && <td className="text-center" style={{ fontWeight: 'bold', color: campaign.metaOrders > 0 ? 'var(--txt)' : 'var(--muted2)' }}>{campaign.metaOrders > 0 ? campaign.metaOrders : '-'}</td>}
      <td className="text-right">
        {isShopee ? (
          <>
            <div style={{ fontWeight: 'bold', color: campaign.costPerClick > 500 || campaign.costPerClick === 0 ? 'var(--r)' : 'var(--txt)' }}>{formatVND(campaign.costPerClick)}</div>
            <div style={{ fontSize: '11px', color: 'var(--txt)' }}>{formatNumber(campaign.clicks || 0)} click</div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 'bold', color: campaign.costPerMessage > 15000 || campaign.costPerMessage === 0 ? 'var(--r)' : 'var(--txt)' }}>{formatVND(campaign.costPerMessage)}</div>
            <div style={{ fontSize: '11px', color: 'var(--txt)' }}>{campaign.messages} TN</div>
          </>
        )}
      </td>
      {showOrders && <td className="text-right" style={{ color: campaign.costPerOrder > CPO_WARNING_THRESHOLD ? 'var(--r)' : 'var(--txt)', fontWeight: campaign.costPerOrder > CPO_WARNING_THRESHOLD ? 'bold' : undefined }}>{campaign.costPerOrder > 0 ? formatVND(campaign.costPerOrder) : '-'}</td>}
      <td className="text-right mono-sm">{formatVND(campaign.spend)}</td>
      <td className="text-right mono-sm">
        {isEditingBudget ? (
          <input
            value={editingBudget}
            autoFocus
            inputMode="numeric"
            disabled={isSavingBudget}
            onChange={e => setEditingBudget(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => onSaveBudget(campaign)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveBudget(campaign); if (e.key === 'Escape') onCancelEditBudget(); }}
            style={{ width: '110px', height: '28px', textAlign: 'right', border: '1px solid var(--border2)', borderRadius: '4px', padding: '0 8px', color: 'var(--txt)', background: 'var(--s1)' }}
          />
        ) : (
          <button type="button" onClick={() => onStartEditBudget(campaign)} title="Click de sua ngan sach" style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--txt)', cursor: 'text', font: 'inherit' }}>
            {isSavingBudget ? '...' : formatVND(budget)}
          </button>
        )}
      </td>
      {showOrders && (
        <td className="text-right" style={{ color: campaign.returnStats?.denominator > 0 ? 'var(--b)' : 'var(--muted2)' }}>
          {campaign.returnStats?.denominator > 0 ? <><div style={{ fontWeight: 'bold' }}>{formatPercent(campaign.returnRate)}</div><div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{formatNumber((campaign.returnStats.returned || 0) + (campaign.returnStats.returning || 0))} / {formatNumber(campaign.returnStats.denominator)}</div></> : ''}
        </td>
      )}
    </tr>
  );
});

export default function Dashboard() {
  const { provider, stats: globalStats, loading: globalLoading } = useAppContext();
  const showOrders = provider !== 'shopee';
  const isShopee = provider === 'shopee';
  const dashboardRef = useRef(null);
  const stickySummaryRef = useRef(null);
  const editingCampaignNameRef = useRef('');
  const renamingCampaignIdRef = useRef('');
  const editingBudgetRef = useRef('');
  const savingBudgetIdsRef = useRef(new Set());
  const togglingCampaignIdsRef = useRef(new Set());
  const toggleReloadTimerRef = useRef(null);

  const [sortField, setSortField] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [reportFromDate, setReportFromDate] = useState(() => todayString());
  const [reportToDate, setReportToDate] = useState(() => todayString());
  const [localStats, setLocalStats] = useState({});
  const [localCampaigns, setLocalCampaigns] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [skuCounts, setSkuCounts] = useState({});
  const [skuTotal, setSkuTotal] = useState(0);
  const [returnStatsBySku, setReturnStatsBySku] = useState({});
  const [orderReturnStats, setOrderReturnStats] = useState(EMPTY_RETURN_STATS);
  const [skuLoading, setSkuLoading] = useState(false);
  const [togglingCampaignIds, setTogglingCampaignIds] = useState(() => new Set());
  const [editingCampaignId, setEditingCampaignId] = useState('');
  const [editingCampaignName, setEditingCampaignName] = useState('');
  const [renamingCampaignId, setRenamingCampaignId] = useState('');
  const [editingBudgetId, setEditingBudgetId] = useState('');
  const [editingBudget, setEditingBudget] = useState('');
  const [savingBudgetId, setSavingBudgetId] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [disablingDuplicates, setDisablingDuplicates] = useState(false);
  const [renderLimit, setRenderLimit] = useState(DASHBOARD_INITIAL_RENDER_ROWS);
  const deferredCampaignSearch = useDeferredValue(campaignSearch);
  const [isSortPending, startSortTransition] = useTransition();

  useEffect(() => {
    editingCampaignNameRef.current = editingCampaignName;
  }, [editingCampaignName]);

  useEffect(() => {
    renamingCampaignIdRef.current = renamingCampaignId;
  }, [renamingCampaignId]);

  useEffect(() => {
    editingBudgetRef.current = editingBudget;
  }, [editingBudget]);

  useEffect(() => {
    savingBudgetIdsRef.current = savingBudgetId ? new Set([savingBudgetId]) : new Set();
  }, [savingBudgetId]);

  useEffect(() => {
    togglingCampaignIdsRef.current = togglingCampaignIds;
  }, [togglingCampaignIds]);

  const handleSort = (field) => {
    startSortTransition(() => {
      if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else {
        setSortField(field);
        setSortDir('desc');
      }
    });
  };

  const loadDashboardData = useCallback(async (from, to) => {
    setStatsLoading(true);
    try {
      const statsUrl = `/stats?provider=${provider}&fromDate=${from}&toDate=${to}`;
      const campaignsUrl = `/campaigns/today?provider=${provider}&fromDate=${from}&toDate=${to}&includeScheduledNoSpend=true`;
      const cachedStats = readResponseCache(`GET:${statsUrl}`);
      const cachedCampaigns = readResponseCache(`GET:${campaignsUrl}`);
      if (cachedStats) setLocalStats(cachedStats);
      if (cachedCampaigns) setLocalCampaigns(cachedCampaigns.map(keepCurrentSortStatus));
      if (cachedStats && cachedCampaigns) setStatsLoading(false);

      const [sData, cData] = await Promise.all([
        cachedApi('GET', statsUrl),
        cachedApi('GET', campaignsUrl, null, { timeoutMs: 5 * 60 * 1000 })
      ]);
      setLocalStats(sData);
      setLocalCampaigns(cData.map(keepCurrentSortStatus));
    } catch (e) {
      console.error('Failed to load dashboard data', e);
    } finally {
      setStatsLoading(false);
    }
  }, [provider]);

  const reloadDashboardNow = useCallback(() => {
    if (toggleReloadTimerRef.current) {
      window.clearTimeout(toggleReloadTimerRef.current);
      toggleReloadTimerRef.current = null;
    }
    loadDashboardData(reportFromDate, reportToDate);
  }, [loadDashboardData, reportFromDate, reportToDate]);

  const scheduleToggleReload = useCallback(() => {
    if (toggleReloadTimerRef.current) {
      window.clearTimeout(toggleReloadTimerRef.current);
    }
    toggleReloadTimerRef.current = window.setTimeout(() => {
      toggleReloadTimerRef.current = null;
      loadDashboardData(reportFromDate, reportToDate);
    }, CAMPAIGN_TOGGLE_RELOAD_DELAY_MS);
  }, [loadDashboardData, reportFromDate, reportToDate]);

  const toggleCampaignStatus = useCallback(async (campaign) => {
    const accountId = campaign.accountId?._id || campaign.accountId;
    if (!campaign.campaignId || !accountId || togglingCampaignIdsRef.current.has(campaign.campaignId)) return;

    const previousStatus = normalizeStatus(campaign.status);
    const nextStatus = isCampaignActiveStatus(previousStatus) ? 'PAUSED' : 'ACTIVE';
    setTogglingCampaignIds(ids => new Set(ids).add(campaign.campaignId));
    setLocalCampaigns(items => items.map(item => (
      item.campaignId === campaign.campaignId ? { ...item, status: nextStatus } : item
    )));

    try {
      const result = await api('POST', `/campaigns/${campaign.campaignId}/toggle`, {
        accountId,
        currentStatus: previousStatus,
        targetStatus: nextStatus,
        date: reportFromDate
      });
      if (result?.newStatus && result.newStatus !== nextStatus) {
        setLocalCampaigns(items => items.map(item => (
          item.campaignId === campaign.campaignId ? { ...item, status: result.newStatus } : item
        )));
      }
      toast.success(isCampaignActiveStatus(previousStatus) ? 'Da tat camp' : 'Da bat camp');
      scheduleToggleReload();
    } catch (error) {
      setLocalCampaigns(items => items.map(item => (
        item.campaignId === campaign.campaignId ? { ...item, status: previousStatus } : item
      )));
      toast.error('Loi doi trang thai camp: ' + error.message);
    } finally {
      setTogglingCampaignIds(ids => {
        const next = new Set(ids);
        next.delete(campaign.campaignId);
        return next;
      });
    }
  }, [reportFromDate, scheduleToggleReload]);

  const startRenameCampaign = useCallback((campaign) => {
    if (renamingCampaignIdRef.current) return;
    setEditingCampaignId(campaign.campaignId);
    setEditingCampaignName(toText(campaign.name, '').toUpperCase());
  }, []);

  const cancelRenameCampaign = useCallback(() => {
    setEditingCampaignId('');
    setEditingCampaignName('');
  }, []);

  const saveRenameCampaign = useCallback(async (campaign) => {
    const accountId = campaign.accountId?._id || campaign.accountId;
    const nextName = editingCampaignNameRef.current.trim().toUpperCase();
    const currentName = toText(campaign.name, '').trim();
    if (!campaign.campaignId || !accountId || renamingCampaignIdRef.current) return;
    if (!nextName) return toast.error('Ten camp khong duoc de trong');
    if (nextName === currentName) return cancelRenameCampaign();

    setRenamingCampaignId(campaign.campaignId);
    try {
      await api('POST', `/campaigns/${campaign.campaignId}/rename`, { accountId, date: reportFromDate, name: nextName });
      setLocalCampaigns(items => items.map(item => item.campaignId === campaign.campaignId ? { ...item, name: nextName } : item));
      toast.success('Da doi ten camp');
      cancelRenameCampaign();
    } catch (error) {
      toast.error('Loi doi ten camp: ' + error.message);
    } finally {
      setRenamingCampaignId('');
    }
  }, [cancelRenameCampaign, reportFromDate]);

  const startEditBudget = useCallback((campaign) => {
    if (savingBudgetIdsRef.current.size > 0) return;
    setEditingBudgetId(campaign.campaignId);
    setEditingBudget(String(campaign.dailyBudget || campaign.lifetimeBudget || 0));
  }, []);

  const cancelEditBudget = useCallback(() => {
    setEditingBudgetId('');
    setEditingBudget('');
  }, []);

  const saveBudget = useCallback(async (campaign) => {
    const accountId = campaign.accountId?._id || campaign.accountId;
    const budget = Math.round(Number(editingBudgetRef.current));
    if (!campaign.campaignId || !accountId || savingBudgetIdsRef.current.size > 0) return;
    if (!Number.isFinite(budget) || budget <= 0) return toast.error('Ngan sach khong hop le');

    setSavingBudgetId(campaign.campaignId);
    try {
      const result = await api('POST', `/campaigns/${campaign.campaignId}/budget`, { accountId, date: reportFromDate, budget });
      setLocalCampaigns(items => items.map(item => {
        if (item.campaignId !== campaign.campaignId) return item;
        return result.budgetType === 'LIFETIME'
          ? { ...item, lifetimeBudget: budget, dailyBudget: 0, budgetType: 'LIFETIME' }
          : { ...item, dailyBudget: budget, lifetimeBudget: 0, budgetType: 'DAILY' };
      }));
      toast.success('Da cap nhat ngan sach');
      cancelEditBudget();
    } catch (error) {
      toast.error('Loi cap nhat ngan sach: ' + error.message);
    } finally {
      setSavingBudgetId('');
    }
  }, [cancelEditBudget, reportFromDate]);

  const loadSkuCounts = useCallback(async (from, to, options = {}) => {
    if (!from || !to || provider === 'shopee') return;
    const { silent = false, includeReturnStats = true } = options;
    if (!silent) setSkuLoading(true);
    try {
      const data = await api('GET', `/orders/sku-counts?fromDate=${from}&toDate=${to}`);
      setSkuCounts(data.counts || {});
      setSkuTotal(data.totalOrders || 0);
      setOrderReturnStats(data.returnStats || EMPTY_RETURN_STATS);
      if (includeReturnStats) {
        const returnData = await api('GET', `/orders/sku-counts?fromDate=${CAMPAIGN_RETURN_STATS_FROM_DATE}&toDate=${todayString()}`);
        setReturnStatsBySku(returnData.returnStatsBySku || {});
      }
    } catch {
      if (!silent) {
        setSkuCounts({});
        setSkuTotal(0);
        setReturnStatsBySku({});
        setOrderReturnStats(EMPTY_RETURN_STATS);
      }
    } finally {
      if (!silent) setSkuLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    loadDashboardData(reportFromDate, reportToDate);
    loadSkuCounts(reportFromDate, reportToDate);
  }, [reportFromDate, reportToDate, loadDashboardData, loadSkuCounts]);

  useEffect(() => {
    if (provider === 'shopee') return undefined;
    const interval = setInterval(() => {
      loadSkuCounts(reportFromDate, reportToDate, { silent: true, includeReturnStats: false });
    }, ORDER_REFRESH_MS);
    return () => clearInterval(interval);
  }, [provider, reportFromDate, reportToDate, loadSkuCounts]);

  const hasSkuCounts = useMemo(() => Object.keys(skuCounts || {}).length > 0, [skuCounts]);
  const hasReturnStatsBySku = useMemo(() => Object.keys(returnStatsBySku || {}).length > 0, [returnStatsBySku]);

  const getOrderCountForCampaign = useCallback((campaignName) => {
    if (!campaignName || !hasSkuCounts) return 0;
    for (const skuKey of getCampaignSkuCandidates(campaignName)) {
      const count = Number(skuCounts[skuKey] || 0);
      if (count > 0) return count;
    }
    return 0;
  }, [skuCounts, hasSkuCounts]);

  const getReturnStatsForCampaign = useCallback((campaignName) => {
    if (!campaignName || !hasReturnStatsBySku) return EMPTY_RETURN_STATS;
    for (const skuKey of getCampaignSkuCandidates(campaignName)) {
      const stats = returnStatsBySku[skuKey];
      if (stats) return stats;
    }
    return EMPTY_RETURN_STATS;
  }, [returnStatsBySku, hasReturnStatsBySku]);

  const filteredCampaigns = useMemo(() => {
    const search = deferredCampaignSearch.trim().toLowerCase();
    return localCampaigns
      .filter(c => Number(c.spend || 0) > 0)
      .filter(c => {
        if (!search) return true;
        return [c.name, c.campaignId, c.accountId?.name, c.accountId?.adAccountId].some(value =>
          String(value || '').toLowerCase().includes(search)
        );
      });
  }, [localCampaigns, deferredCampaignSearch]);

  const enrichedCampaigns = useMemo(() => {
    return filteredCampaigns.map(campaign => {
      const orderCount = showOrders ? getOrderCountForCampaign(campaign.name) : 0;
      const returnStats = showOrders ? getReturnStatsForCampaign(campaign.name) : EMPTY_RETURN_STATS;
      const metaOrders = showOrders ? Number(campaign.metaOrders || 0) : 0;
      const spend = Number(campaign.spend || 0);
      const clicks = Number(campaign.clicks || 0);
      const costPerMessage = Number(campaign.costPerMessage || 0);
      const costPerOrder = orderCount > 0 ? spend / orderCount : 0;
      const costPerClick = clicks > 0 ? spend / clicks : 0;
      return {
        ...campaign,
        orderCount,
        returnStats,
        returnRate: returnStats.rate || 0,
        costPerOrder,
        costPerMessage,
        costPerClick,
        metaOrders
      };
    });
  }, [filteredCampaigns, getOrderCountForCampaign, getReturnStatsForCampaign, showOrders]);

  const processedCampaigns = useMemo(() => {
    const duplicateCounts = enrichedCampaigns.reduce((counts, campaign) => {
      const key = normalizeCampaignDuplicateKey(campaign);
      if (!key) return counts;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});

    const campaignsWithDuplicates = enrichedCampaigns.map(campaign => {
      const key = normalizeCampaignDuplicateKey(campaign);
      return { ...campaign, sameDayDuplicateCount: key ? (duplicateCounts[key] || 0) : 0 };
    });

    return [...campaignsWithDuplicates].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const statusA = isCampaignActiveStatus(a.sortStatus || a.status) ? 1 : 0;
      const statusB = isCampaignActiveStatus(b.sortStatus || b.status) ? 1 : 0;
      if (statusA !== statusB) return statusB - statusA;
      if (sortField === 'duplicateCount') return dir * ((a.sameDayDuplicateCount || 1) - (b.sameDayDuplicateCount || 1));
      if (sortField === 'orderCount') return dir * ((a.orderCount || 0) - (b.orderCount || 0));
      if (sortField === 'metaOrders') return dir * ((a.metaOrders || 0) - (b.metaOrders || 0));
      if (sortField === 'costPerOrder') {
        if (!a.orderCount && !b.orderCount) return 0;
        if (!a.orderCount) return 1;
        if (!b.orderCount) return -1;
        return dir * (a.costPerOrder - b.costPerOrder);
      }
      if (sortField === 'spend') return dir * (a.spend - b.spend);
      if (sortField === 'messages') return dir * ((isShopee ? a.clicks : a.messages) - (isShopee ? b.clicks : b.messages));
      if (sortField === 'returnRate') {
        if (!a.returnStats?.denominator && !b.returnStats?.denominator) return 0;
        if (!a.returnStats?.denominator) return 1;
        if (!b.returnStats?.denominator) return -1;
        return dir * ((a.returnRate || 0) - (b.returnRate || 0));
      }
      return b.spend - a.spend;
    });
  }, [enrichedCampaigns, sortField, sortDir, isShopee]);

  const totalPages = Math.max(1, Math.ceil(processedCampaigns.length / DASHBOARD_CAMPAIGNS_PER_PAGE));
  const pageCampaigns = useMemo(() => {
    const page = Math.min(currentPage, totalPages);
    return processedCampaigns.slice((page - 1) * DASHBOARD_CAMPAIGNS_PER_PAGE, page * DASHBOARD_CAMPAIGNS_PER_PAGE);
  }, [currentPage, processedCampaigns, totalPages]);
  const visibleCampaigns = useMemo(() => pageCampaigns.slice(0, renderLimit), [pageCampaigns, renderLimit]);
  const metaAvgCPM = useMemo(() => {
    if (isShopee) return 0;
    return Number(localStats.avgCPM || 0);
  }, [localStats.avgCPM, isShopee]);

  const duplicateCampaignsToPause = useMemo(() => {
    const groups = processedCampaigns.reduce((items, campaign) => {
      const key = normalizeCampaignDuplicateKey(campaign);
      if (!key || (campaign.sameDayDuplicateCount || 0) <= 1) return items;
      if (!isCampaignActiveStatus(campaign.status)) return items;
      if (!items[key]) items[key] = [];
      items[key].push(campaign);
      return items;
    }, {});

    return Object.values(groups).flatMap(group => {
      if (group.length <= 1) return [];
      const sorted = [...group].sort((a, b) => {
        const aTime = new Date(a.createdTime || a.created_time || 0).getTime() || 0;
        const bTime = new Date(b.createdTime || b.created_time || 0).getTime() || 0;
        return aTime - bTime;
      });
      return sorted.slice(1);
    });
  }, [processedCampaigns]);

  const disableDuplicateCampaigns = useCallback(async () => {
    if (disablingDuplicates || duplicateCampaignsToPause.length === 0) return;

    const targets = duplicateCampaignsToPause.filter(campaign => {
      const accountId = campaign.accountId?._id || campaign.accountId;
      return campaign.campaignId && accountId && !togglingCampaignIdsRef.current.has(campaign.campaignId);
    });
    if (targets.length === 0) return;

    setDisablingDuplicates(true);
    setTogglingCampaignIds(ids => {
      const next = new Set(ids);
      targets.forEach(campaign => next.add(campaign.campaignId));
      return next;
    });
    setLocalCampaigns(items => items.map(item => (
      targets.some(campaign => campaign.campaignId === item.campaignId)
        ? { ...item, status: 'PAUSED' }
        : item
    )));

    let failedCount = 0;
    for (const campaign of targets) {
      const accountId = campaign.accountId?._id || campaign.accountId;
      try {
        await api('POST', `/campaigns/${campaign.campaignId}/toggle`, {
          accountId,
          currentStatus: 'ACTIVE',
          targetStatus: 'PAUSED',
          date: reportFromDate
        });
      } catch {
        failedCount += 1;
        setLocalCampaigns(items => items.map(item => (
          item.campaignId === campaign.campaignId ? { ...item, status: 'ACTIVE' } : item
        )));
      } finally {
        setTogglingCampaignIds(ids => {
          const next = new Set(ids);
          next.delete(campaign.campaignId);
          return next;
        });
      }
    }

    if (failedCount > 0) {
      toast.error(`Loi tat ${failedCount}/${targets.length} camp trung`);
    } else {
      toast.success(`Da tat ${targets.length} camp trung`);
      scheduleToggleReload();
    }
    setDisablingDuplicates(false);
  }, [disablingDuplicates, duplicateCampaignsToPause, reportFromDate, scheduleToggleReload]);

  useEffect(() => {
    return () => {
      if (toggleReloadTimerRef.current) window.clearTimeout(toggleReloadTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [reportFromDate, reportToDate, provider, sortField, sortDir, deferredCampaignSearch]);

  useEffect(() => {
    setRenderLimit(DASHBOARD_INITIAL_RENDER_ROWS);
  }, [currentPage, processedCampaigns]);

  useEffect(() => {
    if (renderLimit >= pageCampaigns.length) return undefined;
    let cancelled = false;
    const addRows = () => {
      if (cancelled) return;
      setRenderLimit(limit => Math.min(limit + DASHBOARD_RENDER_BATCH_ROWS, pageCampaigns.length));
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(addRows, { timeout: 200 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
      };
    }

    const timeoutId = window.setTimeout(addRows, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [renderLimit, pageCampaigns.length]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    const dashboard = dashboardRef.current;
    const stickySummary = stickySummaryRef.current;
    if (!dashboard || !stickySummary) return;

    const updateStickyOffset = () => {
      const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 54;
      dashboard.style.setProperty('--dashboard-topbar-height', `${Math.ceil(topbarHeight)}px`);
    };

    updateStickyOffset();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateStickyOffset) : null;
    observer?.observe(stickySummary);
    window.addEventListener('resize', updateStickyOffset);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateStickyOffset);
    };
  }, [processedCampaigns.length, reportFromDate, reportToDate, provider]);

  const dateLabel = useMemo(() => {
    if (reportFromDate === reportToDate) {
      return reportFromDate === todayString() ? 'hom nay' : reportFromDate.split('-').reverse().join('/');
    }
    return `${reportFromDate.split('-').reverse().join('/')} ~ ${reportToDate.split('-').reverse().join('/')}`;
  }, [reportFromDate, reportToDate]);

  return (
    <div id="page-dashboard" ref={dashboardRef}>
      <div className="dashboard-sticky-summary" ref={stickySummaryRef}>
      <div className="stats-grid section-gap">
        <div className="stat g">
          <div className="stat-label">Tai khoan</div>
          <div className="stat-value g" id="sAccounts">{localStats.totalAccounts ?? globalStats.totalAccounts ?? '-'}</div>
          <div className="stat-sub">{localStats.connectedAccounts ?? globalStats.connectedAccounts ?? 0} ket noi</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Camp dang chay</div>
          <div className="stat-value b" id="sActive">{localStats.activeCount !== undefined ? formatNumber(localStats.activeCount) : '-'}</div>
          <div className="stat-sub">Tong: {formatNumber(processedCampaigns.length)} camp</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Chi tieu {dateLabel}</div>
          <div className="stat-value o stat-value-compact" id="sSpend">{localStats.totalSpend ? formatVND(localStats.totalSpend) : '-'}</div>
        </div>
        <div className="stat p">
          <div className="stat-label">{isShopee ? 'Luot click' : 'Tin nhan'} {dateLabel}</div>
          <div className="stat-value p" id="sMessages">{isShopee ? formatNumber(localStats.totalClicks || 0) : (localStats.totalMessages ? formatNumber(localStats.totalMessages) : '-')}</div>
          <div className="stat-sub">{!isShopee && metaAvgCPM > 0 ? `Chi phi/luot tro chuyen: ${formatVND(metaAvgCPM)}` : '-'}</div>
        </div>
        {showOrders && (
          <div className="stat g2" style={{ borderColor: 'var(--g2)' }}>
            <div className="stat-label">Don hang {dateLabel}</div>
            <div className="stat-value g2" id="sOrders" style={{ color: 'var(--g2)' }}>{skuLoading ? '...' : skuTotal}</div>
            <div className="stat-sub">Tu Google Sheet</div>
          </div>
        )}
        {showOrders && (
          <div className="stat r" style={{ borderColor: 'var(--r)' }}>
            <div className="stat-label">CPO {dateLabel}</div>
            <div className="stat-value" id="sCPO" style={{ color: 'var(--r)', fontSize: skuLoading ? '1.4rem' : undefined }}>
              {skuLoading ? '...' : (skuTotal > 0 && localStats.totalSpend > 0) ? formatVND(localStats.totalSpend / skuTotal) : '-'}
            </div>
            <div className="stat-sub">Chi tiêu / Đơn</div>
          </div>
        )}
        {showOrders && (
          <div className="stat return-rate">
            <div className="stat-label">Tỉ lệ hoàn {dateLabel}</div>
            <div className="stat-value" id="sReturnRate">{skuLoading ? '...' : orderReturnStats.denominator > 0 ? formatPercent(orderReturnStats.rate) : ''}</div>
            <div className="stat-sub">
              {skuLoading ? 'Dang tai' : orderReturnStats.denominator > 0 ? `${formatNumber(orderReturnStats.returned + orderReturnStats.returning)} / ${formatNumber(orderReturnStats.denominator)}` : ''}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
            <div className="card-title" style={{ margin: 0 }}>Bao cao chi tiet {dateLabel}</div>
            <DateRangePicker fromDate={reportFromDate} toDate={reportToDate} onChange={(from, to) => { setReportFromDate(from); setReportToDate(to); }} centered />
            <button className="btn btn-ghost btn-sm" onClick={reloadDashboardNow} disabled={statsLoading}>
              Reload
            </button>
            <input
              type="search"
              value={campaignSearch}
              onChange={e => setCampaignSearch(e.target.value)}
              placeholder="Tim camp, ID, tai khoan..."
              aria-label="Tim campaign"
              style={{ width: '260px', maxWidth: '32vw', height: '38px', border: '1px solid var(--border)', borderRadius: '10px', padding: '0 12px', color: 'var(--txt)', background: 'var(--s1)', outline: 'none', boxShadow: '0 2px 10px rgba(15, 23, 42, 0.06)' }}
            />
            <button
              className="btn btn-sm dashboard-disable-duplicates-btn"
              onClick={disableDuplicateCampaigns}
              disabled={disablingDuplicates || duplicateCampaignsToPause.length === 0}
              title="Tat cac camp trung, giu lai camp tao som nhat trong moi nhom"
            >
              {disablingDuplicates ? 'Dang tat...' : `Tat camp trung (${duplicateCampaignsToPause.length})`}
            </button>
            {(skuLoading || statsLoading || isSortPending) && <span className="spin" style={{ fontSize: '14px' }}>...</span>}
          </div>
        </div>
      </div>
      </div>

      <div className="card dashboard-table-card">
        <div className="tbl-wrap" id="dashCampTable">
          {(globalLoading || statsLoading) ? (
            <div className="empty"><span className="spin">...</span><p style={{ marginTop: '10px' }}>Dang tai...</p></div>
          ) : processedCampaigns.length === 0 ? (
            <div className="empty"><div className="ei">-</div><p>Không có dữ liệu ngày hôm nay </p></div>
          ) : (
            <table className="tbl excel-style">
              <thead>
                <tr>
                  <th>Ten Campaign</th>
                  <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('duplicateCount')}>Trung<SortIcon field="duplicateCount" sortField={sortField} sortDir={sortDir} /></th>
                  <th>Ngay tao</th>
                  <th className="text-center">Tắt/Bật</th>
                  <th>Ten TKQC</th>
                  <th className="text-center">Trạng Thái</th>
                  {showOrders && <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('orderCount')}>Tổng Đơn<SortIcon field="orderCount" sortField={sortField} sortDir={sortDir} /></th>}
                  {showOrders && <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('metaOrders')}>Đơn Meta<SortIcon field="metaOrders" sortField={sortField} sortDir={sortDir} /></th>}
                  <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('messages')}>
                    {isShopee ? 'Luot click (Gia/click)' : 'Bat dau tro chuyen (Gia/BDCT)'}<SortIcon field="messages" sortField={sortField} sortDir={sortDir} />
                  </th>
                  {showOrders && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerOrder')}>CPO<SortIcon field="costPerOrder" sortField={sortField} sortDir={sortDir} /></th>}
                  <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('spend')}>Chi Tiêu<SortIcon field="spend" sortField={sortField} sortDir={sortDir} /></th>
                  <th className="text-right">Ngân Sách</th>
                  {showOrders && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('returnRate')}>Tỉ lệ Hoàn<SortIcon field="returnRate" sortField={sortField} sortDir={sortDir} /></th>}
                </tr>
              </thead>
              <tbody>
                {visibleCampaigns.map((campaign) => {
                  const campaignId = campaign.campaignId || '';
                  const isActive = isCampaignActiveStatus(campaign.status);
                  const isToggling = togglingCampaignIds.has(campaignId);
                  const isEditingCampaign = editingCampaignId === campaignId;
                  const isEditingBudget = editingBudgetId === campaignId;
                  const isRenamingCampaign = renamingCampaignId === campaignId;
                  const isSavingBudget = savingBudgetId === campaignId;
                  return (
                    <CampaignRow
                      key={campaignId}
                      campaign={campaign}
                      isActive={isActive}
                      isToggling={isToggling}
                      isEditingCampaign={isEditingCampaign}
                      editingCampaignName={editingCampaignName}
                      isRenamingCampaign={isRenamingCampaign}
                      isEditingBudget={isEditingBudget}
                      editingBudget={editingBudget}
                      isSavingBudget={isSavingBudget}
                      isShopee={isShopee}
                      showOrders={showOrders}
                      onStartRename={startRenameCampaign}
                      onSaveRename={saveRenameCampaign}
                      onCancelRename={cancelRenameCampaign}
                      onToggleStatus={toggleCampaignStatus}
                      onStartEditBudget={startEditBudget}
                      onSaveBudget={saveBudget}
                      onCancelEditBudget={cancelEditBudget}
                      setEditingCampaignName={setEditingCampaignName}
                      setEditingBudget={setEditingBudget}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {processedCampaigns.length > DASHBOARD_CAMPAIGNS_PER_PAGE && (
          <div className="dashboard-pagination">
            <span>Hien thi {(currentPage - 1) * DASHBOARD_CAMPAIGNS_PER_PAGE + 1}-{Math.min(currentPage * DASHBOARD_CAMPAIGNS_PER_PAGE, processedCampaigns.length)} / {processedCampaigns.length} camp</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>Dau</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(page => Math.max(1, page - 1))} disabled={currentPage === 1}>Truoc</button>
            {Array.from({ length: totalPages }, (_, index) => index + 1)
              .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2)
              .map((page, index, pages) => (
                <React.Fragment key={page}>
                  {index > 0 && page - pages[index - 1] > 1 && <span className="dashboard-page-gap">...</span>}
                  <button className={`btn btn-sm ${page === currentPage ? 'btn-g' : 'btn-ghost'}`} onClick={() => setCurrentPage(page)}>{page}</button>
                </React.Fragment>
              ))}
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>Sau</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>Cuoi</button>
          </div>
        )}
      </div>
    </div>
  );
}
