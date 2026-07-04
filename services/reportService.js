'use strict';

const ExcelJS = require('exceljs');
const Campaign = require('../models/Campaign');
const ShopeeCommission = require('../models/ShopeeCommission');
const ShopeeCommissionOrder = require('../models/ShopeeCommissionOrder');
const Account = require('../models/Account');
const ShopeeAffAccount = require('../models/ShopeeAffAccount');
const { normalizeCsvHeader, parseCsvNumber } = require('../utils/csvImport');

// ============================================================
// STYLE CONSTANTS
// ============================================================

const C = {
  HEADER_BG:    'FF2E75B6',
  HEADER_FG:    'FFFFFFFF',
  TITLE_BG:     'FF1F4E79',
  TITLE_FG:     'FFFFFFFF',
  TOTAL_BG:     'FFFFD700',
  TOTAL_FG:     'FF000000',
  WHITE:        'FFFFFFFF',
  BLACK:        'FF000000',
  GRAY:         'FF808080',
  RED_LIGHT:    'FFFFD9D9',
  RED_FONT:     'FF9E0000',
  GREEN_LIGHT:  'FFE2EFDA',
  YELLOW_LIGHT: 'FFFFF2CC',
  ORANGE_LIGHT: 'FFFFE0B2',
  RED_ORANGE:   'FFFFCCBC',
  BLUE_LIGHT:   'FFEBF3FB',
  BANNER_BG:    'FFFF9800',
  BANNER_FG:    'FFFFFFFF',
};

const FMT = {
  CURRENCY: '#,##0 "₫"',
  PCT:      '0%',
  PCT1:     '0.0%',
  NUMBER:   '#,##0',
};

// ============================================================
// SALE CALENDAR
// ============================================================

function getSaleDates(year) {
  const out = [];
  // SMALL: 15 & 25 each month
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    out.push({ type: 'SMALL', date: `${year}-${mm}-15` });
    out.push({ type: 'SMALL', date: `${year}-${mm}-25` });
  }
  // MEDIUM: 1st each month
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    out.push({ type: 'MEDIUM', date: `${year}-${mm}-01` });
  }
  // BIG: 6/6, 7/7, 8/8, 9/9, 10/10
  for (const [mo, da] of [['06','06'],['07','07'],['08','08'],['09','09'],['10','10']]) {
    out.push({ type: 'BIG', date: `${year}-${mo}-${da}` });
  }
  // MEGA: 11/11, 12/12
  for (const [mo, da] of [['11','11'],['12','12']]) {
    out.push({ type: 'MEGA', date: `${year}-${mo}-${da}` });
  }
  return out;
}

const SALE_WINDOWS = { SMALL: [-3, 2], MEDIUM: [-5, 3], BIG: [-7, 4], MEGA: [-10, 5] };

const K_SALE_TABLE = {
  SMALL:  { '-3':1.20, '-2':1.25, '-1':1.30, '0':1.00, '1':0.80, '2':1.00 },
  MEDIUM: { '-5':1.20, '-4':1.20, '-3':1.25, '-2':1.25, '-1':1.30, '0':1.00, '1':0.75, '2':0.85, '3':1.00 },
  BIG:    { '-7':1.20, '-6':1.20, '-5':1.20, '-4':1.20, '-3':1.25, '-2':1.30, '-1':1.50, '0':1.00, '1':0.70, '2':0.80, '3':0.90, '4':1.00 },
  MEGA:   { '-10':1.20,'-9':1.20,'-8':1.20,'-7':1.20,'-6':1.20, '-5':1.27,'-4':1.27,'-3':1.27, '-2':1.30,'-1':1.50,'0':1.00,'1':0.65,'2':0.75,'3':0.85,'4':0.92,'5':1.00 },
};

const PRIORITY = { MEGA: 4, BIG: 3, MEDIUM: 2, SMALL: 1 };

function getSaleContext(dateStr) {
  const ts = new Date(`${dateStr}T00:00:00Z`).getTime();
  const year = new Date(`${dateStr}T00:00:00Z`).getUTCFullYear();
  const saleDates = [
    ...getSaleDates(year - 1),
    ...getSaleDates(year),
    ...getSaleDates(year + 1),
  ];
  let best = null;
  for (const sale of saleDates) {
    const diff = Math.round((ts - new Date(`${sale.date}T00:00:00Z`).getTime()) / 86400000);
    const [min, max] = SALE_WINDOWS[sale.type];
    if (diff >= min && diff <= max) {
      if (!best || PRIORITY[sale.type] > PRIORITY[best.saleType]) {
        best = { saleType: sale.type, saleDate: sale.date, tOffset: diff };
      }
    }
  }
  return best;
}

function getKSale(dateStr) {
  const ctx = getSaleContext(dateStr);
  if (!ctx) return { k: 1.00, label: '', context: null };
  const table = K_SALE_TABLE[ctx.saleType];
  const k = table[String(ctx.tOffset)] ?? 1.00;
  let label = '';
  if (ctx.tOffset < 0)      label = `🟠 PRE_SALE (${ctx.saleType} T${ctx.tOffset})`;
  else if (ctx.tOffset === 0) label = `🎯 SALE_DAY (${ctx.saleType})`;
  else                       label = `POST_SALE (${ctx.saleType} T+${ctx.tOffset})`;
  return { k, label, context: ctx };
}

function buildSaleBannerMessage(tomorrowDate) {
  const ctx = getSaleContext(tomorrowDate);
  const [yr, mm, dd] = tomorrowDate.split('-');
  const dateLabel = `${dd}/${mm}/${yr}`;
  if (!ctx) {
    return `📅 Ngày mai (${dateLabel}): Ngày bình thường — Áp dụng Cap tiêu chuẩn 250,000 ₫/camp`;
  }
  const { saleType, tOffset } = ctx;
  const isBigOrMega = saleType === 'BIG' || saleType === 'MEGA';
  if (tOffset === 0) {
    return `🎯 Ngày mai (${dateLabel}): NGÀY SALE ${saleType} — Giữ nguyên NS hôm nay, không điều chỉnh`;
  }
  if (tOffset < 0) {
    const noRateLimit = isBigOrMega && tOffset === -1;
    const noCap = isBigOrMega && (tOffset === -1 || tOffset === -2);
    const pct = Math.round((K_SALE_TABLE[saleType][String(tOffset)] - 1) * 100);
    let msg = `🔔 Ngày mai (${dateLabel}): PRE_SALE ${saleType} (T${tOffset}) — Tăng ${pct}% NS`;
    if (noCap) msg += ' | ⚠️ KHÔNG áp Cap';
    if (noRateLimit) msg += ' | ⚠️ KHÔNG giới hạn tốc độ tăng';
    return msg;
  }
  const factor = K_SALE_TABLE[saleType][String(tOffset)] ?? 1.00;
  return `📉 Ngày mai (${dateLabel}): POST_SALE ${saleType} (T+${tOffset}) — Giảm NS × ${factor}`;
}

// ============================================================
// CAMPAIGN / SUBID2 UTILITIES
// ============================================================

function extractSubId2(name) {
  const n = String(name || '').trim();
  return n.length <= 18 ? n : n.slice(0, n.length - 18);
}

const DDMM_RE = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])/;

