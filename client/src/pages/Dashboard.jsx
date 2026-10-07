import React, { useCallback, useDeferredValue, useMemo, useState, useEffect, useRef, useTransition } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatVND, formatNumber, todayString, dateTimeString, api, cachedApi, readResponseCache } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { toast } from 'react-toastify';
import { loadXlsx } from '../utils/loadXlsx';
import ColumnSettingsModal from '../components/ColumnSettingsModal';
import ColumnPresetMenu from '../components/ColumnPresetMenu';
import { META_EXTRA_COLUMNS, META_EXTRA_COLUMN_BY_ID } from '../utils/metaExtraColumns';

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
const HOURLY_REFRESH_MS = 2 * 60 * 1000;
// Cot dang hien + phuong an dang chon: luu rieng tung MAY (nhieu nguoi dung chung 1 tai khoan khong de nhau).
// Danh sach phuong an: luu tren server theo tai khoan (dung chung), localStorage chi la ban tam de hien ngay.
const COLUMN_VIEW_PREFIX = 'dashboard:columnsView:';
const COLUMN_PRESETS_CACHE_PREFIX = 'dashboard:columnPresets:';
// Ban theo user truoc do (luu ca cot dang hien len server) - chi doc de chuyen doi
const PREV_USER_COLUMNS_PREFIX = 'dashboard:columns:';
// Khoa cu (luu chung theo trinh duyet) - chi doc 1 lan de chuyen sang tai khoan dau tien dang nhap
const LEGACY_COLUMN_KEYS = {
  hidden: 'dashboard:hiddenColumns',
  order: 'dashboard:columnOrder',
  presets: 'dashboard:columnPresets',
  activePreset: 'dashboard:activeColumnPreset'
};
const DASHBOARD_COLUMNS = [
  { id: 'duplicateCount', label: 'Trùng', group: 'settings' },
  { id: 'createdTime', label: 'Ngày tạo', group: 'settings' },
  { id: 'toggle', label: 'Tắt/Bật', group: 'settings' },
  { id: 'account', label: 'Tên TKQC', group: 'settings' },
  { id: 'status', label: 'Trạng thái', group: 'settings' },
  { id: 'orderCount', label: 'Tổng đơn', group: 'conversion', ordersOnly: true },
  { id: 'metaOrders', label: 'Đơn Meta', group: 'conversion', ordersOnly: true },
  { id: 'messages', label: 'Tin nhắn / Click', group: 'conversion' },
  { id: 'costPerOrder', label: 'CPO', group: 'conversion', ordersOnly: true },
  { id: 'spend', label: 'Chi tiêu', group: 'performance' },
  { id: 'budget', label: 'Ngân sách', group: 'settings' },
  { id: 'returnRate', label: 'Tỉ lệ hoàn', group: 'conversion', ordersOnly: true },
  { id: 'impressions', label: 'Hiển thị', group: 'performance' },
  { id: 'reach', label: 'Tiếp cận', group: 'performance' },
  { id: 'engagements', label: 'Tương tác', group: 'engagement' },
  { id: 'costPerClick', label: 'CPC', group: 'engagement' },
  { id: 'costPerMille', label: 'CPM', group: 'performance' },
  { id: 'ctr', label: 'CTR', group: 'engagement' },
  { id: 'linkClicks', label: 'Click liên kết', group: 'engagement' },
  { id: 'costPerLinkClick', label: 'CPC liên kết', group: 'engagement' },
  { id: 'frequency', label: 'Tần suất', group: 'performance' },
  { id: 'costPerReach', label: 'CPP (1.000 tiếp cận)', group: 'performance' },
  { id: 'bidAmount', label: 'Giá bid', group: 'settings' },
  ...META_EXTRA_COLUMNS.map(({ id, label, group }) => ({ id, label, group, defaultHidden: true }))
];
const DEFAULT_HIDDEN_COLUMN_IDS = DASHBOARD_COLUMNS.filter(column => column.defaultHidden).map(column => column.id);

