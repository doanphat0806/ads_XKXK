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
const DASHBOARD_HIDDEN_COLUMNS_KEY = 'dashboard:hiddenColumns';
const DASHBOARD_COLUMNS = [
  { id: 'duplicateCount', label: 'Trùng' },
  { id: 'createdTime', label: 'Ngày tạo' },
  { id: 'toggle', label: 'Tắt/Bật' },
  { id: 'account', label: 'Tên TKQC' },
  { id: 'status', label: 'Trạng thái' },
  { id: 'orderCount', label: 'Tổng đơn', ordersOnly: true },
  { id: 'metaOrders', label: 'Đơn Meta', ordersOnly: true },
  { id: 'messages', label: 'Tin nhắn / Click' },
  { id: 'costPerOrder', label: 'CPO', ordersOnly: true },
  { id: 'spend', label: 'Chi tiêu' },
  { id: 'budget', label: 'Ngân sách' },
  { id: 'returnRate', label: 'Tỉ lệ hoàn', ordersOnly: true },
  { id: 'impressions', label: 'Hiển thị' },
  { id: 'reach', label: 'Tiếp cận' },
  { id: 'engagements', label: 'Tương tác' },
  { id: 'costPerClick', label: 'CPC' },
  { id: 'costPerMille', label: 'CPM' },
  { id: 'ctr', label: 'CTR' },
  { id: 'linkClicks', label: 'Click liên kết' },
  { id: 'costPerLinkClick', label: 'CPC liên kết' },
  { id: 'frequency', label: 'Tần suất' },
  { id: 'costPerReach', label: 'CPP (1.000 tiếp cận)' },
  { id: 'bidAmount', label: 'Giá bid' }
];

const readHiddenColumns = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DASHBOARD_HIDDEN_COLUMNS_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
};

const DASHBOARD_METRIC_SORT_FIELDS = new Set(['impressions', 'reach', 'engagements', 'costPerClick', 'costPerMille', 'ctr', 'linkClicks', 'costPerLinkClick', 'frequency', 'costPerReach', 'bidAmount']);
const EMPTY_RETURN_STATS = { returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 };

