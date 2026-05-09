import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api, apiUrl, formatVND, formatNumber, todayString } from '../lib/api';
import { toast } from 'react-toastify';
import DateRangePicker from '../components/DateRangePicker';

const ACTIVE_CAMPAIGN_STATUSES = new Set(['ACTIVE', 'SCHEDULED', 'PENDING_REVIEW', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED']);

function normalizeStatus(status) {
  return String(status || '').toUpperCase().trim();
}

function isCampaignActiveStatus(status) {
  return ACTIVE_CAMPAIGN_STATUSES.has(normalizeStatus(status));
}

const CAMPAIGNS_PER_PAGE = 300;
const CAMPAIGN_TOGGLE_RELOAD_DELAY_MS = 2 * 60 * 1000;

function offsetDateString(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function yesterdayString() {
  return offsetDateString(todayString(), -1);
}

function formatCampaignDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh'
  });
}

export default function Campaigns() {
  const { provider, allAccounts } = useAppContext();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterAcc, setFilterAcc] = useState('');
  const [filterFromDate, setFilterFromDate] = useState(todayString());
  const [filterToDate, setFilterToDate] = useState(todayString());
  const [filterStatus, setFilterStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [syncFromDate, setSyncFromDate] = useState(yesterdayString());
  const [syncToDate, setSyncToDate] = useState(yesterdayString());
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [lastToggleLog, setLastToggleLog] = useState('');
  const toggleReloadTimerRef = useRef(null);

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
      setCampaigns(data);
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

  const toggleCampaignStatus = async (campaignId, accountId, currentStatus) => {
    const nextStatus = isCampaignActiveStatus(currentStatus) ? 'PAUSED' : 'ACTIVE';
    try {
      setCampaigns(items => items.map(item => (
        item.campaignId === campaignId ? { ...item, status: nextStatus } : item
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
        item.campaignId === campaignId ? { ...item, status: currentStatus } : item
      )));
      toast.error('Lỗi: ' + error.message);
    }
  };

  const handleSyncHistoryQueued = async () => {
    if (syncToDate >= todayString()) {
      toast.error('Chi dong bo thu cong cac ngay truoc hom nay. Du lieu hom nay se duoc chot tu dong cuoi ngay.');
      return;
    }

    const accountName = filterAcc
      ? allAccounts.find(account => account._id === filterAcc)?.name || filterAcc
      : `tat ca tai khoan ${provider === 'shopee' ? 'Shopee' : 'Facebook'}`;
    if (!window.confirm(`Dong bo du lieu da chot ${accountName} tu ${syncFromDate} den ${syncToDate}?`)) return;

    setSyncing(true);
    setSyncJob(null);
    try {
      const payload = {
        fromDate: syncFromDate,
        toDate: syncToDate,
        provider,
        queue: true
      };
      if (filterAcc) payload.accountId = filterAcc;
      const res = await api('POST', '/campaigns/sync-history', payload);

      if (!res.jobId) {
        setSyncJob(res);
        if (res.errors?.length) {
          toast.warn(`Dong bo xong, co ${res.errors.length} ngay loi`);
        } else {
          toast.success(`Dong bo xong ${res.syncedRows || 0} camp`);
        }
        await loadCampaigns(true);
        return;
      }

      toast.success('Da bat dau dong bo nen');
      let done = false;
      while (!done) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const status = await api('GET', `/campaigns/sync-history/${res.jobId}`);
        setSyncJob(status.job);
        done = ['completed', 'completed_with_errors', 'failed'].includes(status.job.state);
      }

      const finalStatus = await api('GET', `/campaigns/sync-history/${res.jobId}`);
      setSyncJob(finalStatus.job);

      if (finalStatus.job.state === 'failed') {
        toast.error('Dong bo loi: ' + (finalStatus.job.error || finalStatus.job.message));
      } else if (finalStatus.job.errors?.length) {
        toast.warn(`Dong bo xong, co ${finalStatus.job.errors.length} ngay loi`);
        loadCampaigns(true);
      } else {
        const accountText = finalStatus.job.totalAccounts ? ` / ${finalStatus.job.totalAccounts} tai khoan` : '';
        toast.success(`Dong bo xong ${finalStatus.job.syncedRows || 0} camp${accountText}`);
        loadCampaigns(true);
      }
    } catch (error) {
      toast.error('Loi dong bo: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleExportSpending = () => {
    setExporting(true);
    const params = new URLSearchParams({ fromDate: syncFromDate, toDate: syncToDate, provider });
    window.location.href = apiUrl(`/reports/export-spending?${params.toString()}`);
    window.setTimeout(() => setExporting(false), 2000);
  };

  const syncIncludesTodayOrFuture = syncToDate >= todayString();
  const syncDisabled = syncing || provider === 'shopee' || syncIncludesTodayOrFuture;
  const syncButtonTitle = syncIncludesTodayOrFuture
      ? 'Chi dong bo thu cong cac ngay truoc hom nay'
      : '';

  const filteredCampaigns = useMemo(() => {
    let result = campaigns;
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
        const accountName = String(campaign.accountId?.name || '').toLowerCase();
        return campaignName.includes(normalizedSearch)
          || campaignId.includes(normalizedSearch)
          || accountName.includes(normalizedSearch);
      });
    }
    return [...result].sort((a, b) => b.spend - a.spend);
  }, [campaigns, filterStatus, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / CAMPAIGNS_PER_PAGE));
  const visibleCampaigns = useMemo(() => {
    const page = Math.min(currentPage, totalPages);
    const start = (page - 1) * CAMPAIGNS_PER_PAGE;
    return filteredCampaigns.slice(start, start + CAMPAIGNS_PER_PAGE);
  }, [currentPage, filteredCampaigns, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterAcc, filterFromDate, filterToDate, filterStatus, provider, searchTerm]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div id="page-campaigns">
      <div className="filter-row" style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
        <select
          value={filterAcc}
          onChange={event => setFilterAcc(event.target.value)}
          style={{ background: 'var(--s2)', border: '1px solid var(--border)', color: 'var(--txt)', padding: '6px 12px', borderRadius: '8px', outline: 'none' }}
        >
          <option value="">Tất cả tài khoản</option>
          {allAccounts.map(account => (
            <option key={account._id} value={account._id}>{account.name}</option>
          ))}
        </select>
        
        <DateRangePicker 
          fromDate={filterFromDate} 
          toDate={filterToDate} 
          centered
          onChange={(from, to) => {
            setFilterFromDate(from);
            setFilterToDate(to);
          }} 
        />

        <select
          value={filterStatus}
          onChange={event => setFilterStatus(event.target.value)}
          style={{ background: 'var(--s2)', border: '1px solid var(--border)', color: 'var(--txt)', padding: '6px 12px', borderRadius: '8px', outline: 'none' }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang chạy</option>
          <option value="PAUSED">Tạm dừng</option>
        </select>
        <input
          type="search"
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
          placeholder="Tim ten camp, ID, tai khoan..."
          aria-label="Tim campaign"
          style={{ background: 'var(--s2)', border: '1px solid var(--border)', color: 'var(--txt)', padding: '6px 12px', borderRadius: '8px', outline: 'none', minWidth: '260px', flex: '1 1 260px' }}
        />
      </div>

      <div className="card section-gap" style={{ borderLeft: '4px solid var(--b)' }}>
        <div className="card-header">
          <div className="card-title">Bao cao & Dong bo ngay da chot</div>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted2)', marginBottom: '4px', fontWeight: '700', textTransform: 'uppercase' }}>Chon ngay truoc hom nay</label>
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
            className="btn btn-primary" 
            onClick={handleSyncHistoryQueued}
            disabled={syncDisabled}
            style={{ height: '38px' }}
            title={syncButtonTitle}
          >
            {syncing ? 'Dang dong bo...' : 'Dong bo ngay da chot'}
          </button>
          <button 
            className="btn btn-success" 
            onClick={handleExportSpending}
            disabled={exporting}
            style={{ background: 'var(--g2)', borderColor: 'var(--g2)', height: '38px' }}
          >
            {exporting ? 'Đang xuất...' : '📥 Tải báo cáo CSV'}
          </button>
        </div>
        {syncJob && (
          <div style={{ padding: '0 18px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted2)', marginBottom: '6px' }}>
              <span>
                {syncJob.message || 'Dang dong bo'}
                {syncJob.accountName ? ` - ${syncJob.accountName}` : ''}
                {syncJob.currentDay ? ` - ${syncJob.currentDay}` : ''}
              </span>
              <span>
                {syncJob.totalAccounts ? `${syncJob.completedAccounts || 0}/${syncJob.totalAccounts} TK - ` : ''}
                {syncJob.completedDays || 0}/{syncJob.totalDays || 0} ngay - {syncJob.percent || 0}%
              </span>
            </div>
            <div className="pbar">
              <div className="pbar-fill" style={{ width: `${syncJob.percent || 0}%`, background: syncJob.state === 'failed' ? 'var(--r)' : 'var(--g)' }}></div>
            </div>
          </div>
        )}
      </div>

      {lastToggleLog && (
        <div className="card section-gap">
          <div className="card-body" style={{ padding: '12px 18px', color: 'var(--muted2)', fontSize: '12px' }}>
            {lastToggleLog}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Danh sách chiến dịch</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted2)' }}>
              {filteredCampaigns.length > 0
                ? `${(currentPage - 1) * CAMPAIGNS_PER_PAGE + 1}-${Math.min(currentPage * CAMPAIGNS_PER_PAGE, filteredCampaigns.length)} / ${filteredCampaigns.length}`
                : '0 / 0'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => reloadCampaignsNow(true)}>↻</button>
          </div>
        </div>
        <div className="tbl-wrap">
          {loading && campaigns.length === 0 ? (
            <div className="empty">
              <span className="spin">⟳</span>
              <p style={{ marginTop: '10px' }}>Đang tải...</p>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="empty">
              <div className="ei">📢</div>
              <p>Chưa có dữ liệu</p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: '72px' }}>STT</th>
                  <th style={{ width: '160px' }}>Ngày Tạo</th>
                  <th style={{ width: '240px' }}>Tên Campaign</th>
                  <th>Trạng thái</th>
                  <th>Ngân sách</th>
                  <th style={{ width: '180px' }}>Chi tiêu</th>
                  <th className="text-right">Tin nhắn</th>
                  <th className="text-right">Chi phí/TN</th>
                  <th className="text-right">Clicks</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleCampaigns.map((campaign, index) => {
                  const statusNormalized = normalizeStatus(campaign.status);
                  const isActiveStatus = isCampaignActiveStatus(campaign.status);
                  const budgetAmount = campaign.budgetType === 'LIFETIME' ? campaign.lifetimeBudget : campaign.dailyBudget;
                  const pct = Math.min(100, (campaign.spend / 30000) * 100);
                  const pColor = pct >= 100 ? 'var(--r)' : pct >= 70 ? 'var(--o)' : 'var(--g)';
                  const rowIndex = (currentPage - 1) * CAMPAIGNS_PER_PAGE + index;

                  return (
                    <tr key={`${campaign.accountId?._id || campaign.accountId || rowIndex}:${campaign.campaignId || rowIndex}`}>
                      <td className="mono-sm" style={{ color: 'var(--muted2)' }}>{rowIndex + 1}</td>
                      <td className="mono-sm" style={{ color: 'var(--muted2)' }}>
                        {formatCampaignDateTime(campaign.createdTime || campaign.scheduledStartTimeUtc)}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, marginBottom: '2px' }}>{campaign.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{campaign.campaignId}</div>
                      </td>
                      <td>
                        <span className={`badge ${isActiveStatus ? 'active' : 'paused'}`}>
                          {isActiveStatus ? `● ${statusNormalized || 'ACTIVE'}` : `■ ${statusNormalized || 'PAUSED'}`}
                        </span>
                      </td>
                      <td>
                        {budgetAmount > 0 ? (
                          <>
                            <div style={{ fontSize: '12px', fontWeight: 600 }}>{formatVND(budgetAmount)}</div>
                            <div style={{ fontSize: '10px', color: 'var(--muted2)' }}>({campaign.budgetType === 'LIFETIME' ? 'Trọn đời' : 'Hằng ngày'})</div>
                          </>
                        ) : '-'}
                      </td>
                      <td>
                        <div className="spend-col">
                          <div className="pbar"><div className="pbar-fill" style={{ width: `${pct}%`, background: pColor }}></div></div>
                          <span className="mono-sm" style={{ color: pColor }}>{formatVND(campaign.spend)}</span>
                        </div>
                      </td>
                      <td className="text-right" style={{ color: 'var(--p)', fontFamily: 'var(--mono)' }}>{formatNumber(campaign.messages)}</td>
                      <td className="text-right" style={{ color: 'var(--g2)', fontFamily: 'var(--mono)' }}>
                        {campaign.messages > 0 ? formatVND(campaign.spend / campaign.messages) : '-'}
                      </td>
                      <td className="text-right mono-sm" style={{ color: 'var(--muted2)' }}>{formatNumber(campaign.clicks || 0)}</td>
                      <td>
                        <label
                          className="tgl"
                          title={isActiveStatus ? 'Tat camp' : 'Bat camp'}
                        >
                          <input
                            type="checkbox"
                            checked={isActiveStatus}
                            onChange={() => toggleCampaignStatus(campaign.campaignId, campaign.accountId?._id || campaign.accountId, statusNormalized)}
                          />
                          <div className="tgl-track"></div>
                          <div className="tgl-thumb"></div>
                          {isActiveStatus ? '⏸' : '▶'}
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filteredCampaigns.length > CAMPAIGNS_PER_PAGE && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted2)' }}>
              Trang {currentPage}/{totalPages} - tối đa {CAMPAIGNS_PER_PAGE} camp/trang
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                disabled={currentPage <= 1}
              >
                Trước
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                disabled={currentPage >= totalPages}
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