function detectCampTest(name) {
  return DDMM_RE.test(String(name || '').trim().slice(0, 4)) ? 'CAMP TEST' : 'CAMP THƯỜNG';
}

function calcDaysRunning(name, todayStr) {
  const n = String(name || '').trim();
  if (!DDMM_RE.test(n.slice(0, 4))) return null;
  const dd = parseInt(n.slice(0, 2), 10);
  const mm = parseInt(n.slice(2, 4), 10) - 1;
  const year = new Date(`${todayStr}T00:00:00Z`).getUTCFullYear();
  const testMs  = Date.UTC(year, mm, dd);
  const startMs = testMs + 86400000; // T_start = DDMM + 1 day
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((todayMs - startMs) / 86400000) + 1);
}

// ============================================================
// ROI / KPI CALCULATIONS
// ============================================================

function calcROI(commission, spend) {
  if (spend === 0 && commission > 0) return 1.00;
  if (spend === 0) return 0;
  return (commission - spend) / spend;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mround(v, unit) {
  return unit === 0 ? 0 : Math.round(v / unit) * unit;
}

// ============================================================
// DECISION TREE
// ============================================================

function getRecommendation({ testType, daysRunning, todayRoi, history = [] }) {
  if (testType === 'CAMP TEST') {
    if (daysRunning === 2 && todayRoi < -0.30) return '🔴 TẮT CAMP';
    if (daysRunning === 3 && todayRoi < -0.20) return '🔴 TẮT CAMP';
    return '⚪ Theo dõi';
  }
  // CAMP THƯỜNG
  const n1Roi = history[0]?.roi ?? null;
  const n2Roi = history[1]?.roi ?? null;
  // 3 consecutive loss days
  if (n1Roi !== null && n2Roi !== null && todayRoi < 0 && n1Roi < 0 && n2Roi < 0) {
    return '🔴 TẮT CAMP';
  }
  // ROI >= 30% for 2+ days
  if (todayRoi >= 0.30) {
    if (n1Roi !== null && n1Roi >= 0.30) return '🟢 TĂNG NS';
    return '🟢 TĂNG NS (1 ngày)';
  }
  // ROI <= -30% for 2+ days
  if (todayRoi <= -0.30) {
    if (n1Roi !== null && n1Roi <= -0.30) return '🟡 GIẢM NS';
    return '🟡 GIẢM NS (1 ngày)';
  }
  return '⚪ Theo dõi';
}

// ============================================================
// BUDGET OPTIMIZATION
// ============================================================

function calcKRoi({ commission, spend, avgHistRoi, todayRoi }) {
  // Đột biến
  if (spend > 0 && commission > 3 * spend) {
    return { k: 1.20, noCap: true, reason: 'Đột biến HH > 3× chi tiêu' };
  }
  let k, reason;
  if (commission > 0 && todayRoi > 0.50)    { k = 1.20; reason = 'ROI > 50%'; }
  else if (commission > 0 && todayRoi > 0)  { k = 1.10; reason = 'ROI dương'; }
  else if (commission === 0 && spend > 0)   { k = 1.00; reason = 'Chưa đủ data'; }
  else if (todayRoi > -0.20)                { k = 1.00; reason = 'ROI âm nhẹ'; }
  else                                       { k = 0.90; reason = 'ROI xấu'; }
  // Historical bonus
  if (avgHistRoi !== null && avgHistRoi > 1.00 && todayRoi > 0) {
    k += 0.05;
    reason += ' +bonus LS';
  }
  return { k, noCap: false, reason };
}

function calcTomorrowBudget({ todayBudget, commission, totalSpend, todayRoi, avgHistRoi, tomorrowDate, recommendation }) {
  if (recommendation === '🔴 TẮT CAMP' || recommendation === '⛔ STOP') {
    return { budget: 0, kFinal: 0, kRoi: 0, kSale: 1.00, saleLabel: '', reason: 'TẮT CAMP', changePct: -1 };
  }
  const { k: kRoi, noCap: noCapSpike, reason } = calcKRoi({ commission, spend: totalSpend, avgHistRoi, todayRoi });
  const { k: kSale, label: saleLabel, context: saleCtx } = getKSale(tomorrowDate);
  const kFinal = Math.max(kRoi, kSale);

  const isBigOrMega = saleCtx && (saleCtx.saleType === 'BIG' || saleCtx.saleType === 'MEGA');
  const isCapExempt  = isBigOrMega && (saleCtx.tOffset === -2 || saleCtx.tOffset === -1);
  const isRateExempt = isBigOrMega && saleCtx.tOffset === -1;

  let prelim = todayBudget * kFinal;
  if (!isRateExempt && kFinal > 1.30) prelim = todayBudget * 1.30;
  if (!noCapSpike && !isCapExempt) prelim = Math.min(prelim, 250000);

  const budget = mround(prelim, 10000);
  const changePct = todayBudget > 0 ? (budget - todayBudget) / todayBudget : 0;
  return { budget, kFinal, kRoi, kSale, saleLabel, reason, changePct };
}

// ============================================================
// DATA QUERY
// ============================================================

async function fetchReportData({ ownerUserId, targetDate, accountIds }) {
  const n1 = addDays(targetDate, -1);
  const n2 = addDays(targetDate, -2);
  const n3 = addDays(targetDate, -3);
  const histDates = [n1, n2, n3];

  const [todayCamps, histCamps, todayComm, histComm, accounts, todayOrders] = await Promise.all([
    Campaign.find({ accountId: { $in: accountIds }, date: targetDate }).lean(),
    Campaign.find({ accountId: { $in: accountIds }, date: { $in: histDates } }).lean(),
    ShopeeCommission.find({ ownerUserId, date: targetDate }).lean(),
    ShopeeCommission.find({ ownerUserId, date: { $in: histDates } }).lean(),
    Account.find({ _id: { $in: accountIds } }).select('_id name adAccountId').lean(),
    ShopeeCommissionOrder.find({ ownerUserId, date: targetDate }).lean(),
  ]);
  return { todayCamps, histCamps, todayComm, histComm, accounts, todayOrders, n1, n2, n3 };
}

// ============================================================
// DATA PROCESSING
// ============================================================

function processReportData({ todayCamps, histCamps, todayComm, histComm, accounts, todayOrders, targetDate, n1, n2, n3 }) {
  const accountMap = new Map(accounts.map(a => [String(a._id), a]));
  const tomorrow = addDays(targetDate, 1);

  // Commission maps: subId2 → commission
  const todayCommMap = new Map();
  for (const c of todayComm) todayCommMap.set(c.subId2, c);

  const histCommMap = new Map(); // subId2 → { date → commission }
  for (const c of histComm) {
    if (!histCommMap.has(c.subId2)) histCommMap.set(c.subId2, {});
    histCommMap.get(c.subId2)[c.date] = c.commission;
  }

  // Historical spend per subId2 per date
  const histSpendMap = new Map(); // subId2 → { date → spend }
  for (const c of histCamps) {
    const sub = extractSubId2(c.name);
    if (!histSpendMap.has(sub)) histSpendMap.set(sub, {});
    const m = histSpendMap.get(sub);
    m[c.date] = (m[c.date] || 0) + Number(c.spend || 0);
  }

  // Group today's campaigns by subId2
  const subGroups = new Map(); // subId2 → group
  for (const camp of todayCamps) {
    const sub = extractSubId2(camp.name);
    if (!subGroups.has(sub)) {
      subGroups.set(sub, { subId2: sub, camps: [], totalSpend: 0, totalClicks: 0, totalBudget: 0, activeCnt: 0, pausedCnt: 0 });
    }
    const g = subGroups.get(sub);
    g.camps.push(camp);
    g.totalSpend += Number(camp.spend || 0);
    g.totalClicks += Number(camp.clicks || 0);
    g.totalBudget += Number(camp.dailyBudget || 0) || Number(camp.lifetimeBudget || 0);
    if (String(camp.status || '').toUpperCase() === 'ACTIVE') g.activeCnt++;
    else g.pausedCnt++;
  }

  const processedCamps = [];

  for (const [sub, grp] of subGroups) {
    const commRec = todayCommMap.get(sub);
    const todayCommVal  = commRec?.commission ?? 0;
    const orderCount    = commRec?.rowCount ?? 0;
    const histComms     = histCommMap.get(sub) || {};
    const histSpends    = histSpendMap.get(sub) || {};

    // Historical ROIs for the subId2 group
    const n1Comm = histComms[n1] ?? 0;  const n1Spend = histSpends[n1] ?? 0;
    const n2Comm = histComms[n2] ?? 0;  const n2Spend = histSpends[n2] ?? 0;
    const n3Comm = histComms[n3] ?? 0;  const n3Spend = histSpends[n3] ?? 0;
    const n1Roi  = calcROI(n1Comm, n1Spend);
    const n2Roi  = calcROI(n2Comm, n2Spend);
    const n3Roi  = calcROI(n3Comm, n3Spend);
    const todayRoi = calcROI(todayCommVal, grp.totalSpend);

    // Average historical ROI (only days with data)
    const histPairs = [[n1Comm, n1Spend], [n2Comm, n2Spend], [n3Comm, n3Spend]];
    const validHistRois = histPairs.filter(([,s]) => s > 0).map(([c, s]) => calcROI(c, s));
    const avgHistRoi = validHistRois.length ? validHistRois.reduce((a, b) => a + b, 0) / validHistRois.length : null;

    for (const camp of grp.camps) {
      const acct = accountMap.get(String(camp.accountId));
      const testType   = detectCampTest(camp.name);
      const daysRunning = testType === 'CAMP TEST' ? calcDaysRunning(camp.name, targetDate) : null;
      const campBudget = Number(camp.dailyBudget || 0) || Number(camp.lifetimeBudget || 0);
      const campSpend  = Number(camp.spend || 0);
      const campClicks = Number(camp.clicks || 0);

      const recommendation = getRecommendation({
        testType, daysRunning, todayRoi,
        history: [{ roi: n1Roi }, { roi: n2Roi }, { roi: n3Roi }],
      });

      const budgetCalc = calcTomorrowBudget({
        todayBudget: campBudget,
        commission: todayCommVal,
        totalSpend: grp.totalSpend,
        todayRoi,
        avgHistRoi,
        tomorrowDate: tomorrow,
        recommendation,
      });

      processedCamps.push({
        campaignId:   camp.campaignId,
        campaignName: camp.name,
        subId2:       sub,
        accountName:  acct?.name ?? '',
        status:       String(camp.status || '').toUpperCase(),
        campBudget,
        campSpend,
        campClicks,
        campCpc:      campClicks > 0 ? campSpend / campClicks : 0,
        budgetUsage:  campBudget > 0 ? campSpend / campBudget : 0,
        groupSpend:   grp.totalSpend,
        groupClicks:  grp.totalClicks,
        groupBudget:  grp.totalBudget,
        groupActive:  grp.activeCnt,
        groupPaused:  grp.pausedCnt,
        groupCampCnt: grp.camps.length,
        commission:   todayCommVal,
        orderCount,
        todayRoi,
        profit:       todayCommVal - grp.totalSpend,
        testType,
        daysRunning,
        recommendation,
        tomorrow:     budgetCalc.budget,
        kRoi:         budgetCalc.kRoi,
        kSale:        budgetCalc.kSale,
        saleLabel:    budgetCalc.saleLabel,
        budgetReason: budgetCalc.reason,
        changePct:    budgetCalc.changePct,
        histN1: { date: n1, commission: n1Comm, spend: n1Spend, roi: n1Roi },
        histN2: { date: n2, commission: n2Comm, spend: n2Spend, roi: n2Roi },
        histN3: { date: n3, commission: n3Comm, spend: n3Spend, roi: n3Roi },
      });
    }
  }

  // Build Sheet1 rows (subId2-level aggregates)
  const s1Map = new Map();
  for (const r of processedCamps) {
    if (!s1Map.has(r.subId2)) {
      s1Map.set(r.subId2, {
        subId2:       r.subId2,
        accountName:  r.accountName,
        testType:     r.testType,
        campCount:    0, activeCnt: 0, pausedCnt: 0,
        totalClicks:  0, totalSpend: 0, totalBudget: 0,
        commission:   r.commission,
        orderCount:   r.orderCount,
        todayRoi:     r.todayRoi,
      });
    }
    const g = s1Map.get(r.subId2);
    g.campCount++;
    if (r.status === 'ACTIVE') g.activeCnt++; else g.pausedCnt++;
    g.totalClicks  += r.campClicks;
    g.totalSpend   += r.campSpend;
    g.totalBudget  += r.campBudget;
  }
  const sheet1Rows = [...s1Map.values()].map(g => ({
    ...g,
    avgCpc:  g.totalClicks > 0 ? g.totalSpend / g.totalClicks : 0,
    profit:  g.commission - g.totalSpend,
  }));

  // Build Sheet5 TKQC rows
  const tkqcMap = new Map();
  for (const r of processedCamps) {
    if (!tkqcMap.has(r.accountName)) {
      tkqcMap.set(r.accountName, {
        accountName: r.accountName,
        activeCnt: 0, pausedCnt: 0,
        totalBudgetActive: 0, totalSpend: 0,
        subId2Set: new Set(),
      });
    }
    const g = tkqcMap.get(r.accountName);
    if (r.status === 'ACTIVE') { g.activeCnt++; g.totalBudgetActive += r.campBudget; }
    else g.pausedCnt++;
    g.totalSpend += r.campSpend;
    g.subId2Set.add(r.subId2);
  }
  const tkqcRows = [...tkqcMap.values()].map(g => {
    const totalComm = [...g.subId2Set].reduce((s, sub) => s + (todayCommMap.get(sub)?.commission ?? 0), 0);
    return {
      accountName:        g.accountName,
      activeCnt:          g.activeCnt,
      pausedCnt:          g.pausedCnt,
      totalBudgetActive:  g.totalBudgetActive,
      totalSpend:         g.totalSpend,
      totalCommission:    totalComm,
      profit:             totalComm - g.totalSpend,
      roi:                calcROI(totalComm, g.totalSpend),
      avgBudgetPerCamp:   g.activeCnt > 0 ? g.totalBudgetActive / g.activeCnt : 0,
    };
  });

  // Active camp count per account (for duplicate suggestion logic)
  const activeCampCount = new Map(tkqcRows.map(r => [r.accountName, r.activeCnt]));

  // Add duplicate suggestion to each camp row
  for (const r of processedCamps) {
    const isScale = r.recommendation.startsWith('🟢 TĂNG NS');
    if (isScale) {
      const otherAccounts = [...activeCampCount.entries()].filter(([name]) => name !== r.accountName);
      const eligible = otherAccounts.find(([, cnt]) => cnt <= 60);
      if (eligible) {
        r.dupSuggestion = `🔵 GỢI Ý NHÂN CAMP → ${eligible[0]} (NS: ${Math.round(r.campBudget * 0.5).toLocaleString('vi-VN')} ₫)`;
      } else {
        r.dupSuggestion = '';
      }
    } else {
      r.dupSuggestion = '';
    }
  }

  return { processedCamps, sheet1Rows, tkqcRows, todayOrders, targetDate, tomorrow, n1, n2, n3 };
}

// ============================================================
// EXCEL HELPERS
// ============================================================

function bg(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function fg(argb) {
  return { argb };
}

function styleCell(cell, { bgColor, fontColor, bold, italic, size, hAlign, vAlign, wrap, numFmt } = {}) {
  if (bgColor)   cell.fill = bg(bgColor);
  const fnt = {};
  if (fontColor) fnt.color = fg(fontColor);
  if (bold !== undefined) fnt.bold = bold;
  if (italic !== undefined) fnt.italic = italic;
  if (size) fnt.size = size;
  if (Object.keys(fnt).length) cell.font = { ...(cell.font || {}), ...fnt };
  const aln = {};
  if (wrap !== undefined)  aln.wrapText   = wrap;
  if (hAlign)              aln.horizontal = hAlign;
  if (vAlign)              aln.vertical   = vAlign;
  if (Object.keys(aln).length) cell.alignment = { ...(cell.alignment || {}), ...aln };
  if (numFmt) cell.numFmt = numFmt;
}

function styleRow(row, opts) {
  row.eachCell({ includeEmpty: true }, cell => styleCell(cell, opts));
  if (opts.height) row.height = opts.height;
}

function addHeaderRow(sheet, headers, rowNum = 1) {
  const row = sheet.getRow(rowNum);
  headers.forEach((h, i) => { row.getCell(i + 1).value = h; });
  row.eachCell({ includeEmpty: true }, cell => {
    styleCell(cell, { bgColor: C.HEADER_BG, fontColor: C.HEADER_FG, bold: true, hAlign: 'center', vAlign: 'middle' });
  });
  row.height = 24;
  row.commit();
  return row;
}

function getRowBgByRecommendation(rec, rowIdx) {
  if (rec?.includes('TẮT CAMP') || rec?.includes('STOP')) return C.RED_LIGHT;
  if (rec?.startsWith('🟢 TĂNG NS'))    return C.GREEN_LIGHT;
  if (rec?.startsWith('🟡 GIẢM NS'))   return C.YELLOW_LIGHT;
  if (rec?.startsWith('🟠 PRE_SALE'))  return C.ORANGE_LIGHT;
  if (rec?.startsWith('🎯 SALE_DAY'))  return C.RED_ORANGE;
  // Zebra for "Theo dõi"
  return rowIdx % 2 === 0 ? C.WHITE : C.BLUE_LIGHT;
}

function setColWidths(sheet, widths) {
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

function freezeAt(sheet, ySplit) {
  sheet.views = [{ state: 'frozen', ySplit, xSplit: 0 }];
}

function addTotalRow(sheet, row, cols, lastRowNum) {
  const r = sheet.addRow(row);
  styleRow(r, { bgColor: C.TOTAL_BG, fontColor: C.TOTAL_FG, bold: true });
  r.height = 20;
  r.commit();
  return r;
}

// ============================================================
// SHEET 1 — Tong_Quan
// ============================================================

function buildSheet1(wb, { sheet1Rows, targetDate }) {
  const [, mm, dd] = targetDate.split('-');
  const ws = wb.addWorksheet(`Tong_Quan_${dd}_${mm}`);

  const COLS = [
    'Sub_id2', 'TKQC', 'Test?', 'Số Camp', 'Active', 'Pause',
    'Số Click', 'Giá Click TB', 'Chi Tiêu', 'Ngân Sách Tổng',
    'Số Đơn', 'Hoa Hồng', 'Lợi Nhuận', 'ROI',
  ];
  setColWidths(ws, [32, 10, 14, 10, 10, 10, 12, 16, 16, 18, 10, 16, 16, 12]);
  addHeaderRow(ws, COLS, 1);
  freezeAt(ws, 1);

  let totalClicks = 0, totalSpend = 0, totalBudget = 0, totalOrders = 0, totalComm = 0, totalProfit = 0;

  sheet1Rows.forEach((r, idx) => {
    const bgColor = getRowBgByRecommendation(null, idx);
    const isGray  = false; // sheet1 doesn't color by rec
    const profit  = r.commission - r.totalSpend;
    const roi     = r.todayRoi;

    totalClicks  += r.totalClicks;
    totalSpend   += r.totalSpend;
    totalBudget  += r.totalBudget;
    totalOrders  += r.orderCount || 0;
    totalComm    += r.commission;
    totalProfit  += profit;

    const row = ws.addRow([
      r.subId2, r.accountName, r.testType,
      r.campCount, r.activeCnt, r.pausedCnt,
      r.totalClicks, r.avgCpc, r.totalSpend, r.totalBudget,
      r.orderCount, r.commission, profit, roi,
    ]);

    // Alternate zebra
    const fillColor = idx % 2 === 0 ? C.WHITE : C.BLUE_LIGHT;
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.fill = bg(fillColor);
      cell.alignment = { vertical: 'middle' };
    });
    row.getCell(8).numFmt  = FMT.CURRENCY;
    row.getCell(9).numFmt  = FMT.CURRENCY;
    row.getCell(10).numFmt = FMT.CURRENCY;
    row.getCell(12).numFmt = FMT.CURRENCY;
    row.getCell(13).numFmt = FMT.CURRENCY;
    row.getCell(14).numFmt = FMT.PCT;
    row.height = 18;
    row.commit();
  });

  // Total row
  const avgRoi = totalSpend > 0 ? (totalComm - totalSpend) / totalSpend : 0;
  const totalRow = ws.addRow([
    'TỔNG CỘNG', '', '', sheet1Rows.reduce((s, r) => s + r.campCount, 0),
    sheet1Rows.reduce((s, r) => s + r.activeCnt, 0),
    sheet1Rows.reduce((s, r) => s + r.pausedCnt, 0),
    totalClicks, totalClicks > 0 ? totalSpend / totalClicks : 0,
    totalSpend, totalBudget, totalOrders, totalComm, totalProfit, avgRoi,
  ]);
  styleRow(totalRow, { bgColor: C.TOTAL_BG, fontColor: C.TOTAL_FG, bold: true });
  totalRow.getCell(8).numFmt  = FMT.CURRENCY;
  totalRow.getCell(9).numFmt  = FMT.CURRENCY;
  totalRow.getCell(10).numFmt = FMT.CURRENCY;
  totalRow.getCell(12).numFmt = FMT.CURRENCY;
  totalRow.getCell(13).numFmt = FMT.CURRENCY;
  totalRow.getCell(14).numFmt = FMT.PCT;
  totalRow.height = 22;
  totalRow.commit();
}

// ============================================================
// SHEET 2 — Chi_Tiet_Don_Hang
// ============================================================

function buildSheet2(wb, { todayOrders }) {
  const ws = wb.addWorksheet('Chi_Tiet_Don_Hang');
  const COLS = [
    'Sub_id2', 'ID Đơn', 'Trạng Thái ĐH', 'Tên Item',
    'Giá Trị ĐH', 'Hoa Hồng', '% HH Thực', '% HH Thỏa Thuận',
    'Trạng Thái HH', 'Kênh',
  ];
  setColWidths(ws, [28, 20, 18, 40, 16, 16, 12, 16, 18, 14]);
  addHeaderRow(ws, COLS, 1);
  freezeAt(ws, 1);

  const isCanceled = (status) => {
    const s = String(status || '').toLowerCase();
    return s.includes('hủy') || s.includes('hủy') || s.includes('cancel');
  };

  todayOrders.forEach((o, idx) => {
    const canceled = isCanceled(o.orderStatus);
    const bgColor = canceled ? C.RED_LIGHT : (idx % 2 === 0 ? C.WHITE : C.BLUE_LIGHT);
    const fontColor = canceled ? C.GRAY : C.BLACK;

    const row = ws.addRow([
      o.subId2, o.orderId, o.orderStatus, o.itemName,
      o.orderValue, o.commission,
      o.actualCommissionRate / 100, o.agreedCommissionRate / 100,
      o.commissionStatus, o.channel,
    ]);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = bg(bgColor);
      cell.font = { ...(cell.font || {}), color: fg(fontColor), italic: canceled };
      cell.alignment = { vertical: 'middle' };
    });
    row.getCell(5).numFmt = FMT.CURRENCY;
    row.getCell(6).numFmt = FMT.CURRENCY;
    row.getCell(7).numFmt = FMT.PCT1;
    row.getCell(8).numFmt = FMT.PCT1;
    row.height = 18;
    row.commit();
  });

  if (todayOrders.length === 0) {
    const r = ws.addRow(['(Chưa có dữ liệu đơn hàng chi tiết. Import CSV hoa hồng để cập nhật.)']);
    r.height = 18;
    r.commit();
  }
}

