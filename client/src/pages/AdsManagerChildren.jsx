import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatVND, formatNumber } from '../lib/api';

// Tab Nhom quang cao / Quang cao / Bai viet cua trang Chien dich.
// Lay tu Facebook cho cac camp dang tick chon o tab Chien dich, chi so theo khoang ngay dang chon.
// Bai viet = gom cac quang cao dung chung 1 bai (effective_object_story_id).

const MAX_CAMPAIGNS = 100;

const DELIVERY_LABELS = {
  ACTIVE: 'Đang phân phối',
  PAUSED: 'Đã tắt',
  CAMPAIGN_PAUSED: 'Chiến dịch đang tắt',
  ADSET_PAUSED: 'Nhóm QC đang tắt',
  PENDING_REVIEW: 'Đang xét duyệt',
  DISAPPROVED: 'Bị từ chối',
  WITH_ISSUES: 'Có vấn đề',
  IN_PROCESS: 'Đang xử lý',
  PREAPPROVED: 'Đã duyệt trước',
  PENDING_BILLING_INFO: 'Chờ thanh toán',
  ARCHIVED: 'Đã lưu trữ',
  DELETED: 'Đã xóa'
};

const LEVEL_TEXT = {
  adsets: { title: 'Nhóm quảng cáo', unit: 'nhóm quảng cáo', icon: '📦' },
  ads: { title: 'Quảng cáo', unit: 'quảng cáo', icon: '📢' },
  posts: { title: 'Bài viết', unit: 'bài viết', icon: '📝' }
};

const sumMetrics = (rows) => rows.reduce((acc, row) => {
  acc.spend += row.spend || 0;
  acc.messages += row.messages || 0;
  acc.metaOrders += row.metaOrders || 0;
  acc.impressions += row.impressions || 0;
  acc.reach += row.reach || 0;
  acc.clicks += row.clicks || 0;
  acc.linkClicks += row.linkClicks || 0;
  acc.engagements += row.engagements || 0;
  return acc;
}, { spend: 0, messages: 0, metaOrders: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, engagements: 0 });

const numberOrDash = (value) => (value > 0 ? formatNumber(value) : '-');
const vndOrDash = (value) => (value > 0 ? formatVND(value) : '-');
const costPer = (spend, count) => (count > 0 ? spend / count : 0);
const postUrl = (storyId) => `https://www.facebook.com/${encodeURIComponent(storyId)}`;

// Gom quang cao theo bai viet
function groupAdsByPost(ads) {
  const byStory = new Map();
  for (const ad of ads) {
    const key = ad.storyId || `no-story:${ad.creativeId || ad.id}`;
    if (!byStory.has(key)) {
      byStory.set(key, {
        id: key,
        storyId: ad.storyId,
        name: ad.title || ad.body || ad.name,
        body: ad.body,
        thumbnailUrl: ad.thumbnailUrl,
        accountId: ad.accountId,
        ads: [],
        campaignIds: new Set()
      });
    }
    const post = byStory.get(key);
    post.ads.push(ad);
    post.campaignIds.add(ad.campaignId);
    if (!post.thumbnailUrl && ad.thumbnailUrl) post.thumbnailUrl = ad.thumbnailUrl;
  }
  return [...byStory.values()].map(post => ({
    ...post,
    ...sumMetrics(post.ads),
    adCount: post.ads.length,
    activeAdCount: post.ads.filter(ad => ad.effectiveStatus === 'ACTIVE').length,
    campaignCount: post.campaignIds.size
  }));
}

