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
  { key: 'orders', label: 'Số đơn chốt' },
  { key: 'ordersSale', label: 'Đơn Sale' },
  { key: 'ordersSan', label: 'Đơn Sẵn' },
  { key: 'ordersOrder', label: 'Đơn Order' },
  { key: 'shifts', label: 'Số ca (theo lịch)' },
  { key: 'ordersPerShift', label: 'Đơn/ca', format: 'decimal' }
];

const WEEKDAY_SHORT_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const SHIFT_GROUPS = [
  { key: 'morning', label: 'CA SÁNG' },
  { key: 'noon', label: 'CA TRƯA' },
  { key: 'evening', label: 'CA TỐI' }
];

// Xep khung gio vao ca theo gio bat dau: "8h30-13h" -> sang, "12h-16h30" -> trua, "17h30-21h30" -> toi
function getShiftGroup(shift) {
  const hour = Number(String(shift).match(/\d{1,2}/)?.[0] ?? 0);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'noon';
  return 'evening';
}

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
  if (format === 'decimal') return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return formatNumber(value);
}

function addDaysKey(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

// Thu 2 cua tuan chua dateKey
function mondayOf(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return addDaysKey(dateKey, -((weekday + 6) % 7));
}

function formatShortDate(dateKey) {
  const [, m, d] = String(dateKey).split('-');
  return `${d}/${m}`;
}

function normalizeNameKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const SHIFT_LABEL_RE = /^\d{1,2}\s*h?\s*\d{0,2}\s*-\s*\d{1,2}\s*h/i;
const DAY_KEYS = { t2: 0, t3: 1, t4: 2, t5: 3, t6: 4, t7: 5, cn: 6, 'thu 2': 0, 'thu 3': 1, 'thu 4': 2, 'thu 5': 3, 'thu 6': 4, 'thu 7': 5, 'chu nhat': 6 };

// "8- 12h" / "18H- 22H" -> "8-12h" / "18h-22h"
function normalizeShiftLabel(value) {
  return String(value || '').replace(/\s+/g, '').replace(/H/g, 'h');
}

/**
 * Doc bang lich ca copy tu Excel (TSV): dong tieu de co cac khung gio (o gop nhu "8- 12h" trai nhieu cot -> dien tiep sang phai),
 * cac dong ngay bat dau bang T2..T7/CN. Tra { shifts, entries: [{ dayIndex, shift, name }] }.
 */
function parsePastedSchedule(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n').map(line => line.split('\t').map(cell => cell.trim()));
  const headerIndex = rows.findIndex(row => row.filter(cell => SHIFT_LABEL_RE.test(cell)).length >= 2);
  if (headerIndex < 0) throw new Error('Khong thay dong khung gio (vd 8-12h, 8h30-13h). Hay copy ca dong tieu de khung gio.');

  const columnShift = [];
  let current = '';
  rows[headerIndex].forEach((cell, index) => {
    if (SHIFT_LABEL_RE.test(cell)) current = normalizeShiftLabel(cell);
    columnShift[index] = current;
  });
  const shifts = [...new Set(columnShift.filter(Boolean))];

  const entries = [];
  rows.slice(headerIndex + 1).forEach(row => {
    const dayIndex = DAY_KEYS[normalizeNameKey(row[0])];
    if (dayIndex === undefined) return;
    row.forEach((cell, index) => {
      if (index === 0 || !columnShift[index] || !cell) return;
      cell.split(/[,/+;]/).map(name => name.trim()).filter(Boolean)
        .forEach(name => entries.push({ dayIndex, shift: columnShift[index], name }));
    });
  });
  if (!entries.length) throw new Error('Khong thay dong ngay nao (cot dau phai la T2, T3 ... CN).');
  return { shifts, entries };
}

// Ten goi tat -> id: bang ten goi tat da luu, roi ten Pancake trung khop, roi ten Pancake chua dung cum tu do (vd "Thúy" -> "Phan Thanh Thuý")
function resolveStaffName(name, staff, aliases) {
  const key = normalizeNameKey(name);
  if (aliases[key]) return aliases[key];
  const exact = staff.filter(item => normalizeNameKey(item.name) === key);
  if (exact.length === 1) return exact[0].id;
  const partial = staff.filter(item => ` ${normalizeNameKey(item.name)} `.includes(` ${key} `));
  return partial.length === 1 ? partial[0].id : '';
}

// Lich ca theo tuan: moi o = 1 ngay x 1 khung gio, chua cac nhan vien sale lam ca do
function ShiftScheduleEditor({ staff, onSaved }) {
  const [week, setWeek] = useState(() => mondayOf(todayString()));
  const [schedule, setSchedule] = useState(null);
  const [shiftText, setShiftText] = useState('');
  const [saving, setSaving] = useState(false);
  const nameById = useMemo(() => Object.fromEntries(staff.map(item => [item.id, item.name])), [staff]);
  const [showPaste, setShowPaste] = useState(false);
  const [aliases, setAliases] = useState({});
  const [pasted, setPasted] = useState(null);
  const [aliasDraft, setAliasDraft] = useState({});

  useEffect(() => {
    api('GET', '/sale-stats/staff-aliases')
      .then(data => setAliases(data.aliases || {}))
      .catch(() => {});
  }, []);

  // Ap lich vua dan vao tuan dang mo; ten chua ghep duoc thi bo qua cho den khi ghep
  const applyPasted = (parsed, aliasMap) => {
    const unmatched = new Set();
    const days = Array.from({ length: 7 }, () => []);
    for (const entry of parsed.entries) {
      const staffId = resolveStaffName(entry.name, staff, aliasMap);
      if (staffId) days[entry.dayIndex].push({ shift: entry.shift, staffId });
      else unmatched.add(entry.name);
    }
    setSchedule(prev => ({ ...prev, shifts: parsed.shifts, days }));
    setShiftText(parsed.shifts.join(', '));
    setPasted({ ...parsed, unmatched: [...unmatched] });
    const count = days.reduce((sum, day) => sum + day.length, 0);
    if (unmatched.size) toast.warn(`Da dien ${count} ca. ${unmatched.size} ten chua ghep duoc voi nhan vien, chon ben duoi.`);
    else toast.success(`Da dien ${count} ca tu Excel. Kiem tra roi bam "Luu lich ca".`);
  };

  const handlePaste = event => {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    event.preventDefault();
    try {
      applyPasted(parsePastedSchedule(text), aliases);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const saveAliases = async () => {
    const next = { ...aliases };
    Object.entries(aliasDraft).forEach(([name, staffId]) => {
      if (staffId) next[normalizeNameKey(name)] = staffId;
    });
    try {
      const data = await api('PUT', '/sale-stats/staff-aliases', { aliases: next });
      setAliases(data.aliases || next);
      setAliasDraft({});
      if (pasted) applyPasted(pasted, data.aliases || next);
    } catch (error) {
      toast.error(`Loi luu ten goi tat: ${error.message}`);
    }
  };

  const loadWeek = useCallback(async (weekStart, { keepWeek = false } = {}) => {
    try {
      const data = await api('GET', `/sale-stats/shift-schedule?week=${weekStart}`);
      setSchedule(prev => (keepWeek && prev ? { ...data, weekStart: prev.weekStart, own: prev.own, sourceWeek: prev.sourceWeek } : data));
      setShiftText((data.shifts || []).join(', '));
    } catch (error) {
      toast.error(`Loi tai lich ca: ${error.message}`);
    }
  }, []);

  useEffect(() => {
    loadWeek(week);
  }, [week, loadWeek]);

  if (!schedule) return <div className="sale-settings"><p className="listing-note">Dang tai lich ca...</p></div>;

  // Nhom khung gio thanh Ca sang / trua / toi nhu bang Excel cua sale (giu thu tu khung gio da nhap trong moi ca)
  const shiftGroups = SHIFT_GROUPS
    .map(group => ({ ...group, shifts: schedule.shifts.filter(shift => getShiftGroup(shift) === group.key) }))
    .filter(group => group.shifts.length);
  const orderedShifts = shiftGroups.flatMap(group => group.shifts.map(shift => ({ shift, group: group.key })));

  const removeOwnSchedule = async () => {
    try {
      await api('DELETE', `/sale-stats/shift-schedule?week=${week}`);
      toast.success('Da xoa lich rieng cua tuan');
      loadWeek(week);
      onSaved();
    } catch (error) {
      toast.error(`Loi xoa lich: ${error.message}`);
    }
  };

  const applyShiftText = () => {
    const shifts = [...new Set(shiftText.split(',').map(item => item.trim()).filter(Boolean))];
    setSchedule(prev => ({ shifts, days: prev.days.map(day => day.filter(entry => shifts.includes(entry.shift))) }));
  };

  const addEntry = (dayIndex, shift, staffId) => {
    if (!staffId) return;
    setSchedule(prev => ({
      ...prev,
      days: prev.days.map((day, index) => (index === dayIndex ? [...day, { shift, staffId }] : day))
    }));
  };

  const removeEntry = (dayIndex, entryIndex) => {
    setSchedule(prev => ({
      ...prev,
      days: prev.days.map((day, index) => (index === dayIndex ? day.filter((_, i) => i !== entryIndex) : day))
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await api('PUT', '/sale-stats/shift-schedule', { week, shifts: schedule.shifts, days: schedule.days });
      setSchedule(data);
      toast.success(`Da luu lich ca tuan ${formatShortDate(week)}–${formatShortDate(addDaysKey(week, 6))}`);
      onSaved();
    } catch (error) {
      toast.error(`Loi luu lich ca: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sale-settings">
      <p className="listing-note">Moi tuan (Thu 2 → CN) 1 lich ca rieng. Moi o = 1 ca. Don/ca = so don chot ÷ so ca trong khoang ngay dang xem.</p>
      <div className="sale-shift-week">
        <button className="btn btn-ghost btn-sm" onClick={() => setWeek(addDaysKey(week, -7))} aria-label="Tuan truoc">‹</button>
        <strong>Tuan {formatShortDate(week)} – {formatShortDate(addDaysKey(week, 6))}</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeek(addDaysKey(week, 7))} aria-label="Tuan sau">›</button>
        <input type="date" value={week} onChange={event => event.target.value && setWeek(mondayOf(event.target.value))} />
        {schedule.own
          ? <span className="listing-risk low">Da co lich rieng</span>
          : <span className="listing-risk mid">{schedule.sourceWeek ? `Chua co lich rieng – dang dung tam lich tuan ${formatShortDate(schedule.sourceWeek)}` : 'Chua co lich'}</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => loadWeek(addDaysKey(week, -7), { keepWeek: true })}>Chep lich tuan truoc</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setSchedule(prev => ({ ...prev, days: prev.days.map(() => []) }))}>Xoa trang</button>
        {schedule.own && <button className="btn btn-ghost btn-sm" onClick={removeOwnSchedule}>Xoa lich rieng</button>}
      </div>
      <div className="sale-shift-labels">
        <button className="btn btn-primary btn-sm" onClick={() => setShowPaste(prev => !prev)}>
          {showPaste ? 'Dong dan Excel' : 'Dan tu Excel'}
        </button>
      </div>
      {showPaste && (
        <div className="sale-paste">
          <p className="listing-note">
            Trong Excel boi den bang lich (gom dong khung gio 8-12h, 8h30-13h... va cac dong T2 → CN), Ctrl+C,
            roi bam vao o duoi va Ctrl+V. Lich se dien vao tuan {formatShortDate(week)}–{formatShortDate(addDaysKey(week, 6))}, thay lich dang hien.
          </p>
          <textarea className="sale-paste-box" onPaste={handlePaste} placeholder="Bam vao day roi Ctrl+V" value="" readOnly />
          {pasted?.unmatched?.length > 0 && (
            <div className="sale-paste-unmatched">
              <p className="listing-note">Ghep ten trong Excel voi nhan vien (luu lai cho cac lan dan sau):</p>
              {pasted.unmatched.map(name => (
                <label key={name}>
                  <strong>{name}</strong> →
                  <select value={aliasDraft[name] || ''} onChange={event => setAliasDraft(prev => ({ ...prev, [name]: event.target.value }))}>
                    <option value="">Chon nhan vien</option>
                    {staff.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={saveAliases}>Luu ghep ten &amp; dien lai</button>
            </div>
          )}
        </div>
      )}
      <div className="sale-shift-labels">
        <input value={shiftText} onChange={event => setShiftText(event.target.value)} placeholder="Khung gio, cach nhau dau phay" />
        <button className="btn btn-ghost btn-sm" onClick={applyShiftText}>Cap nhat khung gio</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl sale-shift-table">
          <thead>
            <tr>
              <th rowSpan={2} className="sale-shift-day">Thứ</th>
              {shiftGroups.map(group => (
                <th key={group.key} colSpan={group.shifts.length} className={`sale-shift-group is-${group.key}`}>{group.label}</th>
              ))}
            </tr>
            <tr>
              {shiftGroups.flatMap(group => group.shifts.map(shift => (
                <th key={shift} className={`sale-shift-head is-${group.key}`}>{shift}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_SHORT_LABELS.map((label, dayIndex) => (
              <tr key={label}>
                <td className="sale-shift-day"><strong>{label}</strong><div className="listing-week-label">{formatShortDate(addDaysKey(week, dayIndex))}</div></td>
                {orderedShifts.map(({ shift, group }) => (
                  <td key={shift} className={`is-${group}`}>
                    <div className="sale-shift-cell">
                      {(schedule.days[dayIndex] || []).map((entry, entryIndex) => (entry.shift === shift ? (
                        <span key={entryIndex} className="listing-chip sale-shift-chip">
                          {nameById[entry.staffId] || entry.staffId.slice(0, 8)}
                          <button type="button" onClick={() => removeEntry(dayIndex, entryIndex)} aria-label="Xoa">×</button>
                        </span>
                      ) : null))}
                      <select value="" onChange={event => addEntry(dayIndex, shift, event.target.value)}>
                        <option value="">+</option>
                        {staff.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sale-settings-actions">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Dang luu...' : 'Luu lich ca'}</button>
      </div>
    </div>
  );
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
  const [showShifts, setShowShifts] = useState(false);
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
              <button className="btn btn-ghost btn-sm" onClick={() => setShowShifts(prev => !prev)}>
                {showShifts ? 'Dong lich ca' : 'Lich ca'}
              </button>
            )}
            {isAdmin && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(prev => !prev)}>
                {showSettings ? 'Dong cai dat' : 'Cai dat page'}
              </button>
            )}
          </div>
        </div>

        {showShifts && isAdmin && (
          <ShiftScheduleEditor
            staff={(report?.allStaff || []).filter(item => !report?.staffIds?.length || report.staffIds.includes(item.id))}
            onSaved={() => loadReport()}
          />
        )}

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

        {report?.borrowedShiftWeeks?.length > 0 && (
          <p className="listing-note sale-warning">
            Tuan chua co lich ca rieng (So ca / Don/ca dang tinh tam theo lich tuan khac):{' '}
            {report.borrowedShiftWeeks
              .map(item => `${formatShortDate(item.weekStart)}–${formatShortDate(addDaysKey(item.weekStart, 6))} (dung lich ${formatShortDate(item.sourceWeek)})`)
              .join(', ')}
            {isAdmin ? '. Bam "Lich ca" de nhap.' : '.'}
          </p>
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