// ============================================================
// SHEET 3 — Chi_Tiet_Campaign
// ============================================================

function buildSheet3(wb, { processedCamps }) {
  const ws = wb.addWorksheet('Chi_Tiet_Campaign');
  const COLS = [
    'Sub_id2', 'TKQC', 'Test?', 'Tên Campaign', 'Trạng Thái',
    'Số Click', 'Giá Click', 'Chi Tiêu', 'Ngân Sách', '% Dùng NS', 'Khuyến Nghị',
  ];
  setColWidths(ws, [28, 10, 14, 40, 12, 12, 14, 14, 14, 12, 26]);
  addHeaderRow(ws, COLS, 1);
  freezeAt(ws, 1);

  // Sort by spend descending
  const sorted = [...processedCamps].sort((a, b) => b.campSpend - a.campSpend);

  sorted.forEach((r, idx) => {
    const paused = r.status !== 'ACTIVE';
    const bgColor = getRowBgByRecommendation(r.recommendation, idx);

    const row = ws.addRow([
      r.subId2, r.accountName, r.testType, r.campaignName, r.status,
      r.campClicks, r.campCpc, r.campSpend, r.campBudget, r.budgetUsage, r.recommendation,
    ]);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = bg(bgColor);
      if (paused) cell.font = { ...(cell.font || {}), color: fg(C.GRAY) };
      cell.alignment = { vertical: 'middle' };
    });
    row.getCell(7).numFmt  = FMT.CURRENCY;
    row.getCell(8).numFmt  = FMT.CURRENCY;
    row.getCell(9).numFmt  = FMT.CURRENCY;
    row.getCell(10).numFmt = FMT.PCT1;
    row.height = 18;
    row.commit();
  });
}

