import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, todayString } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { loadXlsx } from '../utils/loadXlsx';

// Mac dinh 5 tuan thuc te gan nhat: tu Thu 2 cua 4 tuan truoc den hom nay
function defaultFromDate() {
  const today = new Date(`${todayString()}T00:00:00Z`);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - (daysSinceMonday + 28) * 86400000).toISOString().slice(0, 10);
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

const RISK_LABELS = { low: 'Thap', mid: 'Trung binh', high: 'Cao' };

// Chi so ma moi cua 1 tuan: ty le don tu ma moi, ty le ma moi ra don, don tren moi ma moi trung
function newCodeMetrics(cell) {
  if (!cell) return null;
  const newCodeOrders = cell.newCodeOrders || 0;
  return {
    newCodes: cell.newCodes || 0,
    newOrderShare: cell.orders > 0 ? (newCodeOrders / cell.orders) * 100 : null,
    hitRate: cell.newCodes > 0 ? (cell.newCodesWithOrders / cell.newCodes) * 100 : null,
    ordersPerHit: cell.newCodesWithOrders > 0 ? newCodeOrders / cell.newCodesWithOrders : null
  };
}

// Chenh lech so tuan truoc: kind 'pct' = diem %, 'count' = so ma, 'ratio' = so thap phan
function MetricDelta({ current, previous, kind }) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return <span className="listing-mini-delta" />;
  }
  const diff = current - previous;
  const rounded = kind === 'count' ? Math.round(diff) : Math.round(diff * 100) / 100;
  if (!rounded) return <span className="listing-mini-delta flat">=</span>;
  const abs = Math.abs(rounded);
  const text = kind === 'pct'
    ? `${abs.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
    : kind === 'count'
      ? `${formatNumber(abs)} ma`
      : abs.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  return <span className={`listing-mini-delta ${rounded > 0 ? 'up' : 'down'}`}>{rounded > 0 ? '▲' : '▼'}{text}</span>;
}

function PersonTile({ title, letter, cells, weeks, isTotal = false }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const values = cells.map(cell => cell.orders);
  // Doi khoang ngay (it tuan hon) ma chuot dang re o tuan cu -> hoverIndex vuot so tuan, phai kep lai neu khong trang trang
  const safeHover = hoverIndex !== null && hoverIndex < values.length ? hoverIndex : null;
  const focusIndex = safeHover ?? values.length - 1;
  const focus = cells[focusIndex];
  const delta = focusIndex > 0 ? formatDelta(values[focusIndex], values[focusIndex - 1]) : null;
  const risk = riskLevel(focus?.top1Share);
  const metrics = newCodeMetrics(focus);
  const prevMetrics = focusIndex > 0 ? newCodeMetrics(cells[focusIndex - 1]) : null;
  const ratio = value => (value === null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));

  if (!focus || !weeks[focusIndex]) return null;

  return (
    <div className={`listing-tile ${isTotal ? 'is-total' : ''}`}>
      <div className="listing-tile-head">
        <div className="listing-name">
          {title}
          {letter && <span className="listing-letter">{letter}</span>}
        </div>
        <span className="listing-tile-when">{weeks[focusIndex].key} · {weeks[focusIndex].label}</span>
      </div>
      <div className="listing-tile-label">Tong don tuan</div>
      <div className="listing-tile-meta">
        <span className="listing-tile-value">{formatNumber(focus.orders)}</span>
        {delta !== null && (
          <span className={`listing-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? '▲' : '▼'} {formatPct(Math.abs(delta))} <span className="listing-delta-note">so tuan truoc</span>
          </span>
        )}
      </div>
      <TileChart values={values} weeks={weeks} hoverIndex={safeHover} onHover={setHoverIndex} />
      <div className="listing-tile-stats">
        <div>
          <span>Ty le don moi</span>
          <b>{formatPct(metrics.newOrderShare)}</b>
          <MetricDelta current={metrics.newOrderShare} previous={prevMetrics?.newOrderShare} kind="pct" />
        </div>
        <div>
          <span>Ma moi dang</span>
          <b>{formatNumber(metrics.newCodes)}</b>
          <MetricDelta current={metrics.newCodes} previous={prevMetrics?.newCodes} kind="count" />
        </div>
        <div>
          <span>Ty le ma moi ra don</span>
          <b>{formatPct(metrics.hitRate)}</b>
          <MetricDelta current={metrics.hitRate} previous={prevMetrics?.hitRate} kind="pct" />
        </div>
        <div>
          <span>Don/ma moi trung</span>
          <b>{ratio(metrics.ordersPerHit)}</b>
          <MetricDelta current={metrics.ordersPerHit} previous={prevMetrics?.ordersPerHit} kind="ratio" />
        </div>
      </div>
      {focus.top1Share !== null && focus.top1Share !== undefined && (
        <div className="listing-tile-foot">
          <span className={`listing-risk ${risk}`}>Top1 share: {formatPct(focus.top1Share)} · {RISK_LABELS[risk]}</span>
        </div>
      )}
    </div>
  );
}