const buildStatsFromCampaigns = (campaigns = [], isShopee = false) => {
  const totals = campaigns.reduce((items, campaign) => {
    const spend = Number(campaign.spend || 0);
    const messages = Number(campaign.messages || 0);
    const clicks = Number(campaign.clicks || 0);
    const hasSpend = spend > 0;
    const status = normalizeStatus(campaign.status);

    items.totalSpend += spend;
    items.totalMessages += messages;
    items.totalClicks += clicks;
    if (hasSpend && status === 'ACTIVE') items.activeCount += 1;
    if (hasSpend && status === 'PAUSED') items.pausedCount += 1;
    return items;
  }, {
    activeCount: 0,
    pausedCount: 0,
    totalSpend: 0,
    totalMessages: 0,
    totalClicks: 0
  });

  return {
    ...totals,
    avgCPM: !isShopee && totals.totalMessages > 0 ? totals.totalSpend / totals.totalMessages : 0
  };
};

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
  setEditingBudget,
  hiddenColumns
}) {
  const budget = campaign.dailyBudget || campaign.lifetimeBudget || 0;
  const show = (id) => !hiddenColumns.has(id);

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
      {show('duplicateCount') && <td className="text-center" style={{ fontWeight: 'bold', color: campaign.sameDayDuplicateCount > 1 ? 'var(--r)' : 'var(--txt)' }}>
        {campaign.sameDayDuplicateCount || 1}
      </td>}
      {show('createdTime') && <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{formatDateTime(campaign.createdTime || campaign.created_time)}</td>}
      {show('toggle') && <td className="text-center">
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
      </td>}
      {show('account') && <td style={{ fontWeight: 500 }}>{campaign.accountId?.name || '-'}</td>}
      {show('status') && <td className="text-center"><span className={`badge ${isActive ? 'active' : 'paused'}`}>{isActive ? 'ACTIVE' : 'PAUSE'}</span></td>}
      {showOrders && show('orderCount') && <td className="text-center" style={{ fontWeight: 'bold', color: 'var(--txt)' }}>{campaign.orderCount || '-'}</td>}
      {showOrders && show('metaOrders') && <td className="text-center" style={{ fontWeight: 'bold', color: campaign.metaOrders > 0 ? 'var(--txt)' : 'var(--muted2)' }}>{campaign.metaOrders > 0 ? campaign.metaOrders : '-'}</td>}
      {show('messages') && <td className="text-right">
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
      </td>}
      {showOrders && show('costPerOrder') && <td className="text-right" style={{ color: campaign.costPerOrder > CPO_WARNING_THRESHOLD ? 'var(--r)' : 'var(--txt)', fontWeight: campaign.costPerOrder > CPO_WARNING_THRESHOLD ? 'bold' : undefined }}>{campaign.costPerOrder > 0 ? formatVND(campaign.costPerOrder) : '-'}</td>}
      {show('spend') && <td className="text-right mono-sm">{formatVND(campaign.spend)}</td>}
      {show('budget') && <td className="text-right mono-sm">
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
      </td>}
      {showOrders && show('returnRate') && (
        <td className="text-right" style={{ color: campaign.returnStats?.denominator > 0 ? 'var(--b)' : 'var(--muted2)' }}>
          {campaign.returnStats?.denominator > 0 ? <><div style={{ fontWeight: 'bold' }}>{formatPercent(campaign.returnRate)}</div><div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{formatNumber((campaign.returnStats.returned || 0) + (campaign.returnStats.returning || 0))} / {formatNumber(campaign.returnStats.denominator)}</div></> : ''}
        </td>
      )}
      {show('impressions') && <td className="text-right mono-sm">{formatNumber(campaign.impressions || 0)}</td>}
      {show('reach') && <td className="text-right mono-sm" title={campaign.reachUnavailable ? 'Meta không có tiếp cận theo giờ' : undefined}>{campaign.reachUnavailable ? '-' : formatNumber(campaign.reach || 0)}</td>}
      {show('engagements') && <td className="text-right mono-sm">{formatNumber(campaign.engagements || 0)}</td>}
      {show('costPerClick') && <td className="text-right mono-sm">{campaign.costPerClick > 0 ? formatVND(campaign.costPerClick) : '-'}</td>}
      {show('costPerMille') && <td className="text-right mono-sm">{campaign.costPerMille > 0 ? formatVND(campaign.costPerMille) : '-'}</td>}
      {show('ctr') && <td className="text-right mono-sm">{campaign.ctr > 0 ? formatPercent(campaign.ctr) : '-'}</td>}
      {show('linkClicks') && <td className="text-right mono-sm">{formatNumber(campaign.linkClicks || 0)}</td>}
      {show('costPerLinkClick') && <td className="text-right mono-sm">{campaign.costPerLinkClick > 0 ? formatVND(campaign.costPerLinkClick) : '-'}</td>}
      {show('frequency') && <td className="text-right mono-sm">{campaign.frequency > 0 ? campaign.frequency.toFixed(2).replace('.', ',') : '-'}</td>}
      {show('costPerReach') && <td className="text-right mono-sm">{campaign.costPerReach > 0 ? formatVND(campaign.costPerReach) : '-'}</td>}
      {show('bidAmount') && <td className="text-right mono-sm">{Number(campaign.bidAmount || 0) > 0 ? formatVND(campaign.bidAmount) : '-'}</td>}
    </tr>
  );
});

