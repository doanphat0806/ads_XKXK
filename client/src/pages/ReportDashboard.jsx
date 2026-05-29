import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, formatVND, todayString } from '../lib/api';

// ─── Color helpers ────────────────────────────────────────────

const REC_BG = {
  '🔴': '#fff0f0',
  '⛔': '#fff0f0',
  '🟢': '#f0fff4',
  '🟡': '#fffde7',
  '🟠': '#fff3e0',
  '🎯': '#fce4ec',
};
const REC_TX = {
  '🔴': '#8b0000',
  '⛔': '#8b0000',
  '🟢': '#1b5e20',
  '🟡': '#7c5c00',
  '🟠': '#7c4000',
  '🎯': '#880e4f',
};

function recBg(rec, idx) {
  const emoji = String(rec || '').slice(0, 2);
  if (REC_BG[emoji]) return { background: REC_BG[emoji], color: REC_TX[emoji] };
  return idx % 2 === 0 ? {} : { background: 'rgba(255,255,255,0.025)' };
}

function recBadgeStyle(rec) {
  const emoji = String(rec || '').slice(0, 2);
  if (!REC_BG[emoji]) return {};
  return { background: REC_BG[emoji], color: REC_TX[emoji], borderRadius: 6, padding: '2px 8px', fontWeight: 600, fontSize: 12, display: 'inline-block', whiteSpace: 'nowrap' };
}

function pct(v) {
  const n = Number(v || 0);
  const s = (n * 100).toFixed(0);
  return `${n >= 0 ? '+' : ''}${s}%`;
}
function pctRaw(v) {
  const n = Number(v || 0);
  return `${(n * 100).toFixed(1)}%`;
}
function vnd(v) { return formatVND(Number(v || 0)); }
function num(v) { return formatNumber(Number(v || 0)); }

// ─── Risk badge ───────────────────────────────────────────────

const RISK_STYLE = {
  '🔴': { background: '#ffebee', color: '#b71c1c' },
  '🟠': { background: '#fff3e0', color: '#7c4000' },
  '🟡': { background: '#fffde7', color: '#7c5c00' },
  '🟢': { background: '#f1f8e9', color: '#1b5e20' },
};
function riskStyle(risk = '') {
  const e = risk.slice(0, 2);
  return RISK_STYLE[e] ? { ...RISK_STYLE[e], borderRadius: 6, padding: '2px 8px', fontWeight: 600, fontSize: 12 } : {};
}

// ─── Status badge ─────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = String(status || '').toUpperCase();
  const cls = s === 'ACTIVE' ? 'badge active' : 'badge paused';
  return <span className={cls}>{s === 'ACTIVE' ? 'Active' : 'Paused'}</span>;
}

// ─── Small number display ─────────────────────────────────────

function ROICell({ value }) {
  const v = Number(value || 0);
  const color = v > 0 ? '#1b5e20' : v < -0.05 ? '#b71c1c' : '#888';
  return <span style={{ color, fontWeight: 600 }}>{pct(v)}</span>;
}

// ─── Tabs ─────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: '📊 Tổng Quan' },
  { id: 'orders',      label: '📦 Đơn Hàng' },
  { id: 'campaigns',   label: '📢 Chiến Dịch' },
  { id: 'tomorrow',    label: '⚡ KN & NS Ngày Mai' },
  { id: 'health',      label: '🏥 TKQC Health' },
];

// ─── Main Component ───────────────────────────────────────────