// Cot mac dinh an ma nguoi dung chua tung thay (khong co trong thu tu da luu) -> an,
// tranh viec bang tu dung hien them hang chuc cot moi.
const withUnseenColumnsHidden = (hiddenIds = [], knownOrder = []) => {
  const known = new Set(Array.isArray(knownOrder) ? knownOrder : []);
  return new Set([...hiddenIds, ...DEFAULT_HIDDEN_COLUMN_IDS.filter(id => !known.has(id))]);
};

const DASHBOARD_COLUMN_GROUPS = [
  { id: 'settings', label: 'Cài đặt' },
  { id: 'conversion', label: 'Chuyển đổi' },
  { id: 'performance', label: 'Hiệu quả' },
  { id: 'engagement', label: 'Tương tác' }
];
const DEFAULT_COLUMN_ORDER = DASHBOARD_COLUMNS.map(column => column.id);

// Thu tu da luu; bo id khong con ton tai, cot moi them sau nay (chua co trong ban luu) noi vao cuoi
const normalizeColumnOrder = (saved) => {
  const known = Array.isArray(saved) ? saved.filter(id => DEFAULT_COLUMN_ORDER.includes(id)) : [];
  return [...new Set([...known, ...DEFAULT_COLUMN_ORDER])];
};

const normalizeColumnPresets = (value) => (Array.isArray(value)
  ? value.filter(preset => preset && typeof preset.name === 'string' && preset.name.trim())
  : []);

// Cot dang hien tren MAY nay: { order, hidden (Set), activePreset }
const normalizeColumnView = (raw) => {
  const view = raw && typeof raw === 'object' ? raw : {};
  const savedOrder = Array.isArray(view.order) ? view.order : [];
  return {
    order: normalizeColumnOrder(savedOrder),
    hidden: withUnseenColumnsHidden(Array.isArray(view.hidden) ? view.hidden : [], savedOrder),
    activePreset: typeof view.activePreset === 'string' ? view.activePreset : ''
  };
};

const toColumnViewPayload = (view) => ({ order: view.order, hidden: [...view.hidden], activePreset: view.activePreset });

const readJsonStorage = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJsonStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage khong kha dung -> chi giu trong phien hien tai
  }
};

const removeStorageKeys = (keys) => {
  try {
    keys.forEach(key => localStorage.removeItem(key));
  } catch {
    // bo qua
  }
};

// Cau hinh cu luu chung trong trinh duyet (truoc khi tach theo tai khoan); null neu khong co gi
const readLegacyColumnSettings = () => {
  const legacy = {
    order: readJsonStorage(LEGACY_COLUMN_KEYS.order),
    hidden: readJsonStorage(LEGACY_COLUMN_KEYS.hidden),
    presets: readJsonStorage(LEGACY_COLUMN_KEYS.presets)
  };
  try {
    legacy.activePreset = localStorage.getItem(LEGACY_COLUMN_KEYS.activePreset) || '';
  } catch {
    legacy.activePreset = '';
  }
  const hasAny = Array.isArray(legacy.order) || Array.isArray(legacy.hidden) || (Array.isArray(legacy.presets) && legacy.presets.length > 0);
  return hasAny ? legacy : null;
};

// Cot dang hien cua may nay; lan dau tren may thi lay tu ban cu (neu co)
const readColumnView = (userId) => {
  if (!userId) return normalizeColumnView(null);
  return normalizeColumnView(
    readJsonStorage(`${COLUMN_VIEW_PREFIX}${userId}`)
    || readJsonStorage(`${PREV_USER_COLUMNS_PREFIX}${userId}`)
    || readLegacyColumnSettings()
  );
};

// Phuong an o ban cu (chung trinh duyet / ban theo user truoc do) can dua len server
const readPresetsToMigrate = (userId) => normalizeColumnPresets(
  readJsonStorage(`${PREV_USER_COLUMNS_PREFIX}${userId}`)?.presets
  || readLegacyColumnSettings()?.presets
);

const clearMigratedColumnSettings = (userId) => {
  removeStorageKeys([...Object.values(LEGACY_COLUMN_KEYS), `${PREV_USER_COLUMNS_PREFIX}${userId}`]);
};