export default function AdsManagerChildren({
  level,
  selectedCampaigns,
  campaignNameById,
  fromDate,
  toDate,
  searchTerm,
  reloadToken,
  onBackToCampaigns
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [togglingId, setTogglingId] = useState('');
  const [sortField, setSortField] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const text = LEVEL_TEXT[level];
  const apiLevel = level === 'adsets' ? 'adset' : 'ad';

  const items = useMemo(() => selectedCampaigns.map(campaign => ({
    accountId: String(campaign.accountId?._id || campaign.accountId || ''),
    campaignId: String(campaign.campaignId || '')
  })).filter(item => item.accountId && item.campaignId), [selectedCampaigns]);
  const itemsKey = useMemo(() => items.map(item => `${item.accountId}:${item.campaignId}`).sort().join(','), [items]);
  const tooMany = items.length > MAX_CAMPAIGNS;

  useEffect(() => {
    if (!items.length || tooMany) {
      setRows([]);
      setErrors([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api('POST', '/ads-manager/children', { level: apiLevel, fromDate, toDate, items }, { timeoutMs: 3 * 60 * 1000 })
      .then(result => {
        if (cancelled) return;
        setRows(Array.isArray(result?.rows) ? result.rows : []);
        setErrors(Array.isArray(result?.errors) ? result.errors : []);
      })
      .catch(error => {
        if (cancelled) return;
        setRows([]);
        setErrors([{ accountName: '', error: error.message }]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // itemsKey dai dien cho items (tranh goi lai khi chi doi tham chieu mang)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiLevel, itemsKey, fromDate, toDate, reloadToken, tooMany]);

  const toggleStatus = useCallback(async (row) => {
    if (togglingId) return;
    const nextStatus = row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const accountId = String(row.accountId?._id || row.accountId || '');
    setTogglingId(row.id);
    const apply = (status, effectiveStatus) => setRows(current => current.map(item => (
      item.id === row.id ? { ...item, status, effectiveStatus } : item
    )));
    apply(nextStatus, nextStatus);
    try {
      await api('POST', '/ads-manager/status', { accountId, objectId: row.id, status: nextStatus });
      toast.success(`Đã ${nextStatus === 'ACTIVE' ? 'bật' : 'tắt'} ${level === 'adsets' ? 'nhóm quảng cáo' : 'quảng cáo'}`);
    } catch (error) {
      apply(row.status, row.effectiveStatus);
      toast.error('Lỗi: ' + error.message);
    } finally {
      setTogglingId('');
    }
  }, [level, togglingId]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };
  const sortMark = (field) => (sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const viewRows = useMemo(() => {
    let list = level === 'posts' ? groupAdsByPost(rows) : rows;
    const query = String(searchTerm || '').trim().toLowerCase();
    if (query) {
      list = list.filter(row => [
        row.name, row.id, row.storyId, row.adsetName, row.body,
        campaignNameById.get(row.campaignId), row.accountId?.name
      ].some(value => String(value || '').toLowerCase().includes(query)));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortField === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
      if (sortField === 'costPerMessage') return dir * (costPer(a.spend, a.messages) - costPer(b.spend, b.messages));
      if (sortField === 'budget') return dir * ((a.dailyBudget || a.lifetimeBudget || 0) - (b.dailyBudget || b.lifetimeBudget || 0));
      return dir * (Number(a[sortField] || 0) - Number(b[sortField] || 0));
    });
  }, [rows, level, searchTerm, campaignNameById, sortField, sortDir]);

  const totals = useMemo(() => sumMetrics(viewRows), [viewRows]);

  if (!items.length) {
    return (
      <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div className="ei" style={{ fontSize: '32px' }}>{text.icon}</div>
        <h3 style={{ marginTop: '12px', fontSize: '16px', fontWeight: 700 }}>{text.title}</h3>
        <p style={{ color: 'var(--muted2)', marginTop: '6px', fontSize: '13px' }}>
          Tick chọn 1 hoặc nhiều camp ở tab Chiến dịch để xem {text.unit} của các camp đó.
        </p>
        <button type="button" className="ads-manager-btn primary" onClick={onBackToCampaigns} style={{ marginTop: '16px' }}>
          Về danh sách Chiến dịch
        </button>
      </div>
    );
  }

  if (tooMany) {
    return (
      <div className="empty" style={{ padding: '60px 20px' }}>
        <p>Đang chọn {formatNumber(items.length)} camp. Chỉ xem được tối đa {MAX_CAMPAIGNS} camp một lần, hãy bỏ bớt.</p>
      </div>
    );
  }

  const header = (field, label, className, style) => (
    <th className={className} style={{ cursor: 'pointer', userSelect: 'none', ...style }} onClick={() => handleSort(field)}>
      {label}{sortMark(field)}
    </th>
  );

  const metricHeaders = (
    <>
      {header('metaOrders', 'Số lượt mua hàng', 'text-center')}
      {header('messages', 'Lượt bắt đầu trò chuyện', 'text-right')}
      {header('costPerMessage', 'Chi phí / lượt trò chuyện', 'text-right')}
      {header('impressions', 'Hiển thị', 'text-right')}
      {header('reach', 'Tiếp cận', 'text-right')}
      {header('linkClicks', 'Click liên kết', 'text-right')}
      {header('spend', 'Số tiền đã chi tiêu', 'text-right')}
    </>
  );
  const metricCells = (row) => (
    <>
      <td className="text-center" style={{ fontWeight: row.metaOrders > 0 ? 600 : 400 }}>{numberOrDash(row.metaOrders)}</td>
      <td className="text-right" style={{ fontWeight: row.messages > 0 ? 600 : 400 }}>{numberOrDash(row.messages)}</td>
      <td className="text-right">{vndOrDash(costPer(row.spend, row.messages))}</td>
      <td className="text-right">{numberOrDash(row.impressions)}</td>
      <td className="text-right">{numberOrDash(row.reach)}</td>
      <td className="text-right">{numberOrDash(row.linkClicks)}</td>
      <td className="text-right" style={{ fontWeight: 600 }}>{row.spend > 0 ? formatVND(row.spend) : '0 ₫'}</td>
    </>
  );
  const metricFooter = (
    <>
      <td className="text-center">{numberOrDash(totals.metaOrders)}</td>
      <td className="text-right">{numberOrDash(totals.messages)}</td>
      <td className="text-right">{vndOrDash(costPer(totals.spend, totals.messages))}</td>
      <td className="text-right">{numberOrDash(totals.impressions)}</td>
      <td className="text-right">-</td>
      <td className="text-right">{numberOrDash(totals.linkClicks)}</td>
      <td className="text-right">{formatVND(totals.spend)}</td>
    </>
  );

  const statusToggle = (row) => (
    <label className="smit-tgl" title={row.status === 'ACTIVE' ? 'Tắt' : 'Bật'} style={{ opacity: togglingId === row.id ? 0.6 : 1 }}>
      <input type="checkbox" checked={row.status === 'ACTIVE'} disabled={Boolean(togglingId)} onChange={() => toggleStatus(row)} />
      <div className="tgl-track"></div>
      <div className="tgl-thumb"></div>
    </label>
  );
  const deliveryCell = (row) => {
    const active = row.effectiveStatus === 'ACTIVE';
    return (
      <td>
        <div className={`delivery-cell ${active ? 'active' : 'paused'}`}>
          <span style={{ fontSize: '14px', lineHeight: 1 }}>•</span>
          <span>{DELIVERY_LABELS[row.effectiveStatus] || row.effectiveStatus || '-'}</span>
        </div>
      </td>
    );
  };
  const campaignCell = (row) => (
    <td>
      <div style={{ fontWeight: 600 }}>{campaignNameById.get(row.campaignId) || '-'}</div>
      <div className="campaign-id-sub">{row.accountId?.name || ''}</div>
    </td>
  );

  let table;
  if (level === 'adsets') {
    table = (
      <table className="tbl excel-style ads-manager-table">
        <thead>
          <tr>
            <th className="text-center" style={{ width: '38px' }}>#</th>
            {header('name', 'Nhóm quảng cáo', '', { minWidth: '220px' })}
            <th>Chiến dịch</th>
            <th>Phân phối</th>
            {header('budget', 'Ngân sách', 'text-right')}
            <th>Mục tiêu tối ưu</th>
            {metricHeaders}
          </tr>
        </thead>
        <tbody>
          {viewRows.map((row, index) => (
            <tr key={row.id}>
              <td className="text-center" style={{ color: 'var(--muted2)' }}>{index + 1}</td>
              <td>
                <div className="campaign-name-cell">
                  {statusToggle(row)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="campaign-name-title" title={row.name}>{row.name}</div>
                    <div className="campaign-id-sub">{row.id}</div>
                  </div>
                </div>
              </td>
              {campaignCell(row)}
              {deliveryCell(row)}
              <td className="text-right">
                {row.budgetType ? (
                  <>
                    <div style={{ fontWeight: 700 }}>{formatVND(row.budgetType === 'LIFETIME' ? row.lifetimeBudget : row.dailyBudget)}</div>
                    <div style={{ fontSize: '10.5px', color: row.budgetType === 'LIFETIME' ? 'var(--o)' : 'var(--muted2)' }}>
                      {row.budgetType === 'LIFETIME' ? 'Trọn đời' : 'Hàng ngày'}
                    </div>
                  </>
                ) : <span style={{ color: 'var(--muted2)', fontSize: '12px' }}>Theo chiến dịch</span>}
              </td>
              <td style={{ fontSize: '12px' }}>{row.optimizationGoal || '-'}</td>
              {metricCells(row)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Kết quả từ {formatNumber(viewRows.length)} nhóm quảng cáo</td>
            {metricFooter}
          </tr>
        </tfoot>
      </table>
    );
  } else if (level === 'ads') {
    table = (
      <table className="tbl excel-style ads-manager-table">
        <thead>
          <tr>
            <th className="text-center" style={{ width: '38px' }}>#</th>
            {header('name', 'Quảng cáo', '', { minWidth: '240px' })}
            <th>Nhóm quảng cáo</th>
            <th>Chiến dịch</th>
            <th>Phân phối</th>
            <th>Bài viết</th>
            {metricHeaders}
          </tr>
        </thead>
        <tbody>
          {viewRows.map((row, index) => (
            <tr key={row.id}>
              <td className="text-center" style={{ color: 'var(--muted2)' }}>{index + 1}</td>
              <td>
                <div className="campaign-name-cell">
                  {statusToggle(row)}
                  {row.thumbnailUrl && (
                    <img src={row.thumbnailUrl} alt="" loading="lazy" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="campaign-name-title" title={row.name}>{row.name}</div>
                    <div className="campaign-id-sub">{row.id}</div>
                  </div>
                </div>
              </td>
              <td>
                <div style={{ fontWeight: 600 }}>{row.adsetName || '-'}</div>
                <div className="campaign-id-sub">{row.adsetId}</div>
              </td>
              {campaignCell(row)}
              {deliveryCell(row)}
              <td>
                {row.storyId
                  ? <a href={postUrl(row.storyId)} target="_blank" rel="noopener noreferrer" style={{ color: '#0d6e52', fontWeight: 600 }}>Xem bài ↗</a>
                  : <span style={{ color: 'var(--muted2)' }}>-</span>}
              </td>
              {metricCells(row)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Kết quả từ {formatNumber(viewRows.length)} quảng cáo</td>
            {metricFooter}
          </tr>
        </tfoot>
      </table>
    );
  } else {
    table = (
      <table className="tbl excel-style ads-manager-table">
        <thead>
          <tr>
            <th className="text-center" style={{ width: '38px' }}>#</th>
            {header('name', 'Bài viết', '', { minWidth: '280px' })}
            {header('adCount', 'Số quảng cáo', 'text-center')}
            {header('campaignCount', 'Số chiến dịch', 'text-center')}
            <th>Tài khoản</th>
            {metricHeaders}
          </tr>
        </thead>
        <tbody>
          {viewRows.map((row, index) => (
            <tr key={row.id}>
              <td className="text-center" style={{ color: 'var(--muted2)' }}>{index + 1}</td>
              <td>
                <div className="campaign-name-cell">
                  {row.thumbnailUrl && (
                    <img src={row.thumbnailUrl} alt="" loading="lazy" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="campaign-name-title" title={row.body || row.name} style={{ whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {row.name || '(Không có nội dung)'}
                    </div>
                    <div className="campaign-id-sub">
                      {row.storyId
                        ? <a href={postUrl(row.storyId)} target="_blank" rel="noopener noreferrer" style={{ color: '#0d6e52' }}>{row.storyId} ↗</a>
                        : 'Không có ID bài viết'}
                    </div>
                  </div>
                </div>
              </td>
              <td className="text-center" title={`${row.activeAdCount} quảng cáo đang phân phối`}>
                <b>{row.activeAdCount}</b> / {row.adCount}
              </td>
              <td className="text-center">{row.campaignCount}</td>
              <td>{row.accountId?.name || '-'}</td>
              {metricCells(row)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Kết quả từ {formatNumber(viewRows.length)} bài viết</td>
            {metricFooter}
          </tr>
        </tfoot>
      </table>
    );
  }

  return (
    <>
      <div style={{ padding: '8px 4px 10px', fontSize: '12px', color: 'var(--muted2)' }}>
        {text.title} của <b style={{ color: 'var(--txt)' }}>{formatNumber(items.length)}</b> chiến dịch đã chọn. Số liệu lấy trực tiếp từ Facebook theo ngày đang chọn.
        {loading && <span className="spin" style={{ marginLeft: '8px' }}>⟳</span>}
      </div>
      {errors.length > 0 && (
        <div style={{ padding: '8px 12px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.08)', color: 'var(--r)', fontSize: '12px' }}>
          {errors.map((item, index) => (
            <div key={index}>{item.accountName ? `${item.accountName}: ` : ''}{item.error}</div>
          ))}
        </div>
      )}
      {loading && rows.length === 0 ? (
        <div className="empty"><span className="spin">⟳</span><p style={{ marginTop: '10px' }}>Đang tải {text.unit} từ Facebook...</p></div>
      ) : viewRows.length === 0 ? (
        <div className="empty"><div className="ei">{text.icon}</div><p>Không có {text.unit}</p></div>
      ) : table}
    </>
  );
}
