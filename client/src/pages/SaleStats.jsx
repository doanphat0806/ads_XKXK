import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react';
import { api, formatNumber, todayString } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { useAppContext } from '../contexts/AppContext';

const HIDDEN_COLUMNS_KEY = 'adsctrl-sale-stats-hidden-columns';

const BASE_COLUMNS = [
  { key: 'commentInbox', label: 'T.nhắn từ b.luận' },
  { key: 'comments', label: 'Bình luận' },
  { key: 'commentSessions', label: 'Phiên tr.lời b.luận' },
  { key: 'messages', label: 'Tin nhắn' },
  { key: 'inboxSessions', label: 'Phiên t.lời t.nhắn' },
  { key: 'avgResponseSeconds', label: 'Th.gian ph.hồi TB', format: 'duration', lowerIsBetter: true },
  { key: 'phones', label: 'SĐT mang về' },
  { key: 'orders', label: 'Số đơn chốt' }
];

// "48487" giay -> "13h 28m 7s"
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.round(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatCell(value, format) {
  if (value === null || value === undefined) return '—';
  if (format === 'duration') return formatDuration(value);
  if (format === 'pct') return `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
  return formatNumber(value);
}

function readHiddenColumns() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeHiddenColumns(keys) {
  try {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(keys));
  } catch {
    // bo qua: trinh duyet chan localStorage
  }
}

function getValue(row, key) {
  return row[key] ?? null;
}

// Chon nhan vien nao la sale (chi hien nguoi da chon). Danh sach lay tu nhan vien co hoat dong trong khoang dang xem.
function SaleStaffPicker({ report, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(report?.staffIds || []));
  const [saving, setSaving] = useState(false);
  const staff = report?.allStaff || [];

  const toggle = id => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await api('PUT', '/sale-stats/sale-staff', { staffIds: [...selected] });
      toast.success(selected.size ? `Da luu ${selected.size} nhan vien sale` : 'Da bo loc: hien tat ca nhan vien');
      onSaved();
    } catch (error) {
      toast.error(`Loi luu nhan vien sale: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sale-settings">
      <p className="listing-note">Nhan vien sale (chi hien nguoi duoc chon; bo chon het = hien tat ca):</p>
      <div className="sale-columns">
        {staff.map(item => (
          <label key={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
            {item.name || item.id}
          </label>
        ))}
      </div>
      <div className="sale-settings-actions">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Dang luu...' : 'Luu nhan vien sale'}</button>
      </div>
    </div>
  );
}

function PageSettings({ onSaved }) {
  const [pages, setPages] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('GET', '/sale-stats/pages')
      .then(data => setPages((data.pages || []).map(page => ({ ...page, accessToken: '' }))))
      .catch(error => toast.error(`Loi tai danh sach page: ${error.message}`));
  }, []);

  const updatePage = (index, patch) => setPages(prev => prev.map((page, i) => (i === index ? { ...page, ...patch } : page)));

  const save = async () => {
    setSaving(true);
    try {
      const data = await api('PUT', '/sale-stats/pages', { pages });
      setPages((data.pages || []).map(page => ({ ...page, accessToken: '' })));
      toast.success('Da luu page Pancake');
      onSaved();
    } catch (error) {
      toast.error(`Loi luu page: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sale-settings">
      <p className="listing-note">
        Lay page access token trong Pancake: Cai dat page &gt; Cong cu &gt; API (token khong het han, tao lai thi token cu mat hieu luc).
        De trong o token = giu token da luu.
      </p>
      {pages.map((page, index) => (
        <div key={index} className="sale-settings-row">
          <input value={page.name} onChange={event => updatePage(index, { name: event.target.value })} placeholder="Ten page" />
          <input value={page.pageId} onChange={event => updatePage(index, { pageId: event.target.value.trim() })} placeholder="Page ID" />
          <input
            type="password"
            value={page.accessToken}
            onChange={event => updatePage(index, { accessToken: event.target.value })}
            placeholder={page.hasToken ? `Da luu token ${page.tokenHint}` : 'Page access token'}
            autoComplete="off"
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setPages(prev => prev.filter((_, i) => i !== index))}>Xoa</button>
        </div>
      ))}
      <div className="sale-settings-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setPages(prev => [...prev, { name: '', pageId: '', accessToken: '' }])}>
          + Them page
        </button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Dang luu...' : 'Luu'}</button>
      </div>
    </div>
  );
}

export default function SaleStats() {
  const { currentUser } = useAppContext();
  const isAdmin = currentUser?.username === 'admin';
  const [fromDate, setFromDate] = useState(todayString());
  const [toDate, setToDate] = useState(todayString());
  const [pageId, setPageId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState({ key: 'orders', dir: 'desc' });
  const [hiddenColumns, setHiddenColumns] = useState(readHiddenColumns);
  const [showColumns, setShowColumns] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [debug, setDebug] = useState(false);

  // fresh: bo cache 5 phut tren server, lay lai tu Pancake
  const loadReport = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (pageId) params.set('pageId', pageId);
      if (debug) params.set('debug', '1');
      if (fresh) params.set('fresh', '1');
      const data = await api('GET', `/sale-stats/staff?${params}`);
      setReport(data);
      const errors = data.errors || [];
      if (errors.length) {
        toast.error(`${errors.length} page loi: ${errors.slice(0, 3).map(item => `${item.name} (${item.error})`).join(', ')}${errors.length > 3 ? '...' : ''}`);
      }
    } catch (error) {
      toast.error(`Loi tai thong ke sale: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, pageId, debug]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const allColumns = BASE_COLUMNS;
  const visibleColumns = allColumns.filter(column => !hiddenColumns.includes(column.key));

  const rows = useMemo(() => {
    const list = [...(report?.rows || [])];
    const factor = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (sort.key === 'name') return factor * a.name.localeCompare(b.name, 'vi');
      const va = getValue(a, sort.key);
      const vb = getValue(b, sort.key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return factor * (va - vb);
    });
  }, [report, sort]);

  const toggleSort = key => {
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  };

  const toggleColumn = key => {
    setHiddenColumns(prev => {
      const next = prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key];
      writeHiddenColumns(next);
      return next;
    });
  };

  const sortIcon = key => {
    if (sort.key !== key) return null;
    return sort.dir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />;
  };

  return (
    <div id="page-sale-stats">
      <div className="card">
        <div className="card-header sale-toolbar">
          <div>
            <div className="card-title">Thong ke chi tiet</div>
            <div className="listing-note sale-subtitle">Hoi thoai tu Pancake Pages · So don chot tu don POS (nhan vien chot don)</div>
          </div>
          <div className="listing-controls">
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onChange={(from, to) => {
                setFromDate(from);
                setToDate(to);
              }}
            />
            <select className="sale-select" value={pageId} onChange={event => setPageId(event.target.value)}>
              <option value="">Tat ca page</option>
              {(report?.pages || []).map(page => <option key={page.pageId} value={page.pageId}>{page.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowColumns(prev => !prev)}>
              <Columns3 size={14} /> Tuy chinh
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => loadReport(true)} disabled={loading}>{loading ? 'Dang tai...' : 'Tai lai'}</button>
            {isAdmin && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(prev => !prev)}>
                {showSettings ? 'Dong cai dat' : 'Cai dat page'}
              </button>
            )}
          </div>
        </div>

        {showSettings && isAdmin && (
          <>
            <PageSettings onSaved={() => loadReport(true)} />
            <SaleStaffPicker report={report} onSaved={() => loadReport()} />
          </>
        )}

        {showColumns && (
          <div className="sale-columns">
            {allColumns.map(column => (
              <label key={column.key}>
                <input type="checkbox" checked={!hiddenColumns.includes(column.key)} onChange={() => toggleColumn(column.key)} />
                {column.label}
              </label>
            ))}
          </div>
        )}

        {report?.posOrdersWithoutSeller > 0 && (
          <p className="listing-note sale-warning">
            {formatNumber(report.posOrdersWithoutSeller)}/{formatNumber(report.posOrdersTotal)} don POS trong khoang nay chua co nhan vien chot
            (don luu truoc khi them truong) nen chua tinh vao "So don chot". Chay: node scripts/backfillPosSeller.js [so_ngay]
          </p>
        )}

        <div className="tbl-wrap sale-table-wrap">
          {loading && !report ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai tu Pancake...</p></div>
          ) : report?.needsSetup ? (
            <div className="empty">
              <div className="ei">!</div>
              <p>{isAdmin ? 'Chua cau hinh page Pancake. Bam "Cai dat page" de them page ID va page access token.' : 'Admin chua cau hinh page Pancake.'}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Khong co du lieu nhan vien trong khoang nay</p></div>
          ) : (
            <table className="tbl sale-table">
              <thead>
                <tr>
                  <th className="sale-sticky" onClick={() => toggleSort('name')}>
                    <span className="sale-th">Nhân viên {sortIcon('name')}</span>
                  </th>
                  {visibleColumns.map(column => (
                    <th key={column.key} onClick={() => toggleSort(column.key)} className={sort.key === column.key ? 'is-sorted' : ''}>
                      <span className="sale-th">{column.label} {sortIcon(column.key)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id || row.name}>
                    <td className="sale-sticky">
                      <div className="sale-user" title={row.pages.join(', ')}>
                        {row.avatar
                          ? <img src={row.avatar} alt="" className="sale-avatar" loading="lazy" referrerPolicy="no-referrer" />
                          : <span className="sale-avatar sale-avatar-empty">{(row.name || '?').charAt(0)}</span>}
                        <span className="sale-user-name">{row.name || row.id || '(khong ten)'}</span>
                      </div>
                    </td>
                    {visibleColumns.map(column => (
                      <td key={column.key} className={`listing-num ${sort.key === column.key ? 'is-sorted' : ''}`}>
                        {formatCell(getValue(row, column.key), column.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {isAdmin && (
          <details className="sale-debug" onToggle={event => setDebug(event.currentTarget.open)}>
            <summary>Du lieu tho tu Pancake (doi chieu ten cot)</summary>
            {report?.rawSample
              ? <pre>{JSON.stringify(report.rawSample, null, 2).slice(0, 20000)}</pre>
              : <p className="listing-note">Dang tai...</p>}
          </details>
        )}
      </div>
    </div>
  );
}