const DASHBOARD_METRIC_SORT_FIELDS = new Set([
  'impressions', 'reach', 'engagements', 'costPerClick', 'costPerMille', 'ctr', 'linkClicks', 'costPerLinkClick', 'frequency', 'costPerReach', 'bidAmount',
  ...META_EXTRA_COLUMNS.map(column => column.id)
]);
const formatMetaExtraValue = (value, format) => {
  if (value === null || value === undefined) return '-';
  if (format === 'vnd') return value > 0 ? formatVND(value) : '-';
  if (format === 'percent') return value > 0 ? formatPercent(value) : '-';
  return formatNumber(Math.round(value));
};
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
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggleStatus,
  onStartEditBudget,
  onSaveBudget,
  onCancelEditBudget,
  setEditingCampaignName,
  setEditingBudget,
  visibleColumnIds
}) {
  const budget = campaign.dailyBudget || campaign.lifetimeBudget || 0;

  const cells = {
    duplicateCount: () => (
      <td key="duplicateCount" className="text-center" style={{ fontWeight: 'bold', color: campaign.sameDayDuplicateCount > 1 ? 'var(--r)' : 'var(--txt)' }}>
        {campaign.sameDayDuplicateCount || 1}
      </td>
    ),
    createdTime: () => (
      <td key="createdTime" style={{ color: 'var(--muted)', fontSize: '12px' }}>{formatDateTime(campaign.createdTime || campaign.created_time)}</td>
    ),
    toggle: () => (
      <td key="toggle" className="text-center">
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
    ),
    account: () => (
      <td key="account" style={{ fontWeight: 500 }}>{campaign.accountId?.name || '-'}</td>
    ),
    status: () => (
      <td key="status" className="text-center"><span className={`badge ${isActive ? 'active' : 'paused'}`}>{isActive ? 'ACTIVE' : 'PAUSE'}</span></td>
    ),
    orderCount: () => (
      <td key="orderCount" className="text-center" style={{ fontWeight: 'bold', color: 'var(--txt)' }}>{campaign.orderCount || '-'}</td>
    ),
    metaOrders: () => (
      <td key="metaOrders" className="text-center" style={{ fontWeight: 'bold', color: campaign.metaOrders > 0 ? 'var(--txt)' : 'var(--muted2)' }}>{campaign.metaOrders > 0 ? campaign.metaOrders : '-'}</td>
    ),
    messages: () => (
      <td key="messages" className="text-right">
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
    ),
    costPerOrder: () => (
      <td key="costPerOrder" className="text-right" style={{ color: campaign.costPerOrder > CPO_WARNING_THRESHOLD ? 'var(--r)' : 'var(--txt)', fontWeight: campaign.costPerOrder > CPO_WARNING_THRESHOLD ? 'bold' : undefined }}>{campaign.costPerOrder > 0 ? formatVND(campaign.costPerOrder) : '-'}</td>
    ),
    spend: () => (
      <td key="spend" className="text-right mono-sm">{formatVND(campaign.spend)}</td>
    ),
    budget: () => (
      <td key="budget" className="text-right mono-sm">
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
    ),
    returnRate: () => (
      <td key="returnRate" className="text-right" style={{ color: campaign.returnStats?.denominator > 0 ? 'var(--b)' : 'var(--muted2)' }}>
        {campaign.returnStats?.denominator > 0 ? <><div style={{ fontWeight: 'bold' }}>{formatPercent(campaign.returnRate)}</div><div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{formatNumber((campaign.returnStats.returned || 0) + (campaign.returnStats.returning || 0))} / {formatNumber(campaign.returnStats.denominator)}</div></> : ''}
      </td>
    ),
    impressions: () => (
      <td key="impressions" className="text-right mono-sm">{formatNumber(campaign.impressions || 0)}</td>
    ),
    reach: () => (
      <td key="reach" className="text-right mono-sm" title={campaign.reachUnavailable ? 'Meta không có tiếp cận theo giờ' : undefined}>{campaign.reachUnavailable ? '-' : formatNumber(campaign.reach || 0)}</td>
    ),
    engagements: () => (
      <td key="engagements" className="text-right mono-sm">{formatNumber(campaign.engagements || 0)}</td>
    ),
    costPerClick: () => (
      <td key="costPerClick" className="text-right mono-sm">{campaign.costPerClick > 0 ? formatVND(campaign.costPerClick) : '-'}</td>
    ),
    costPerMille: () => (
      <td key="costPerMille" className="text-right mono-sm">{campaign.costPerMille > 0 ? formatVND(campaign.costPerMille) : '-'}</td>
    ),
    ctr: () => (
      <td key="ctr" className="text-right mono-sm">{campaign.ctr > 0 ? formatPercent(campaign.ctr) : '-'}</td>
    ),
    linkClicks: () => (
      <td key="linkClicks" className="text-right mono-sm">{formatNumber(campaign.linkClicks || 0)}</td>
    ),
    costPerLinkClick: () => (
      <td key="costPerLinkClick" className="text-right mono-sm">{campaign.costPerLinkClick > 0 ? formatVND(campaign.costPerLinkClick) : '-'}</td>
    ),
    frequency: () => (
      <td key="frequency" className="text-right mono-sm">{campaign.frequency > 0 ? campaign.frequency.toFixed(2).replace('.', ',') : '-'}</td>
    ),
    costPerReach: () => (
      <td key="costPerReach" className="text-right mono-sm">{campaign.costPerReach > 0 ? formatVND(campaign.costPerReach) : '-'}</td>
    ),
    bidAmount: () => (
      <td key="bidAmount" className="text-right mono-sm">{Number(campaign.bidAmount || 0) > 0 ? formatVND(campaign.bidAmount) : '-'}</td>
    )
  };

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
      {visibleColumnIds.map(id => {
        if (cells[id]) return cells[id]();
        const extraColumn = META_EXTRA_COLUMN_BY_ID.get(id);
        if (!extraColumn) return null;
        return <td key={id} className="text-right mono-sm">{formatMetaExtraValue(campaign[id], extraColumn.format)}</td>;
      })}
    </tr>
  );
});

