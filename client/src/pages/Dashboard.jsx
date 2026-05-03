import React, { useCallback, useMemo, useState, useEffect } from 'react';
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

const DASHBOARD_CAMPAIGNS_PER_PAGE = 100;
const CAMPAIGN_RETURN_STATS_FROM_DATE = '2026-02-22';

export default function Dashboard() {
  const { provider, stats: globalStats, loading: globalLoading } = useAppContext();
  const showOrders = provider !== 'shopee';
  const isShopee = provider === 'shopee';

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
  const [orderReturnStats, setOrderReturnStats] = useState({ returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 });
  const [skuLoading, setSkuLoading] = useState(false);
  const [togglingCampaignId, setTogglingCampaignId] = useState('');
  const [editingCampaignId, setEditingCampaignId] = useState('');
  const [editingCampaignName, setEditingCampaignName] = useState('');
  const [renamingCampaignId, setRenamingCampaignId] = useState('');
  const [editingBudgetId, setEditingBudgetId] = useState('');
  const [editingBudget, setEditingBudget] = useState('');
  const [savingBudgetId, setSavingBudgetId] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const loadDashboardData = useCallback(async (from, to) => {
    setStatsLoading(true);
    try {
      const statsUrl = `/stats?provider=${provider}&fromDate=${from}&toDate=${to}`;
      const campaignsUrl = `/campaigns/today?provider=${provider}&fromDate=${from}&toDate=${to}`;
      const cachedStats = readResponseCache(`GET:${statsUrl}`);
      const cachedCampaigns = readResponseCache(`GET:${campaignsUrl}`);
      if (cachedStats) setLocalStats(cachedStats);
      if (cachedCampaigns) setLocalCampaigns(cachedCampaigns);
      if (cachedStats && cachedCampaigns) setStatsLoading(false);

      const [sData, cData] = await Promise.all([
        cachedApi('GET', statsUrl),
        cachedApi('GET', campaignsUrl, null, { timeoutMs: 5 * 60 * 1000 })
      ]);
      setLocalStats(sData);
      setLocalCampaigns(cData);
    } catch (e) {
      console.error('Failed to load dashboard data', e);
    } finally {
      setStatsLoading(false);
    }
  }, [provider]);

  const toggleCampaignStatus = async (campaign) => {
    const accountId = campaign.accountId?._id || campaign.accountId;
    if (!campaign.campaignId || !accountId || togglingCampaignId) return;
    setTogglingCampaignId(campaign.campaignId);
    try {
      await api('POST', `/campaigns/${campaign.campaignId}/toggle`, { accountId, currentStatus: campaign.status, date: reportFromDate });
      toast.success(String(campaign.status || '').toUpperCase() === 'ACTIVE' ? 'Da tat camp' : 'Da bat camp');
      await loadDashboardData(reportFromDate, reportToDate);
    } catch (error) {
      toast.error('Loi doi trang thai camp: ' + error.message);
    } finally {
      setTogglingCampaignId('');
    }
  };

  const startRenameCampaign = (campaign) => {
    if (renamingCampaignId) return;
    setEditingCampaignId(campaign.campaignId);
    setEditingCampaignName(toText(campaign.name, '').toUpperCase());
  };

  const cancelRenameCampaign = () => {
    setEditingCampaignId('');
    setEditingCampaignName('');
  };

  const saveRenameCampaign = async (campaign) => {
    const accountId = campaign.accountId?._id || campaign.accountId;
    const nextName = editingCampaignName.trim().toUpperCase();
    const currentName = toText(campaign.name, '').trim();
    if (!campaign.campaignId || !accountId || renamingCampaignId) return;
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
  };

  const startEditBudget = (campaign) => {
    if (savingBudgetId) return;
    setEditingBudgetId(campaign.campaignId);
    setEditingBudget(String(campaign.dailyBudget || campaign.lifetimeBudget || 0));
  };

  const cancelEditBudget = () => {
    setEditingBudgetId('');
    setEditingBudget('');
  };

  const saveBudget = async (campaign) => {
    const accountId = campaign.accountId?._id || campaign.accountId;
    const budget = Math.round(Number(editingBudget));
    if (!campaign.campaignId || !accountId || savingBudgetId) return;
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
  };

  const loadSkuCounts = useCallback(async (from, to) => {
    if (!from || !to || provider === 'shopee') return;
    setSkuLoading(true);
    try {
      const data = await api('GET', `/orders/sku-counts?fromDate=${from}&toDate=${to}`);
      setSkuCounts(data.counts || {});
      setSkuTotal(data.totalOrders || 0);
      setOrderReturnStats(data.returnStats || { returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 });
      const returnData = await api('GET', `/orders/sku-counts?fromDate=${CAMPAIGN_RETURN_STATS_FROM_DATE}&toDate=${todayString()}`);
      setReturnStatsBySku(returnData.returnStatsBySku || {});
    } catch {
      setSkuCounts({});
      setSkuTotal(0);
      setReturnStatsBySku({});
      setOrderReturnStats({ returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 });
    } finally {
      setSkuLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    loadDashboardData(reportFromDate, reportToDate);
    loadSkuCounts(reportFromDate, reportToDate);
  }, [reportFromDate, reportToDate, loadDashboardData, loadSkuCounts]);

  const getOrderCountForCampaign = useCallback((campaignName) => {
    if (!campaignName || !skuCounts || Object.keys(skuCounts).length === 0) return 0;
    const normName = String(campaignName).toUpperCase().replace(/\s+/g, '').trim();
    return Number(skuCounts['MS' + normName] || 0);
  }, [skuCounts]);

  const getReturnStatsForCampaign = useCallback((campaignName) => {
    if (!campaignName || !returnStatsBySku || Object.keys(returnStatsBySku).length === 0) {
      return { returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 };
    }
    const normName = String(campaignName).toUpperCase().replace(/\s+/g, '').trim();
    return returnStatsBySku['MS' + normName] || { returned: 0, returning: 0, received: 0, denominator: 0, rate: 0 };
  }, [returnStatsBySku]);

  const processedCampaigns = useMemo(() => {
    const search = campaignSearch.trim().toLowerCase();
    const mapped = localCampaigns
      .filter(c => Number(c.spend || 0) > 0)
      .filter(c => {
        if (!search) return true;
        return [c.name, c.campaignId, c.accountId?.name, c.accountId?.adAccountId].some(value =>
          String(value || '').toLowerCase().includes(search)
        );
      })
      .map(c => {
        const orderCount = showOrders ? getOrderCountForCampaign(c.name) : 0;
        const returnStats = showOrders ? getReturnStatsForCampaign(c.name) : { denominator: 0, rate: 0 };
        const costPerOrder = orderCount > 0 ? c.spend / orderCount : 0;
        const costPerMessage = c.messages > 0 ? c.spend / c.messages : 0;
        const costPerClick = c.clicks > 0 ? c.spend / c.clicks : 0;
        return { ...c, orderCount, returnStats, returnRate: returnStats.rate || 0, costPerOrder, costPerMessage, costPerClick };
      });

    return [...mapped].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const sA = String(a.status || '').toUpperCase() === 'ACTIVE' ? 1 : 0;
      const sB = String(b.status || '').toUpperCase() === 'ACTIVE' ? 1 : 0;
      if (sA !== sB) return sB - sA;
      if (sortField === 'orderCount') return dir * ((a.orderCount || 0) - (b.orderCount || 0));
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
  }, [localCampaigns, campaignSearch, getOrderCountForCampaign, getReturnStatsForCampaign, showOrders, sortField, sortDir, isShopee]);

  const totalPages = Math.max(1, Math.ceil(processedCampaigns.length / DASHBOARD_CAMPAIGNS_PER_PAGE));
  const visibleCampaigns = useMemo(() => {
    const page = Math.min(currentPage, totalPages);
    return processedCampaigns.slice((page - 1) * DASHBOARD_CAMPAIGNS_PER_PAGE, page * DASHBOARD_CAMPAIGNS_PER_PAGE);
  }, [currentPage, processedCampaigns, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [reportFromDate, reportToDate, provider, sortField, sortDir, campaignSearch]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const dateLabel = useMemo(() => {
    if (reportFromDate === reportToDate) {
      return reportFromDate === todayString() ? 'hom nay' : reportFromDate.split('-').reverse().join('/');
    }
    return `${reportFromDate.split('-').reverse().join('/')} ~ ${reportToDate.split('-').reverse().join('/')}`;
  }, [reportFromDate, reportToDate]);

  return (
    <div id="page-dashboard">
      <div className="stats-grid section-gap">
        <div className="stat g">
          <div className="stat-label">Tai khoan</div>
          <div className="stat-value g" id="sAccounts">{localStats.totalAccounts ?? globalStats.totalAccounts ?? '-'}</div>
          <div className="stat-sub">{localStats.connectedAccounts ?? globalStats.connectedAccounts ?? 0} ket noi</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Camp dang chay</div>
          <div className="stat-value b" id="sActive">{localStats.activeCount ?? '-'}</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Chi tieu {dateLabel}</div>
          <div className="stat-value o" id="sSpend">{localStats.totalSpend ? formatVND(localStats.totalSpend) : '-'}</div>
        </div>
        <div className="stat p">
          <div className="stat-label">{isShopee ? 'Luot click' : 'Tin nhan'} {dateLabel}</div>
          <div className="stat-value p" id="sMessages">{isShopee ? formatNumber(localStats.totalClicks || 0) : (localStats.totalMessages ? formatNumber(localStats.totalMessages) : '-')}</div>
          <div className="stat-sub">{!isShopee && localStats.avgCPM > 0 ? `CPM: ${formatVND(localStats.avgCPM)}` : '-'}</div>
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
            <div className="stat-sub">Chi tieu / Don</div>
          </div>
        )}
        {showOrders && (
          <div className="stat return-rate">
            <div className="stat-label">Ti le hoan {dateLabel}</div>
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
            <input
              type="search"
              value={campaignSearch}
              onChange={e => setCampaignSearch(e.target.value)}
              placeholder="Tim camp, ID, tai khoan..."
              aria-label="Tim campaign"
              style={{ width: '260px', maxWidth: '32vw', height: '38px', border: '1px solid var(--border)', borderRadius: '10px', padding: '0 12px', color: 'var(--txt)', background: 'var(--s1)', outline: 'none', boxShadow: '0 2px 10px rgba(15, 23, 42, 0.06)' }}
            />
            {(skuLoading || statsLoading) && <span className="spin" style={{ fontSize: '14px' }}>...</span>}
          </div>
        </div>
        <div className="tbl-wrap" id="dashCampTable">
          {(globalLoading || statsLoading) ? (
            <div className="empty"><span className="spin">...</span><p style={{ marginTop: '10px' }}>Dang tai...</p></div>
          ) : processedCampaigns.length === 0 ? (
            <div className="empty"><div className="ei">-</div><p>Khong co du lieu cho khoang ngay nay</p></div>
          ) : (
            <table className="tbl excel-style">
              <thead>
                <tr>
                  <th>Ten Campaign</th>
                  <th>Ngay tao</th>
                  <th className="text-center">Bat/Tat</th>
                  <th>Ten TKQC</th>
                  <th className="text-center">Trang thai</th>
                  <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('messages')}>
                    {isShopee ? 'Luot click (Gia/click)' : 'Tin nhan (Gia/TN)'}<SortIcon field="messages" sortField={sortField} sortDir={sortDir} />
                  </th>
                  {showOrders && <th className="text-center" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('orderCount')}>Tong don<SortIcon field="orderCount" sortField={sortField} sortDir={sortDir} /></th>}
                  {showOrders && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('returnRate')}>Ti le hoan<SortIcon field="returnRate" sortField={sortField} sortDir={sortDir} /></th>}
                  {showOrders && <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('costPerOrder')}>CPO<SortIcon field="costPerOrder" sortField={sortField} sortDir={sortDir} /></th>}
                  <th className="text-right" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('spend')}>Da chi tieu<SortIcon field="spend" sortField={sortField} sortDir={sortDir} /></th>
                  <th className="text-right">Ngan sach</th>
                </tr>
              </thead>
              <tbody>
                {visibleCampaigns.map((c, i) => {
                  const isActive = String(c.status || '').toUpperCase() === 'ACTIVE';
                  const budget = c.dailyBudget || c.lifetimeBudget || 0;
                  return (
                    <tr key={c.campaignId || i}>
                      <td>
                        {editingCampaignId === c.campaignId ? (
                          <input
                            value={editingCampaignName}
                            autoFocus
                            disabled={renamingCampaignId === c.campaignId}
                            onChange={e => setEditingCampaignName(e.target.value.toUpperCase())}
                            onBlur={() => saveRenameCampaign(c)}
                            onKeyDown={e => { if (e.key === 'Enter') saveRenameCampaign(c); if (e.key === 'Escape') cancelRenameCampaign(); }}
                            style={{ width: '100%', minWidth: '120px', height: '28px', border: '1px solid var(--border2)', borderRadius: '4px', padding: '0 8px', fontWeight: 600, fontSize: '13px', color: 'var(--txt)', background: 'var(--s1)' }}
                          />
                        ) : (
                          <button type="button" onClick={() => startRenameCampaign(c)} title="Click de sua ten camp" style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--txt)', cursor: 'text' }}>
                            {renamingCampaignId === c.campaignId ? '...' : toText(c.name)}
                          </button>
                        )}
                        <div style={{ fontSize: '10px', color: 'var(--muted2)' }}>{c.campaignId}</div>
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{formatDateTime(c.createdTime || c.created_time)}</td>
                      <td className="text-center">
                        <button className={`btn btn-sm ${isActive ? 'btn-danger' : 'btn-g'}`} onClick={() => toggleCampaignStatus(c)} disabled={togglingCampaignId === c.campaignId} title={isActive ? 'Tat camp' : 'Bat camp'} style={{ minWidth: '54px', height: '28px', padding: '0 10px' }}>
                          {togglingCampaignId === c.campaignId ? '...' : (isActive ? 'Tat' : 'Bat')}
                        </button>
                      </td>
                      <td style={{ fontWeight: 500 }}>{c.accountId?.name || '-'}</td>
                      <td className="text-center"><span className={`badge ${isActive ? 'active' : 'paused'}`}>{isActive ? 'ACTIVE' : 'PAUSE'}</span></td>
                      <td className="text-right">
                        {isShopee ? (
                          <>
                            <div style={{ fontWeight: 'bold', color: c.costPerClick > 500 ? 'var(--r)' : 'var(--txt)' }}>{formatVND(c.costPerClick)}</div>
                            <div style={{ fontSize: '11px', color: 'var(--txt)' }}>{formatNumber(c.clicks || 0)} click</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontWeight: 'bold', color: c.costPerMessage > 15000 ? 'var(--r)' : 'var(--txt)' }}>{formatVND(c.costPerMessage)}</div>
                            <div style={{ fontSize: '11px', color: 'var(--txt)' }}>{c.messages} TN</div>
                          </>
                        )}
                      </td>
                      {showOrders && <td className="text-center" style={{ fontWeight: 'bold', color: 'var(--txt)' }}>{c.orderCount || '-'}</td>}
                      {showOrders && (
                        <td className="text-right" style={{ color: c.returnStats?.denominator > 0 ? 'var(--b)' : 'var(--muted2)' }}>
                          {c.returnStats?.denominator > 0 ? <><div style={{ fontWeight: 'bold' }}>{formatPercent(c.returnRate)}</div><div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{formatNumber((c.returnStats.returned || 0) + (c.returnStats.returning || 0))} / {formatNumber(c.returnStats.denominator)}</div></> : ''}
                        </td>
                      )}
                      {showOrders && <td className="text-right" style={{ color: 'var(--txt)' }}>{c.costPerOrder > 0 ? formatVND(c.costPerOrder) : '-'}</td>}
                      <td className="text-right mono-sm">{formatVND(c.spend)}</td>
                      <td className="text-right mono-sm">
                        {editingBudgetId === c.campaignId ? (
                          <input
                            value={editingBudget}
                            autoFocus
                            inputMode="numeric"
                            disabled={savingBudgetId === c.campaignId}
                            onChange={e => setEditingBudget(e.target.value.replace(/[^\d]/g, ''))}
                            onBlur={() => saveBudget(c)}
                            onKeyDown={e => { if (e.key === 'Enter') saveBudget(c); if (e.key === 'Escape') cancelEditBudget(); }}
                            style={{ width: '110px', height: '28px', textAlign: 'right', border: '1px solid var(--border2)', borderRadius: '4px', padding: '0 8px', color: 'var(--txt)', background: 'var(--s1)' }}
                          />
                        ) : (
                          <button type="button" onClick={() => startEditBudget(c)} title="Click de sua ngan sach" style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--txt)', cursor: 'text', font: 'inherit' }}>
                            {savingBudgetId === c.campaignId ? '...' : formatVND(budget)}
                          </button>
                        )}
                      </td>
                    </tr>
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
