import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'react-toastify';
import { CalendarClock, CheckSquare, Copy, RefreshCw, Square, X } from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';
import { api, cachedApi, readResponseCache, formatVND, formatNumber, todayString } from '../lib/api';

function getDefaultDuplicateStartTime() {
  const start = new Date(Date.now() + 10 * 60 * 1000 + 7 * 60 * 60 * 1000);
  const yyyy = start.getUTCFullYear();
  const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(start.getUTCDate()).padStart(2, '0');
  const hh = String(start.getUTCHours()).padStart(2, '0');
  const mi = String(start.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function getCampaignAccountId(campaign) {
  return String(campaign.accountId?._id || campaign.accountId || '');
}

function getCampaignSelectionKey(campaign) {
  return `${getCampaignAccountId(campaign)}:${campaign.campaignId}`;
}

function getDateTimeMs(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatScheduleValue(value) {
  return value ? value.replace('T', ' ') : 'Không đặt';
}

function normalizeStatus(status) {
  return String(status || '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
}

export default function CloneCampaigns() {
  const { provider, allAccounts } = useAppContext();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [filterAcc, setFilterAcc] = useState('');
  const [filterDate, setFilterDate] = useState(todayString());
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedCampaigns, setSelectedCampaigns] = useState(new Set());
  const [copyCount, setCopyCount] = useState(1);
  const [duplicateStartTime, setDuplicateStartTime] = useState(getDefaultDuplicateStartTime);
  const [duplicateEndTime, setDuplicateEndTime] = useState('');
  const [duplicateResult, setDuplicateResult] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const selectedAccountName = useMemo(() => {
    return allAccounts.find(account => account._id === filterAcc)?.name || 'Tất cả tài khoản';
  }, [allAccounts, filterAcc]);

  const loadCampaigns = useCallback(async (showLoader = true) => {
    if (showLoader || campaigns.length === 0) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({ date: filterDate, provider });
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
  }, [filterAcc, filterDate, provider, campaigns.length]);

  useEffect(() => {
    setFilterAcc('');
    setSelectedCampaigns(new Set());
    setDuplicateResult(null);
  }, [provider]);

  useEffect(() => {
    loadCampaigns(false);
  }, [loadCampaigns]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredCampaigns = useMemo(() => {
    let result = campaigns;
    if (filterStatus) {
      result = result.filter(campaign => normalizeStatus(campaign.status) === filterStatus);
    }
    return [...result].sort((a, b) => b.spend - a.spend);
  }, [campaigns, filterStatus]);

  useEffect(() => {
    const validKeys = new Set(filteredCampaigns.map(getCampaignSelectionKey));
    setSelectedCampaigns(prev => new Set([...prev].filter(key => validKeys.has(key))));
  }, [filteredCampaigns]);

  const selectedRows = useMemo(() => {
    return filteredCampaigns.filter(campaign => selectedCampaigns.has(getCampaignSelectionKey(campaign)));
  }, [filteredCampaigns, selectedCampaigns]);

  const scheduleError = useMemo(() => {
    const startMs = getDateTimeMs(duplicateStartTime);
    if (!duplicateStartTime || startMs === null) return 'Chọn ngày bắt đầu hợp lệ';
    if (startMs < nowMs - 60 * 1000) return 'Ngày bắt đầu phải là hiện tại hoặc tương lai';

    if (duplicateEndTime) {
      const endMs = getDateTimeMs(duplicateEndTime);
      if (endMs === null) return 'Chọn ngày kết thúc hợp lệ';
      if (endMs <= startMs) return 'Ngày kết thúc phải lớn hơn ngày bắt đầu';
    }

    return '';
  }, [duplicateEndTime, duplicateStartTime, nowMs]);

  const allFilteredSelected = filteredCampaigns.length > 0 && selectedCampaigns.size === filteredCampaigns.length;
  const safeCopyCount = Math.min(20, Math.max(1, Number(copyCount) || 1));
  const totalCopies = selectedRows.length * safeCopyCount;

  const resetSelection = () => {
    setSelectedCampaigns(new Set());
    setDuplicateResult(null);
  };

  const handleAccountFilterChange = (value) => {
    setFilterAcc(value);
    resetSelection();
  };

  const toggleSelectedCampaign = (campaign, checked) => {
    const key = getCampaignSelectionKey(campaign);
    setSelectedCampaigns(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedCampaigns(new Set());
      return;
    }
    setSelectedCampaigns(new Set(filteredCampaigns.map(getCampaignSelectionKey)));
  };

  const duplicateSelectedCampaigns = async () => {
    if (!selectedRows.length || duplicating) return;
    if (scheduleError) {
      toast.error(scheduleError);
      return;
    }

    if (totalCopies > 100) {
      toast.error('Chỉ tạo tối đa 100 bản copy mỗi lần');
      return;
    }

    const scheduleText = `Bắt đầu: ${formatScheduleValue(duplicateStartTime)}\nKết thúc: ${formatScheduleValue(duplicateEndTime)}`;
    const accountText = `Tài khoản nguồn: ${selectedAccountName}`;
    if (!confirm(`Nhân bản y nguyên ${selectedRows.length} camp, mỗi camp ${safeCopyCount} bản?\n${accountText}\n${scheduleText}`)) return;

    setDuplicating(true);
    try {
      const result = await api('POST', '/campaigns/duplicate-exact', {
        provider,
        date: filterDate,
        copyCount: safeCopyCount,
        startTime: duplicateStartTime,
        endTime: duplicateEndTime,
        items: selectedRows.map(campaign => ({
          campaignId: campaign.campaignId,
          accountId: getCampaignAccountId(campaign)
        }))
      });

      setDuplicateResult(result);
      setSelectedCampaigns(new Set());
      await loadCampaigns(true);

      if (result.errors?.length) {
        toast.warn(`Đã copy ${result.copied?.length || 0}/${totalCopies} bản`);
      } else {
        toast.success(`Đã copy ${result.copied?.length || 0} bản`);
      }
    } catch (error) {
      toast.error('Lỗi nhân bản: ' + error.message);
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <div id="page-clone-campaigns">
      <div className="filter-row" style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
        <select
          value={filterAcc}
          onChange={event => handleAccountFilterChange(event.target.value)}
          style={{ background: 'var(--s2)', border: '1px solid var(--border)', color: 'var(--txt)', padding: '6px 12px', borderRadius: '8px', outline: 'none' }}
        >
          <option value="">Tất cả tài khoản</option>
          {allAccounts.map(account => (
            <option key={account._id} value={account._id}>{account.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={event => {
            setFilterDate(event.target.value);
            resetSelection();
          }}
          style={{ background: 'var(--s2)', border: '1px solid var(--border)', color: 'var(--txt)', padding: '6px 12px', borderRadius: '8px', outline: 'none' }}
        />
        <select
          value={filterStatus}
          onChange={event => {
            setFilterStatus(event.target.value);
            resetSelection();
          }}
          style={{ background: 'var(--s2)', border: '1px solid var(--border)', color: 'var(--txt)', padding: '6px 12px', borderRadius: '8px', outline: 'none' }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang chạy</option>
          <option value="PAUSED">Tạm dừng</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => loadCampaigns(true)} disabled={loading || duplicating}>
          <RefreshCw size={14} /> Tải lại
        </button>
      </div>

      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Nhân bản y nguyên</div>
          <span className="mono-sm" style={{ color: selectedRows.length ? 'var(--g)' : 'var(--muted2)' }}>
            Đã chọn {formatNumber(selectedRows.length)} camp
          </span>
        </div>
        <div className="duplicate-controls">
          <label className="duplicate-field" style={{ minWidth: '220px' }}>
            <span>Tài khoản nguồn</span>
            <select
              value={filterAcc}
              onChange={event => handleAccountFilterChange(event.target.value)}
              disabled={duplicating}
            >
              <option value="">Tất cả tài khoản</option>
              {allAccounts.map(account => (
                <option key={account._id} value={account._id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label className="duplicate-field">
            <span>Số bản / camp</span>
            <input
              type="number"
              min="1"
              max="20"
              value={copyCount}
              onChange={event => setCopyCount(event.target.value)}
              disabled={duplicating}
            />
          </label>
          <label className="duplicate-field">
            <span>Bắt đầu</span>
            <input
              type="datetime-local"
              value={duplicateStartTime}
              onChange={event => setDuplicateStartTime(event.target.value)}
              disabled={duplicating}
            />
          </label>
          <label className="duplicate-field">
            <span>Kết thúc</span>
            <input
              type="datetime-local"
              value={duplicateEndTime}
              onChange={event => setDuplicateEndTime(event.target.value)}
              disabled={duplicating}
            />
          </label>
          <div className="duplicate-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDuplicateStartTime(getDefaultDuplicateStartTime())}
              disabled={duplicating}
            >
              <CalendarClock size={14} /> Mặc định
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDuplicateEndTime(`${(duplicateStartTime || getDefaultDuplicateStartTime()).slice(0, 10)}T23:59`)}
              disabled={duplicating}
            >
              <CalendarClock size={14} /> Cuối ngày
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDuplicateEndTime('')}
              disabled={!duplicateEndTime || duplicating}
            >
              <X size={14} /> Xóa kết thúc
            </button>
            <button
              className="btn btn-g btn-sm"
              onClick={duplicateSelectedCampaigns}
              disabled={!selectedRows.length || duplicating || Boolean(scheduleError) || totalCopies > 100}
            >
              <Copy size={14} /> {duplicating ? 'Đang nhân...' : `Nhân ${formatNumber(totalCopies)} bản`}
            </button>
          </div>
        </div>
        <div className={`duplicate-summary ${scheduleError || totalCopies > 100 ? 'error' : ''}`}>
          {scheduleError || (totalCopies > 100 ? 'Chỉ tạo tối đa 100 bản copy mỗi lần' : `${selectedAccountName} - ${formatScheduleValue(duplicateStartTime)} đến ${formatScheduleValue(duplicateEndTime)}`)}
        </div>
      </div>

      {duplicateResult && (
        <div className="card section-gap">
          <div className="card-header">
            <div className="card-title">Kết quả nhân bản</div>
            <span className="mono-sm" style={{ color: duplicateResult.errors?.length ? 'var(--o)' : 'var(--g)' }}>
              {formatNumber(duplicateResult.copied?.length || 0)} thành công
            </span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Campaign nguồn</th>
                  <th>Campaign mới</th>
                  <th>Tài khoản</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {(duplicateResult.copied || []).map(item => (
                  <tr key={`${item.sourceCampaignId}-${item.copiedCampaignId}-${item.copyIndex}`}>
                    <td>
                      <div>{item.sourceName || item.name || '-'}</div>
                      <div className="mono-sm" style={{ color: 'var(--muted2)' }}>{item.sourceCampaignId}</div>
                    </td>
                    <td>
                      <div>{item.copiedCampaignName || item.name || '-'}</div>
                      <div className="mono-sm" style={{ color: 'var(--muted2)' }}>{item.copiedCampaignId}</div>
                    </td>
                    <td>{item.accountName || '-'}</td>
                    <td><span className="badge active">ACTIVE</span></td>
                  </tr>
                ))}
                {(duplicateResult.errors || []).map(item => (
                  <tr key={`${item.sourceCampaignId || item.name}-${item.error}`}>
                    <td>
                      <div>{item.name || '-'}</div>
                      <div className="mono-sm" style={{ color: 'var(--muted2)' }}>{item.sourceCampaignId || '-'}</div>
                    </td>
                    <td colSpan="2" style={{ color: 'var(--r)' }}>{item.error}</td>
                    <td><span className="badge paused">Lỗi</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Camp nguồn</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={toggleSelectAllFiltered} disabled={!filteredCampaigns.length || loading || duplicating}>
              {allFilteredSelected ? <Square size={14} /> : <CheckSquare size={14} />}
              {allFilteredSelected ? 'Bỏ chọn' : 'Chọn tất cả'}
            </button>
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
                  <th style={{ width: '42px' }}></th>
                  <th style={{ width: '260px' }}>Tên Campaign</th>
                  <th>Tài khoản</th>
                  <th>Trạng thái</th>
                  <th>Ngân sách</th>
                  <th style={{ width: '180px' }}>Chi tiêu</th>
                  <th className="text-right">Tin nhắn</th>
                  <th className="text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((campaign, index) => {
                  const statusNormalized = normalizeStatus(campaign.status);
                  const budgetAmount = campaign.budgetType === 'LIFETIME' ? campaign.lifetimeBudget : campaign.dailyBudget;
                  const pct = Math.min(100, (campaign.spend / 30000) * 100);
                  const pColor = pct >= 100 ? 'var(--r)' : pct >= 70 ? 'var(--o)' : 'var(--g)';

                  return (
                    <tr key={`${getCampaignSelectionKey(campaign)}:${index}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedCampaigns.has(getCampaignSelectionKey(campaign))}
                          onChange={event => toggleSelectedCampaign(campaign, event.target.checked)}
                          style={{ width: '15px', height: '15px', accentColor: 'var(--g)' }}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, marginBottom: '2px' }}>{campaign.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted2)' }}>{campaign.campaignId}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{campaign.accountId?.name || '-'}</div>
                        <div className="mono-sm" style={{ color: 'var(--muted2)' }}>{campaign.accountId?.adAccountId || ''}</div>
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
                      <td className="text-right mono-sm" style={{ color: 'var(--muted2)' }}>{formatNumber(campaign.clicks || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