export default function ReportDashboard() {
  const [date, setDate]       = useState(todayString());
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('tomorrow');

  const [searchS1, setSearchS1] = useState('');
  const [searchS3, setSearchS3] = useState('');
  const [searchS4, setSearchS4] = useState('');
  const [filterRec, setFilterRec] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async (targetDate) => {
    setLoading(true);
    try {
      const result = await api('GET', `/reports/data?date=${targetDate || date}`);
      setData(result);
    } catch (err) {
      toast.error(`Lỗi tải báo cáo: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(date); }, []); // eslint-disable-line

  function handleDateChange(e) {
    setDate(e.target.value);
  }
  function handleLoad() { load(date); }

  // ── Derived data ──────────────────────────────────────────

  const s1Rows = useMemo(() => {
    if (!data?.sheet1) return [];
    const q = searchS1.toLowerCase();
    return data.sheet1.filter(r => !q || r.subId2?.toLowerCase().includes(q) || r.accountName?.toLowerCase().includes(q));
  }, [data, searchS1]);

  const s1Totals = useMemo(() => {
    if (!s1Rows.length) return null;
    const totalSpend = s1Rows.reduce((s, r) => s + Number(r.totalSpend || 0), 0);
    const totalComm  = s1Rows.reduce((s, r) => s + Number(r.commission || 0), 0);
    return {
      campCount:    s1Rows.reduce((s, r) => s + Number(r.campCount || 0), 0),
      activeCnt:    s1Rows.reduce((s, r) => s + Number(r.activeCnt || 0), 0),
      pausedCnt:    s1Rows.reduce((s, r) => s + Number(r.pausedCnt || 0), 0),
      totalClicks:  s1Rows.reduce((s, r) => s + Number(r.totalClicks || 0), 0),
      totalSpend,
      totalBudget:  s1Rows.reduce((s, r) => s + Number(r.totalBudget || 0), 0),
      orderCount:   s1Rows.reduce((s, r) => s + Number(r.orderCount || 0), 0),
      totalComm,
      profit:       totalComm - totalSpend,
      roi:          totalSpend > 0 ? (totalComm - totalSpend) / totalSpend : 0,
    };
  }, [s1Rows]);

  const s3Rows = useMemo(() => {
    if (!data?.sheet3) return [];
    const q = searchS3.toLowerCase();
    return data.sheet3.filter(r => {
      if (q && !r.subId2?.toLowerCase().includes(q) && !r.campaignName?.toLowerCase().includes(q)) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterRec && !r.recommendation?.includes(filterRec)) return false;
      return true;
    });
  }, [data, searchS3, filterStatus, filterRec]);

  const s4Rows = useMemo(() => {
    if (!data?.sheet4) return [];
    const q = searchS4.toLowerCase();
    return data.sheet4.filter(r => {
      if (q && !r.subId2?.toLowerCase().includes(q) && !r.campaignName?.toLowerCase().includes(q)) return false;
      if (filterRec && !r.recommendation?.includes(filterRec)) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      return true;
    });
  }, [data, searchS4, filterRec, filterStatus]);

  const s4Totals = useMemo(() => {
    if (!s4Rows.length) return null;
    return {
      budgetToday:    s4Rows.reduce((s, r) => s + Number(r.campBudget || 0), 0),
      budgetTomorrow: s4Rows.reduce((s, r) => s + Number(r.tomorrow || 0), 0),
    };
  }, [s4Rows]);

  const uniqueRecs = useMemo(() => {
    if (!data) return [];
    const set = new Set([
      ...(data.sheet3 || []).map(r => r.recommendation),
      ...(data.sheet4 || []).map(r => r.recommendation),
    ].filter(Boolean));
    return [...set];
  }, [data]);

  // ── Date display ──────────────────────────────────────────

  const fmtDate = (d) => {
    if (!d) return '';
    const [yr, mm, dd] = d.split('-');
    return `${dd}/${mm}/${yr}`;
  };
  const fmtShort = (d) => {
    if (!d) return '';
    const [, mm, dd] = d.split('-');
    return `${dd}/${mm}`;
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div id="page-report-dashboard">

      {/* ── Toolbar ── */}
      <div className="card report-toolbar">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">Báo Cáo Giám Sát Shopee Ads</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: 'var(--muted2)', fontWeight: 600 }}>Ngày báo cáo:</label>
            <input
              type="date"
              value={date}
              onChange={handleDateChange}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13 }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleLoad} disabled={loading}>
              {loading ? '⏳ Đang tải...' : '🔄 Tải báo cáo'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Sale Banner ── */}
      {data?.bannerMessage && (
        <div className="report-banner" style={{ background: data.saleTOffset === 0 ? '#fce4ec' : data.saleTOffset < 0 ? '#fff3e0' : '#e8f5e9', color: data.saleTOffset === 0 ? '#880e4f' : data.saleTOffset < 0 ? '#7c4000' : '#1b5e20', borderRadius: 8, padding: '12px 18px', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
          {data.bannerMessage}
        </div>
      )}

      {!data && !loading && (
        <div className="empty"><div className="ei">📊</div><p>Nhấn "Tải báo cáo" để xem dữ liệu</p></div>
      )}

      {data && (
        <>
          {/* ── Tab nav ── */}
          <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 0 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                className={`tab${activeTab === t.id ? ' active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                {t.id === 'tomorrow' && data.sheet4?.filter(r => r.recommendation?.includes('TẮT')).length > 0 && (
                  <span style={{ marginLeft: 6, background: '#ef5350', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
                    {data.sheet4.filter(r => r.recommendation?.includes('TẮT')).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ══════════ TAB 1 — TỔNG QUAN ══════════ */}
          <div className={`tab-pane${activeTab === 'overview' ? ' active' : ''}`} style={{ padding: 0 }}>
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div className="card-header">
                <div className="card-title">Tổng Quan theo Sub_id2 — {fmtDate(data.targetDate)}</div>
                <input placeholder="🔍 Tìm sub_id2 / tài khoản..." value={searchS1} onChange={e => setSearchS1(e.target.value)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13, width: 260 }} />
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sub_id2</th><th>TKQC</th><th>Test?</th>
                      <th className="text-right">Số Camp</th><th className="text-right">Active</th><th className="text-right">Pause</th>
                      <th className="text-right">Số Click</th><th className="text-right">Click TB</th>
                      <th className="text-right">Chi Tiêu</th><th className="text-right">Ngân Sách</th>
                      <th className="text-right">Số Đơn</th><th className="text-right">Hoa Hồng</th>
                      <th className="text-right">Lợi Nhuận</th><th className="text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s1Rows.map((r, i) => {
                      const profit = Number(r.commission || 0) - Number(r.totalSpend || 0);
                      return (
                        <tr key={r.subId2} style={i % 2 === 0 ? {} : { background: 'rgba(255,255,255,0.025)' }}>
                          <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.subId2}>{r.subId2}</td>
                          <td><span className="badge neutral">{r.accountName}</span></td>
                          <td><span className={r.testType === 'CAMP TEST' ? 'badge warning' : 'badge neutral'} style={{ fontSize: 11 }}>{r.testType}</span></td>
                          <td className="text-right mono-sm">{num(r.campCount)}</td>
                          <td className="text-right"><span className="badge active">{num(r.activeCnt)}</span></td>
                          <td className="text-right"><span className="badge paused">{num(r.pausedCnt)}</span></td>
                          <td className="text-right mono-sm">{num(r.totalClicks)}</td>
                          <td className="text-right mono-sm">{vnd(r.avgCpc)}</td>
                          <td className="text-right mono-sm">{vnd(r.totalSpend)}</td>
                          <td className="text-right mono-sm">{vnd(r.totalBudget)}</td>
                          <td className="text-right mono-sm">{num(r.orderCount)}</td>
                          <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{vnd(r.commission)}</td>
                          <td className="text-right mono-sm" style={{ color: profit >= 0 ? 'var(--g)' : '#ef5350', fontWeight: 600 }}>{vnd(profit)}</td>
                          <td className="text-right"><ROICell value={r.todayRoi} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {s1Totals && (
                    <tfoot>
                      <tr style={{ background: '#ffd700', color: '#000', fontWeight: 800 }}>
                        <td colSpan={3}>TỔNG CỘNG</td>
                        <td className="text-right">{num(s1Totals.campCount)}</td>
                        <td className="text-right">{num(s1Totals.activeCnt)}</td>
                        <td className="text-right">{num(s1Totals.pausedCnt)}</td>
                        <td className="text-right">{num(s1Totals.totalClicks)}</td>
                        <td className="text-right">{s1Totals.totalClicks > 0 ? vnd(s1Totals.totalSpend / s1Totals.totalClicks) : '-'}</td>
                        <td className="text-right">{vnd(s1Totals.totalSpend)}</td>
                        <td className="text-right">{vnd(s1Totals.totalBudget)}</td>
                        <td className="text-right">{num(s1Totals.orderCount)}</td>
                        <td className="text-right">{vnd(s1Totals.totalComm)}</td>
                        <td className="text-right">{vnd(s1Totals.profit)}</td>
                        <td className="text-right"><ROICell value={s1Totals.roi} /></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {s1Rows.length === 0 && <div className="empty"><div className="ei">0</div><p>Không có dữ liệu</p></div>}
            </div>
          </div>

          {/* ══════════ TAB 2 — ĐƠN HÀNG ══════════ */}
          <div className={`tab-pane${activeTab === 'orders' ? ' active' : ''}`} style={{ padding: 0 }}>
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div className="card-header">
                <div className="card-title">Chi Tiết Đơn Hàng — {fmtDate(data.targetDate)}</div>
                <span className="badge neutral">{data.sheet2?.length || 0} đơn</span>
              </div>
              {(!data.sheet2 || data.sheet2.length === 0) ? (
                <div className="empty"><div className="ei">📦</div><p>Chưa có dữ liệu đơn hàng chi tiết.<br/>Import CSV hoa hồng để cập nhật dữ liệu per-order.</p></div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Sub_id2</th><th>ID Đơn</th><th>Trạng Thái ĐH</th><th>Tên Item</th>
                        <th className="text-right">Giá Trị ĐH</th><th className="text-right">Hoa Hồng</th>
                        <th className="text-right">% HH Thực</th><th className="text-right">% HH Thỏa Thuận</th>
                        <th>Trạng Thái HH</th><th>Kênh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sheet2.map((o, i) => {
                        const canceled = /hủy|cancel/i.test(o.orderStatus || '');
                        const rowStyle = canceled
                          ? { background: '#fff0f0', color: '#999', fontStyle: 'italic' }
                          : i % 2 === 0 ? {} : { background: 'rgba(255,255,255,0.025)' };
                        return (
                          <tr key={o.orderId || i} style={rowStyle}>
                            <td style={{ fontWeight: 600 }}>{o.subId2}</td>
                            <td className="mono-sm">{o.orderId}</td>
                            <td>{o.orderStatus}</td>
                            <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.itemName}>{o.itemName}</td>
                            <td className="text-right mono-sm">{vnd(o.orderValue)}</td>
                            <td className="text-right mono-sm" style={{ color: canceled ? '#999' : 'var(--g)', fontWeight: 600 }}>{vnd(o.commission)}</td>
                            <td className="text-right mono-sm">{pctRaw(o.actualCommissionRate / 100)}</td>
                            <td className="text-right mono-sm">{pctRaw(o.agreedCommissionRate / 100)}</td>
                            <td>{o.commissionStatus}</td>
                            <td>{o.channel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ══════════ TAB 3 — CHIẾN DỊCH ══════════ */}
          <div className={`tab-pane${activeTab === 'campaigns' ? ' active' : ''}`} style={{ padding: 0 }}>
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="card-title">Chi Tiết Chiến Dịch — {fmtDate(data.targetDate)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input placeholder="🔍 Tìm tên campaign / sub_id2..." value={searchS3} onChange={e => setSearchS3(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13, width: 260 }} />
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13 }}>
                    <option value="">Tất cả trạng thái</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                  </select>
                  <select value={filterRec} onChange={e => setFilterRec(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13, maxWidth: 200 }}>
                    <option value="">Tất cả khuyến nghị</option>
                    {uniqueRecs.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sub_id2</th><th>TKQC</th><th>Test?</th><th>Tên Campaign</th><th>Trạng Thái</th>
                      <th className="text-right">Click</th><th className="text-right">CPC</th>
                      <th className="text-right">Chi Tiêu</th><th className="text-right">Ngân Sách</th>
                      <th className="text-right">% NS</th><th>Khuyến Nghị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s3Rows.map((r, i) => {
                      const rowStyle = { ...recBg(r.recommendation, i), opacity: r.status === 'PAUSED' ? 0.65 : 1 };
                      return (
                        <tr key={`${r.campaignName}-${i}`} style={rowStyle}>
                          <td style={{ fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.subId2}>{r.subId2}</td>
                          <td><span className="badge neutral">{r.accountName}</span></td>
                          <td><span className={r.testType === 'CAMP TEST' ? 'badge warning' : 'badge neutral'} style={{ fontSize: 10 }}>{r.testType === 'CAMP TEST' ? 'TEST' : 'Thường'}</span></td>
                          <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }} title={r.campaignName}>{r.campaignName}</td>
                          <td><StatusBadge status={r.status} /></td>
                          <td className="text-right mono-sm">{num(r.clicks)}</td>
                          <td className="text-right mono-sm">{vnd(r.cpc)}</td>
                          <td className="text-right mono-sm">{vnd(r.spend)}</td>
                          <td className="text-right mono-sm">{vnd(r.budget)}</td>
                          <td className="text-right mono-sm">{pctRaw(r.budgetUsage)}</td>
                          <td><span style={recBadgeStyle(r.recommendation)}>{r.recommendation || '—'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {s3Rows.length === 0 && <div className="empty"><div className="ei">0</div><p>Không có chiến dịch phù hợp</p></div>}
            </div>
          </div>

          {/* ══════════ TAB 4 — KN & NS NGÀY MAI ══════════ */}
          <div className={`tab-pane${activeTab === 'tomorrow' ? ' active' : ''}`} style={{ padding: 0 }}>
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="card-title">Khuyến Nghị & Ngân Sách Ngày Mai ({fmtDate(data.tomorrowDate)})</div>
                  <div style={{ fontSize: 12, color: 'var(--muted2)', marginTop: 4 }}>
                    Lịch sử: {fmtShort(data.n3)} → {fmtShort(data.n2)} → {fmtShort(data.n1)} → Hôm nay ({fmtShort(data.targetDate)})
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input placeholder="🔍 Tìm tên / sub_id2..." value={searchS4} onChange={e => setSearchS4(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13, width: 240 }} />
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13 }}>
                    <option value="">Tất cả trạng thái</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                  </select>
                  <select value={filterRec} onChange={e => setFilterRec(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--s2)', color: 'var(--txt)', fontSize: 13, maxWidth: 200 }}>
                    <option value="">Tất cả khuyến nghị</option>
                    {uniqueRecs.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sub_id2</th><th>TKQC</th><th>Test?</th><th>Tên Campaign</th><th>TT</th>
                      <th>Khuyến Nghị</th>
                      <th className="text-right">HH {fmtShort(data.n3)}</th><th className="text-right">ROI {fmtShort(data.n3)}</th>
                      <th className="text-right">HH {fmtShort(data.n2)}</th><th className="text-right">ROI {fmtShort(data.n2)}</th>
                      <th className="text-right">HH {fmtShort(data.n1)}</th><th className="text-right">ROI {fmtShort(data.n1)}</th>
                      <th className="text-right">HH Hôm Nay</th><th className="text-right">ROI HN</th>
                      <th className="text-right">NS Hôm Nay</th><th className="text-right" style={{ color: '#ff9800', fontWeight: 800 }}>NS Ngày Mai ⚡</th>
                      <th className="text-right">+/−%</th><th>Gợi Ý Nhân</th><th>Lý Do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s4Rows.map((r, i) => {
                      const rowStyle = { ...recBg(r.recommendation, i), opacity: r.status === 'PAUSED' ? 0.6 : 1 };
                      const budgetChange = Number(r.changePct || 0);
                      const changeColor = budgetChange > 0.01 ? '#1b5e20' : budgetChange < -0.01 ? '#b71c1c' : '#888';
                      return (
                        <tr key={`${r.campaignName}-${i}`} style={rowStyle}>
                          <td style={{ fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }} title={r.subId2}>{r.subId2}</td>
                          <td><span className="badge neutral" style={{ fontSize: 10 }}>{r.accountName}</span></td>
                          <td><span className={r.testType === 'CAMP TEST' ? 'badge warning' : 'badge neutral'} style={{ fontSize: 10 }}>{r.testType === 'CAMP TEST' ? 'TEST' : '—'}</span></td>
                          <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }} title={r.campaignName}>{r.campaignName}</td>
                          <td><StatusBadge status={r.status} /></td>
                          <td><span style={recBadgeStyle(r.recommendation)}>{r.recommendation || '—'}</span></td>
                          {/* N-3 */}
                          <td className="text-right mono-sm" style={{ fontSize: 11 }}>{vnd(r.histN3?.commission)}</td>
                          <td className="text-right" style={{ fontSize: 11 }}><ROICell value={r.histN3?.roi} /></td>
                          {/* N-2 */}
                          <td className="text-right mono-sm" style={{ fontSize: 11 }}>{vnd(r.histN2?.commission)}</td>
                          <td className="text-right" style={{ fontSize: 11 }}><ROICell value={r.histN2?.roi} /></td>
                          {/* N-1 */}
                          <td className="text-right mono-sm" style={{ fontSize: 11 }}>{vnd(r.histN1?.commission)}</td>
                          <td className="text-right" style={{ fontSize: 11 }}><ROICell value={r.histN1?.roi} /></td>
                          {/* Today */}
                          <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{vnd(r.commission)}</td>
                          <td className="text-right"><ROICell value={r.todayRoi} /></td>
                          {/* Budget */}
                          <td className="text-right mono-sm">{vnd(r.campBudget)}</td>
                          <td className="text-right mono-sm" style={{ color: '#ff9800', fontWeight: 700, fontSize: 13 }}>
                            {r.recommendation?.includes('TẮT') ? <span style={{ color: '#b71c1c' }}>0 ₫</span> : vnd(r.tomorrow)}
                          </td>
                          <td className="text-right" style={{ color: changeColor, fontWeight: 600 }}>{pct(r.changePct)}</td>
                          <td style={{ maxWidth: 160, fontSize: 11, color: r.dupSuggestion ? '#1565c0' : 'var(--muted2)', fontWeight: r.dupSuggestion ? 700 : 400 }}>
                            {r.dupSuggestion || '—'}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--muted2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.budgetReason}>
                            {r.budgetReason || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {s4Totals && (
                    <tfoot>
                      <tr style={{ background: '#ffd700', color: '#000', fontWeight: 800 }}>
                        <td colSpan={14} style={{ textAlign: 'right', fontWeight: 800 }}>TỔNG NS</td>
                        <td className="text-right">{vnd(s4Totals.budgetToday)}</td>
                        <td className="text-right" style={{ color: '#e65100', fontSize: 14 }}>{vnd(s4Totals.budgetTomorrow)}</td>
                        <td className="text-right">
                          {s4Totals.budgetToday > 0 ? pct((s4Totals.budgetTomorrow - s4Totals.budgetToday) / s4Totals.budgetToday) : '—'}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {s4Rows.length === 0 && <div className="empty"><div className="ei">0</div><p>Không có dữ liệu</p></div>}
            </div>
          </div>

          {/* ══════════ TAB 5 — TKQC HEALTH ══════════ */}
          <div className={`tab-pane${activeTab === 'health' ? ' active' : ''}`} style={{ padding: 0 }}>
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div className="card-header">
                <div className="card-title">TKQC Health Check — {fmtDate(data.targetDate)}</div>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>TKQC</th>
                      <th className="text-right">Active</th><th className="text-right">Pause</th>
                      <th className="text-right">NS Active</th><th className="text-right">Chi Tiêu</th>
                      <th className="text-right">Hoa Hồng</th><th className="text-right">Lợi Nhuận</th>
                      <th className="text-right">ROI TB</th><th className="text-right">NS/Camp TB</th>
                      <th>Rủi Ro Overlap</th><th>Khuyến Nghị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.sheet5 || []).map((r, i) => (
                      <tr key={r.accountName} style={i % 2 === 0 ? {} : { background: 'rgba(255,255,255,0.025)' }}>
                        <td style={{ fontWeight: 700, fontSize: 15 }}>{r.accountName}</td>
                        <td className="text-right"><span className="badge active">{num(r.activeCnt)}</span></td>
                        <td className="text-right"><span className="badge paused">{num(r.pausedCnt)}</span></td>
                        <td className="text-right mono-sm">{vnd(r.totalBudgetActive)}</td>
                        <td className="text-right mono-sm">{vnd(r.totalSpend)}</td>
                        <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{vnd(r.totalCommission)}</td>
                        <td className="text-right mono-sm" style={{ color: Number(r.profit) >= 0 ? 'var(--g)' : '#ef5350', fontWeight: 600 }}>{vnd(r.profit)}</td>
                        <td className="text-right"><ROICell value={r.roi} /></td>
                        <td className="text-right mono-sm">{vnd(r.avgBudgetPerCamp)}</td>
                        <td><span style={riskStyle(r.risk)}>{r.risk}</span></td>
                        <td style={{ fontSize: 12, maxWidth: 260, lineHeight: 1.5, color: 'var(--muted2)' }}>{r.recText}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#ffd700', color: '#000', fontWeight: 800 }}>
                      <td>TỔNG</td>
                      <td className="text-right">{num((data.sheet5 || []).reduce((s, r) => s + r.activeCnt, 0))}</td>
                      <td className="text-right">{num((data.sheet5 || []).reduce((s, r) => s + r.pausedCnt, 0))}</td>
                      <td className="text-right">{vnd((data.sheet5 || []).reduce((s, r) => s + r.totalBudgetActive, 0))}</td>
                      <td className="text-right">{vnd((data.sheet5 || []).reduce((s, r) => s + r.totalSpend, 0))}</td>
                      <td className="text-right">{vnd((data.sheet5 || []).reduce((s, r) => s + r.totalCommission, 0))}</td>
                      <td className="text-right">{vnd((data.sheet5 || []).reduce((s, r) => s + r.profit, 0))}</td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Strategic analysis */}
              <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--txt)' }}>📋 Phân Tích Chiến Lược Điều Phối Ngân Sách</div>
                {(() => {
                  const rows     = data.sheet5 || [];
                  const totSpend = rows.reduce((s, r) => s + r.totalSpend, 0);
                  const totComm  = rows.reduce((s, r) => s + r.totalCommission, 0);
                  const totActive= rows.reduce((s, r) => s + r.activeCnt, 0);
                  const totBudget= rows.reduce((s, r) => s + r.totalBudgetActive, 0);
                  const roi      = totSpend > 0 ? (totComm - totSpend) / totSpend * 100 : 0;
                  const canReceive = rows.filter(r => r.activeCnt <= 30).map(r => r.accountName);
                  const overloaded = rows.filter(r => r.activeCnt > 60).map(r => r.accountName);
                  return (
                    <div style={{ fontSize: 13, lineHeight: 2, color: 'var(--muted2)' }}>
                      <div>📊 Tổng quan: <b style={{ color: 'var(--txt)' }}>{totActive} camp active</b> trên <b style={{ color: 'var(--txt)' }}>{rows.length} tài khoản</b></div>
                      <div>💰 Chi tiêu: <b>{vnd(totSpend)}</b> | Hoa hồng: <b style={{ color: 'var(--g)' }}>{vnd(totComm)}</b> | ROI: <b style={{ color: roi >= 0 ? 'var(--g)' : '#ef5350' }}>{roi.toFixed(0)}%</b></div>
                      <div>🎯 Lợi nhuận: <b style={{ color: totComm - totSpend >= 0 ? 'var(--g)' : '#ef5350' }}>{vnd(totComm - totSpend)}</b> | NS Active: <b>{vnd(totBudget)}</b></div>
                      {overloaded.length > 0 && <div>⚠️ TK tải cao (không scale): <b style={{ color: '#ef5350' }}>{overloaded.join(', ')}</b></div>}
                      {canReceive.length > 0 && <div>✅ TK có thể nhận camp thêm: <b style={{ color: 'var(--g)' }}>{canReceive.join(', ')}</b></div>}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