export default function Dashboard() {
  const { provider, stats: globalStats } = useAppContext();
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
  const dashboardLoadSeqRef = useRef(0);

  const [sortField, setSortField] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [reportFromDate, setReportFromDate] = useState(() => todayString());
  const [reportHours, setReportHours] = useState({ fromHour: 0, toHour: 23 });
  const [hourlyData, setHourlyData] = useState(null);
  const [hourlyError, setHourlyError] = useState('');
  const [hourlySkuStats, setHourlySkuStats] = useState(null);
  const [hourlySkuError, setHourlySkuError] = useState('');
  const hourRangeActive = reportHours.fromHour !== 0 || reportHours.toHour !== 23;
  const [reportToDate, setReportToDate] = useState(() => todayString());
  const [localStats, setLocalStats] = useState({});
  const [localCampaigns, setLocalCampaigns] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
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
  const [exportingExcel, setExportingExcel] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState(readHiddenColumns);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef(null);
  const availableColumns = useMemo(() => DASHBOARD_COLUMNS.filter(column => showOrders || !column.ordersOnly), [showOrders]);
  const hiddenColumnCount = availableColumns.filter(column => hiddenColumns.has(column.id)).length;
  const isColumnVisible = (id) => {
    const column = DASHBOARD_COLUMNS.find(item => item.id === id);
    if (column?.ordersOnly && !showOrders) return false;
    return !hiddenColumns.has(id);
  };
  const updateHiddenColumns = (next) => {
    setHiddenColumns(next);
    try {
      localStorage.setItem(DASHBOARD_HIDDEN_COLUMNS_KEY, JSON.stringify([...next]));
    } catch {
      // localStorage khong kha dung -> chi giu trong phien hien tai
    }
  };
  const toggleColumn = (id) => {
    const next = new Set(hiddenColumns);
    if (next.has(id)) next.delete(id); else next.add(id);
    updateHiddenColumns(next);
  };

  useEffect(() => {
    if (!columnMenuOpen) return undefined;
    const handleClickOutside = (event) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target)) setColumnMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [columnMenuOpen]);
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
    const loadSeq = dashboardLoadSeqRef.current + 1;
    dashboardLoadSeqRef.current = loadSeq;
    const statsUrl = `/stats?provider=${provider}&fromDate=${from}&toDate=${to}&includeOrders=false`;
    const campaignsUrl = `/campaigns/today?provider=${provider}&fromDate=${from}&toDate=${to}`;
    const cachedStats = readResponseCache(`GET:${statsUrl}`);
    const cachedCampaigns = readResponseCache(`GET:${campaignsUrl}`);
    if (cachedStats) setLocalStats(cachedStats);
    if (cachedCampaigns) setLocalCampaigns(cachedCampaigns.map(keepCurrentSortStatus));

    setStatsLoading(!cachedStats);
    setCampaignsLoading(!cachedCampaigns);

    const applyCampaignRows = (data) => {
      if (dashboardLoadSeqRef.current !== loadSeq) return;
      const nextCampaigns = data.map(keepCurrentSortStatus);
      setLocalCampaigns(nextCampaigns);
      setLocalStats(currentStats => ({
        ...currentStats,
        ...buildStatsFromCampaigns(nextCampaigns, provider === 'shopee')
      }));
    };

    try {
      const statsPromise = cachedApi('GET', statsUrl)
        .then(data => {
          if (dashboardLoadSeqRef.current === loadSeq) setLocalStats(data);
        })
        .catch(e => console.error('Failed to load dashboard stats', e))
        .finally(() => {
          if (dashboardLoadSeqRef.current === loadSeq) setStatsLoading(false);
        });

      const campaignsPromise = cachedApi('GET', campaignsUrl, null, { timeoutMs: 5 * 60 * 1000 })
        .then(data => {
          applyCampaignRows(data);
        })
        .catch(e => {
          console.error('Failed to load dashboard campaigns', e);
        })
        .finally(() => {
          if (dashboardLoadSeqRef.current === loadSeq) setCampaignsLoading(false);
        });

      await Promise.all([statsPromise, campaignsPromise]);
    } catch (e) {
      console.error('Failed to load dashboard data', e);
      setStatsLoading(false);
      setCampaignsLoading(false);
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
    let hasCachedSkuCounts = false;
    try {
      const skuCountsUrl = `/orders/sku-counts?fromDate=${from}&toDate=${to}`;
      const cachedSkuCounts = readResponseCache(`GET:${skuCountsUrl}`);
      if (cachedSkuCounts) {
        hasCachedSkuCounts = true;
        setSkuCounts(cachedSkuCounts.counts || {});
        setSkuTotal(cachedSkuCounts.totalOrders || 0);
        setOrderReturnStats(cachedSkuCounts.returnStats || EMPTY_RETURN_STATS);
        if (!silent) setSkuLoading(false);
      }
      const data = await cachedApi('GET', skuCountsUrl);
      setSkuCounts(data.counts || {});
      setSkuTotal(data.totalOrders || 0);
      setOrderReturnStats(data.returnStats || EMPTY_RETURN_STATS);
      if (includeReturnStats) {
        const returnStatsUrl = `/orders/sku-counts?fromDate=${CAMPAIGN_RETURN_STATS_FROM_DATE}&toDate=${todayString()}`;
        const cachedReturnStats = readResponseCache(`GET:${returnStatsUrl}`);
        if (cachedReturnStats) setReturnStatsBySku(cachedReturnStats.returnStatsBySku || {});
        cachedApi('GET', returnStatsUrl)
          .then(returnData => setReturnStatsBySku(returnData.returnStatsBySku || {}))
          .catch(() => {});
      }
    } catch {
      if (!silent && !hasCachedSkuCounts) {
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

  // Dang chon khung gio -> Tong don lay tu Pancake POS (co gio tao don), sheet chi co ngay
  useEffect(() => {
    if (!hourRangeActive || !showOrders) return undefined;
    let cancelled = false;
    const { fromHour, toHour } = reportHours;
    const load = () => api('GET', `/orders/hourly-sku-counts?fromDate=${reportFromDate}&toDate=${reportToDate}&fromHour=${fromHour}&toHour=${toHour}`, null, { timeoutMs: 5 * 60 * 1000 })
      .then(data => { if (!cancelled) { setHourlySkuStats(data); setHourlySkuError(''); } })
      .catch(error => { if (!cancelled) setHourlySkuError(error?.message || 'Khong tai duoc don theo gio'); });
    load();
    const interval = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hourRangeActive, showOrders, reportFromDate, reportToDate, reportHours]);

  const hourlySkuReady = Boolean(
    hourRangeActive && hourlySkuStats &&
    hourlySkuStats.fromDate === reportFromDate && hourlySkuStats.toDate === reportToDate &&
    hourlySkuStats.fromHour === reportHours.fromHour && hourlySkuStats.toHour === reportHours.toHour
  );
  const effectiveSkuCounts = useMemo(() => (
    hourlySkuReady ? (hourlySkuStats.counts || {}) : skuCounts
  ), [hourlySkuReady, hourlySkuStats, skuCounts]);
  const effectiveSkuTotal = hourlySkuReady ? Number(hourlySkuStats.totalOrders || 0) : skuTotal;

  const hasSkuCounts = useMemo(() => Object.keys(effectiveSkuCounts || {}).length > 0, [effectiveSkuCounts]);
  const hasReturnStatsBySku = useMemo(() => Object.keys(returnStatsBySku || {}).length > 0, [returnStatsBySku]);

  const getOrderCountForCampaign = useCallback((campaignName) => {
    if (!campaignName || !hasSkuCounts) return 0;
    for (const skuKey of getCampaignSkuCandidates(campaignName)) {
      const count = Number(effectiveSkuCounts[skuKey] || 0);
      if (count > 0) return count;
    }
    return 0;
  }, [effectiveSkuCounts, hasSkuCounts]);

  const getReturnStatsForCampaign = useCallback((campaignName) => {
    if (!campaignName || !hasReturnStatsBySku) return EMPTY_RETURN_STATS;
    for (const skuKey of getCampaignSkuCandidates(campaignName)) {
      const stats = returnStatsBySku[skuKey];
      if (stats) return stats;
    }
    return EMPTY_RETURN_STATS;
  }, [returnStatsBySku, hasReturnStatsBySku]);

  // Dang chon khung gio (khac ca ngay) -> chi tieu/click/hien thi/don Meta cua camp chi tinh trong khung gio do.
  // Tiep can (va tan suat, CPP) khong cong don theo gio duoc -> an ("-") khi dang chon khung gio.
  const hourlyDataReady = Boolean(hourlyData && hourlyData.fromDate === reportFromDate && hourlyData.toDate === reportToDate);

  // Chi tai du lieu theo gio (Meta Insights breakdown theo gio) khi dang chon khung gio
  useEffect(() => {
    if (!hourRangeActive) return undefined;
    let cancelled = false;
    setHourlyError('');
    api('GET', `/campaigns/hourly-spend?provider=${provider}&fromDate=${reportFromDate}&toDate=${reportToDate}`, null, { timeoutMs: 5 * 60 * 1000 })
      .then(data => { if (!cancelled) setHourlyData(data); })
      .catch(error => { if (!cancelled) setHourlyError(error?.message || 'Khong tai duoc so lieu theo gio'); });
    return () => { cancelled = true; };
  }, [hourRangeActive, provider, reportFromDate, reportToDate]);
  const hourAdjustedCampaigns = useMemo(() => {
    if (!hourRangeActive || !hourlyDataReady) return localCampaigns;
    const { fromHour, toHour } = reportHours;
    const sumRange = (row) => {
      if (!row) return 0;
      let total = 0;
      for (let hour = fromHour; hour <= toHour; hour += 1) total += Number(row[hour] || 0);
      return total;
    };
    return localCampaigns.map(campaign => {
      const id = String(campaign.campaignId);
      const metrics = hourlyData.metricsByCampaign?.[id] || {};
      const spend = sumRange(hourlyData.byCampaign?.[id]);
      const messages = sumRange(metrics.messages);
      return {
        ...campaign,
        spend,
        clicks: sumRange(metrics.clicks),
        impressions: sumRange(metrics.impressions),
        linkClicks: sumRange(metrics.linkClicks),
        engagements: sumRange(metrics.engagements),
        messages,
        costPerMessage: messages > 0 ? spend / messages : 0,
        reach: 0,
        reachUnavailable: true,
        metaOrders: sumRange(hourlyData.ordersByCampaign?.[id])
      };
    });
  }, [localCampaigns, hourRangeActive, hourlyDataReady, hourlyData, reportHours]);

  const filteredCampaigns = useMemo(() => {
    const search = deferredCampaignSearch.trim().toLowerCase();
    return hourAdjustedCampaigns
      .filter(c => Number(c.spend || 0) > 0)
      .filter(c => {
        if (!search) return true;
        return [c.name, c.campaignId, c.accountId?.name, c.accountId?.adAccountId].some(value =>
          String(value || '').toLowerCase().includes(search)
        );
      });
  }, [hourAdjustedCampaigns, deferredCampaignSearch]);

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
      const impressions = Number(campaign.impressions || 0);
      const costPerMille = impressions > 0 ? (spend / impressions) * 1000 : 0;
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const reach = Number(campaign.reach || 0);
      const linkClicks = Number(campaign.linkClicks || 0);
      const costPerLinkClick = linkClicks > 0 ? spend / linkClicks : 0;
      const frequency = reach > 0 ? impressions / reach : 0;
      const costPerReach = reach > 0 ? (spend / reach) * 1000 : 0;
      return {
        ...campaign,
        orderCount,
        returnStats,
        returnRate: returnStats.rate || 0,
        costPerOrder,
        costPerMessage,
        costPerClick,
        costPerMille,
        ctr,
        linkClicks,
        costPerLinkClick,
        frequency,
        costPerReach,
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
      if (DASHBOARD_METRIC_SORT_FIELDS.has(sortField)) return dir * (Number(a[sortField] || 0) - Number(b[sortField] || 0));
      if (sortField === 'messages') return dir * ((isShopee ? a.costPerClick : a.costPerMessage) - (isShopee ? b.costPerClick : b.costPerMessage));
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
  const campaignStats = useMemo(() => buildStatsFromCampaigns(hourAdjustedCampaigns, isShopee), [hourAdjustedCampaigns, isShopee]);
  const metaAvgCPM = useMemo(() => {
    if (isShopee) return 0;
    return Number(campaignStats.avgCPM || 0);
  }, [campaignStats.avgCPM, isShopee]);

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
        const spendDiff = Number(b.spend || 0) - Number(a.spend || 0);
        if (spendDiff !== 0) return spendDiff;

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

  // Phu thuoc vao SO LUONG dong, khong phu thuoc tham chieu mang. Bam Tat/Bat mot
  // camp se goi setLocalCampaigns -> processedCampaigns tao mang moi (noi dung gan
  // nhu y het, chi doi status 1 dong) -> effect nay chay -> bang dang render 500
  // dong bi keo ve 300, trang ngan lai dot ngot nen trinh duyet cuon vot len, roi
  // 16ms sau moi gian ra lai. Nguoi dung thay "nhay hinh" va phai lan chuot xuong
  // tim lai dung nut vua bam. Dem dong khong doi khi bat/tat nen khong con reset.
  useEffect(() => {
    setRenderLimit(DASHBOARD_INITIAL_RENDER_ROWS);
  }, [currentPage, processedCampaigns.length]);

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

  const exportDashboardExcel = async () => {
    if (exportingExcel || processedCampaigns.length === 0) return;
    setExportingExcel(true);
    try {
      const XLSX = await import('xlsx');
      const rows = processedCampaigns.map(campaign => {
        const row = {
          'Ten Campaign': toText(campaign.name),
          'ID Campaign': campaign.campaignId || '',
          'Ngay tao': formatDateTime(campaign.createdTime || campaign.created_time),
          'Ten TKQC': campaign.accountId?.name || '',
          'ID TKQC': campaign.accountId?.adAccountId || '',
          'Trang thai': isCampaignActiveStatus(campaign.status) ? 'ACTIVE' : 'PAUSE'
        };
        if (showOrders) {
          row['Tong don'] = campaign.orderCount || 0;
          row['Don Meta'] = campaign.metaOrders || 0;
        }
        if (isShopee) {
          row['Luot click'] = Number(campaign.clicks || 0);
          row['Gia/click'] = Math.round(campaign.costPerClick || 0);
        } else {
          row['Tin nhan'] = Number(campaign.messages || 0);
          row['Gia/TN'] = Math.round(campaign.costPerMessage || 0);
        }
        if (showOrders) row['CPO'] = Math.round(campaign.costPerOrder || 0);
        Object.assign(row, {
          'Chi tieu': Math.round(Number(campaign.spend || 0)),
          'Ngan sach': Number(campaign.dailyBudget || campaign.lifetimeBudget || 0)
        });
        if (showOrders) row['Ti le hoan (%)'] = Number(((campaign.returnRate || 0) * 100).toFixed(2));
        Object.assign(row, {
          'Hien thi': Number(campaign.impressions || 0),
          'Tiep can': campaign.reachUnavailable ? '' : Number(campaign.reach || 0),
          'Tuong tac': Number(campaign.engagements || 0),
          'Clicks': Number(campaign.clicks || 0),
          'CPC': Math.round(campaign.costPerClick || 0),
          'CPM': Math.round(campaign.costPerMille || 0),
          'CTR (%)': Number(((campaign.ctr || 0) * 100).toFixed(2)),
          'Click lien ket': campaign.linkClicks || 0,
          'CPC lien ket': Math.round(campaign.costPerLinkClick || 0),
          'Tan suat': Number((campaign.frequency || 0).toFixed(2)),
          'CPP': Math.round(campaign.costPerReach || 0),
          'Gia bid': Number(campaign.bidAmount || 0)
        });
        return row;
      });
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = Object.keys(rows[0]).map(key => ({ wch: key === 'Ten Campaign' ? 40 : Math.max(12, key.length + 2) }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Dashboard');
      const range = reportFromDate === reportToDate ? reportFromDate : `${reportFromDate}_${reportToDate}`;
      XLSX.writeFile(workbook, `dashboard-${provider || 'all'}-${range}.xlsx`);
    } catch (error) {
      toast.error(`Xuat Excel that bai: ${error.message}`);
    } finally {
      setExportingExcel(false);
    }
  };

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
          <div className="stat-value b" id="sActive">{formatNumber(campaignStats.activeCount || 0)}</div>
          <div className="stat-sub">Tong: {formatNumber(processedCampaigns.length)} camp</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Chi tieu {dateLabel}</div>
          <div className="stat-value o stat-value-compact" id="sSpend">{campaignStats.totalSpend ? formatVND(campaignStats.totalSpend) : '-'}</div>
        </div>
        <div className="stat p">
          <div className="stat-label">{isShopee ? 'Luot click' : 'Tin nhan'} {dateLabel}</div>
          <div className="stat-value p" id="sMessages">{isShopee ? formatNumber(campaignStats.totalClicks || 0) : (campaignStats.totalMessages ? formatNumber(campaignStats.totalMessages) : '-')}</div>
          <div className="stat-sub">{!isShopee && metaAvgCPM > 0 ? `Chi phi/luot tro chuyen: ${formatVND(metaAvgCPM)}` : '-'}</div>
        </div>
        {showOrders && (
          <div className="stat g2" style={{ borderColor: 'var(--g2)' }}>
            <div className="stat-label">Don hang {dateLabel}</div>
            <div className="stat-value g2" id="sOrders" style={{ color: 'var(--g2)' }}>{skuLoading ? '...' : effectiveSkuTotal}</div>
            <div className="stat-sub">Tu Google Sheet</div>
          </div>
        )}
        {showOrders && (
          <div className="stat r" style={{ borderColor: 'var(--r)' }}>
            <div className="stat-label">CPO {dateLabel}</div>
            <div className="stat-value" id="sCPO" style={{ color: 'var(--r)', fontSize: skuLoading ? '1.4rem' : undefined }}>
              {skuLoading ? '...' : (effectiveSkuTotal > 0 && campaignStats.totalSpend > 0) ? formatVND(campaignStats.totalSpend / effectiveSkuTotal) : '-'}
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
            <DateRangePicker
              fromDate={reportFromDate}
              toDate={reportToDate}
              fromHour={reportHours.fromHour}
              toHour={reportHours.toHour}
              showHours
              onChange={(from, to, hours) => {
                setReportFromDate(from);
                setReportToDate(to);
                if (hours) setReportHours(hours);
              }}
              centered
            />
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
            <button className="btn btn-ghost btn-sm" onClick={exportDashboardExcel} disabled={exportingExcel || processedCampaigns.length === 0}>
              {exportingExcel ? 'Dang xuat...' : 'Xuất Excel'}
            </button>
            <div className="dashboard-column-menu" ref={columnMenuRef}>
              <button className="btn btn-ghost btn-sm" onClick={() => setColumnMenuOpen(open => !open)} aria-expanded={columnMenuOpen}>
                Tùy chỉnh cột{hiddenColumnCount > 0 ? ` (ẩn ${hiddenColumnCount})` : ''}
              </button>
              {columnMenuOpen && (
                <div className="dashboard-column-menu-panel">
                  <div className="dashboard-column-menu-actions">
                    <button type="button" onClick={() => updateHiddenColumns(new Set())}>Hiện tất cả</button>
                  </div>
                  {availableColumns.map(column => (
                    <label key={column.id} className="dashboard-column-menu-item">
                      <input type="checkbox" checked={!hiddenColumns.has(column.id)} onChange={() => toggleColumn(column.id)} />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {(skuLoading || statsLoading || isSortPending) && <span className="spin" style={{ fontSize: '14px' }}>...</span>}
          </div>
        </div>
      </div>
      </div>

      {hourRangeActive && (
        <div className="hourly-table-note">
          {hourlyError && !hourlyDataReady
            ? <span style={{ color: 'var(--r)' }}>Không tải được số liệu theo giờ: {hourlyError}</span>
            : hourlyDataReady
            ? <span>
                Đang tính <b>chi tiêu, click, hiển thị, tương tác, tin nhắn, đơn Meta{hourlySkuReady ? ', Tổng đơn (POS)' : ''}</b> trong khung <b>{reportHours.fromHour}h–{reportHours.toHour}h59</b>.
                {' '}Tiếp cận, tần suất, CPP không có theo giờ (hiện "-"){hourlySkuReady ? '' : '; Tổng đơn vẫn là cả ngày'}.
                {showOrders && hourlySkuError && !hourlySkuReady && <span style={{ color: 'var(--r)' }}> Không lấy được đơn theo giờ từ POS: {hourlySkuError}</span>}
              </span>
            : <span>Đang tải số liệu khung {reportHours.fromHour}h–{reportHours.toHour}h59... bảng tạm hiện số cả ngày.</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportHours({ fromHour: 0, toHour: 23 })}>Xem cả ngày</button>
        </div>
      )}

      <div className="card dashboard-table-card">
        <div className="tbl-wrap" id="dashCampTable">
          {campaignsLoading ? (
            <div className="empty"><span className="spin">...</span><p style={{ marginTop: '10px' }}>Dang tai...</p></div>
          ) : processedCampaigns.length === 0 ? (
            <div className="empty"><div className="ei">-</div><p>Không có dữ liệu ngày hôm nay </p></div>
          ) : (
            <table className="tbl excel-style">
              <thead>
                <tr>
                  <th>Ten Campaign</th>
                  {isColumnVisible('duplicateCount') && <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('duplicateCount')}>Trung<SortIcon field="duplicateCount" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('createdTime') && <th>Ngay tao</th>}
                  {isColumnVisible('toggle') && <th className="text-center">Tắt/Bật</th>}
                  {isColumnVisible('account') && <th>Ten TKQC</th>}
                  {isColumnVisible('status') && <th className="text-center">Trạng Thái</th>}
                  {isColumnVisible('orderCount') && <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('orderCount')}>Tổng Đơn<SortIcon field="orderCount" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('metaOrders') && <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('metaOrders')}>Đơn Meta<SortIcon field="metaOrders" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('messages') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('messages')} title={isShopee ? undefined : 'Chi phí / lượt bắt đầu trò chuyện'}>
                    {isShopee ? 'Luot click (Gia/click)' : 'Giá/TN'}<SortIcon field="messages" sortField={sortField} sortDir={sortDir} />
                  </th>}
                  {isColumnVisible('costPerOrder') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerOrder')}>CPO<SortIcon field="costPerOrder" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('spend') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('spend')}>Chi Tiêu<SortIcon field="spend" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('budget') && <th className="text-right">Ngân Sách</th>}
                  {isColumnVisible('returnRate') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('returnRate')}>Tỉ lệ Hoàn<SortIcon field="returnRate" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('impressions') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('impressions')}>Hiển thị<SortIcon field="impressions" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('reach') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('reach')}>Tiếp cận<SortIcon field="reach" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('engagements') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('engagements')}>Tương tác<SortIcon field="engagements" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('costPerClick') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerClick')}>CPC<SortIcon field="costPerClick" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('costPerMille') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerMille')}>CPM<SortIcon field="costPerMille" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('ctr') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('ctr')}>CTR<SortIcon field="ctr" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('linkClicks') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('linkClicks')}>Click liên kết<SortIcon field="linkClicks" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('costPerLinkClick') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerLinkClick')}>CPC liên kết<SortIcon field="costPerLinkClick" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('frequency') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('frequency')}>Tần suất<SortIcon field="frequency" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('costPerReach') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerReach')}>CPP<SortIcon field="costPerReach" sortField={sortField} sortDir={sortDir} /></th>}
                  {isColumnVisible('bidAmount') && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('bidAmount')}>Giá bid<SortIcon field="bidAmount" sortField={sortField} sortDir={sortDir} /></th>}
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
                      hiddenColumns={hiddenColumns}
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