// ============================================================
// SHEET 4 — KN_va_NS_Ngay_Mai
// ============================================================

function buildSheet4(wb, { processedCamps, targetDate, tomorrow, n1, n2, n3 }) {
  const ws = wb.addWorksheet('KN_va_NS_Ngay_Mai');

  const COLS = [
    'Sub_id2', 'TKQC', 'Test?', 'Tên Campaign', 'Trạng Thái', 'Khuyến Nghị Camp',
    `HH [${fmtDDMM(n3)}]`, `ROI [${fmtDDMM(n3)}]`,
    `HH [${fmtDDMM(n2)}]`, `ROI [${fmtDDMM(n2)}]`,
    `HH [${fmtDDMM(n1)}]`, `ROI [${fmtDDMM(n1)}]`,
    `HH Hôm Nay`,           `ROI Hôm Nay`,
    'NS Hôm Nay', 'NS Ngày Mai ⚡', 'Tăng/Giảm %', 'Gợi Ý Nhân Camp', 'Lý Do',
  ];

  setColWidths(ws, [28,10,14,36,12,26, 14,10, 14,10, 14,10, 14,10, 14,16,12, 38,30]);

  // Row 1: Banner
  const bannerText = buildSaleBannerMessage(tomorrow);
  const bannerRow = ws.getRow(1);
  bannerRow.getCell(1).value = bannerText;
  ws.mergeCells(1, 1, 1, COLS.length);
  styleCell(bannerRow.getCell(1), { bgColor: C.BANNER_BG, fontColor: C.BANNER_FG, bold: true, size: 12, hAlign: 'center', vAlign: 'middle' });
  bannerRow.height = 26;
  bannerRow.commit();

  // Row 2: Headers
  addHeaderRow(ws, COLS, 2);
  freezeAt(ws, 2);

  let totalBudgetToday = 0, totalBudgetTomorrow = 0;

  processedCamps.forEach((r, idx) => {
    const bgColor = getRowBgByRecommendation(r.recommendation, idx);
    const paused  = r.status !== 'ACTIVE';

    const row = ws.addRow([
      r.subId2, r.accountName, r.testType, r.campaignName, r.status, r.recommendation,
      r.histN3.commission, r.histN3.roi,
      r.histN2.commission, r.histN2.roi,
      r.histN1.commission, r.histN1.roi,
      r.commission, r.todayRoi,
      r.campBudget, r.tomorrow, r.changePct,
      r.dupSuggestion || '', r.budgetReason || '',
    ]);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = bg(bgColor);
      if (paused) cell.font = { ...(cell.font || {}), color: fg(C.GRAY) };
      cell.alignment = { vertical: 'middle' };
    });
    // Currency cols
    [7,9,11,13,15,16].forEach(col => { row.getCell(col).numFmt = FMT.CURRENCY; });
    // ROI cols
    [8,10,12,14,17].forEach(col => { row.getCell(col).numFmt = FMT.PCT; });
    row.height = 18;
    row.commit();

    totalBudgetToday    += r.campBudget;
    totalBudgetTomorrow += r.tomorrow;
  });

  // Total summary row
  const totalChangePct = totalBudgetToday > 0 ? (totalBudgetTomorrow - totalBudgetToday) / totalBudgetToday : 0;
  const totalRow = ws.addRow([
    'TỔNG CỘNG', '', '', '', '', '',
    '', '', '', '', '', '', '', '',
    totalBudgetToday, totalBudgetTomorrow, totalChangePct, '', '',
  ]);
  styleRow(totalRow, { bgColor: C.TOTAL_BG, fontColor: C.TOTAL_FG, bold: true });
  totalRow.getCell(15).numFmt = FMT.CURRENCY;
  totalRow.getCell(16).numFmt = FMT.CURRENCY;
  totalRow.getCell(17).numFmt = FMT.PCT;
  totalRow.height = 22;
  totalRow.commit();
}

