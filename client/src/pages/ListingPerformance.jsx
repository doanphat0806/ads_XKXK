import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, todayString } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { loadXlsx } from '../utils/loadXlsx';

// Mac dinh 5 tuan gan nhat (35 ngay, ket thuc hom nay)
function defaultFromDate() {
  return new Date(Date.parse(`${todayString()}T00:00:00Z`) - 34 * 86400000).toISOString().slice(0, 10);
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CODE_RE = /^(MS\s*)?[A-Z]{2}\s*\d{5,}$/i;

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^MS(?=[A-Z]{2}\d)/, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateKey(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// O ngay trong Excel: Date (cellDates), so serial, "dd/mm/yyyy", "yyyy-mm-dd"
function parseDateCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && value > 30000 && value < 70000) {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (match) return toDateKey(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return toDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
  return '';
}

// Khong co cot ngay -> doc ngay tu ma: "DH2608478" = dang ngay 26/08; lay nam gan nhat khong vuot qua hom nay
function dateFromCode(code) {
  const match = code.match(/^[A-Z]{2}(\d{2})(\d{2})/);
  if (!match) return '';
  const today = todayString();
  const year = Number(today.slice(0, 4));
  const thisYear = toDateKey(year, Number(match[2]), Number(match[1]));
  if (thisYear && thisYear <= today) return thisYear;
  return toDateKey(year - 1, Number(match[2]), Number(match[1]));
}

function findHeaderColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    const cells = rows[r].map(cell => String(cell || '').trim().toLowerCase());
    const dateCol = cells.findIndex(cell => /ng[aà]y|date/.test(cell));
    const codeCol = cells.findIndex(cell => /^m[aã]\b|m[aã] (sp|s[aả]n ph[aẩ]m|h[aà]ng)|sku|code/.test(cell));
    if (dateCol >= 0 || codeCol >= 0) return { headerRow: r, dateCol, codeCol };
  }
  return { headerRow: -1, dateCol: -1, codeCol: -1 };
}

async function readNewCodeFile(file) {
  const XLSX = await loadXlsx(file.name);
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const entries = new Map();
  let fromCode = 0;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
    const { headerRow, dateCol, codeCol } = findHeaderColumns(rows);

    rows.forEach((row, index) => {
      if (index === headerRow) return;
      const rawCode = codeCol >= 0 && CODE_RE.test(String(row[codeCol] || '').trim())
        ? row[codeCol]
        : row.find(cell => CODE_RE.test(String(cell || '').trim()));
      if (!rawCode) return;
      const code = normalizeCode(rawCode);
      let postedDate = dateCol >= 0 ? parseDateCell(row[dateCol]) : '';
      if (!postedDate && dateCol < 0) {
        const dateCell = row.find(cell => cell !== rawCode && parseDateCell(cell));
        postedDate = dateCell ? parseDateCell(dateCell) : '';
      }
      if (!postedDate) {
        postedDate = dateFromCode(code);
        if (postedDate) fromCode += 1;
      }
      if (postedDate) entries.set(code, { code, postedDate });
    });
  }

  return { codes: [...entries.values()], fromCode };
}

function formatPct(value, digits = 1) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

function riskLevel(share) {
  if (share === null || share === undefined) return 'none';
  if (share < 15) return 'low';
  if (share <= 25) return 'mid';
  return 'high';
}