// Bang so ma dang moi tuan cua tung nguoi (ngay dang lay tu file ma / upload ma moi)
function NewCodeTable({ rows, weeks, totalCells }) {
  const lastIndex = weeks.length - 1;
  const sumOf = cells => cells.reduce((sum, cell) => sum + cell.newCodes, 0);
  const tableRows = rows
    .map(row => ({ ...row, total: sumOf(row.weeks) }))
    .filter(row => row.total > 0)
    .sort((a, b) => (b.weeks[lastIndex].newCodes - a.weeks[lastIndex].newCodes) || (b.total - a.total));
  const grandTotal = sumOf(totalCells);

  if (!tableRows.length) {
    return <p className="listing-note">Chua co ma dang nao trong khoang nay. Bam "Dong bo file ma" de doc file ma cua moi nguoi.</p>;
  }

  return (
    <div className="tbl-wrap">
      <table className="tbl listing-table">
        <thead>
          <tr>
            <th>Nguoi</th>
            {weeks.map((week, index) => (
              <th key={week.key} className={index === lastIndex ? 'listing-last' : ''}>
                {week.key}<div className="listing-week-label">{week.label}</div>
              </th>
            ))}
            <th>Tong</th>
            <th>TB/tuan</th>
            <th>Ra don</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map(row => {
            const withOrders = row.weeks.reduce((sum, cell) => sum + cell.newCodesWithOrders, 0);
            return (
              <tr key={row.key}>
                <td><div className="listing-name">{row.name}<span className="listing-letter">{row.letter}</span></div></td>
                {row.weeks.map((cell, index) => (
                  <td key={weeks[index].key} className={`listing-num ${index === lastIndex ? 'listing-last' : ''}`}>
                    {cell.newCodes ? formatNumber(cell.newCodes) : '—'}
                  </td>
                ))}
                <td className="listing-num"><b>{formatNumber(row.total)}</b></td>
                <td className="listing-num">{formatNumber(Math.round((row.total / weeks.length) * 10) / 10)}</td>
                <td className="listing-num">{formatPct((withOrders / row.total) * 100)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td><b>Toan shop</b></td>
            {totalCells.map((cell, index) => (
              <td key={weeks[index].key} className={`listing-num ${index === lastIndex ? 'listing-last' : ''}`}>
                <b>{formatNumber(cell.newCodes)}</b>
              </td>
            ))}
            <td className="listing-num"><b>{formatNumber(grandTotal)}</b></td>
            <td className="listing-num">{formatNumber(Math.round((grandTotal / weeks.length) * 10) / 10)}</td>
            <td className="listing-num">
              {grandTotal ? formatPct((totalCells.reduce((sum, cell) => sum + cell.newCodesWithOrders, 0) / grandTotal) * 100) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
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
  const [syncingSheet, setSyncingSheet] = useState(false);
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

  const syncSheet = async () => {
    setSyncingSheet(true);
    try {
      const result = await api('POST', '/listing/sync-sheet');
      const tabCount = result.tabs?.length || 0;
      toast.success(
        `Da doc ${formatNumber(result.saved)} ma tu ${formatNumber(tabCount)} tab (${formatNumber(result.inserted)} ma moi`
        + (result.updated ? `, ${formatNumber(result.updated)} ma doi ngay)` : ')')
        + (result.fromCode ? ` · ${formatNumber(result.fromCode)} ma lay ngay tu ma` : '')
      );
      loadReport();
    } catch (error) {
      toast.error(`Loi dong bo file ma: ${error.message}`);
    } finally {
      setSyncingSheet(false);
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
        newCodesWithOrders: cells.reduce((sum, cell) => sum + cell.newCodesWithOrders, 0),
        newCodeOrders: cells.reduce((sum, cell) => sum + (cell.newCodeOrders || 0), 0)
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
            {report && <span className="listing-tile-when">{report.weeks.length} tuan · Thu 2 → CN</span>}
            <button className="btn btn-ghost btn-sm" onClick={loadReport} disabled={loading}>Tai lai</button>
            <button className="btn btn-ghost btn-sm" onClick={syncSheet} disabled={syncingSheet}>
              {syncingSheet ? 'Dang doc file ma...' : 'Dong bo file ma'}
            </button>
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
          Ty le don moi = % don den tu ma dang trong chinh tuan do · Ty le ma moi ra don = % ma moi co it nhat 1 don trong tuan dang ·
          Don/ma moi trung = so don tu ma moi chia so ma moi co don. Mui ten = so voi tuan truoc (voi ty le la chenh lech diem %).
        </p>
      </div>

      {report && rows.length > 0 && (
        <div className="card">
          <div className="card-header listing-toolbar">
            <div className="card-title">So ma dang moi tuan</div>
            {report.codeSheetSync?.at && (
              <span className="listing-tile-when">
                Dong bo file ma luc {new Date(report.codeSheetSync.at).toLocaleString('vi-VN')}
                {report.codeSheetSync.tabCount ? ` · ${report.codeSheetSync.tabCount} tab` : ''}
              </span>
            )}
          </div>
          <NewCodeTable rows={rows} weeks={weeks} totalCells={totalCells} />
          <p className="listing-note">
            Ma dang = ma co ngay dang trong tuan (Thu 2 → CN), gom theo chu cai dau ma. Khong co cot ngay thi lay ngay tu ma (vd DH<b>2608</b>478 = 26/08).
            Ra don = % ma dang co it nhat 1 don ngay trong tuan dang.
          </p>
        </div>
      )}
    </div>
  );
}