// ============================================================
// SHEET 5 — TKQC_Health_Check
// ============================================================

function buildSheet5(wb, { tkqcRows, targetDate }) {
  const ws = wb.addWorksheet('TKQC_Health_Check');

  // Title row
  const titleText = `Báo Cáo Sức Khỏe Tài Khoản Quảng Cáo — Ngày ${fmtDDMM(targetDate)}`;
  const NCOLS = 11;
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value = titleText;
  ws.mergeCells(1, 1, 1, NCOLS);
  styleCell(titleRow.getCell(1), { bgColor: C.TITLE_BG, fontColor: C.TITLE_FG, bold: true, size: 13, hAlign: 'center', vAlign: 'middle' });
  titleRow.height = 28;
  titleRow.commit();

  const COLS = [
    'TKQC', 'Camp Active', 'Camp Pause',
    'Tổng NS Active', 'Tổng Chi', 'Tổng HH',
    'Lợi Nhuận', 'ROI TB', 'NS/Camp TB',
    'Rủi Ro Overlap', 'Khuyến Nghị TKQC',
  ];
  setColWidths(ws, [12, 14, 12, 18, 16, 16, 16, 10, 16, 18, 50]);
  addHeaderRow(ws, COLS, 2);
  freezeAt(ws, 2);

  tkqcRows.forEach((r, idx) => {
    const { risk, recText } = getOverlapRisk(r.activeCnt);
    const bgColor = idx % 2 === 0 ? C.WHITE : C.BLUE_LIGHT;

    const row = ws.addRow([
      r.accountName, r.activeCnt, r.pausedCnt,
      r.totalBudgetActive, r.totalSpend, r.totalCommission,
      r.profit, r.roi, r.avgBudgetPerCamp,
      risk, recText,
    ]);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = bg(bgColor);
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    [4,5,6,7,9].forEach(col => { row.getCell(col).numFmt = FMT.CURRENCY; });
    row.getCell(8).numFmt = FMT.PCT;
    row.height = 40;
    row.commit();
  });

  // Total row
  const totSpend  = tkqcRows.reduce((s, r) => s + r.totalSpend, 0);
  const totComm   = tkqcRows.reduce((s, r) => s + r.totalCommission, 0);
  const totBudget = tkqcRows.reduce((s, r) => s + r.totalBudgetActive, 0);
  const totProfit = totComm - totSpend;
  const totRoi    = calcROI(totComm, totSpend);
  const totActive = tkqcRows.reduce((s, r) => s + r.activeCnt, 0);
  const totPaused = tkqcRows.reduce((s, r) => s + r.pausedCnt, 0);

  const totalRow = ws.addRow([
    'TỔNG', totActive, totPaused,
    totBudget, totSpend, totComm,
    totProfit, totRoi, totActive > 0 ? totBudget / totActive : 0,
    '', '',
  ]);
  styleRow(totalRow, { bgColor: C.TOTAL_BG, fontColor: C.TOTAL_FG, bold: true });
  [4,5,6,7,9].forEach(col => { totalRow.getCell(col).numFmt = FMT.CURRENCY; });
  totalRow.getCell(8).numFmt = FMT.PCT;
  totalRow.height = 22;
  totalRow.commit();

  // Strategic analysis block
  ws.addRow([]);
  const anaRow = ws.addRow(['PHÂN TÍCH CHIẾN LƯỢC ĐIỀU PHỐI NGÂN SÁCH']);
  ws.mergeCells(anaRow.number, 1, anaRow.number, NCOLS);
  styleCell(anaRow.getCell(1), { bgColor: C.TITLE_BG, fontColor: C.TITLE_FG, bold: true, size: 12, hAlign: 'left', vAlign: 'middle' });
  anaRow.height = 22;
  anaRow.commit();

  const analysisLines = buildStrategicAnalysis({ tkqcRows, targetDate });
  for (const line of analysisLines) {
    const r = ws.addRow([line]);
    ws.mergeCells(r.number, 1, r.number, NCOLS);
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    r.height = 18;
    r.commit();
  }
}