export default function Dashboard() {
  const { provider, stats: globalStats, currentUser } = useAppContext();
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
  // Cot dang hien / phuong an dang chon: rieng tung may (localStorage theo user).
  // Danh sach phuong an: chung cho ca tai khoan, luu tren server tung phuong an mot.
  const userId = currentUser?.id ? String(currentUser.id) : '';
  const [columnView, setColumnView] = useState(() => readColumnView(userId));
  const [columnPresets, setColumnPresets] = useState(() => normalizeColumnPresets(
    userId ? readJsonStorage(`${COLUMN_PRESETS_CACHE_PREFIX}${userId}`) : null
  ));
  const { order: columnOrder, hidden: hiddenColumns } = columnView;
  // Phuong an dang chon bi nguoi khac xoa -> giu nguyen cot, chi bo nhan
  const activePreset = columnPresets.some(preset => preset.name === columnView.activePreset) ? columnView.activePreset : '';
  const [columnModalOpen, setColumnModalOpen] = useState(false);

  const commitColumnView = (next) => {
    setColumnView(next);
    if (userId) writeJsonStorage(`${COLUMN_VIEW_PREFIX}${userId}`, toColumnViewPayload(next));
  };
  const applyServerPresets = useCallback((presets) => {
    const next = normalizeColumnPresets(presets);
    setColumnPresets(next);
    if (userId) writeJsonStorage(`${COLUMN_PRESETS_CACHE_PREFIX}${userId}`, next);
  }, [userId]);
  const refreshColumnPresets = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await api('GET', '/dashboard-columns');
      applyServerPresets(result?.presets);
    } catch {
      // Khong goi duoc server -> dung ban tam
    }
  }, [userId, applyServerPresets]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // Luu lai cot dang hien theo khoa moi (lan dau tren may co the doc tu ban cu)
        writeJsonStorage(`${COLUMN_VIEW_PREFIX}${userId}`, toColumnViewPayload(readColumnView(userId)));
        const result = await api('GET', '/dashboard-columns');
        let presets = normalizeColumnPresets(result?.presets);
        const toMigrate = readPresetsToMigrate(userId).filter(preset => !presets.some(item => item.name === preset.name));
        for (const preset of toMigrate) {
          const saved = await api('PUT', '/dashboard-columns/presets', {
            name: preset.name,
            order: preset.order || [],
            hidden: preset.hidden || []
          });
          presets = normalizeColumnPresets(saved?.presets);
        }
        clearMigratedColumnSettings(userId);
        if (!cancelled) applyServerPresets(presets);
      } catch {
        // Khong goi duoc server -> dung ban tam, lan mo sau thu lai
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, applyServerPresets]);

  const availableColumns = useMemo(() => DASHBOARD_COLUMNS.filter(column => showOrders || !column.ordersOnly), [showOrders]);
  const orderedMenuColumns = useMemo(() => {
    const byId = new Map(availableColumns.map(column => [column.id, column]));
    return columnOrder.map(id => byId.get(id)).filter(Boolean);
  }, [availableColumns, columnOrder]);
  const visibleColumnIds = useMemo(
    () => orderedMenuColumns.filter(column => !hiddenColumns.has(column.id)).map(column => column.id),
    [orderedMenuColumns, hiddenColumns]
  );
  const applyColumnSettings = ({ order, hidden }) => {
    commitColumnView({ order, hidden: new Set(hidden), activePreset: '' });
    setColumnModalOpen(false);
  };
  // Luu (hoac ghi de neu trung ten) phuong an roi ap dung luon tren may nay
  const saveColumnPreset = async (name, { order, hidden }) => {
    const preset = { name, order, hidden: [...hidden] };
    commitColumnView({ order, hidden: new Set(hidden), activePreset: name });
    setColumnPresets(current => [...current.filter(item => item.name !== name), preset]);
    setColumnModalOpen(false);
    try {
      const result = await api('PUT', '/dashboard-columns/presets', preset);
      applyServerPresets(result?.presets);
    } catch (error) {
      toast.error(`Không lưu được phương án: ${error.message}`);
      refreshColumnPresets();
    }
  };
  const selectColumnPreset = (preset) => {
    commitColumnView({
      order: normalizeColumnOrder(preset.order),
      hidden: withUnseenColumnsHidden(preset.hidden || [], preset.order),
      activePreset: preset.name
    });
  };
  const deleteColumnPreset = async (name) => {
    setColumnPresets(current => current.filter(item => item.name !== name));
    if (columnView.activePreset === name) commitColumnView({ ...columnView, activePreset: '' });
    try {
      const result = await api('DELETE', `/dashboard-columns/presets/${encodeURIComponent(name)}`);
      applyServerPresets(result?.presets);
    } catch (error) {
      toast.error(`Không xóa được phương án: ${error.message}`);
      refreshColumnPresets();
    }
  };
  // On dinh tham chieu: modal dang ky Esc / khoa cuon theo onClose, Dashboard render lai moi ~10s
  const closeColumnModal = useCallback(() => setColumnModalOpen(false), []);
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
  const hourlyDataReady = Boolean(
    hourlyData && hourlyData.provider === provider &&
    hourlyData.fromDate === reportFromDate && hourlyData.toDate === reportToDate
  );

  // Chi tai du lieu theo gio (Meta Insights breakdown theo gio) khi dang chon khung gio; tai lai dinh ky de gio hien tai cap nhat
  useEffect(() => {
    if (!hourRangeActive) return undefined;
    let cancelled = false;
    setHourlyError('');
    const load = () => api('GET', `/campaigns/hourly-spend?provider=${provider}&fromDate=${reportFromDate}&toDate=${reportToDate}`, null, { timeoutMs: 5 * 60 * 1000 })
      .then(data => { if (!cancelled) { setHourlyData({ ...data, provider }); setHourlyError(''); } })
      .catch(error => { if (!cancelled) setHourlyError(error?.message || 'Khong tai duoc so lieu theo gio'); });
    load();
    const interval = setInterval(load, HOURLY_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
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
        // Meta khong co chi so phu theo gio
        metaExtra: null,
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

  // Chi tinh cot chi so phu dang hien (sap xep chi theo cot dang hien)
  const visibleExtraColumns = useMemo(
    () => visibleColumnIds.map(id => META_EXTRA_COLUMN_BY_ID.get(id)).filter(Boolean),
    [visibleColumnIds]
  );

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
      const extraValues = {};
      for (const column of visibleExtraColumns) extraValues[column.id] = column.value(campaign);
      return {
        ...campaign,
        ...extraValues,
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
  }, [filteredCampaigns, getOrderCountForCampaign, getReturnStatsForCampaign, showOrders, visibleExtraColumns]);

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
      const XLSX = await loadXlsx();
      // Chi xuat cac cot dang hien (theo phuong an / tuy chinh cot), dung thu tu tren bang.
      // Moi cot -> danh sach [tieu de, gia tri]; cot "Tat/Bat" khong co du lieu de xuat.
      const percent = (value) => Number(((value || 0) * 100).toFixed(2));
      const exportCells = {
        duplicateCount: c => [['Trùng', c.sameDayDuplicateCount || 1]],
        createdTime: c => [['Ngày tạo', formatDateTime(c.createdTime || c.created_time)]],
        account: c => [['Tên TKQC', c.accountId?.name || ''], ['ID TKQC', c.accountId?.adAccountId || '']],
        status: c => [['Trạng thái', isCampaignActiveStatus(c.status) ? 'ACTIVE' : 'PAUSE']],
        orderCount: c => [['Tổng đơn', c.orderCount || 0]],
        metaOrders: c => [['Đơn Meta', c.metaOrders || 0]],
        messages: c => (isShopee
          ? [['Lượt click', Number(c.clicks || 0)], ['Giá/click', Math.round(c.costPerClick || 0)]]
          : [['Tin nhắn', Number(c.messages || 0)], ['Giá/TN', Math.round(c.costPerMessage || 0)]]),
        costPerOrder: c => [['CPO', Math.round(c.costPerOrder || 0)]],
        spend: c => [['Chi tiêu', Math.round(Number(c.spend || 0))]],
        budget: c => [['Ngân sách', Number(c.dailyBudget || c.lifetimeBudget || 0)]],
        returnRate: c => [['Tỉ lệ hoàn (%)', percent(c.returnRate)]],
        impressions: c => [['Hiển thị', Number(c.impressions || 0)]],
        reach: c => [['Tiếp cận', c.reachUnavailable ? '' : Number(c.reach || 0)]],
        engagements: c => [['Tương tác', Number(c.engagements || 0)]],
        costPerClick: c => [['CPC', Math.round(c.costPerClick || 0)]],
        costPerMille: c => [['CPM', Math.round(c.costPerMille || 0)]],
        ctr: c => [['CTR (%)', percent(c.ctr)]],
        linkClicks: c => [['Click liên kết', c.linkClicks || 0]],
        costPerLinkClick: c => [['CPC liên kết', Math.round(c.costPerLinkClick || 0)]],
        frequency: c => [['Tần suất', Number((c.frequency || 0).toFixed(2))]],
        costPerReach: c => [['CPP', Math.round(c.costPerReach || 0)]],
        bidAmount: c => [['Giá bid', Number(c.bidAmount || 0)]]
      };
      const getExportCells = (id, campaign) => {
        if (exportCells[id]) return exportCells[id](campaign);
        const extraColumn = META_EXTRA_COLUMN_BY_ID.get(id);
        if (!extraColumn) return [];
        const value = campaign[id];
        const label = extraColumn.format === 'percent' ? `${extraColumn.label} (%)` : extraColumn.label;
        if (value === null || value === undefined) return [[label, '']];
        return [[label, extraColumn.format === 'percent' ? percent(value) : Math.round(value)]];
      };
      const rows = processedCampaigns.map(campaign => {
        const row = {
          'Tên Campaign': toText(campaign.name),
          'ID Campaign': campaign.campaignId || ''
        };
        for (const id of visibleColumnIds) {
          for (const [label, value] of getExportCells(id, campaign)) row[label] = value;
        }
        return row;
      });
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = Object.keys(rows[0]).map(key => ({ wch: key === 'Tên Campaign' ? 40 : Math.max(12, key.length + 2) }));
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

  // Header theo id cot; sortField co thi bam vao de sap xep
  const COLUMN_HEADERS = {
    duplicateCount: { label: 'Trung', className: 'text-center', sortField: 'duplicateCount' },
    createdTime: { label: 'Ngay tao' },
    toggle: { label: 'Tắt/Bật', className: 'text-center' },
    account: { label: 'Ten TKQC' },
    status: { label: 'Trạng Thái', className: 'text-center' },
    orderCount: { label: 'Tổng Đơn', className: 'text-center', sortField: 'orderCount' },
    metaOrders: { label: 'Đơn Meta', className: 'text-center', sortField: 'metaOrders' },
    messages: { label: isShopee ? 'Luot click (Gia/click)' : 'Giá/TN', className: 'text-right', sortField: 'messages', title: isShopee ? undefined : 'Chi phí / lượt bắt đầu trò chuyện' },
    costPerOrder: { label: 'CPO', className: 'text-right', sortField: 'costPerOrder' },
    spend: { label: 'Chi Tiêu', className: 'text-right', sortField: 'spend' },
    budget: { label: 'Ngân Sách', className: 'text-right' },
    returnRate: { label: 'Tỉ lệ Hoàn', className: 'text-right', sortField: 'returnRate' },
    impressions: { label: 'Hiển thị', className: 'text-right', sortField: 'impressions' },
    reach: { label: 'Tiếp cận', className: 'text-right', sortField: 'reach' },
    engagements: { label: 'Tương tác', className: 'text-right', sortField: 'engagements' },
    costPerClick: { label: 'CPC', className: 'text-right', sortField: 'costPerClick' },
    costPerMille: { label: 'CPM', className: 'text-right', sortField: 'costPerMille' },
    ctr: { label: 'CTR', className: 'text-right', sortField: 'ctr' },
    linkClicks: { label: 'Click liên kết', className: 'text-right', sortField: 'linkClicks' },
    costPerLinkClick: { label: 'CPC liên kết', className: 'text-right', sortField: 'costPerLinkClick' },
    frequency: { label: 'Tần suất', className: 'text-right', sortField: 'frequency' },
    costPerReach: { label: 'CPP', className: 'text-right', sortField: 'costPerReach' },
    bidAmount: { label: 'Giá bid', className: 'text-right', sortField: 'bidAmount' },
    ...Object.fromEntries(META_EXTRA_COLUMNS.map(column => [column.id, { label: column.label, className: 'text-right', sortField: column.id }]))
  };
  const renderColumnHeader = (id) => {
    const header = COLUMN_HEADERS[id];
    if (!header) return null;
    if (!header.sortField) return <th key={id} className={header.className}>{header.label}</th>;
    return (
      <th key={id} className={header.className} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort(header.sortField)} title={header.title}>
        {header.label}<SortIcon field={header.sortField} sortField={sortField} sortDir={sortDir} />
      </th>
    );
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
            <div className="stat-sub">Từ Pancake POS</div>
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
            <ColumnPresetMenu
              label={activePreset ? `Cột: ${activePreset}` : 'Tùy chỉnh'}
              presets={columnPresets}
              activePreset={activePreset}
              onSelect={selectColumnPreset}
              onDelete={deleteColumnPreset}
              onCustomize={() => setColumnModalOpen(true)}
              onOpen={refreshColumnPresets}
            />
            {columnModalOpen && (
              <ColumnSettingsModal
                columns={availableColumns}
                groups={DASHBOARD_COLUMN_GROUPS}
                order={columnOrder}
                hidden={hiddenColumns}
                defaultOrder={DEFAULT_COLUMN_ORDER}
                defaultHidden={DEFAULT_HIDDEN_COLUMN_IDS}
                pinnedLabel="Tên Campaign"
                presetName={activePreset}
                onApply={applyColumnSettings}
                onSavePreset={saveColumnPreset}
                onClose={closeColumnModal}
              />
            )}
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
                  {visibleColumnIds.map(renderColumnHeader)}
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
                      onStartRename={startRenameCampaign}
                      onSaveRename={saveRenameCampaign}
                      onCancelRename={cancelRenameCampaign}
                      onToggleStatus={toggleCampaignStatus}
                      onStartEditBudget={startEditBudget}
                      onSaveBudget={saveBudget}
                      onCancelEditBudget={cancelEditBudget}
                      setEditingCampaignName={setEditingCampaignName}
                      setEditingBudget={setEditingBudget}
                      visibleColumnIds={visibleColumnIds}
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
