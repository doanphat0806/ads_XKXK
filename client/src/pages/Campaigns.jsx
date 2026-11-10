import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api, uploadForm, formatVND, formatNumber, todayString, dateTimeString } from '../lib/api';
import { toast } from 'react-toastify';
import DateRangePicker from '../components/DateRangePicker';
import ColumnSettingsModal from '../components/ColumnSettingsModal';
import ColumnPresetMenu from '../components/ColumnPresetMenu';
import AdsManagerChildren from './AdsManagerChildren';
import { loadXlsx } from '../utils/loadXlsx';
import { META_EXTRA_COLUMNS, META_EXTRA_COLUMN_BY_ID } from '../utils/metaExtraColumns';
import {
  Megaphone,
  Users,
  PenSquare,
  Layers,
  Search,
  RefreshCw,
  Download,
  FolderSync,
  Upload,
  FileSpreadsheet,
  Flag,
  Plus,
  Eye,
  Timer,
  Pencil,
  Trash2
} from 'lucide-react';

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

const CAMPAIGNS_PER_PAGE = 500;
const CAMPAIGN_TOGGLE_RELOAD_DELAY_MS = 2 * 60 * 1000;

function offsetDateString(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function yesterdayString() {
  return offsetDateString(todayString(), -1);
}

function formatMoneyWithCurrency(value, currency) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  if (!currency || currency === 'VND') return formatVND(Number(value));
  return `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${currency}`;
}

// 2 o: tong chi tieu tron doi TK, so du chua thanh toan (lay tu Facebook)
function AccountBillingCells({ item }) {
  const { currency, amountSpent, balance, spendCap, error } = item || {};
  const failed = error && amountSpent === undefined;
  return (
    <>
      <td className="text-right" style={{ fontWeight: 600 }} title={error ? `Lỗi: ${error}` : (spendCap ? `Giới hạn chi tiêu TK: ${formatMoneyWithCurrency(spendCap, currency)}` : '')}>
        {failed ? <span style={{ color: 'var(--r)' }}>Lỗi</span> : formatMoneyWithCurrency(amountSpent, currency)}
      </td>
      <td className="text-right" style={{ fontWeight: 600 }} title={error ? `Lỗi: ${error}` : ''}>
        {failed ? <span style={{ color: 'var(--r)' }}>Lỗi</span> : formatMoneyWithCurrency(balance, currency)}
      </td>
    </>
  );
}

// Thanh % dong bo lich su cua 1 TK (dong bo tay / tu dong khi them TK moi)
function AccountSyncBar({ item }) {
  if (!item) return null;
  const percent = Math.max(0, Math.min(100, Number(item.percent) || 0));
  const isQueued = item.state === 'queued';
  const isDone = item.state === 'completed' || item.state === 'completed_with_errors';
  const hasErrors = Number(item.errorCount) > 0;
  const label = isQueued
    ? 'Đang chờ đồng bộ'
    : isDone
      ? (hasErrors ? `Xong, ${item.errorCount} lỗi` : 'Đồng bộ xong')
      : `Đang đồng bộ ${item.currentDay ? `(${String(item.currentDay).replace('..', ' → ')})` : ''}`;
  const color = hasErrors ? 'var(--r, #dc2626)' : isDone ? 'var(--g, #16a34a)' : '#0d6e52';
  const title = [
    item.source === 'new-account' ? 'Tự đồng bộ khi thêm tài khoản' : 'Đồng bộ tay',
    item.fromDate && item.toDate ? `${item.fromDate} → ${item.toDate}` : '',
    `${item.completedDays || 0}/${item.totalDays || 0} ngày`,
    item.lastError ? `Lỗi gần nhất: ${item.lastError}` : ''
  ].filter(Boolean).join('\n');

  return (
    <div className="account-sync-bar" title={title}>
      <div className="account-sync-bar-head">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="account-sync-bar-track">
        <div
          className={`account-sync-bar-fill ${!isDone && !isQueued ? 'running' : ''}`}
          style={{ width: `${isQueued ? 0 : percent}%`, background: color }}
        />
      </div>
    </div>
  );
}

function getCampaignAccount(campaign, accounts = []) {
  const account = campaign?.accountId;
  if (account && typeof account === 'object') return account;
  const accountId = String(account || '').trim();
  return accounts.find(item => String(item._id || '') === accountId) || null;
}

function getCampaignAccountId(campaign) {
  return String(campaign?.accountId?._id || campaign?.accountId || '').trim();
}

function getCampaignSelectionKey(campaign) {
  const accountId = getCampaignAccountId(campaign);
  const campaignId = String(campaign?.campaignId || '').trim();
  return accountId && campaignId ? `${accountId}:${campaignId}` : '';
}

const getCampaignSkuCandidates = (campaignName) => {
  const rawName = String(campaignName || '').toUpperCase().trim();
  const compactName = rawName.replace(/\s+/g, '');
  const firstNineChars = rawName.slice(0, 9).replace(/\s+/g, '');
  const firstToken = rawName.split(/\s+/)[0]?.replace(/\s+/g, '') || '';

  return [...new Set([firstNineChars, firstToken, compactName].filter(Boolean))]
    .map(code => `MS${code}`);
};

const formatPercent = (value) => `${(Number(value || 0) * 100).toFixed(2).replace('.', ',')}%`;
const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeString(date);
};
const formatMetaExtraValue = (value, format) => {
  if (value === null || value === undefined) return '-';
  if (format === 'vnd') return value > 0 ? formatVND(value) : '-';
  if (format === 'percent') return value > 0 ? formatPercent(value) : '-';
  return formatNumber(Math.round(value));
};
const vndOrDash = (value) => (value > 0 ? formatVND(value) : '-');

// Cot tuy chinh cua tab Chien dich (giong Dashboard). Cot "Chien dich" (ten + bat/tat) luon co dinh.
// sortField: sap xep theo so (tru delivery/account co xu ly rieng); ordersOnly: an voi Shopee.
const CAMPAIGN_COLUMNS = [
  { id: 'account', label: 'Tài khoản quảng cáo', group: 'settings', sortField: 'account', style: { minWidth: '150px' } },
  { id: 'status', label: 'Trạng thái', group: 'settings', className: 'text-center', style: { width: '90px' } },
  { id: 'delivery', label: 'Phân phối', group: 'settings', sortField: 'delivery', style: { width: '130px' } },
  { id: 'budget', label: 'Ngân sách', group: 'settings', className: 'text-right', sortField: 'budget', style: { width: '120px' } },
  { id: 'objective', label: 'Mục tiêu', group: 'settings', style: { width: '120px' } },
  { id: 'metaOrders', label: 'Số lượt mua hàng', group: 'conversion', className: 'text-center', sortField: 'metaOrders', style: { width: '110px' } },
  { id: 'orderCount', label: 'Đơn đặt hàng đã tạo', group: 'conversion', className: 'text-center', sortField: 'orderCount', ordersOnly: true, style: { width: '130px' } },
  { id: 'messages', label: 'Lượt bắt đầu cuộc trò chuyện qua tin nhắn', group: 'engagement', className: 'text-right', sortField: 'messages', style: { width: '150px' } },
  { id: 'costPerMessage', label: 'Chi phí trên mỗi lượt bắt đầu cuộc trò chuyện', group: 'engagement', className: 'text-right', sortField: 'costPerMessage', style: { width: '150px' } },
  { id: 'spend', label: 'Số tiền đã chi tiêu', group: 'performance', className: 'text-right', sortField: 'spend', style: { width: '130px' } },
  { id: 'createdTime', label: 'Ngày tạo', group: 'settings', sortField: 'createdTimeMs', defaultHidden: true },
  { id: 'bidAmount', label: 'Giá bid', group: 'settings', className: 'text-right', sortField: 'bidAmount', defaultHidden: true },
  { id: 'costPerOrder', label: 'CPO', group: 'conversion', className: 'text-right', sortField: 'costPerOrder', ordersOnly: true, defaultHidden: true },
  { id: 'impressions', label: 'Hiển thị', group: 'performance', className: 'text-right', sortField: 'impressions', defaultHidden: true },
  { id: 'reach', label: 'Tiếp cận', group: 'performance', className: 'text-right', sortField: 'reach', defaultHidden: true },
  { id: 'costPerMille', label: 'CPM', group: 'performance', className: 'text-right', sortField: 'costPerMille', defaultHidden: true },
  { id: 'frequency', label: 'Tần suất', group: 'performance', className: 'text-right', sortField: 'frequency', defaultHidden: true },
  { id: 'costPerReach', label: 'CPP (1.000 tiếp cận)', group: 'performance', className: 'text-right', sortField: 'costPerReach', defaultHidden: true },
  { id: 'engagements', label: 'Tương tác', group: 'engagement', className: 'text-right', sortField: 'engagements', defaultHidden: true },
  { id: 'costPerClick', label: 'CPC', group: 'engagement', className: 'text-right', sortField: 'costPerClick', defaultHidden: true },
  { id: 'ctr', label: 'CTR', group: 'engagement', className: 'text-right', sortField: 'ctr', defaultHidden: true },
  { id: 'linkClicks', label: 'Click liên kết', group: 'engagement', className: 'text-right', sortField: 'linkClicks', defaultHidden: true },
  { id: 'costPerLinkClick', label: 'CPC liên kết', group: 'engagement', className: 'text-right', sortField: 'costPerLinkClick', defaultHidden: true },
  ...META_EXTRA_COLUMNS.map(({ id, label, group }) => ({ id, label, group, className: 'text-right', sortField: id, defaultHidden: true }))
];
const CAMPAIGN_COLUMN_BY_ID = new Map(CAMPAIGN_COLUMNS.map(column => [column.id, column]));
const CAMPAIGN_COLUMN_GROUPS = [
  { id: 'settings', label: 'Cài đặt' },
  { id: 'conversion', label: 'Chuyển đổi' },
  { id: 'performance', label: 'Hiệu quả' },
  { id: 'engagement', label: 'Tương tác' }
];
const DEFAULT_CAMPAIGN_COLUMN_ORDER = CAMPAIGN_COLUMNS.map(column => column.id);
const DEFAULT_HIDDEN_CAMPAIGN_COLUMN_IDS = CAMPAIGN_COLUMNS.filter(column => column.defaultHidden).map(column => column.id);
// Sap xep chuoi thay vi so
const TEXT_SORT_FIELDS = new Set(['name', 'account']);

// Cot dang hien + phuong an: luu localStorage theo tung user (rieng voi Dashboard)
const CAMPAIGN_COLUMN_VIEW_PREFIX = 'campaigns:columnsView:';
const SHOW_ALL_CAMPAIGNS_KEY = 'campaigns:showAll';
const CAMPAIGN_COLUMN_PRESETS_PREFIX = 'campaigns:columnPresets:';

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