function getOverlapRisk(activeCnt) {
  if (activeCnt > 100) return {
    risk: '🔴 Rất cao',
    recText: 'Hệ thống quá tải. Tắt ngay camp yếu, tuyệt đối không tạo thêm chiến dịch mới.',
  };
  if (activeCnt > 60) return {
    risk: '🟠 Cao',
    recText: 'Hạn chế scale ngang. Tập trung tối ưu ngân sách chiến dịch hiện tại.',
  };
  if (activeCnt > 30) return {
    risk: '🟡 Trung bình',
    recText: 'Trạng thái ổn định. Cho phép nhân camp sang tài khoản đối diện nếu an toàn.',
  };
  return {
    risk: '🟢 Thấp',
    recText: 'Tài khoản sạch đối tượng. Ưu tiên nhận thêm camp mồi từ tài khoản khác chuyển sang.',
  };
}

function buildStrategicAnalysis({ tkqcRows, targetDate }) {
  const lines = [];
  const total = tkqcRows.reduce((s, r) => ({
    activeCnt: s.activeCnt + r.activeCnt,
    totalSpend: s.totalSpend + r.totalSpend,
    totalComm: s.totalComm + r.totalCommission,
    totalBudget: s.totalBudget + r.totalBudgetActive,
  }), { activeCnt: 0, totalSpend: 0, totalComm: 0, totalBudget: 0 });

  const overallRoi = calcROI(total.totalComm, total.totalSpend);
  lines.push(`📊 Tổng quan ngày ${fmtDDMMYYYY(targetDate)}: ${total.activeCnt} camp đang chạy trên ${tkqcRows.length} tài khoản`);
  lines.push(`💰 Tổng chi tiêu: ${fmt(total.totalSpend)} ₫ | Tổng hoa hồng: ${fmt(total.totalComm)} ₫ | ROI tổng: ${pct(overallRoi)}`);
  lines.push(`🎯 Lợi nhuận tổng: ${fmt(total.totalComm - total.totalSpend)} ₫ | Ngân sách Active: ${fmt(total.totalBudget)} ₫`);
  lines.push('');
  for (const r of tkqcRows) {
    const { risk } = getOverlapRisk(r.activeCnt);
    lines.push(`  • ${r.accountName}: ${r.activeCnt} Active / ${r.pausedCnt} Pause — ROI ${pct(r.roi)} — Rủi ro: ${risk}`);
  }
  lines.push('');
  // Allocation suggestion
  const canReceive = tkqcRows.filter(r => r.activeCnt <= 30).map(r => r.accountName);
  const overloaded = tkqcRows.filter(r => r.activeCnt > 60).map(r => r.accountName);
  if (overloaded.length) lines.push(`⚠️ Tài khoản tải cao (nên dừng nhân): ${overloaded.join(', ')}`);
  if (canReceive.length) lines.push(`✅ Tài khoản có thể nhận camp thêm: ${canReceive.join(', ')}`);
  return lines;
}