function formatDelta(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// Bieu do duong nho cho 1 nguoi, thang do rieng. Re chuot vao diem -> hien so don tuan do.
function TileChart({ values, weeks, hoverIndex, onHover }) {
  const width = 240;
  const height = 92;
  const padX = 14;
  const padTop = 16;
  const padBottom = 18;
  const max = Math.max(...values, 1);
  const plotH = height - padTop - padBottom;
  const step = values.length > 1 ? (width - padX * 2) / (values.length - 1) : 0;
  const hitWidth = Math.max(step, 24);
  const points = values.map((value, index) => [
    values.length > 1 ? padX + index * step : width / 2,
    padTop + plotH - (value / max) * plotH
  ]);
  const showAllLabels = values.length <= 6;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  return (
    <svg
      className="listing-tile-chart"
      viewBox={`0 0 ${width} ${height}`}
      onMouseLeave={() => onHover(null)}
      aria-hidden="true"
    >
      <line className="listing-tile-base" x1={padX} x2={width - padX} y1={padTop + plotH} y2={padTop + plotH} />
      {hoverIndex !== null && (
        <line className="listing-tile-cross" x1={points[hoverIndex][0]} x2={points[hoverIndex][0]} y1={padTop - 4} y2={padTop + plotH} />
      )}
      <path className="listing-tile-line" d={path} />
      {points.map((p, index) => {
        const isLast = index === points.length - 1;
        const showLabel = showAllLabels || isLast || hoverIndex === index;
        return (
          <g key={weeks[index].key}>
            <circle className={`listing-tile-dot ${isLast ? 'last' : ''}`} cx={p[0]} cy={p[1]} r={hoverIndex === index ? 4.5 : 3.5} />
            {showLabel && (
              <text className={`listing-tile-val ${isLast ? 'last' : ''}`} x={p[0]} y={p[1] - 7}>{formatNumber(values[index])}</text>
            )}
            <text className="listing-tile-week" x={p[0]} y={height - 4}>{weeks[index].key}</text>
            <rect
              className="listing-tile-hit"
              x={p[0] - hitWidth / 2}
              y={0}
              width={hitWidth}
              height={height}
              onMouseEnter={() => onHover(index)}
            />
          </g>
        );
      })}
    </svg>
  );
}

function PersonTile({ title, letter, cells, weeks, isTotal = false }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const values = cells.map(cell => cell.orders);
  const focusIndex = hoverIndex ?? values.length - 1;
  const focus = cells[focusIndex];
  const delta = focusIndex > 0 ? formatDelta(values[focusIndex], values[focusIndex - 1]) : null;
  const risk = riskLevel(focus.top1Share);

  return (
    <div className={`listing-tile ${isTotal ? 'is-total' : ''}`}>
      <div className="listing-tile-head">
        <div className="listing-name">
          {title}
          {letter && <span className="listing-letter">{letter}</span>}
        </div>
        <span className="listing-tile-when">{weeks[focusIndex].key} · {weeks[focusIndex].label}</span>
      </div>
      <div className="listing-tile-meta">
        <span className="listing-tile-value">{formatNumber(focus.orders)}</span>
        {delta !== null && (
          <span className={`listing-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? '▲' : '▼'} {formatPct(Math.abs(delta))}
          </span>
        )}
      </div>
      <TileChart values={values} weeks={weeks} hoverIndex={hoverIndex} onHover={setHoverIndex} />
      <div className="listing-tile-foot">
        {focus.top1Share !== null && focus.top1Share !== undefined && (
          <span className={`listing-risk ${risk}`}>Top1 {formatPct(focus.top1Share)}</span>
        )}
        {focus.newCodes > 0 && (
          <span>Ma moi: <b>{formatNumber(focus.newCodesWithOrders)}/{formatNumber(focus.newCodes)}</b> ra don</span>
        )}
      </div>
    </div>
  );
}

// Du ca bang chu cai A-Z, moi chu 1 o (chu cung ten da duoc server gop chung). Sap theo so don tuan cuoi.
function buildDisplayRows(report) {
  if (!report) return [];
  const lastIndex = report.weeks.length - 1;
  return report.rows
    .map(row => ({ ...row, key: row.letter, name: row.name || 'Chua gan ten' }))
    .sort((a, b) => (b.weeks[lastIndex].orders - a.weeks[lastIndex].orders) || a.letter.localeCompare(b.letter));
}

export default function ListingPerformance() {
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(todayString());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const [staffNames, setStaffNames] = useState({});
  const [savingStaff, setSavingStaff] = useState(false);
  const fileInputRef = useRef(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('GET', `/listing/weekly?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`);
      setReport(data);
    } catch (error) {
      toast.error(`Loi tai bang Listing: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const openStaffEditor = async () => {
    if (showStaff) {
      setShowStaff(false);
      return;
    }
    try {
      const data = await api('GET', '/listing/staff');
      setStaffNames(data.staffNames || {});
      setShowStaff(true);
    } catch (error) {
      toast.error(`Loi tai danh sach nhan vien: ${error.message}`);
    }
  };

  const saveStaff = async () => {
    setSavingStaff(true);
    try {
      const fullMap = Object.fromEntries(LETTERS.map(letter => [letter, staffNames[letter] || '']));
      const data = await api('PUT', '/listing/staff', { staffNames: fullMap });
      setStaffNames(data.staffNames || {});
      toast.success('Da luu ten nhan vien');
      setShowStaff(false);
      loadReport();
    } catch (error) {
      toast.error(`Loi luu ten: ${error.message}`);
    } finally {
      setSavingStaff(false);
    }
  };

  const handleUpload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const { codes, fromCode } = await readNewCodeFile(file);
      if (!codes.length) {
        toast.error('Khong tim thay ma moi nao trong file (can cot ma dang MS XX123456 va cot ngay dang)');
        return;
      }
      const result = await api('POST', '/listing/new-codes', { codes });
      toast.success(
        `Da luu ${formatNumber(result.saved)} ma moi (${formatNumber(result.inserted)} ma them moi)`
        + (fromCode ? ` · ${formatNumber(fromCode)} ma lay ngay tu ma` : '')
      );
      loadReport();
    } catch (error) {
      toast.error(`Loi doc file ma moi: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const rows = useMemo(() => buildDisplayRows(report), [report]);
  const weeks = report?.weeks || [];
  const totalCells = useMemo(() => {
    if (!report) return [];
    return report.weeks.map((_, index) => {
      const cells = report.rows.map(row => row.weeks[index]);
      return {
        orders: report.totals[index] || 0,
        top1Share: null,
        newCodes: cells.reduce((sum, cell) => sum + cell.newCodes, 0),
        newCodesWithOrders: cells.reduce((sum, cell) => sum + cell.newCodesWithOrders, 0)
      };
    });
  }, [report]);

  return (
    <div id="page-listing-performance">
      <div className="card">
        <div className="card-header listing-toolbar">
          <div className="card-title">Toan shop — tong don theo tung nguoi</div>
          <div className="listing-controls">
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onChange={(from, to) => {
                setFromDate(from);
                setToDate(to);
              }}
            />
            {report && <span className="listing-tile-when">{report.weeks.length} tuan · tinh nguoc 7 ngay tu ngay cuoi</span>}
            <button className="btn btn-ghost btn-sm" onClick={loadReport} disabled={loading}>Tai lai</button>
            <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Dang doc file...' : 'Upload ma moi'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={openStaffEditor}>
              {showStaff ? 'Dong sua ten' : 'Sua ten'}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleUpload} />
          </div>
        </div>

        {showStaff && (
          <div className="listing-staff">
            <p className="listing-note">Moi chu cai dau ma (sau "MS") la 1 nguoi. Dat cung ten = gop chung 1 o (vd T va Z cung "Hiếu"). De trong = hien "Chua gan ten".</p>
            <div className="listing-staff-grid">
              {LETTERS.map(letter => (
                <label key={letter} className="listing-staff-item">
                  <span className="listing-letter">{letter}</span>
                  <input
                    value={staffNames[letter] || ''}
                    onChange={event => setStaffNames(prev => ({ ...prev, [letter]: event.target.value }))}
                    placeholder="Chua gan ten"
                  />
                </label>
              ))}
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveStaff} disabled={savingStaff}>
              {savingStaff ? 'Dang luu...' : 'Luu ten'}
            </button>
          </div>
        )}

        {loading && !report ? (
          <div className="empty"><span className="spin">...</span><p>Dang tinh bieu do Listing...</p></div>
        ) : rows.length === 0 ? (
          <div className="empty"><div className="ei">0</div><p>Khong co don trong khoang nay</p></div>
        ) : (
          <div className="listing-grid">
            <PersonTile title="Toan shop" cells={totalCells} weeks={weeks} isTotal />
            {rows.map(row => (
              <PersonTile key={row.key} title={row.name} letter={row.letter} cells={row.weeks} weeks={weeks} />
            ))}
          </div>
        )}
        <p className="listing-note">
          Moi o 1 nguoi, thang do rieng, sap xep theo so don tuan cuoi. Re chuot vao diem de xem so lieu tuan do.
          Don = so dong ma san pham trong don (1 ma tinh 1 lan/don), gom theo chu cai dau ma sau "MS". Don huy/xoa khong tinh.
          Top1 share = % don den tu 1 ma ban chay nhat · &lt;15% thap · 15–25% trung binh · &gt;25% cao.
        </p>
      </div>
    </div>
  );
}
