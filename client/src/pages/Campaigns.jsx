import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api, apiUrl, cachedApi, readResponseCache, formatVND, formatNumber, todayString } from '../lib/api';
import { toast } from 'react-toastify';
import DateRangePicker from '../components/DateRangePicker';

function normalizeStatus(status) {
  return String(status || '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
}

const CAMPAIGNS_PER_PAGE = 500;

function offsetDateString(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function yesterdayString() {
  return offsetDateString(todayString(), -1);
}

export default function Campaigns() {
  const { provider, allAccounts } = useAppContext();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterAcc, setFilterAcc] = useState('');
  const [filterFromDate, setFilterFromDate] = useState(todayString());
  const [filterToDate, setFilterToDate] = useState(todayString());
  const [filterStatus, setFilterStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [syncFromDate, setSyncFromDate] = useState(yesterdayString());
  const [syncToDate, setSyncToDate] = useState(yesterdayString());
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState(null);
  const [exporting, setExporting] = useState(false);

  const loadCampaigns = useCallback(async (showLoader = true) => {
    if (showLoader || campaigns.length === 0) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({ 
        fromDate: filterFromDate, 
        toDate: filterToDate, 
        provider 
      });
      const url = filterAcc
        ? `/accounts/${filterAcc}/campaigns?${params.toString()}`
        : `/campaigns/today?${params.toString()}`;
      const cached = readResponseCache(`GET:${url}`);
      if (cached) {
        setCampaigns(cached);
        setLoading(false);
      }
      const data = await cachedApi('GET', url, null, { timeoutMs: 5 * 60 * 1000 });
      setCampaigns(data);
    } catch (error) {
      toast.error('Lỗi tải chiến dịch: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [filterAcc, filterFromDate, filterToDate, provider, campaigns.length]);

  useEffect(() => {
    setFilterAcc('');
  }, [provider]);

  useEffect(() => {
    loadCampaigns(false);
  }, [loadCampaigns]);

  const toggleCampaignStatus = async (campaignId, accountId, currentStatus) => {
    try {
      await api('POST', `/campaigns/${campaignId}/toggle`, { accountId, currentStatus, date: filterFromDate });
      toast.success(currentStatus === 'ACTIVE' ? 'Đã tạm dừng' : 'Đã bật');
      loadCampaigns();
    } catch (error) {
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
      result = result.filter(campaign => normalizeStatus(campaign.status) === filterStatus);
    }
    return [...result].sort((a, b) => b.spend - a.spend);
  }, [campaigns, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / CAMPAIGNS_PER_PAGE));
  const visibleCampaigns = useMemo(() => {
    const page = Math.min(currentPage, totalPages);
    const start = (page - 1) * CAMPAIGNS_PER_PAGE;
    return filteredCampaigns.slice(start, start + CAMPAIGNS_PER_PAGE);
  }, [currentPage, filteredCampaigns, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterAcc, filterFromDate, filterToDate, filterStatus, provider]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const stats = useMemo(() => {
    const activeCamps = filteredCampaigns.filter(campaign => normalizeStatus(campaign.status) === 'ACTIVE').length;
    const accSet = new Set(filteredCampaigns.map(campaign => campaign.accountId?._id || campaign.accountId));
    const spend = filteredCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
    const msgs = filteredCampaigns.reduce((sum, campaign) => sum + campaign.messages, 0);
    return {
      activeCamps,
      accCount: accSet.size,
      spend,
      msgs
    };
  }, [filteredCampaigns]);

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

      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Báo cáo chiến dịch</div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted2)' }}>Chọn bộ lọc để xem báo cáo</span>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
          <div className="acc-metric">
            <div className="acc-metric-label">Số camp</div>
            <div className="acc-metric-val">{stats.activeCamps}</div>
          </div>
          <div className="acc-metric">
            <div className="acc-metric-label">Số tài khoản</div>
            <div className="acc-metric-val">{stats.accCount}</div>
          </div>
          <div className="acc-metric">
            <div className="acc-metric-label">Chi tiêu</div>
            <div className="acc-metric-val" style={{ color: 'var(--o)' }}>{formatVND(stats.spend)}</div>
          </div>
          <div className="acc-metric">
            <div className="acc-metric-label">Tin nhắn</div>
            <div className="acc-metric-val" style={{ color: 'var(--p)' }}>{formatNumber(stats.msgs)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Danh sách chiến dịch</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted2)' }}>
              {filteredCampaigns.length > 0
                ? `${(currentPage - 1) * CAMPAIGNS_PER_PAGE + 1}-${Math.min(currentPage * CAMPAIGNS_PER_PAGE, filteredCampaigns.length)} / ${filteredCampaigns.length}`
                : '0 / 0'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => loadCampaigns(true)}>↻</button>
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
                  const budgetAmount = campaign.budgetType === 'LIFETIME' ? campaign.lifetimeBudget : campaign.dailyBudget;
                  const pct = Math.min(100, (campaign.spend / 30000) * 100);
                  const pColor = pct >= 100 ? 'var(--r)' : pct >= 70 ? 'var(--o)' : 'var(--g)';
                  const rowIndex = (currentPage - 1) * CAMPAIGNS_PER_PAGE + index;

                  return (
                    <tr key={`${campaign.accountId?._id || campaign.accountId || rowIndex}:${campaign.campaignId || rowIndex}`}>
                      <td>
                        <div style={{ fontWeight: 600, marginBottom: '2px' }}>{campaign.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{campaign.campaignId}</div>
                      </td>
                      <td>
                        <span className={`badge ${statusNormalized.toLowerCase()}`}>
                          {statusNormalized === 'ACTIVE' ? '● Active' : '■ Paused'}
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
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleCampaignStatus(campaign.campaignId, campaign.accountId?._id || campaign.accountId, statusNormalized)}
                        >
                          {statusNormalized === 'ACTIVE' ? '⏸' : '▶'}
                        </button>
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