// ============================================================
// FORMAT UTILITIES
// ============================================================

function fmtDDMM(dateStr) {
  if (!dateStr) return '';
  const [, mm, dd] = dateStr.split('-');
  return `${dd}/${mm}`;
}

function fmtDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  const [yr, mm, dd] = dateStr.split('-');
  return `${dd}/${mm}/${yr}`;
}

function fmt(n) {
  return Math.round(Number(n) || 0).toLocaleString('vi-VN');
}

function pct(n) {
  return `${Math.round((Number(n) || 0) * 100)}%`;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

async function generateExcelReport({ ownerUserId, targetDate, accountIds }) {
  const raw = await fetchReportData({ ownerUserId, targetDate, accountIds });
  const data = processReportData({ ...raw, targetDate });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ADS System';
  wb.created = new Date();

  buildSheet1(wb, data);
  buildSheet2(wb, data);
  buildSheet3(wb, data);
  buildSheet4(wb, data);
  buildSheet5(wb, data);

  return wb.xlsx.writeBuffer();
}

// ============================================================
// CSV PARSING FOR ORDER IMPORT
// ============================================================

function getCsvColIdx(headers, candidates) {
  const norm = candidates.map(normalizeCsvHeader);
  return headers.findIndex(h => {
    const nh = normalizeCsvHeader(h);
    return norm.some(c => nh === c || nh.startsWith(c) || c.startsWith(nh));
  });
}

const ORDER_ID_HEADERS      = ['Mã đơn hàng', 'Order ID', 'Order Number', 'ID Đơn', 'Ma don hang', 'Ma DH', 'order id', 'order number', 'order_no', 'order#'];
const ORDER_STATUS_HEADERS  = ['Trạng thái đơn hàng', 'Order Status', 'trang thai don hang', 'status don hang', 'order status', 'order_state'];
const ITEM_NAME_HEADERS     = ['Tên mặt hàng', 'Item Name', 'Product Name', 'ten mat hang', 'ten san pham', 'ten san pham', 'item name', 'product name'];
const ORDER_VALUE_HEADERS   = ['Giá trị đơn hàng', 'Order Value', 'gia tri don hang', 'Total Order Value', 'Order Amount', 'Gia tri don hang'];
const COMM_RATE_ACT_HEADERS = ['% Hoa hồng thực', 'Actual Commission Rate', 'ti le hoa hong thuc', '% hoa hong thuc'];
const COMM_RATE_AGR_HEADERS = ['% Hoa hồng thỏa thuận', 'Agreed Commission Rate', 'ti le hoa hong thoa thuan', '% hoa hong thoa thuan'];
const COMM_STATUS_HEADERS   = ['Trạng thái hoa hồng', 'Commission Status', 'trang thai hoa hong', 'status hoa hong'];
const CHANNEL_HEADERS       = ['Kênh', 'Channel', 'kenh', 'Nguồn', 'source', 'platform'];

async function importCommissionOrders(ownerUserId, rows, subId2Index, dateIndex, commissionIndex, parseCsvDate) {
  if (!ownerUserId) return { ok: false, error: 'Missing ownerUserId' };

  const headers = rows[0];
  const orderIdIdx     = getCsvColIdx(headers, ORDER_ID_HEADERS);
  const orderStatusIdx = getCsvColIdx(headers, ORDER_STATUS_HEADERS);
  const itemNameIdx    = getCsvColIdx(headers, ITEM_NAME_HEADERS);
  const orderValueIdx  = getCsvColIdx(headers, ORDER_VALUE_HEADERS);
  const commRateActIdx = getCsvColIdx(headers, COMM_RATE_ACT_HEADERS);
  const commRateAgrIdx = getCsvColIdx(headers, COMM_RATE_AGR_HEADERS);
  const commStatusIdx  = getCsvColIdx(headers, COMM_STATUS_HEADERS);
  const channelIdx     = getCsvColIdx(headers, CHANNEL_HEADERS);

  if (orderIdIdx < 0) return { ok: false, skipped: true, reason: 'No Order ID column' };

  const ops = [];
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some(c => String(c || '').trim())) continue;
    const orderId = String(row[orderIdIdx] || '').trim();
    if (!orderId) continue;
    const date   = parseCsvDate(row[dateIndex]);
    if (!date) continue;
    const subId2 = String(row[subId2Index] || '').trim();
    if (!subId2) continue;

    ops.push({
      updateOne: {
        filter: { ownerUserId, orderId },
        update: {
          $set: {
            date, subId2,
            orderStatus:          orderStatusIdx  >= 0 ? String(row[orderStatusIdx]  || '').trim() : '',
            itemName:             itemNameIdx      >= 0 ? String(row[itemNameIdx]     || '').trim() : '',
            orderValue:           orderValueIdx    >= 0 ? parseCsvNumber(row[orderValueIdx])   : 0,
            commission:           commissionIndex  >= 0 ? parseCsvNumber(String(row[commissionIndex] || '').split('.')[0]) : 0,
            actualCommissionRate: commRateActIdx   >= 0 ? parseCsvNumber(row[commRateActIdx])  : 0,
            agreedCommissionRate: commRateAgrIdx   >= 0 ? parseCsvNumber(row[commRateAgrIdx])  : 0,
            commissionStatus:     commStatusIdx    >= 0 ? String(row[commStatusIdx]   || '').trim() : '',
            channel:              channelIdx       >= 0 ? String(row[channelIdx]      || '').trim() : '',
            importedAt: now,
          },
          $setOnInsert: { ownerUserId },
        },
        upsert: true,
      },
    });
  }

  if (!ops.length) return { ok: true, imported: 0 };
  const result = await ShopeeCommissionOrder.bulkWrite(ops, { ordered: false });
  return { ok: true, imported: ops.length, upserted: result.upsertedCount, modified: result.modifiedCount };
}

async function getReportData({ ownerUserId, targetDate, accountIds }) {
  const raw  = await fetchReportData({ ownerUserId, targetDate, accountIds });
  const data = processReportData({ ...raw, targetDate });

  const { processedCamps, sheet1Rows, tkqcRows, todayOrders, tomorrow, n1, n2, n3 } = data;

  // Sheet 3: sorted by campSpend desc
  const sheet3 = [...processedCamps].sort((a, b) => b.campSpend - a.campSpend).map(r => ({
    subId2: r.subId2, accountName: r.accountName, testType: r.testType,
    campaignName: r.campaignName, status: r.status,
    clicks: r.campClicks, cpc: r.campCpc,
    spend: r.campSpend, budget: r.campBudget, budgetUsage: r.budgetUsage,
    recommendation: r.recommendation,
  }));

  // Sheet 4: all campaigns with history
  const sheet4 = processedCamps.map(r => ({
    subId2: r.subId2, accountName: r.accountName, testType: r.testType,
    campaignName: r.campaignName, status: r.status,
    recommendation: r.recommendation,
    histN3: r.histN3, histN2: r.histN2, histN1: r.histN1,
    commission: r.commission, todayRoi: r.todayRoi,
    campBudget: r.campBudget, tomorrow: r.tomorrow,
    changePct: r.changePct, dupSuggestion: r.dupSuggestion,
    budgetReason: r.budgetReason,
  }));

  // Sheet 5
  const sheet5 = tkqcRows.map(r => ({
    ...r,
    ...getOverlapRisk(r.activeCnt),
  }));

  const saleCtx = getSaleContext(tomorrow);
  const bannerMessage = buildSaleBannerMessage(tomorrow);

  return {
    targetDate, tomorrowDate: tomorrow, n1, n2, n3,
    bannerMessage,
    saleType: saleCtx?.saleType ?? null,
    saleTOffset: saleCtx?.tOffset ?? null,
    sheet1: sheet1Rows,
    sheet2: todayOrders,
    sheet3,
    sheet4,
    sheet5,
  };
}