// Bo id khong con ton tai; cot moi them sau nay noi vao cuoi
const normalizeCampaignColumnOrder = (saved) => {
  const known = Array.isArray(saved) ? saved.filter(id => CAMPAIGN_COLUMN_BY_ID.has(id)) : [];
  return [...new Set([...known, ...DEFAULT_CAMPAIGN_COLUMN_ORDER])];
};

// Cot mac dinh an ma ban luu chua tung biet den -> van an
const normalizeCampaignColumnView = (raw) => {
  const view = raw && typeof raw === 'object' ? raw : {};
  const savedOrder = Array.isArray(view.order) ? view.order : [];
  const known = new Set(savedOrder);
  const hidden = Array.isArray(view.hidden) ? view.hidden : [];
  return {
    order: normalizeCampaignColumnOrder(savedOrder),
    hidden: new Set([...hidden, ...DEFAULT_HIDDEN_CAMPAIGN_COLUMN_IDS.filter(id => !known.has(id))]),
    activePreset: typeof view.activePreset === 'string' ? view.activePreset : ''
  };
};

const normalizeCampaignColumnPresets = (value) => (Array.isArray(value)
  ? value.filter(preset => preset && typeof preset.name === 'string' && preset.name.trim())
  : []);

export default function Campaigns() {
  const { provider, allAccounts, currentUser, loadAccounts, openModal } = useAppContext();
  
  // Tab state: 'campaigns' (default) | 'accounts' | 'adsets' | 'ads' | 'posts'
  // ?tab=accounts (vd link /accounts cu chuyen sang day) -> mo san tab Tai khoan quang cao
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const tab = new URLSearchParams(window.location.search).get('tab');
      return ['accounts', 'campaigns', 'adsets', 'ads', 'posts'].includes(tab) ? tab : 'campaigns';
    } catch {
      return 'campaigns';
    }
  });

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterAcc, setFilterAcc] = useState('');
  const [filterFromDate, setFilterFromDate] = useState(todayString());
  const [filterToDate, setFilterToDate] = useState(todayString());
  const [filterStatus, setFilterStatus] = useState('');
  // Bat: hien moi camp (ngay chi dung de tinh chi tieu / chi so); tat: chi camp co du lieu trong ngay
  const [showAllCampaigns, setShowAllCampaigns] = useState(() => {
    try {
      return localStorage.getItem(SHOW_ALL_CAMPAIGNS_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCampaignKeys, setSelectedCampaignKeys] = useState(() => new Set());
  const [bulkToggling, setBulkToggling] = useState('');
  // Tang len khi bam tai lai -> tab nhom QC / quang cao / bai viet lay lai tu Facebook
  const [childrenReloadToken, setChildrenReloadToken] = useState(0);

  // Accounts selection in accounts tab
  const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());

  // Sort
  const [sortField, setSortField] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');

  // Pancake POS orders by SKU
  const [skuCounts, setSkuCounts] = useState({});

  // Inline budget editing
  const [editingBudgetId, setEditingBudgetId] = useState(null);
  const [editingBudgetValue, setEditingBudgetValue] = useState('');
  const [savingBudgetId, setSavingBudgetId] = useState(null);

  // Sync tools toggle
  const [showSyncTools, setShowSyncTools] = useState(false);
  const [syncFromDate, setSyncFromDate] = useState(yesterdayString());
  const [syncToDate, setSyncToDate] = useState(yesterdayString());
  const [syncing, setSyncing] = useState(false);
  // Tien do dong bo lich su theo tung TK: { [accountId]: { state, percent, completedDays, totalDays, currentDay, ... } }
  const [accountSyncProgress, setAccountSyncProgress] = useState({});
  const [exporting, setExporting] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [lastToggleLog, setLastToggleLog] = useState('');
  const toggleReloadTimerRef = useRef(null);

  // Doi ten camp truc tiep tren bang (giong Dashboard)
  const [editingNameKey, setEditingNameKey] = useState('');
  const [editingNameValue, setEditingNameValue] = useState('');
  const [renamingKey, setRenamingKey] = useState('');
  const renamingKeyRef = useRef('');

  // Tuy chinh cot hien thi
  const userId = currentUser?.id ? String(currentUser.id) : '';
  const [columnView, setColumnView] = useState(() => normalizeCampaignColumnView(
    userId ? readJsonStorage(`${CAMPAIGN_COLUMN_VIEW_PREFIX}${userId}`) : null
  ));
  const [columnPresets, setColumnPresets] = useState(() => normalizeCampaignColumnPresets(
    userId ? readJsonStorage(`${CAMPAIGN_COLUMN_PRESETS_PREFIX}${userId}`) : null
  ));
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const activePreset = columnPresets.some(preset => preset.name === columnView.activePreset) ? columnView.activePreset : '';

  useEffect(() => {
    // Doi user dang nhap -> doc lai cau hinh cot cua user do
    setColumnView(normalizeCampaignColumnView(userId ? readJsonStorage(`${CAMPAIGN_COLUMN_VIEW_PREFIX}${userId}`) : null));
    setColumnPresets(normalizeCampaignColumnPresets(userId ? readJsonStorage(`${CAMPAIGN_COLUMN_PRESETS_PREFIX}${userId}`) : null));
  }, [userId]);

  const commitColumnView = (next) => {
    setColumnView(next);
    if (userId) writeJsonStorage(`${CAMPAIGN_COLUMN_VIEW_PREFIX}${userId}`, { order: next.order, hidden: [...next.hidden], activePreset: next.activePreset });
  };
  const commitColumnPresets = (next) => {
    setColumnPresets(next);
    if (userId) writeJsonStorage(`${CAMPAIGN_COLUMN_PRESETS_PREFIX}${userId}`, next);
  };
  const applyColumnSettings = ({ order, hidden }) => {
    commitColumnView({ order, hidden: new Set(hidden), activePreset: '' });
    setColumnModalOpen(false);
  };
  const saveColumnPreset = (name, { order, hidden }) => {
    commitColumnPresets([...columnPresets.filter(item => item.name !== name), { name, order, hidden: [...hidden] }]);
    commitColumnView({ order, hidden: new Set(hidden), activePreset: name });
    setColumnModalOpen(false);
    toast.success(`Đã lưu phương án "${name}"`);
  };
  const selectColumnPreset = (preset) => {
    commitColumnView({ ...normalizeCampaignColumnView(preset), activePreset: preset.name });
  };
  const deleteColumnPreset = (name) => {
    commitColumnPresets(columnPresets.filter(item => item.name !== name));
    if (columnView.activePreset === name) commitColumnView({ ...columnView, activePreset: '' });
  };
  const closeColumnModal = useCallback(() => setColumnModalOpen(false), []);

  const showOrders = provider !== 'shopee';
  const availableColumns = useMemo(
    () => CAMPAIGN_COLUMNS.filter(column => showOrders || !column.ordersOnly),
    [showOrders]
  );
  const visibleColumns = useMemo(() => {
    const available = new Set(availableColumns.map(column => column.id));
    return columnView.order
      .filter(id => available.has(id) && !columnView.hidden.has(id))
      .map(id => CAMPAIGN_COLUMN_BY_ID.get(id));
  }, [availableColumns, columnView]);
  const visibleExtraColumns = useMemo(
    () => visibleColumns.map(column => META_EXTRA_COLUMN_BY_ID.get(column.id)).filter(Boolean),
    [visibleColumns]
  );

  // Load campaigns
  const loadCampaigns = useCallback(async (showLoader = true) => {
    if (showLoader || campaigns.length === 0) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        fromDate: filterFromDate,
        toDate: filterToDate,
        provider,
        includeScheduledNoSpend: 'true',
        includeLiveCreated: 'true',
        allCampaigns: showAllCampaigns ? 'true' : 'false'
      });
      const url = filterAcc
        ? `/accounts/${filterAcc}/campaigns?${params.toString()}`
        : `/campaigns/today?${params.toString()}`;
      const data = await api('GET', url, null, { timeoutMs: 5 * 60 * 1000 });
      setCampaigns(data || []);
      setLastToggleLog('');
    } catch (error) {
      toast.error('Lỗi tải chiến dịch: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [filterAcc, filterFromDate, filterToDate, provider, showAllCampaigns, campaigns.length]);

  const reloadCampaignsNow = useCallback((showLoader = true) => {
    if (toggleReloadTimerRef.current) {
      window.clearTimeout(toggleReloadTimerRef.current);
      toggleReloadTimerRef.current = null;
    }
    loadCampaigns(showLoader);
  }, [loadCampaigns]);

  const scheduleToggleReload = useCallback(() => {
    if (toggleReloadTimerRef.current) {
      window.clearTimeout(toggleReloadTimerRef.current);
    }
    toggleReloadTimerRef.current = window.setTimeout(() => {
      toggleReloadTimerRef.current = null;
      loadCampaigns(true);
    }, CAMPAIGN_TOGGLE_RELOAD_DELAY_MS);
  }, [loadCampaigns]);

  // Load Pancake POS SKU order counts
  useEffect(() => {
    if (provider === 'shopee') return undefined;
    let cancelled = false;
    api('GET', `/orders/sku-counts?fromDate=${filterFromDate}&toDate=${filterToDate}`)
      .then(res => {
        if (!cancelled && res?.counts) setSkuCounts(res.counts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filterFromDate, filterToDate, provider]);

  const getOrderCountForCampaign = useCallback((campaignName) => {
    if (!campaignName || !skuCounts) return 0;
    for (const skuKey of getCampaignSkuCandidates(campaignName)) {
      const count = Number(skuCounts[skuKey] || 0);
      if (count > 0) return count;
    }
    return 0;
  }, [skuCounts]);

  useEffect(() => {
    setFilterAcc('');
  }, [provider]);

  useEffect(() => {
    loadCampaigns(false);
  }, [loadCampaigns]);

  useEffect(() => {
    return () => {
      if (toggleReloadTimerRef.current) window.clearTimeout(toggleReloadTimerRef.current);
    };
  }, []);

  // Toggle single campaign status
  const toggleCampaignStatus = async (campaignId, accountId, currentStatus) => {
    const nextStatus = isCampaignActiveStatus(currentStatus) ? 'PAUSED' : 'ACTIVE';
    try {
      setCampaigns(items => items.map(item => (
        item.campaignId === campaignId && getCampaignAccountId(item) === String(accountId || '').trim()
          ? { ...item, status: nextStatus }
          : item
      )));
      const result = await api('POST', `/campaigns/${campaignId}/toggle`, {
        accountId,
        currentStatus,
        targetStatus: nextStatus,
        fromDate: filterFromDate,
        toDate: filterToDate
      });
      if (result?.logMessage) setLastToggleLog(result.logMessage);
      toast.success(isCampaignActiveStatus(currentStatus) ? 'Đã tạm dừng' : 'Đã bật');
      scheduleToggleReload();
    } catch (error) {
      setCampaigns(items => items.map(item => (
        item.campaignId === campaignId && getCampaignAccountId(item) === String(accountId || '').trim()
          ? { ...item, status: currentStatus }
          : item
      )));
      toast.error('Lỗi: ' + error.message);
    }
  };

  // Inline budget editing
  const startEditBudget = (campaign) => {
    setEditingBudgetId(campaign.campaignId);
    setEditingBudgetValue(String(campaign.budget || 0));
  };

  const cancelEditBudget = () => {
    setEditingBudgetId(null);
    setEditingBudgetValue('');
  };

  const saveBudget = async (campaign) => {
    const nextValue = Number(editingBudgetValue);
    if (!nextValue || nextValue < 1000) {
      toast.error('Ngân sách tối thiểu là 1.000 ₫');
      return;
    }
    if (nextValue === campaign.budget) {
      cancelEditBudget();
      return;
    }
    const campaignId = campaign.campaignId;
    const accountId = getCampaignAccountId(campaign);
    setSavingBudgetId(campaignId);

    try {
      const payload = {
        accountId,
        budgetType: campaign.budgetType || 'DAILY',
        budget: nextValue,
        fromDate: filterFromDate,
        toDate: filterToDate
      };
      await api('POST', `/campaigns/${campaignId}/budget`, payload);
      setCampaigns(items => items.map(item => {
        if (item.campaignId === campaignId && getCampaignAccountId(item) === accountId) {
          return {
            ...item,
            dailyBudget: campaign.budgetType === 'LIFETIME' ? item.dailyBudget : nextValue,
            lifetimeBudget: campaign.budgetType === 'LIFETIME' ? nextValue : item.lifetimeBudget,
            budget: nextValue
          };
        }
        return item;
      }));
      toast.success('Đã cập nhật ngân sách');
      cancelEditBudget();
    } catch (error) {
      toast.error('Lỗi sửa ngân sách: ' + error.message);
    } finally {
      setSavingBudgetId(null);
    }
  };

  // Doi ten camp
  const startRenameCampaign = (campaign) => {
    if (renamingKeyRef.current) return;
    setEditingNameKey(getCampaignSelectionKey(campaign));
    setEditingNameValue(String(campaign.name || '').toUpperCase());
  };

  const cancelRenameCampaign = () => {
    setEditingNameKey('');
    setEditingNameValue('');
  };

  const saveRenameCampaign = async (campaign) => {
    const key = getCampaignSelectionKey(campaign);
    const accountId = getCampaignAccountId(campaign);
    const nextName = editingNameValue.trim().toUpperCase();
    // Enter roi blur se goi 2 lan -> chan lan sau
    if (!key || !accountId || renamingKeyRef.current) return;
    if (!nextName) {
      toast.error('Tên camp không được để trống');
      return;
    }
    if (nextName === String(campaign.name || '').trim()) {
      cancelRenameCampaign();
      return;
    }

    renamingKeyRef.current = key;
    setRenamingKey(key);
    try {
      await api('POST', `/campaigns/${campaign.campaignId}/rename`, { accountId, date: filterToDate, name: nextName });
      setCampaigns(items => items.map(item => (
        getCampaignSelectionKey(item) === key ? { ...item, name: nextName } : item
      )));
      toast.success('Đã đổi tên camp');
      cancelRenameCampaign();
    } catch (error) {
      toast.error('Lỗi đổi tên camp: ' + error.message);
    } finally {
      renamingKeyRef.current = '';
      setRenamingKey('');
    }
  };

  // Dong bo ngay da chot: chon TK thi dong bo cac TK do, khong chon thi tat ca. Chay ngam tren server,
  // tien do tung TK hien o thanh % trong bang "Tai khoan quang cao".
  const handleSyncHistoryQueued = async () => {
    if (syncToDate >= todayString()) {
      toast.error('Chỉ được chọn các ngày trước hôm nay');
      return;
    }
    const accountIds = Array.from(selectedAccountIds);
    setSyncing(true);
    try {
      const result = await api('POST', '/campaigns/sync-history', {
        fromDate: syncFromDate,
        toDate: syncToDate,
        provider,
        ...(accountIds.length ? { accountIds } : {}),
        queue: true,
        background: true
      });
      toast.info(`Bắt đầu đồng bộ ${result?.totalAccounts || accountIds.length || ''} tài khoản trong nền`.replace('  ', ' '));
      await refreshAccountSyncProgress();
    } catch (e) {
      toast.error('Lỗi đồng bộ: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Doc tien do dong bo tung TK (ca dong bo tay lan tu dong khi them TK moi)
  const prevSyncStatesRef = useRef({});
  const refreshAccountSyncProgress = useCallback(async () => {
    try {
      const result = await api('GET', `/account-sync/progress?provider=${encodeURIComponent(provider || '')}`);
      const next = result?.progress || {};
      // TK vua chay xong -> tai lai so lieu tai khoan
      const prev = prevSyncStatesRef.current;
      const justFinished = Object.entries(next).some(([id, item]) =>
        ['completed', 'completed_with_errors'].includes(item.state) && ['active', 'queued'].includes(prev[id]));
      prevSyncStatesRef.current = Object.fromEntries(Object.entries(next).map(([id, item]) => [id, item.state]));
      setAccountSyncProgress(next);
      if (justFinished && loadAccounts) loadAccounts();
    } catch {
      // bo qua loi poll, lan sau thu lai
    }
  }, [provider, loadAccounts]);

  // Nguong thanh toan / tong chi tieu / so du cua tung TK (lay tu Facebook, server cache 5 phut)
  const [accountBilling, setAccountBilling] = useState({});
  const [billingLoading, setBillingLoading] = useState(false);
  const loadAccountBilling = useCallback(async (refresh = false) => {
    setBillingLoading(true);
    try {
      const result = await api('GET', `/ads-manager/account-billing?provider=${encodeURIComponent(provider || '')}${refresh ? '&refresh=1' : ''}`);
      setAccountBilling(result?.billing || {});
    } catch (e) {
      toast.error('Lỗi tải ngưỡng / số dư: ' + e.message);
    } finally {
      setBillingLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (activeTab !== 'accounts') return undefined;
    loadAccountBilling(false);
    const timer = setInterval(() => loadAccountBilling(false), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [activeTab, loadAccountBilling]);

  const hasRunningAccountSync = useMemo(
    () => Object.values(accountSyncProgress).some(item => item.state === 'active' || item.state === 'queued'),
    [accountSyncProgress]
  );

  useEffect(() => {
    if (activeTab !== 'accounts') return undefined;
    refreshAccountSyncProgress();
    // Dang co TK dong bo: 3s/lan; khong co: 15s/lan (de bat duoc TK moi them tu dong bo)
    const timer = setInterval(refreshAccountSyncProgress, hasRunningAccountSync ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [activeTab, hasRunningAccountSync, refreshAccountSyncProgress]);

  // Export spending CSV
  const handleExportSpending = async () => {
    setExporting(true);
    try {
      const url = `/campaigns/export-spending?fromDate=${filterFromDate}&toDate=${filterToDate}&provider=${provider}${filterAcc ? `&accountId=${filterAcc}` : ''}`;
      const blob = await api('GET', url, null, { asBlob: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `spending_${filterFromDate}_${filterToDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast.success('Đã tải báo cáo CSV');
    } catch (e) {
      toast.error('Lỗi tải báo cáo: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  // Import CSV
  const handleImportCampaignCsv = async (file) => {
    if (!file) return;
    setImportingCsv(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', provider);
      if (filterAcc) formData.append('accountId', filterAcc);

      const result = await uploadForm('/campaigns/import-csv', formData, { timeoutMs: 10 * 60 * 1000 });
      const skippedText = result.skipped ? `, bỏ qua ${formatNumber(result.skipped)} dòng` : '';
      const sourceText = result.sourceRows ? ` từ ${formatNumber(result.sourceRows)} dòng CSV` : ' dòng CSV';
      toast.success(`Đã import ${formatNumber(result.imported)} camp-ngày${sourceText}${skippedText}`);
      if (result.errors?.length) {
        toast.warn(`Có ${formatNumber(result.errors.length)} dòng lỗi khi map dữ liệu`);
      }
      await loadCampaigns(true);
    } catch (error) {
      toast.error('Lỗi import CSV: ' + error.message);
    } finally {
      setImportingCsv(false);
    }
  };

  // Enriched campaigns with POS orders and cost per message
  const enrichedCampaigns = useMemo(() => {
    return campaigns.map(campaign => {
      const account = getCampaignAccount(campaign, allAccounts);
      const spend = Number(campaign.spend || 0);
      const messages = Number(campaign.messages || 0);
      const orderCount = provider === 'shopee' ? 0 : getOrderCountForCampaign(campaign.name);
      const metaOrders = Number(campaign.metaOrders || 0);
      const costPerMessage = messages > 0 ? spend / messages : 0;
      const budget = campaign.budgetType === 'LIFETIME' ? Number(campaign.lifetimeBudget || 0) : Number(campaign.dailyBudget || 0);
      const clicks = Number(campaign.clicks || 0);
      const impressions = Number(campaign.impressions || 0);
      const reach = Number(campaign.reach || 0);
      const linkClicks = Number(campaign.linkClicks || 0);
      const createdTimeValue = campaign.createdTime || campaign.created_time;
      const createdTimeMs = createdTimeValue ? new Date(createdTimeValue).getTime() || 0 : 0;
      const extraValues = {};
      for (const column of visibleExtraColumns) extraValues[column.id] = column.value(campaign);
      return {
        ...campaign,
        ...extraValues,
        account,
        accountName: account?.name || '',
        adAccountId: account?.adAccountId || '',
        spend,
        messages,
        orderCount,
        metaOrders,
        costPerMessage,
        budget,
        clicks,
        impressions,
        reach,
        linkClicks,
        engagements: Number(campaign.engagements || 0),
        bidAmount: Number(campaign.bidAmount || 0),
        createdTimeValue,
        createdTimeMs,
        costPerOrder: orderCount > 0 ? spend / orderCount : 0,
        costPerClick: clicks > 0 ? spend / clicks : 0,
        costPerMille: impressions > 0 ? (spend / impressions) * 1000 : 0,
        ctr: impressions > 0 ? clicks / impressions : 0,
        costPerLinkClick: linkClicks > 0 ? spend / linkClicks : 0,
        frequency: reach > 0 ? impressions / reach : 0,
        costPerReach: reach > 0 ? (spend / reach) * 1000 : 0
      };
    });
  }, [campaigns, allAccounts, provider, getOrderCountForCampaign, visibleExtraColumns]);

  // Account metrics aggregated from campaigns
  const accountMetricsMap = useMemo(() => {
    const map = new Map();
    for (const c of enrichedCampaigns) {
      const accId = getCampaignAccountId(c);
      if (!accId) continue;
      const prev = map.get(accId) || {
        spend: 0,
        messages: 0,
        metaOrders: 0,
        orderCount: 0,
        activeCampaigns: 0,
        totalCampaigns: 0,
        totalBudget: 0
      };
      prev.spend += Number(c.spend || 0);
      prev.messages += Number(c.messages || 0);
      prev.metaOrders += Number(c.metaOrders || 0);
      prev.orderCount += Number(c.orderCount || 0);
      prev.totalBudget += Number(c.budget || 0);
      prev.totalCampaigns += 1;
      if (isCampaignActiveStatus(c.status)) {
        prev.activeCampaigns += 1;
      }
      map.set(accId, prev);
    }
    return map;
  }, [enrichedCampaigns]);

  // Enriched accounts list
  const enrichedAccounts = useMemo(() => {
    return (allAccounts || []).map(account => {
      const accId = String(account._id || '').trim();
      const metrics = accountMetricsMap.get(accId) || {
        spend: 0,
        messages: 0,
        metaOrders: 0,
        orderCount: 0,
        activeCampaigns: 0,
        totalCampaigns: 0,
        totalBudget: 0
      };
      const costPerMessage = metrics.messages > 0 ? metrics.spend / metrics.messages : 0;
      return {
        ...account,
        ...metrics,
        costPerMessage
      };
    });
  }, [allAccounts, accountMetricsMap]);

  // Filtered & Sorted accounts
  const filteredAccounts = useMemo(() => {
    let result = enrichedAccounts;
    if (filterAcc) {
      result = result.filter(acc => String(acc._id || '') === filterAcc);
    }
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
    if (normalizedSearch) {
      result = result.filter(acc => {
        const name = String(acc.name || '').toLowerCase();
        const adAccountId = String(acc.adAccountId || '').toLowerCase();
        return name.includes(normalizedSearch) || adAccountId.includes(normalizedSearch);
      });
    }

    return [...result].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'spend') return dir * (a.spend - b.spend);
      if (sortField === 'messages') return dir * (a.messages - b.messages);
      if (sortField === 'metaOrders') return dir * (a.metaOrders - b.metaOrders);
      if (sortField === 'orderCount') return dir * (a.orderCount - b.orderCount);
      if (sortField === 'costPerMessage') return dir * (a.costPerMessage - b.costPerMessage);
      if (sortField === 'campaigns') return dir * (a.activeCampaigns - b.activeCampaigns);
      if (sortField === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
      return b.spend - a.spend;
    });
  }, [enrichedAccounts, filterAcc, searchTerm, sortField, sortDir]);

  // Accounts summary totals
  const accountsSummaryTotals = useMemo(() => {
    return filteredAccounts.reduce((acc, a) => {
      acc.spend += Number(a.spend || 0);
      acc.metaOrders += Number(a.metaOrders || 0);
      acc.orderCount += Number(a.orderCount || 0);
      acc.messages += Number(a.messages || 0);
      acc.activeCampaigns += Number(a.activeCampaigns || 0);
      acc.totalCampaigns += Number(a.totalCampaigns || 0);
      return acc;
    }, { spend: 0, metaOrders: 0, orderCount: 0, messages: 0, activeCampaigns: 0, totalCampaigns: 0 });
  }, [filteredAccounts]);

  const billingTotals = useMemo(() => {
    const totals = { amountSpent: 0, balance: 0 };
    for (const acc of filteredAccounts) {
      const item = accountBilling[acc._id];
      // Chi cong don TK tien VND de tong khong bi lech don vi
      if (!item || (item.currency && item.currency !== 'VND')) continue;
      totals.amountSpent += Number(item.amountSpent) || 0;
      totals.balance += Number(item.balance) || 0;
    }
    return totals;
  }, [accountBilling, filteredAccounts]);

  const avgAccountCostPerMessage = accountsSummaryTotals.messages > 0
    ? accountsSummaryTotals.spend / accountsSummaryTotals.messages
    : 0;

  // Filtered & Sorted campaigns
  const filteredCampaigns = useMemo(() => {
    let result = enrichedCampaigns;
    if (filterAcc) {
      result = result.filter(campaign => getCampaignAccountId(campaign) === filterAcc);
    }
    if (filterStatus) {
      result = result.filter(campaign => (
        filterStatus === 'ACTIVE'
          ? isCampaignActiveStatus(campaign.status)
          : !isCampaignActiveStatus(campaign.status)
      ));
    }
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
    if (normalizedSearch) {
      result = result.filter(campaign => {
        const campaignName = String(campaign.name || '').toLowerCase();
        const campaignId = String(campaign.campaignId || '').toLowerCase();
        const accountName = String(campaign.accountName || '').toLowerCase();
        const adAccountId = String(campaign.adAccountId || '').toLowerCase();
        return campaignName.includes(normalizedSearch)
          || campaignId.includes(normalizedSearch)
          || accountName.includes(normalizedSearch)
          || adAccountId.includes(normalizedSearch);
      });
    }

    return [...result].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'delivery') {
        const delA = isCampaignActiveStatus(a.status) ? 1 : 0;
        const delB = isCampaignActiveStatus(b.status) ? 1 : 0;
        return dir * (delA - delB);
      }
      if (sortField === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
      if (sortField === 'account') return dir * String(a.accountName || '').localeCompare(String(b.accountName || ''));
      if (!TEXT_SORT_FIELDS.has(sortField)) {
        return dir * (Number(a[sortField] || 0) - Number(b[sortField] || 0));
      }
      return b.spend - a.spend;
    });
  }, [enrichedCampaigns, filterAcc, filterStatus, searchTerm, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / CAMPAIGNS_PER_PAGE));
  const pageCampaigns = useMemo(() => {
    const page = Math.min(currentPage, totalPages);
    const start = (page - 1) * CAMPAIGNS_PER_PAGE;
    return filteredCampaigns.slice(start, start + CAMPAIGNS_PER_PAGE);
  }, [currentPage, filteredCampaigns, totalPages]);

  // Totals for summary footer row
  const summaryTotals = useMemo(() => {
    return filteredCampaigns.reduce((acc, c) => {
      acc.spend += Number(c.spend || 0);
      acc.metaOrders += Number(c.metaOrders || 0);
      acc.orderCount += Number(c.orderCount || 0);
      acc.messages += Number(c.messages || 0);
      acc.clicks += Number(c.clicks || 0);
      acc.impressions += Number(c.impressions || 0);
      acc.engagements += Number(c.engagements || 0);
      acc.linkClicks += Number(c.linkClicks || 0);
      return acc;
    }, { spend: 0, metaOrders: 0, orderCount: 0, messages: 0, clicks: 0, impressions: 0, engagements: 0, linkClicks: 0 });
  }, [filteredCampaigns]);

  const avgCostPerMessage = summaryTotals.messages > 0 ? summaryTotals.spend / summaryTotals.messages : 0;

  // Selection for campaigns
  const selectableCampaigns = useMemo(() => (
    filteredCampaigns.filter(campaign => getCampaignSelectionKey(campaign))
  ), [filteredCampaigns]);

  const selectedCampaigns = useMemo(() => (
    selectableCampaigns.filter(campaign => selectedCampaignKeys.has(getCampaignSelectionKey(campaign)))
  ), [selectableCampaigns, selectedCampaignKeys]);

  // Camp dang chon (khong phu thuoc o tim kiem) -> dung cho tab nhom QC / quang cao / bai viet
  const selectedCampaignsAll = useMemo(() => (
    enrichedCampaigns.filter(campaign => selectedCampaignKeys.has(getCampaignSelectionKey(campaign)))
  ), [enrichedCampaigns, selectedCampaignKeys]);
  const campaignNameById = useMemo(
    () => new Map(enrichedCampaigns.map(campaign => [String(campaign.campaignId || ''), campaign.name || ''])),
    [enrichedCampaigns]
  );

  const allFilteredSelected = selectableCampaigns.length > 0 && selectedCampaigns.length === selectableCampaigns.length;

  const toggleSelectCampaign = useCallback((campaign) => {
    const key = getCampaignSelectionKey(campaign);
    if (!key) return;
    setSelectedCampaignKeys(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    const keys = selectableCampaigns.map(campaign => getCampaignSelectionKey(campaign)).filter(Boolean);
    setSelectedCampaignKeys(previous => {
      const next = new Set(previous);
      const shouldSelect = keys.some(key => !next.has(key));
      keys.forEach(key => {
        if (shouldSelect) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }, [selectableCampaigns]);

  const clearSelection = useCallback(() => {
    setSelectedCampaignKeys(new Set());
  }, []);

  // Selection for accounts
  const toggleSelectAccount = useCallback((id) => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllAccounts = useCallback(() => {
    setSelectedAccountIds(prev => {
      if (prev.size === filteredAccounts.length) return new Set();
      return new Set(filteredAccounts.map(a => a._id));
    });
  }, [filteredAccounts]);

  // Account operations
  const toggleAccountAuto = async (id, enabled) => {
    try {
      await api('POST', `/accounts/${id}/auto`, { enabled });
      toast.success(`Đã ${enabled ? 'bật' : 'tắt'} tự động cho tài khoản`);
      if (loadAccounts) await loadAccounts();
    } catch (e) {
      toast.error('Lỗi bật/tắt tự động: ' + e.message);
    }
  };

  const toggleAccountAutoBulk = async (enabled) => {
    const ids = Array.from(selectedAccountIds);
    if (!ids.length) return;
    try {
      await api('POST', '/accounts/toggle-auto-bulk', { ids, enabled });
      toast.success(`Đã ${enabled ? 'bật' : 'tắt'} tự động cho ${ids.length} tài khoản`);
      setSelectedAccountIds(new Set());
      if (loadAccounts) await loadAccounts();
    } catch (e) {
      toast.error('Lỗi bulk toggle auto: ' + e.message);
    }
  };

  const deleteSelectedAccounts = async () => {
    const ids = Array.from(selectedAccountIds);
    if (!ids.length) return;
    if (!window.confirm(`Xóa ${ids.length} tài khoản đã chọn?`)) return;
    try {
      await api('POST', '/accounts/delete-bulk', { ids, provider });
      toast.success('Đã xóa thành công các tài khoản');
      setSelectedAccountIds(new Set());
      if (loadAccounts) await loadAccounts();
    } catch (e) {
      toast.error('Lỗi xóa: ' + e.message);
    }
  };

  const deleteSingleAccount = async (id, name) => {
    if (!window.confirm(`Xóa tài khoản "${name}"?`)) return;
    try {
      await api('DELETE', `/accounts/${id}?provider=${encodeURIComponent(provider)}`);
      toast.success('Đã xóa tài khoản');
      if (loadAccounts) await loadAccounts();
    } catch (e) {
      toast.error('Lỗi xóa: ' + e.message);
    }
  };

  const viewAccountCampaigns = (accountId) => {
    setFilterAcc(accountId);
    setActiveTab('campaigns');
    toast.info('Đang hiển thị chiến dịch của tài khoản');
  };

  // Bulk status toggle for campaigns
  const bulkToggleSelectedCampaigns = async (targetStatus) => {
    const targetLabel = targetStatus === 'PAUSED' ? 'tắt' : 'bật';
    if (!selectedCampaigns.length || bulkToggling) return;
    if (!window.confirm(`${targetStatus === 'PAUSED' ? 'Tắt' : 'Bật'} ${selectedCampaigns.length} chiến dịch đã chọn?`)) return;

    const selectedKeys = new Set(selectedCampaigns.map(campaign => getCampaignSelectionKey(campaign)).filter(Boolean));
    const previousStatuses = new Map(selectedCampaigns.map(campaign => [getCampaignSelectionKey(campaign), campaign.status]));
    setBulkToggling(targetStatus);
    setCampaigns(items => items.map(item => (
      selectedKeys.has(getCampaignSelectionKey(item)) ? { ...item, status: targetStatus } : item
    )));

    try {
      const payload = {
        targetStatus,
        fromDate: filterFromDate,
        toDate: filterToDate,
        items: selectedCampaigns.map(campaign => ({
          campaignId: campaign.campaignId,
          accountId: getCampaignAccountId(campaign),
          currentStatus: normalizeStatus(campaign.status)
        }))
      };
      const result = await api('POST', '/campaigns/bulk-toggle', payload, { timeoutMs: 10 * 60 * 1000 });
      if (result?.logMessage) setLastToggleLog(result.logMessage);
      const changedText = `${formatNumber(result?.changed || 0)}/${formatNumber(result?.requested || selectedCampaigns.length)}`;
      if (result?.failed > 0) {
        toast.warn(`Đã ${targetLabel} ${changedText} camp, lỗi ${formatNumber(result.failed)}`);
      } else {
        toast.success(`Đã ${targetLabel} ${changedText} camp`);
      }
      clearSelection();
      scheduleToggleReload();
    } catch (error) {
      setCampaigns(items => items.map(item => {
        const key = getCampaignSelectionKey(item);
        return previousStatuses.has(key) ? { ...item, status: previousStatuses.get(key) } : item;
      }));
      toast.error('Lỗi bulk toggle: ' + error.message);
    } finally {
      setBulkToggling('');
    }
  };

  // Export Campaigns to Excel
  const exportExcel = async () => {
    if (filteredCampaigns.length === 0) return;
    try {
      const XLSX = await loadXlsx();
      const rows = filteredCampaigns.map((campaign, idx) => {
        return {
          'STT': idx + 1,
          'Chiến dịch': campaign.name || '',
          'ID Chiến dịch': campaign.campaignId || '',
          'Tài khoản quảng cáo': campaign.accountName || '',
          'ID TKQC': campaign.adAccountId || '',
          'Trạng thái': isCampaignActiveStatus(campaign.status) ? 'ACTIVE' : 'PAUSED',
          'Phân phối': isCampaignActiveStatus(campaign.status) ? 'Đang phân phối' : 'Đã tắt',
          'Ngân sách': campaign.budget || 0,
          'Loại ngân sách': campaign.budgetType === 'LIFETIME' ? 'Trọn đời' : 'Hàng ngày',
          'Mục tiêu': campaign.objective || 'Lượt tương tác',
          'Số lượt mua hàng': campaign.metaOrders || 0,
          'Đơn đặt hàng đã tạo': campaign.orderCount || 0,
          'Lượt bắt đầu cuộc trò chuyện qua tin nhắn': campaign.messages || 0,
          'Chi phí trên mỗi lượt bắt đầu cuộc trò chuyện': Math.round(campaign.costPerMessage || 0),
          'Số tiền đã chi tiêu': Math.round(campaign.spend || 0)
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Chiến dịch');
      XLSX.writeFile(wb, `chien_dich_${filterFromDate}_${filterToDate}.xlsx`);
      toast.success('Đã xuất file Excel chiến dịch');
    } catch (e) {
      toast.error('Lỗi xuất Excel: ' + e.message);
    }
  };

  // Export Accounts to Excel
  const exportAccountsExcel = async () => {
    if (filteredAccounts.length === 0) return;
    try {
      const XLSX = await loadXlsx();
      const rows = filteredAccounts.map((acc, idx) => ({
        'STT': idx + 1,
        'Tài khoản quảng cáo': acc.name || '',
        'ID TKQC': acc.adAccountId || '',
        'Trạng thái': acc.status === 'connected' ? 'ONLINE' : (acc.status === 'error' ? 'LỖI' : 'OFFLINE'),
        'Tự động': acc.autoEnabled ? 'BẬT' : 'TẮT',
        'Chiến dịch đang chạy': acc.activeCampaigns || 0,
        'Tổng số chiến dịch': acc.totalCampaigns || 0,
        'Số lượt mua hàng': acc.metaOrders || 0,
        'Đơn đặt hàng đã tạo': acc.orderCount || 0,
        'Lượt bắt đầu cuộc trò chuyện qua tin nhắn': acc.messages || 0,
        'Chi phí trên mỗi lượt bắt đầu cuộc trò chuyện': Math.round(acc.costPerMessage || 0),
        'Số tiền đã chi tiêu': Math.round(acc.spend || 0)
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Tài khoản quảng cáo');
      XLSX.writeFile(wb, `tai_khoan_ads_${filterFromDate}_${filterToDate}.xlsx`);
      toast.success('Đã xuất file Excel tài khoản');
    } catch (e) {
      toast.error('Lỗi xuất Excel: ' + e.message);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [filterAcc, filterFromDate, filterToDate, filterStatus, provider, searchTerm, activeTab]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const sortIndicator = (field) => (sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const renderColumnHeader = (column) => {
    const style = { ...(column.style || {}), ...(column.sortField ? { cursor: 'pointer', userSelect: 'none' } : {}) };
    return (
      <th
        key={column.id}
        className={column.className}
        style={style}
        onClick={column.sortField ? () => handleSort(column.sortField) : undefined}
      >
        {column.label}{column.sortField ? sortIndicator(column.sortField) : ''}
      </th>
    );
  };

  const renderCampaignCell = (column, campaign) => {
    const isActive = isCampaignActiveStatus(campaign.status);
    const numberCell = (value, emptyText = '-') => (
      <td key={column.id} className={column.className}>{value > 0 ? formatNumber(value) : emptyText}</td>
    );
    const vndCell = (value) => <td key={column.id} className={column.className}>{vndOrDash(value)}</td>;

    switch (column.id) {
      case 'account': {
        const accId = getCampaignAccountId(campaign);
        const isAccFiltered = filterAcc && filterAcc === accId;
        return (
          <td key="account">
            <div
              className="account-name-cell"
              style={{ cursor: 'pointer' }}
              title="Bấm để lọc theo tài khoản này (bấm lại để hiện tất cả)"
              onClick={() => {
                if (!accId) return;
                if (filterAcc === accId) {
                  setFilterAcc('');
                  toast.info('Đã bỏ lọc tài khoản');
                } else {
                  setFilterAcc(accId);
                  toast.info(`Đang lọc theo tài khoản: ${campaign.accountName}`);
                }
              }}
            >
              <span style={{ color: '#10b981', fontSize: '14px', lineHeight: 1 }}>•</span>
              <span style={{ fontWeight: isAccFiltered ? 700 : 600, color: isAccFiltered ? '#0d6e52' : 'inherit', textDecoration: isAccFiltered ? 'underline' : 'none' }}>
                {campaign.accountName || '-'}
              </span>
            </div>
            {campaign.adAccountId && (
              <div className="campaign-id-sub" style={{ paddingLeft: '11px' }}>{campaign.adAccountId}</div>
            )}
          </td>
        );
      }
      case 'status':
        return (
          <td key="status" className="text-center" style={{ fontWeight: 700, fontSize: '12px', color: isActive ? 'var(--txt)' : 'var(--muted2)' }}>
            {isActive ? 'ACTIVE' : 'PAUSED'}
          </td>
        );
      case 'delivery':
        return (
          <td key="delivery">
            <div className={`delivery-cell ${isActive ? 'active' : 'paused'}`}>
              <span style={{ fontSize: '14px', lineHeight: 1 }}>•</span>
              <span>{isActive ? 'Đang phân phối' : 'Đã tắt'}</span>
            </div>
          </td>
        );
      case 'budget': {
        const isEditingBudget = editingBudgetId === campaign.campaignId;
        const isSavingBudget = savingBudgetId === campaign.campaignId;
        const isLifetime = campaign.budgetType === 'LIFETIME';
        return (
          <td key="budget" className="text-right">
            {isEditingBudget ? (
              <input
                value={editingBudgetValue}
                autoFocus
                inputMode="numeric"
                disabled={isSavingBudget}
                onChange={e => setEditingBudgetValue(e.target.value.replace(/[^\d]/g, ''))}
                onBlur={() => saveBudget(campaign)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveBudget(campaign);
                  if (e.key === 'Escape') cancelEditBudget();
                }}
                style={{ width: '100px', height: '26px', textAlign: 'right', border: '1px solid var(--border2)', borderRadius: '4px', padding: '0 6px', fontSize: '12px', color: 'var(--txt)', background: 'var(--s1)' }}
              />
            ) : (
              <button
                type="button"
                onClick={() => startEditBudget(campaign)}
                title="Click để sửa ngân sách"
                style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--txt)', cursor: 'text', font: 'inherit', fontWeight: 700, fontSize: '12.5px' }}
              >
                {isSavingBudget ? '...' : formatVND(campaign.budget)}
              </button>
            )}
            <div style={{ fontSize: '10.5px', color: isLifetime ? 'var(--o)' : 'var(--muted2)', marginTop: '2px' }}>
              {isLifetime ? 'Trọn đời' : 'Hàng ngày'}
            </div>
          </td>
        );
      }
      case 'objective':
        return (
          <td key="objective" style={{ fontSize: '12px', color: 'var(--txt)' }}>
            {campaign.objective === 'OUTCOME_SALES' ? 'Doanh số' : (campaign.objective === 'OUTCOME_TRAFFIC' ? 'Lưu lượng truy cập' : 'Lượt tương tác')}
          </td>
        );
      case 'metaOrders':
      case 'orderCount': {
        const value = campaign[column.id];
        return (
          <td key={column.id} className="text-center" style={{ fontWeight: value > 0 ? 600 : 400, color: value > 0 ? 'var(--txt)' : 'var(--muted2)' }}>
            {value > 0 ? formatNumber(value) : '-'}
          </td>
        );
      }
      case 'messages':
        return (
          <td key="messages" className="text-right" style={{ fontWeight: campaign.messages > 0 ? 600 : 400 }}>
            {campaign.messages > 0 ? formatNumber(campaign.messages) : '-'}
          </td>
        );
      case 'spend':
        return (
          <td key="spend" className="text-right" style={{ fontWeight: 600 }}>
            {campaign.spend > 0 ? formatVND(campaign.spend) : '0 ₫'}
          </td>
        );
      case 'createdTime':
        return <td key="createdTime" style={{ color: 'var(--muted)', fontSize: '12px' }}>{formatDateTime(campaign.createdTimeValue)}</td>;
      case 'reach':
        return (
          <td key="reach" className="text-right" title={campaign.reachUnavailable ? 'Meta không có tiếp cận theo giờ' : undefined}>
            {campaign.reachUnavailable ? '-' : formatNumber(campaign.reach || 0)}
          </td>
        );
      case 'impressions':
      case 'engagements':
      case 'linkClicks':
        return numberCell(campaign[column.id], '0');
      case 'ctr':
        return <td key="ctr" className="text-right">{campaign.ctr > 0 ? formatPercent(campaign.ctr) : '-'}</td>;
      case 'frequency':
        return <td key="frequency" className="text-right">{campaign.frequency > 0 ? campaign.frequency.toFixed(2).replace('.', ',') : '-'}</td>;
      case 'costPerMessage':
      case 'costPerOrder':
      case 'costPerClick':
      case 'costPerMille':
      case 'costPerLinkClick':
      case 'costPerReach':
      case 'bidAmount':
        return vndCell(campaign[column.id]);
      default: {
        const extraColumn = META_EXTRA_COLUMN_BY_ID.get(column.id);
        if (!extraColumn) return <td key={column.id}>-</td>;
        return <td key={column.id} className="text-right">{formatMetaExtraValue(campaign[column.id], extraColumn.format)}</td>;
      }
    }
  };

  // Dong tong: chi cot cong / tinh duoc tu tong moi co so
  const renderFooterCell = (column) => {
    const t = summaryTotals;
    const values = {
      metaOrders: t.metaOrders > 0 ? formatNumber(t.metaOrders) : '-',
      orderCount: t.orderCount > 0 ? formatNumber(t.orderCount) : '-',
      messages: t.messages > 0 ? formatNumber(t.messages) : '-',
      costPerMessage: vndOrDash(avgCostPerMessage),
      spend: formatVND(t.spend),
      costPerOrder: vndOrDash(t.orderCount > 0 ? t.spend / t.orderCount : 0),
      impressions: formatNumber(t.impressions),
      engagements: formatNumber(t.engagements),
      linkClicks: formatNumber(t.linkClicks),
      clicks: formatNumber(t.clicks),
      costPerClick: vndOrDash(t.clicks > 0 ? t.spend / t.clicks : 0),
      costPerMille: vndOrDash(t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0),
      ctr: t.impressions > 0 && t.clicks > 0 ? formatPercent(t.clicks / t.impressions) : '-',
      costPerLinkClick: vndOrDash(t.linkClicks > 0 ? t.spend / t.linkClicks : 0)
    };
    return (
      <td key={column.id} className={column.className} style={{ fontWeight: 700 }}>
        {values[column.id] ?? ''}
      </td>
    );
  };

  return (
    <div id="page-campaigns">
      {/* SMIT Green Header */}
      <div className="ads-manager-header">
        <div className="ads-manager-top-bar">
          <div className="ads-manager-title">
            <span>Trình quản lý quảng cáo</span>
          </div>
        </div>

        {/* SMIT Tabs: Seamless switching without navigating away */}
        <div className="ads-manager-tabs">
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'accounts' ? 'active' : ''}`}
            onClick={() => setActiveTab('accounts')}
          >
            <Users size={14} />
            <span>Tài khoản quảng cáo</span>
          </button>
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'campaigns' ? 'active' : ''}`}
            onClick={() => setActiveTab('campaigns')}
          >
            <Flag size={14} />
            <span>Chiến dịch</span>
          </button>
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'adsets' ? 'active' : ''}`}
            onClick={() => setActiveTab('adsets')}
          >
            <Layers size={14} />
            <span>Nhóm quảng cáo</span>
            {selectedCampaignsAll.length > 0 && (
              <span style={{ marginLeft: '4px', fontSize: '10.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: 'rgba(13, 110, 82, 0.12)', color: '#0d6e52' }} title={`Của ${selectedCampaignsAll.length} chiến dịch đã chọn`}>
                {selectedCampaignsAll.length} camp
              </span>
            )}
          </button>
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'ads' ? 'active' : ''}`}
            onClick={() => setActiveTab('ads')}
          >
            <Megaphone size={14} />
            <span>Quảng cáo</span>
            {selectedCampaignsAll.length > 0 && (
              <span style={{ marginLeft: '4px', fontSize: '10.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: 'rgba(13, 110, 82, 0.12)', color: '#0d6e52' }} title={`Của ${selectedCampaignsAll.length} chiến dịch đã chọn`}>
                {selectedCampaignsAll.length} camp
              </span>
            )}
          </button>
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'posts' ? 'active' : ''}`}
            onClick={() => setActiveTab('posts')}
          >
            <PenSquare size={14} />
            <span>Bài viết</span>
            {selectedCampaignsAll.length > 0 && (
              <span style={{ marginLeft: '4px', fontSize: '10.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: 'rgba(13, 110, 82, 0.12)', color: '#0d6e52' }} title={`Của ${selectedCampaignsAll.length} chiến dịch đã chọn`}>
                {selectedCampaignsAll.length} camp
              </span>
            )}
          </button>
        </div>
      </div>

      {/* SMIT Toolbar */}
      <div className="ads-manager-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Quick Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--muted2)' }} />
            <input
              type="search"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={activeTab === 'accounts' ? 'Tìm tài khoản, ID...' : 'Tìm camp, ID, tài khoản...'}
              aria-label="Tìm kiếm"
              style={{
                width: '230px',
                height: '32px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                padding: '0 10px 0 30px',
                fontSize: '12px',
                background: 'var(--s1)',
                color: 'var(--txt)',
                outline: 'none'
              }}
            />
          </div>

          {/* Reload button */}
          <button
            type="button"
            className="ads-manager-btn"
            onClick={() => {
              if (activeTab === 'accounts' && loadAccounts) loadAccounts();
              if (activeTab === 'accounts') loadAccountBilling(true);
              if (['adsets', 'ads', 'posts'].includes(activeTab)) setChildrenReloadToken(token => token + 1);
              else reloadCampaignsNow(true);
            }}
            disabled={loading}
            title="Tải lại dữ liệu"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>

          {/* Thêm tài khoản button (in Accounts tab) */}
          {activeTab === 'accounts' && openModal && (
            <button
              type="button"
              className="ads-manager-btn primary"
              onClick={() => openModal('ACCOUNT')}
              title="Thêm tài khoản quảng cáo mới"
            >
              <Plus size={13} />
              <span>Thêm tài khoản</span>
            </button>
          )}

          {/* Account Filter dropdown (shown only in campaigns tab) */}
          {activeTab === 'campaigns' && (
            <select
              value={filterAcc}
              onChange={e => setFilterAcc(e.target.value)}
              style={{
                height: '32px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '12px',
                background: 'var(--s1)',
                color: 'var(--txt)',
                cursor: 'pointer'
              }}
            >
              <option value="">Tất cả tài khoản</option>
              {allAccounts.map(account => (
                <option key={account._id} value={account._id}>{account.name}</option>
              ))}
            </select>
          )}

          {/* Status Filter (shown in campaigns tab) */}
          {activeTab === 'campaigns' && (
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{
                height: '32px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '12px',
                background: 'var(--s1)',
                color: 'var(--txt)',
                cursor: 'pointer'
              }}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="ACTIVE">Đang phân phối (ACTIVE)</option>
              <option value="PAUSED">Đã tắt (PAUSED)</option>
            </select>
          )}

          {/* Hien tat ca camp: ngay chi de xem chi tieu */}
          {activeTab === 'campaigns' && (
            <label
              className="ads-manager-btn"
              title={showAllCampaigns ? 'Đang hiện mọi camp; ngày chỉ dùng để tính chi tiêu' : 'Chỉ hiện camp có dữ liệu trong ngày đã chọn'}
              style={{ cursor: 'pointer', gap: '6px' }}
            >
              <input
                type="checkbox"
                checked={showAllCampaigns}
                onChange={e => {
                  const next = e.target.checked;
                  setShowAllCampaigns(next);
                  try { localStorage.setItem(SHOW_ALL_CAMPAIGNS_KEY, String(next)); } catch { /* bo qua */ }
                }}
              />
              <span>Hiện tất cả camp</span>
            </label>
          )}

          {/* Date Picker Button */}
          <DateRangePicker
            fromDate={filterFromDate}
            toDate={filterToDate}
            centered
            onChange={(from, to) => {
              setFilterFromDate(from);
              setFilterToDate(to);
            }}
          />

          {/* Export button */}
          <button
            type="button"
            className="ads-manager-btn"
            onClick={activeTab === 'accounts' ? exportAccountsExcel : exportExcel}
            disabled={activeTab === 'accounts' ? filteredAccounts.length === 0 : filteredCampaigns.length === 0}
            title="Tải xuống Excel"
          >
            <Download size={13} />
            <span>Tải xuống</span>
          </button>

          {/* Sync & CSV Tool Drawer Toggle (chi o tab Tai khoan quang cao) */}
          {activeTab === 'accounts' && (
            <button
              type="button"
              className={`ads-manager-btn ${showSyncTools ? 'primary' : ''}`}
              onClick={() => setShowSyncTools(prev => !prev)}
              title="Đồng bộ ngày đã chốt & Import CSV"
            >
              <FolderSync size={13} />
              <span>Đồng bộ & CSV</span>
            </button>
          )}

          {/* Tuy chinh cot hien thi (giong Dashboard) */}
          {activeTab === 'campaigns' && (
            <ColumnPresetMenu
              label={activePreset ? `Cột: ${activePreset}` : 'Tùy chỉnh cột'}
              presets={columnPresets}
              activePreset={activePreset}
              onSelect={selectColumnPreset}
              onDelete={deleteColumnPreset}
              onCustomize={() => setColumnModalOpen(true)}
            />
          )}
          {columnModalOpen && (
            <ColumnSettingsModal
              columns={availableColumns}
              groups={CAMPAIGN_COLUMN_GROUPS}
              order={columnView.order}
              hidden={columnView.hidden}
              defaultOrder={DEFAULT_CAMPAIGN_COLUMN_ORDER}
              defaultHidden={DEFAULT_HIDDEN_CAMPAIGN_COLUMN_IDS}
              pinnedLabel="Chiến dịch"
              presetName={activePreset}
              onApply={applyColumnSettings}
              onSavePreset={saveColumnPreset}
              onClose={closeColumnModal}
            />
          )}

          {/* Bulk Selection Actions for Campaigns */}
          {activeTab === 'campaigns' && selectedCampaigns.length > 0 && (
            <>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={() => bulkToggleSelectedCampaigns('PAUSED')}
                disabled={Boolean(bulkToggling)}
                style={{ color: 'var(--r)', borderColor: 'var(--r)', fontWeight: 600 }}
              >
                {bulkToggling === 'PAUSED' ? 'Đang tắt...' : `Tắt đã chọn (${selectedCampaigns.length})`}
              </button>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={() => bulkToggleSelectedCampaigns('ACTIVE')}
                disabled={Boolean(bulkToggling)}
                style={{ color: '#10b981', borderColor: '#10b981', fontWeight: 600 }}
              >
                {bulkToggling === 'ACTIVE' ? 'Đang bật...' : `Bật đã chọn (${selectedCampaigns.length})`}
              </button>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={clearSelection}
              >
                Bỏ chọn
              </button>
            </>
          )}

          {/* Bulk Selection Actions for Accounts */}
          {activeTab === 'accounts' && selectedAccountIds.size > 0 && (
            <>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={() => toggleAccountAutoBulk(true)}
                style={{ color: '#10b981', borderColor: '#10b981', fontWeight: 600 }}
              >
                Bật Auto ({selectedAccountIds.size})
              </button>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={() => toggleAccountAutoBulk(false)}
                style={{ color: 'var(--o)', borderColor: 'var(--o)', fontWeight: 600 }}
              >
                Tắt Auto ({selectedAccountIds.size})
              </button>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={deleteSelectedAccounts}
                style={{ color: 'var(--r)', borderColor: 'var(--r)', fontWeight: 600 }}
              >
                Xóa tài khoản ({selectedAccountIds.size})
              </button>
              <button
                type="button"
                className="ads-manager-btn"
                onClick={() => setSelectedAccountIds(new Set())}
              >
                Bỏ chọn
              </button>
            </>
          )}
        </div>

        
      </div>

      {/* Collapsible Sync History & CSV Tools Panel */}
      {activeTab === 'accounts' && showSyncTools && (
        <div className="card" style={{ margin: '0', borderRadius: 0, borderTop: 'none', background: 'var(--s2, #f8fafc)', padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--txt)' }}>Công cụ đồng bộ ngày đã chốt & Import CSV</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSyncTools(false)}>Đóng</button>
          </div>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted2)', marginBottom: '4px', fontWeight: '700', textTransform: 'uppercase' }}>
                Chọn ngày trước hôm nay
              </label>
              <DateRangePicker
                fromDate={syncFromDate}
                toDate={syncToDate}
                centered
                onChange={(from, to) => {
                  setSyncFromDate(from);
                  setSyncToDate(to);
                }}
              />
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSyncHistoryQueued}
              disabled={syncing || syncToDate >= todayString()}
              style={{ height: '34px' }}
              title={selectedAccountIds.size ? 'Đồng bộ các tài khoản đang tick' : 'Không tick tài khoản nào = đồng bộ tất cả'}
            >
              {syncing
                ? 'Đang gửi...'
                : selectedAccountIds.size
                  ? `Đồng bộ ${selectedAccountIds.size} tài khoản đã chọn`
                  : 'Đồng bộ tất cả tài khoản'}
            </button>
            <label
              className="btn btn-ghost btn-sm"
              style={{ height: '34px', cursor: importingCsv || provider === 'shopee' ? 'not-allowed' : 'pointer', opacity: importingCsv || provider === 'shopee' ? 0.6 : 1 }}
            >
              <Upload size={13} style={{ marginRight: '4px' }} />
              {importingCsv ? 'Đang import...' : 'Import CSV ads'}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={importingCsv || provider === 'shopee'}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  handleImportCampaignCsv(file);
                }}
                style={{ display: 'none' }}
              />
            </label>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleExportSpending}
              disabled={exporting}
              style={{ height: '34px' }}
            >
              <FileSpreadsheet size={13} style={{ marginRight: '4px' }} />
              {exporting ? 'Đang xuất...' : 'Tải báo cáo CSV'}
            </button>
          </div>
          <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--muted2)' }}>
            Tiến độ từng tài khoản hiện ở thanh % dưới tên tài khoản trong bảng.
          </div>
        </div>
      )}

      {/* Log message */}
      {lastToggleLog && (
        <div style={{ padding: '8px 18px', background: 'var(--s2)', fontSize: '12px', color: 'var(--muted2)', borderBottom: '1px solid var(--border)' }}>
          {lastToggleLog}
        </div>
      )}

      {/* Table Card */}
      <div className="card dashboard-table-card" style={{ marginTop: 0, borderRadius: '0 0 12px 12px' }}>
        <div className="tbl-wrap" id="campTableWrap">
          {/* TAB 1: ACCOUNTS VIEW */}
          {activeTab === 'accounts' && (
            loading && filteredAccounts.length === 0 ? (
              <div className="empty">
                <span className="spin">⟳</span>
                <p style={{ marginTop: '10px' }}>Đang tải tài khoản...</p>
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="empty">
                <div className="ei">🔍</div>
                <p>Không tìm thấy tài khoản quảng cáo</p>
              </div>
            ) : (
              <table className="tbl excel-style ads-manager-table">
                <thead>
                  <tr>
                    <th className="text-center" style={{ width: '38px', padding: '0 8px' }}>
                      <input
                        type="checkbox"
                        className="smit-row-checkbox"
                        checked={filteredAccounts.length > 0 && selectedAccountIds.size === filteredAccounts.length}
                        onChange={toggleSelectAllAccounts}
                        aria-label="Chọn tất cả tài khoản"
                      />
                    </th>
                    <th style={{ minWidth: '220px' }}>Tài khoản quảng cáo</th>
                    <th className="text-center" style={{ width: '100px' }}>Trạng thái</th>
                    <th style={{ width: '130px' }}>Phân phối</th>
                    <th
                      className="text-center"
                      style={{ width: '130px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('campaigns')}
                    >
                      Chiến dịch {sortField === 'campaigns' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-center"
                      style={{ width: '110px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('metaOrders')}
                    >
                      Số lượt mua hàng {sortField === 'metaOrders' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-center"
                      style={{ width: '130px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('orderCount')}
                    >
                      Đơn đặt hàng đã tạo {sortField === 'orderCount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-right"
                      style={{ width: '150px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('messages')}
                    >
                      Lượt bắt đầu cuộc trò chuyện {sortField === 'messages' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-right"
                      style={{ width: '150px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('costPerMessage')}
                    >
                      Chi phí trên mỗi lượt {sortField === 'costPerMessage' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-right"
                      style={{ width: '130px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('spend')}
                    >
                      Số tiền đã chi tiêu {sortField === 'spend' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="text-right" style={{ width: '140px' }} title="Tổng chi tiêu trọn đời tài khoản (Facebook)">
                      Tổng chi tiêu {billingLoading ? <span className="spin">⟳</span> : null}
                    </th>
                    <th className="text-right" style={{ width: '150px' }} title="Số tiền đã tiêu nhưng chưa thanh toán (Facebook)">
                      Số dư
                    </th>
                    <th className="text-center" style={{ width: '140px' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((acc, index) => {
                    const isChecked = selectedAccountIds.has(acc._id);
                    const isOnline = acc.status === 'connected' || acc.activeCampaigns > 0;
                    return (
                      <tr key={acc._id || index} style={{ background: isChecked ? 'rgba(13, 110, 82, 0.05)' : undefined }}>
                        {/* Checkbox */}
                        <td className="text-center" style={{ width: '38px', padding: '0 8px' }}>
                          <input
                            type="checkbox"
                            className="smit-row-checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectAccount(acc._id)}
                            aria-label={`Chọn tài khoản ${acc.name}`}
                          />
                        </td>

                        {/* Tài khoản quảng cáo (Toggle auto + Name + ID) */}
                        <td>
                          <div className="campaign-name-cell">
                            <label className="smit-tgl" title={acc.autoEnabled ? 'Tắt tự động' : 'Bật tự động'}>
                              <input
                                type="checkbox"
                                checked={Boolean(acc.autoEnabled)}
                                onChange={e => toggleAccountAuto(acc._id, e.target.checked)}
                              />
                              <div className="tgl-track"></div>
                              <div className="tgl-thumb"></div>
                            </label>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                className="campaign-name-title"
                                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                                onClick={() => viewAccountCampaigns(acc._id)}
                                title="Bấm để xem danh sách chiến dịch của tài khoản này"
                              >
                                <span style={{ color: '#10b981', fontSize: '14px', lineHeight: 1 }}>•</span>
                                <span style={{ textDecoration: 'underline' }}>{acc.name}</span>
                              </div>
                              <div className="campaign-id-sub">
                                {acc.adAccountId}
                                <span style={{ marginLeft: '6px', fontSize: '9.5px', background: 'rgba(13,110,82,0.1)', color: '#0d6e52', padding: '1px 5px', borderRadius: '4px' }}>
                                  {acc.provider === 'shopee' ? 'Shopee' : 'Facebook'}
                                </span>
                              </div>
                              <AccountSyncBar item={accountSyncProgress[acc._id]} />
                            </div>
                          </div>
                        </td>

                        {/* Trạng thái */}
                        <td className="text-center">
                          <span style={{
                            fontWeight: 700,
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: acc.status === 'connected' ? 'rgba(16, 185, 129, 0.12)' : (acc.status === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(148, 163, 184, 0.15)'),
                            color: acc.status === 'connected' ? '#059669' : (acc.status === 'error' ? '#dc2626' : '#64748b')
                          }}>
                            {acc.status === 'connected' ? 'ONLINE' : (acc.status === 'error' ? 'LỖI' : 'OFFLINE')}
                          </span>
                        </td>

                        {/* Phân phối */}
                        <td>
                          <div className={`delivery-cell ${isOnline ? 'active' : 'paused'}`}>
                            <span style={{ fontSize: '14px', lineHeight: 1 }}>•</span>
                            <span>{isOnline ? 'Đang phân phối' : 'Đã tắt'}</span>
                          </div>
                        </td>

                        {/* Chiến dịch */}
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => viewAccountCampaigns(acc._id)}
                            style={{
                              border: 0,
                              background: 'transparent',
                              color: '#0d6e52',
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontSize: '12.5px',
                              textDecoration: 'underline'
                            }}
                            title="Bấm để xem chiến dịch"
                          >
                            {formatNumber(acc.activeCampaigns)} / {formatNumber(acc.totalCampaigns)}
                          </button>
                        </td>

                        {/* Số lượt mua hàng */}
                        <td className="text-center" style={{ fontWeight: acc.metaOrders > 0 ? 600 : 400 }}>
                          {acc.metaOrders > 0 ? formatNumber(acc.metaOrders) : '-'}
                        </td>

                        {/* Đơn đặt hàng đã tạo */}
                        <td className="text-center" style={{ fontWeight: acc.orderCount > 0 ? 600 : 400 }}>
                          {acc.orderCount > 0 ? formatNumber(acc.orderCount) : '-'}
                        </td>

                        {/* Tin nhắn */}
                        <td className="text-right" style={{ fontWeight: acc.messages > 0 ? 600 : 400 }}>
                          {acc.messages > 0 ? formatNumber(acc.messages) : '-'}
                        </td>

                        {/* Chi phí / tin nhắn */}
                        <td className="text-right">
                          {acc.costPerMessage > 0 ? formatVND(acc.costPerMessage) : '-'}
                        </td>

                        {/* Số tiền đã chi tiêu */}
                        <td className="text-right" style={{ fontWeight: 600 }}>
                          {acc.spend > 0 ? formatVND(acc.spend) : '0 ₫'}
                        </td>

                        {/* Tổng chi tiêu / Số dư (Facebook) */}
                        <AccountBillingCells item={accountBilling[acc._id]} />

                        {/* Thao tác */}
                        <td className="text-center">
                          <div className="account-row-actions">
                            <button
                              type="button"
                              className="account-action-btn"
                              title="Xem chiến dịch tài khoản này"
                              aria-label="Xem chiến dịch"
                              onClick={() => viewAccountCampaigns(acc._id)}
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              type="button"
                              className="account-action-btn"
                              title="Cấu hình Automation"
                              aria-label="Cấu hình Automation"
                              onClick={() => openModal && openModal('AUTOMATION', acc)}
                            >
                              <Timer size={14} />
                            </button>
                            <button
                              type="button"
                              className="account-action-btn"
                              title="Sửa tài khoản"
                              aria-label="Sửa tài khoản"
                              onClick={() => openModal && openModal('ACCOUNT', acc)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="account-action-btn danger"
                              title="Xóa tài khoản"
                              aria-label="Xóa tài khoản"
                              onClick={() => deleteSingleAccount(acc._id, acc.name)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Tfoot summary for accounts */}
                {filteredAccounts.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ fontWeight: 700 }}>
                        Kết quả từ {formatNumber(filteredAccounts.length)} tài khoản quảng cáo
                      </td>
                      <td colSpan={2}></td>
                      <td className="text-center" style={{ fontWeight: 700 }}>
                        {accountsSummaryTotals.activeCampaigns} / {accountsSummaryTotals.totalCampaigns}
                      </td>
                      <td className="text-center" style={{ fontWeight: 700 }}>
                        {accountsSummaryTotals.metaOrders > 0 ? formatNumber(accountsSummaryTotals.metaOrders) : '-'}
                      </td>
                      <td className="text-center" style={{ fontWeight: 700 }}>
                        {accountsSummaryTotals.orderCount > 0 ? formatNumber(accountsSummaryTotals.orderCount) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {accountsSummaryTotals.messages > 0 ? formatNumber(accountsSummaryTotals.messages) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {avgAccountCostPerMessage > 0 ? formatVND(avgAccountCostPerMessage) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700, color: 'var(--txt)' }}>
                        {formatVND(accountsSummaryTotals.spend)}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {billingTotals.amountSpent > 0 ? formatVND(billingTotals.amountSpent) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {billingTotals.balance > 0 ? formatVND(billingTotals.balance) : '-'}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )
          )}

          {/* TAB 2: CAMPAIGNS VIEW */}
          {activeTab === 'campaigns' && (
            loading && campaigns.length === 0 ? (
              <div className="empty">
                <span className="spin">⟳</span>
                <p style={{ marginTop: '10px' }}>Đang tải...</p>
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="empty">
                <div className="ei">📢</div>
                <p>Chưa có dữ liệu ngày hôm nay</p>
              </div>
            ) : (
              <table className="tbl excel-style ads-manager-table">
                <thead>
                  <tr>
                    <th className="text-center" style={{ width: '38px', padding: '0 8px' }}>
                      <input
                        type="checkbox"
                        className="smit-row-checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Chọn tất cả chiến dịch"
                      />
                    </th>
                    <th style={{ minWidth: '180px', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>
                      Chiến dịch{sortIndicator('name')}
                    </th>
                    {visibleColumns.map(renderColumnHeader)}
                  </tr>
                </thead>
                <tbody>
                  {pageCampaigns.map((campaign, index) => {
                    const statusNormalized = normalizeStatus(campaign.status);
                    const isActive = isCampaignActiveStatus(campaign.status);
                    const selectionKey = getCampaignSelectionKey(campaign);
                    const isSelected = selectedCampaignKeys.has(selectionKey);
                    const isEditingName = Boolean(selectionKey) && editingNameKey === selectionKey;
                    const isRenaming = Boolean(selectionKey) && renamingKey === selectionKey;

                    return (
                      <tr
                        key={selectionKey || index}
                        style={{ background: isSelected ? 'rgba(13, 110, 82, 0.05)' : undefined }}
                      >
                        {/* Checkbox */}
                        <td className="text-center" style={{ width: '38px', padding: '0 8px' }}>
                          <input
                            type="checkbox"
                            className="smit-row-checkbox"
                            checked={isSelected}
                            disabled={!selectionKey || Boolean(bulkToggling)}
                            onChange={() => toggleSelectCampaign(campaign)}
                            aria-label={`Chọn camp ${campaign.name}`}
                          />
                        </td>

                        {/* Chiến dịch (Toggle + Name + ID) - bam vao ten de doi ten */}
                        <td>
                          <div className="campaign-name-cell">
                            <label className="smit-tgl" title={isActive ? 'Tắt camp' : 'Bật camp'}>
                              <input
                                type="checkbox"
                                checked={isActive}
                                onChange={() => toggleCampaignStatus(
                                  campaign.campaignId,
                                  campaign.accountId?._id || campaign.accountId,
                                  statusNormalized
                                )}
                              />
                              <div className="tgl-track"></div>
                              <div className="tgl-thumb"></div>
                            </label>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              {isEditingName ? (
                                <input
                                  value={editingNameValue}
                                  autoFocus
                                  disabled={isRenaming}
                                  onChange={e => setEditingNameValue(e.target.value.toUpperCase())}
                                  onBlur={() => saveRenameCampaign(campaign)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') saveRenameCampaign(campaign);
                                    if (e.key === 'Escape') cancelRenameCampaign();
                                  }}
                                  style={{ width: '100%', minWidth: '140px', height: '26px', border: '1px solid var(--border2)', borderRadius: '4px', padding: '0 6px', fontWeight: 600, fontSize: '12.5px', color: 'var(--txt)', background: 'var(--s1)' }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="campaign-name-title"
                                  onClick={() => startRenameCampaign(campaign)}
                                  disabled={!selectionKey}
                                  title={`${campaign.name || ''}\nBấm để đổi tên camp`}
                                  style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', textAlign: 'left', cursor: 'text', font: 'inherit' }}
                                >
                                  {isRenaming ? 'Đang đổi tên...' : campaign.name}
                                </button>
                              )}
                              <div className="campaign-id-sub">{campaign.campaignId}</div>
                            </div>
                          </div>
                        </td>

                        {visibleColumns.map(column => renderCampaignCell(column, campaign))}
                      </tr>
                    );
                  })}
                </tbody>

                {/* Total Summary Row (Bottom of Table) */}
                {filteredCampaigns.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ fontWeight: 700 }}>
                        Kết quả từ {formatNumber(filteredCampaigns.length)} chiến dịch
                      </td>
                      {visibleColumns.map(renderFooterCell)}
                    </tr>
                  </tfoot>
                )}
              </table>
            )
          )}

          {/* TAB 3-5: NHOM QUANG CAO / QUANG CAO / BAI VIET cua cac camp dang chon */}
          {['adsets', 'ads', 'posts'].includes(activeTab) && (
            <AdsManagerChildren
              level={activeTab}
              selectedCampaigns={selectedCampaignsAll}
              campaignNameById={campaignNameById}
              accountId={filterAcc}
              fromDate={filterFromDate}
              toDate={filterToDate}
              searchTerm={searchTerm}
              reloadToken={childrenReloadToken}
            />
          )}
        </div>

        {/* SMIT Table Footer */}
        <div className="ads-manager-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Hiển thị:</span>
            <select
              value={CAMPAIGNS_PER_PAGE}
              disabled
              style={{
                height: '28px',
                padding: '0 8px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--s1)',
                color: 'var(--txt)',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <option value={500}>500</option>
            </select>
            <span>mỗi trang</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {activeTab === 'accounts' ? (
              <span>
                {filteredAccounts.length > 0
                  ? `1-${filteredAccounts.length} / ${formatNumber(filteredAccounts.length)} tài khoản quảng cáo`
                  : '0 / 0 tài khoản quảng cáo'}
              </span>
            ) : (
              <>
                <span>
                  {filteredCampaigns.length > 0
                    ? `${(currentPage - 1) * CAMPAIGNS_PER_PAGE + 1}-${Math.min(currentPage * CAMPAIGNS_PER_PAGE, filteredCampaigns.length)} / ${formatNumber(filteredCampaigns.length)} chiến dịch`
                    : '0 / 0 chiến dịch'}
                </span>
                {totalPages > 1 && (
                  <div style={{ display: 'inline-flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      style={{ height: '26px', padding: '0 8px' }}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      style={{ height: '26px', padding: '0 8px' }}
                    >
                      ›
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick Floating Action Button (Teal paper plane icon) */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '46px',
          height: '46px',
          borderRadius: '50%',
          background: '#10b981',
          boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: '20px',
          cursor: 'pointer',
          zIndex: 90
        }}
        title="Hỗ trợ nhanh"
      >
        ✈
      </div>
    </div>
  );
}
