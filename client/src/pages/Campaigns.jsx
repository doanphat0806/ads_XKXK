import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api, apiUrl, uploadForm, formatVND, formatNumber, todayString } from '../lib/api';
import { toast } from 'react-toastify';
import DateRangePicker from '../components/DateRangePicker';
import { loadXlsx } from '../utils/loadXlsx';
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
  Plus
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

export default function Campaigns() {
  const { provider, allAccounts, currentUser, loadAccounts, openModal } = useAppContext();
  
  // Tab state: 'campaigns' (default) | 'accounts' | 'adsets' | 'ads' | 'posts'
  const [activeTab, setActiveTab] = useState('campaigns');

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterAcc, setFilterAcc] = useState('');
  const [filterFromDate, setFilterFromDate] = useState(todayString());
  const [filterToDate, setFilterToDate] = useState(todayString());
  const [filterStatus, setFilterStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCampaignKeys, setSelectedCampaignKeys] = useState(() => new Set());
  const [bulkToggling, setBulkToggling] = useState('');

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
  const [syncJob, setSyncJob] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [lastToggleLog, setLastToggleLog] = useState('');
  const toggleReloadTimerRef = useRef(null);

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
        includeLiveCreated: 'true'
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
  }, [filterAcc, filterFromDate, filterToDate, provider, campaigns.length]);

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

  // Sync historical data
  const handleSyncHistoryQueued = async () => {
    if (syncToDate >= todayString()) {
      toast.error('Chỉ được chọn các ngày trước hôm nay');
      return;
    }
    setSyncing(true);
    setSyncJob(null);
    try {
      const result = await api('POST', '/campaigns/sync-history-queued', {
        fromDate: syncFromDate,
        toDate: syncToDate,
        provider
      });
      if (result?.jobId) {
        toast.info('Bắt đầu đồng bộ trong nền...');
        pollSyncJob(result.jobId);
      } else {
        toast.success('Đã gửi yêu cầu đồng bộ');
        setSyncing(false);
      }
    } catch (e) {
      toast.error('Lỗi đồng bộ: ' + e.message);
      setSyncing(false);
    }
  };

  const pollSyncJob = (jobId) => {
    const timer = setInterval(async () => {
      try {
        const res = await api('GET', `/campaigns/sync-jobs/${jobId}`);
        setSyncJob(res);
        if (res.state === 'completed') {
          clearInterval(timer);
          setSyncing(false);
          toast.success(`Đồng bộ hoàn tất (${res.completedDays || 0}/${res.totalDays || 0} ngày)`);
          await loadCampaigns(true);
        } else if (res.state === 'failed') {
          clearInterval(timer);
          setSyncing(false);
          toast.error('Đồng bộ thất bại: ' + (res.error || 'Lỗi không xác định'));
        }
      } catch (err) {
        clearInterval(timer);
        setSyncing(false);
      }
    }, 2500);
  };

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
      return {
        ...campaign,
        account,
        accountName: account?.name || '',
        adAccountId: account?.adAccountId || '',
        spend,
        messages,
        orderCount,
        metaOrders,
        costPerMessage,
        budget
      };
    });
  }, [campaigns, allAccounts, provider, getOrderCountForCampaign]);

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
      if (sortField === 'spend') return dir * (a.spend - b.spend);
      if (sortField === 'budget') return dir * (a.budget - b.budget);
      if (sortField === 'messages') return dir * (a.messages - b.messages);
      if (sortField === 'metaOrders') return dir * (a.metaOrders - b.metaOrders);
      if (sortField === 'orderCount') return dir * (a.orderCount - b.orderCount);
      if (sortField === 'costPerMessage') return dir * (a.costPerMessage - b.costPerMessage);
      if (sortField === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
      if (sortField === 'account') return dir * String(a.accountName || '').localeCompare(String(b.accountName || ''));
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
      return acc;
    }, { spend: 0, metaOrders: 0, orderCount: 0, messages: 0 });
  }, [filteredCampaigns]);

  const avgCostPerMessage = summaryTotals.messages > 0 ? summaryTotals.spend / summaryTotals.messages : 0;

  // Selection for campaigns
  const selectableCampaigns = useMemo(() => (
    filteredCampaigns.filter(campaign => getCampaignSelectionKey(campaign))
  ), [filteredCampaigns]);

  const selectedCampaigns = useMemo(() => (
    selectableCampaigns.filter(campaign => selectedCampaignKeys.has(getCampaignSelectionKey(campaign)))
  ), [selectableCampaigns, selectedCampaignKeys]);

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
          </button>
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'ads' ? 'active' : ''}`}
            onClick={() => setActiveTab('ads')}
          >
            <Megaphone size={14} />
            <span>Quảng cáo</span>
          </button>
          <button
            type="button"
            className={`ads-manager-tab ${activeTab === 'posts' ? 'active' : ''}`}
            onClick={() => setActiveTab('posts')}
          >
            <PenSquare size={14} />
            <span>Bài viết</span>
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
              reloadCampaignsNow(true);
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

          {/* Sync & CSV Tool Drawer Toggle (in campaigns tab) */}
          {activeTab === 'campaigns' && (
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
      {activeTab === 'campaigns' && showSyncTools && (
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
            >
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngày đã chốt'}
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
          {syncJob && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted2)', marginBottom: '4px' }}>
                <span>{syncJob.message || 'Đang đồng bộ'}</span>
                <span>{syncJob.completedDays || 0}/{syncJob.totalDays || 0} ngày ({syncJob.percent || 0}%)</span>
              </div>
              <div className="pbar">
                <div className="pbar-fill" style={{ width: `${syncJob.percent || 0}%`, background: syncJob.state === 'failed' ? 'var(--r)' : 'var(--g)' }}></div>
              </div>
            </div>
          )}
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
                    <th className="text-center" style={{ width: '120px' }}>Thao tác</th>
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

                        {/* Thao tác */}
                        <td className="text-center">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Xem chiến dịch tài khoản này"
                              onClick={() => viewAccountCampaigns(acc._id)}
                              style={{ height: '26px', width: '26px', padding: 0 }}
                            >
                              👁
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Cấu hình Automation"
                              onClick={() => openModal && openModal('AUTOMATION', acc)}
                              style={{ height: '26px', width: '26px', padding: 0 }}
                            >
                              ⏱
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Sửa tài khoản"
                              onClick={() => openModal && openModal('ACCOUNT', acc)}
                              style={{ height: '26px', width: '26px', padding: 0 }}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Xóa tài khoản"
                              onClick={() => deleteSingleAccount(acc._id, acc.name)}
                              style={{ height: '26px', width: '26px', padding: 0, color: 'var(--r)' }}
                            >
                              🗑
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
                    <th style={{ minWidth: '180px' }}>Chiến dịch</th>
                    <th style={{ minWidth: '150px' }}>Tài khoản quảng cáo</th>
                    <th className="text-center" style={{ width: '90px' }}>Trạng thái</th>
                    <th
                      style={{ width: '130px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('delivery')}
                      className="delivery-col-header"
                      title="Bấm để sắp xếp theo trạng thái phân phối"
                    >
                      Phân phối {sortField === 'delivery' ? (sortDir === 'asc' ? '↑' : '↓') : '↑'}
                    </th>
                    <th
                      className="text-right"
                      style={{ width: '120px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('budget')}
                    >
                      Ngân sách {sortField === 'budget' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th style={{ width: '120px' }}>Mục tiêu</th>
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
                      Lượt bắt đầu cuộc trò chuyện qua tin nhắn {sortField === 'messages' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-right"
                      style={{ width: '150px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('costPerMessage')}
                    >
                      Chi phí trên mỗi lượt bắt đầu cuộc trò chuyện {sortField === 'costPerMessage' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="text-right"
                      style={{ width: '130px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort('spend')}
                    >
                      Số tiền đã chi tiêu {sortField === 'spend' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageCampaigns.map((campaign, index) => {
                    const statusNormalized = normalizeStatus(campaign.status);
                    const isActive = isCampaignActiveStatus(campaign.status);
                    const selectionKey = getCampaignSelectionKey(campaign);
                    const isSelected = selectedCampaignKeys.has(selectionKey);
                    const isEditingBudget = editingBudgetId === campaign.campaignId;
                    const isSavingBudget = savingBudgetId === campaign.campaignId;
                    const isLifetime = campaign.budgetType === 'LIFETIME';
                    const isAccFiltered = filterAcc && filterAcc === (campaign.accountId?._id || campaign.accountId);

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

                        {/* Chiến dịch (Toggle + Name + ID) */}
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
                              <div className="campaign-name-title" title={campaign.name}>
                                {campaign.name}
                              </div>
                              <div className="campaign-id-sub">{campaign.campaignId}</div>
                            </div>
                          </div>
                        </td>

                        {/* Tài khoản quảng cáo - Clickable to filter by account */}
                        <td>
                          <div
                            className="account-name-cell"
                            style={{ cursor: 'pointer' }}
                            title="Bấm để lọc theo tài khoản này (bấm lại để hiện tất cả)"
                            onClick={() => {
                              const accId = campaign.accountId?._id || campaign.accountId;
                              if (accId) {
                                if (filterAcc === accId) {
                                  setFilterAcc('');
                                  toast.info('Đã bỏ lọc tài khoản');
                                } else {
                                  setFilterAcc(accId);
                                  toast.info(`Đang lọc theo tài khoản: ${campaign.accountName}`);
                                }
                              }
                            }}
                          >
                            <span style={{ color: '#10b981', fontSize: '14px', lineHeight: 1 }}>•</span>
                            <span style={{ fontWeight: isAccFiltered ? 700 : 600, color: isAccFiltered ? '#0d6e52' : 'inherit', textDecoration: isAccFiltered ? 'underline' : 'none' }}>
                              {campaign.accountName || '-'}
                            </span>
                          </div>
                          {campaign.adAccountId && (
                            <div className="campaign-id-sub" style={{ paddingLeft: '11px' }}>
                              {campaign.adAccountId}
                            </div>
                          )}
                        </td>

                        {/* Trạng thái */}
                        <td className="text-center" style={{ fontWeight: 700, fontSize: '12px', color: isActive ? 'var(--txt)' : 'var(--muted2)' }}>
                          {isActive ? 'ACTIVE' : 'PAUSED'}
                        </td>

                        {/* Phân phối */}
                        <td>
                          <div className={`delivery-cell ${isActive ? 'active' : 'paused'}`}>
                            <span style={{ fontSize: '14px', lineHeight: 1 }}>•</span>
                            <span>{isActive ? 'Đang phân phối' : 'Đã tắt'}</span>
                          </div>
                        </td>

                        {/* Ngân sách */}
                        <td className="text-right">
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
                              style={{
                                width: '100px',
                                height: '26px',
                                textAlign: 'right',
                                border: '1px solid var(--border2)',
                                borderRadius: '4px',
                                padding: '0 6px',
                                fontSize: '12px',
                                color: 'var(--txt)',
                                background: 'var(--s1)'
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditBudget(campaign)}
                              title="Click để sửa ngân sách"
                              style={{
                                border: 0,
                                padding: 0,
                                background: 'transparent',
                                color: 'var(--txt)',
                                cursor: 'text',
                                font: 'inherit',
                                fontWeight: 700,
                                fontSize: '12.5px'
                              }}
                            >
                              {isSavingBudget ? '...' : formatVND(campaign.budget)}
                            </button>
                          )}
                          <div style={{ fontSize: '10.5px', color: isLifetime ? 'var(--o)' : 'var(--muted2)', marginTop: '2px' }}>
                            {isLifetime ? 'Trọn đời' : 'Hàng ngày'}
                          </div>
                        </td>

                        {/* Mục tiêu */}
                        <td style={{ fontSize: '12px', color: 'var(--txt)' }}>
                          {campaign.objective === 'OUTCOME_SALES' ? 'Doanh số' : (campaign.objective === 'OUTCOME_TRAFFIC' ? 'Lưu lượng truy cập' : 'Lượt tương tác')}
                        </td>

                        {/* Số lượt mua hàng */}
                        <td className="text-center" style={{ fontWeight: campaign.metaOrders > 0 ? 600 : 400, color: campaign.metaOrders > 0 ? 'var(--txt)' : 'var(--muted2)' }}>
                          {campaign.metaOrders > 0 ? formatNumber(campaign.metaOrders) : '-'}
                        </td>

                        {/* Đơn đặt hàng đã tạo (POS) */}
                        <td className="text-center" style={{ fontWeight: campaign.orderCount > 0 ? 600 : 400, color: campaign.orderCount > 0 ? 'var(--txt)' : 'var(--muted2)' }}>
                          {campaign.orderCount > 0 ? formatNumber(campaign.orderCount) : '-'}
                        </td>

                        {/* Lượt bắt đầu cuộc trò chuyện */}
                        <td className="text-right" style={{ fontWeight: campaign.messages > 0 ? 600 : 400 }}>
                          {campaign.messages > 0 ? formatNumber(campaign.messages) : '-'}
                        </td>

                        {/* Chi phí trên mỗi lượt bắt đầu */}
                        <td className="text-right">
                          {campaign.costPerMessage > 0 ? formatVND(campaign.costPerMessage) : '-'}
                        </td>

                        {/* Số tiền đã chi tiêu */}
                        <td className="text-right" style={{ fontWeight: 600 }}>
                          {campaign.spend > 0 ? formatVND(campaign.spend) : '0 ₫'}
                        </td>
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
                      <td colSpan={5}></td>
                      <td className="text-center" style={{ fontWeight: 700 }}>
                        {summaryTotals.metaOrders > 0 ? formatNumber(summaryTotals.metaOrders) : '-'}
                      </td>
                      <td className="text-center" style={{ fontWeight: 700 }}>
                        {summaryTotals.orderCount > 0 ? formatNumber(summaryTotals.orderCount) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {summaryTotals.messages > 0 ? formatNumber(summaryTotals.messages) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700 }}>
                        {avgCostPerMessage > 0 ? formatVND(avgCostPerMessage) : '-'}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700, color: 'var(--txt)' }}>
                        {formatVND(summaryTotals.spend)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )
          )}

          {/* TAB 3: ADSETS VIEW */}
          {activeTab === 'adsets' && (
            <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div className="ei" style={{ fontSize: '32px' }}>📦</div>
              <h3 style={{ marginTop: '12px', fontSize: '16px', fontWeight: 700 }}>Nhóm quảng cáo</h3>
              <p style={{ color: 'var(--muted2)', marginTop: '6px', fontSize: '13px' }}>
                Dữ liệu nhóm quảng cáo được đồng bộ và quản lý trực tiếp theo chiến dịch.
              </p>
              <button
                type="button"
                className="ads-manager-btn primary"
                onClick={() => setActiveTab('campaigns')}
                style={{ marginTop: '16px' }}
              >
                Về danh sách Chiến dịch
              </button>
            </div>
          )}

          {/* TAB 4: ADS VIEW */}
          {activeTab === 'ads' && (
            <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div className="ei" style={{ fontSize: '32px' }}>📢</div>
              <h3 style={{ marginTop: '12px', fontSize: '16px', fontWeight: 700 }}>Quảng cáo</h3>
              <p style={{ color: 'var(--muted2)', marginTop: '6px', fontSize: '13px' }}>
                Dữ liệu chi tiết từng quảng cáo được thống kê theo chiến dịch hoạt động.
              </p>
              <button
                type="button"
                className="ads-manager-btn primary"
                onClick={() => setActiveTab('campaigns')}
                style={{ marginTop: '16px' }}
              >
                Về danh sách Chiến dịch
              </button>
            </div>
          )}

          {/* TAB 5: POSTS VIEW */}
          {activeTab === 'posts' && (
            <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div className="ei" style={{ fontSize: '32px' }}>📝</div>
              <h3 style={{ marginTop: '12px', fontSize: '16px', fontWeight: 700 }}>Bài viết</h3>
              <p style={{ color: 'var(--muted2)', marginTop: '6px', fontSize: '13px' }}>
                Quản lý bài viết Fanpage và lên lịch đăng bài tự động.
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
                <a href="/creater-page" className="ads-manager-btn primary">
                  Đi đến Trang Đăng Bài
                </a>
                <button
                  type="button"
                  className="ads-manager-btn"
                  onClick={() => setActiveTab('campaigns')}
                >
                  Về danh sách Chiến dịch
                </button>
              </div>
            </div>
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