// ============================================================
// SHOPEE STATS (multi-day, per-account, cumulative tax split)
// ============================================================

const TAX_THRESHOLD = 1200000000;

// Extracts the alphabetic code from a subId2 (e.g. "1102PH01" -> "PH", "1102PHAT01" -> "PHAT"),
// stripping a leading numeric date prefix if present. Used to attribute commission to a
// Shopee account via that account's configured `shopeeSubId2Codes` (exact match, not substring).
function extractSubId2Code(subId2) {
  const s = String(subId2 || '').trim().toUpperCase().replace(/^\d+/, '');
  const match = s.match(/^[A-Z]+/);
  return match ? match[0] : '';
}

async function getShopeeStatsData({ ownerUserId, fromDate, toDate, accountIds }) {
  const accounts = await Account.find({ _id: { $in: accountIds } })
    .select('_id name adAccountId').lean();
  const accountMap = new Map(accounts.map(a => [String(a._id), a]));

  const affAccounts = await ShopeeAffAccount.find({ ownerUserId })
    .select('_id name shopeeSubId2Codes').lean();
  const affAccountMap = new Map(affAccounts.map(a => [String(a._id), a]));

  const codeToAffId = new Map(); // code -> affId (string)
  for (const aff of affAccounts) {
    for (const code of aff.shopeeSubId2Codes || []) {
      const c = String(code || '').trim().toUpperCase();
      if (c) codeToAffId.set(c, String(aff._id));
    }
  }

  // Ads spend / active campaigns within the requested range, attributed per-campaign to
  // its AFF account via the code extracted from Campaign.name (same convention as subId2),
  // since a single Số TKQC can run campaigns belonging to several different AFF accounts.
  const rangeCamps = await Campaign.find({
    accountId: { $in: accountIds },
    date: { $gte: fromDate, $lte: toDate },
  }).select('accountId spend status name').lean();

  const adsByAff = new Map();           // affId -> total spend in range
  const activeCampIdsByAff = new Map(); // affId -> Set(campaign _id)
  const accountsSeenByAff = new Map();  // affId -> Set(accountId)

  for (const camp of rangeCamps) {
    const affId = codeToAffId.get(extractSubId2Code(camp.name));
    if (!affId) continue;
    adsByAff.set(affId, (adsByAff.get(affId) || 0) + Number(camp.spend || 0));

    if (String(camp.status || '').toUpperCase() === 'ACTIVE') {
      if (!activeCampIdsByAff.has(affId)) activeCampIdsByAff.set(affId, new Set());
      activeCampIdsByAff.get(affId).add(String(camp._id));
    }

    if (!accountsSeenByAff.has(affId)) accountsSeenByAff.set(affId, new Set());
    accountsSeenByAff.get(affId).add(String(camp.accountId));
  }

  // Full commission history (all-time) for the owner, matched to AFF accounts via their
  // configured subId2 codes — needed to compute the lifetime-cumulative 1.2B threshold correctly.
  const allComm = await ShopeeCommission.find({ ownerUserId })
    .select('subId2 date commission').sort({ date: 1 }).lean();

  const commByAffDate = new Map(); // affId -> Map(date -> commission)
  for (const c of allComm) {
    const affId = codeToAffId.get(extractSubId2Code(c.subId2));
    if (!affId) continue;
    if (!commByAffDate.has(affId)) commByAffDate.set(affId, new Map());
    const m = commByAffDate.get(affId);
    m.set(c.date, (m.get(c.date) || 0) + Number(c.commission || 0));
  }

  // Per-AFF-account: walk full commission history chronologically to compute the
  // cumulative 1.2B tax-bracket split, keeping only rows within [fromDate, toDate].
  const taxByAffDate = new Map(); // affId -> Map(date -> { amount30, amount35 })
  for (const [affId, dateMap] of commByAffDate) {
    const dates = [...dateMap.keys()].sort();
    let cumulative = 0;
    const taxMap = new Map();
    for (const date of dates) {
      const dayComm = dateMap.get(date) || 0;
      const cumBefore = cumulative;
      const cumAfter = cumBefore + dayComm;
      let amount30 = 0;
      let amount35 = 0;
      if (cumAfter <= TAX_THRESHOLD) {
        amount30 = dayComm;
      } else if (cumBefore >= TAX_THRESHOLD) {
        amount35 = dayComm;
      } else {
        amount30 = TAX_THRESHOLD - cumBefore;
        amount35 = cumAfter - TAX_THRESHOLD;
      }
      cumulative = cumAfter;
      taxMap.set(date, { amount30, amount35 });
    }
    taxByAffDate.set(affId, taxMap);
  }

  // Build one summary row per AFF account for the entire [fromDate, toDate] range.
  const rows = [];
  for (const affId of new Set([...adsByAff.keys(), ...commByAffDate.keys()])) {
    const aff = affAccountMap.get(affId);
    if (!aff) continue;

    const ads = adsByAff.get(affId) || 0;

    const commMap = commByAffDate.get(affId) || new Map();
    const taxMap = taxByAffDate.get(affId) || new Map();
    let commission = 0;
    let hhAfterTax30 = 0;
    let hhAfterTax35 = 0;
    for (const [date, dayComm] of commMap) {
      if (date < fromDate || date > toDate) continue;
      commission += dayComm;
      const tax = taxMap.get(date) || { amount30: 0, amount35: 0 };
      hhAfterTax30 += tax.amount30 * 0.7;
      hhAfterTax35 += tax.amount35 * 0.65;
    }

    const seenAccountIds = [...(accountsSeenByAff.get(affId) || [])];
    const adAccountIdList = seenAccountIds.map(id => accountMap.get(id)?.adAccountId).filter(Boolean).join(', ');
    const accountCount = seenAccountIds.length;
    const campsRunning = (activeCampIdsByAff.get(affId) || new Set()).size;

    rows.push({
      affAccountId: affId,
      accountName: aff.name,
      adAccountId: adAccountIdList,
      accountCount,
      campsRunning,
      ads,
      commission,
      adsPerHH: commission > 0 ? ads / commission : null,
      hhAfterTax30,
      hhAfterTax35,
    });
  }

  rows.sort((a, b) => a.accountName.localeCompare(b.accountName));

  const totals = rows.reduce((t, r) => {
    t.ads += r.ads;
    t.commission += r.commission;
    t.hhAfterTax30 += r.hhAfterTax30;
    t.hhAfterTax35 += r.hhAfterTax35;
    return t;
  }, { ads: 0, commission: 0, hhAfterTax30: 0, hhAfterTax35: 0 });
  totals.adsPerHH = totals.commission > 0 ? totals.ads / totals.commission : null;

  return { rows, totals };
}

module.exports = { generateExcelReport, importCommissionOrders, getReportData, getShopeeStatsData };
