'use strict';

const express = require('express');
const Config = require('../models/Config');
const { getAppConfig, clearAppConfigCache } = require('../services/configService');
const { buildSaleStaffStats, mondayOf, resolveWeekSchedule } = require('../services/pancakePageStatsService');
const { isAdminUser, requireAdminUser } = require('../utils/authUtils');
const { todayStr } = require('../utils/timeUtils');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGES = 50;

function getStoredPages(config = {}) {
  return (Array.isArray(config.pancakeStatsPages) ? config.pancakeStatsPages : [])
    .filter(page => page && page.pageId);
}

// Id nhan vien Pancake duoc tinh la sale (rong = hien tat ca nhan vien co hoat dong)
function getSaleStaffIds(config = {}) {
  return (Array.isArray(config.saleStaffIds) ? config.saleStaffIds : []).map(String).filter(Boolean);
}

// Lich ca tuan: { shifts: ['8-12h', ...], days: [7 mang (Thu 2..CN) cac { shift, staffId }] }
function normalizeShiftSchedule(value = {}) {
  const shifts = [...new Set((Array.isArray(value.shifts) ? value.shifts : [])
    .map(label => String(label || '').trim().slice(0, 30))
    .filter(Boolean))].slice(0, 20);
  const days = Array.from({ length: 7 }, (_, index) => {
    const entries = Array.isArray(value.days?.[index]) ? value.days[index] : [];
    return entries
      .map(entry => ({ shift: String(entry?.shift || '').trim(), staffId: String(entry?.staffId || '').trim() }))
      .filter(entry => shifts.includes(entry.shift) && /^[\w-]{6,64}$/.test(entry.staffId))
      .slice(0, 100);
  });
  return { shifts, days };
}

// Lich ca theo tuan { [Thu 2]: lich }. Ban cu chi co 1 lich lap lai (saleShiftSchedule) -> coi la lich cua tuan hien tai,
// cac tuan khac muon lich nay cho den khi luu lich rieng.
function getShiftSchedules(config = {}) {
  const schedules = config.saleShiftSchedules && typeof config.saleShiftSchedules === 'object' ? config.saleShiftSchedules : {};
  if (Object.keys(schedules).length) return schedules;
  const legacy = config.saleShiftSchedule;
  return legacy?.days?.some(day => day?.length) ? { [mondayOf(todayStr())]: legacy } : {};
}

function parseWeekStart(value) {
  const date = String(value || '').trim();
  return mondayOf(DATE_RE.test(date) ? date : todayStr());
}

// GET /api/sale-stats/shift-schedule?week=YYYY-MM-DD -> lich cua tuan chua ngay do (own=false: dang muon lich tuan sourceWeek)
router.get('/shift-schedule', async (req, res) => {
  try {
    const schedules = getShiftSchedules(await getAppConfig());
    const { weekStart, schedule, sourceWeek, own } = resolveWeekSchedule(schedules, parseWeekStart(req.query.week));
    res.json({
      weekStart,
      own,
      sourceWeek,
      savedWeeks: Object.keys(schedules).sort(),
      ...normalizeShiftSchedule(schedule || {})
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Body: { week, shifts, days } - luu lich rieng cho 1 tuan ($set rieng key tuan, khong de len tuan khac)
router.put('/shift-schedule', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const weekStart = parseWeekStart(req.body?.week);
    const schedule = normalizeShiftSchedule(req.body || {});
    const config = await getAppConfig({ fresh: true });
    // Chuyen lich cu (1 lich chung) sang dang theo tuan truoc khi them tuan moi, de khong mat
    const migrate = !Object.keys(config.saleShiftSchedules || {}).length ? getShiftSchedules(config) : {};
    const set = { [`saleShiftSchedules.${weekStart}`]: schedule, updatedAt: new Date() };
    for (const [week, legacy] of Object.entries(migrate)) {
      if (week !== weekStart) set[`saleShiftSchedules.${week}`] = normalizeShiftSchedule(legacy);
    }
    await Config.updateOne({ key: 'app' }, { $set: set }, { upsert: true });
    clearAppConfigCache();
    res.json({ weekStart, own: true, sourceWeek: weekStart, ...schedule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Xoa lich rieng cua 1 tuan (tuan do quay ve muon lich tuan gan nhat truoc do)
router.delete('/shift-schedule', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const weekStart = parseWeekStart(req.query.week);
    await Config.updateOne({ key: 'app' }, { $unset: { [`saleShiftSchedules.${weekStart}`]: '' }, $set: { updatedAt: new Date() } });
    clearAppConfigCache();
    res.json({ weekStart, deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ten goi tat trong lich ca Excel -> id nhan vien Pancake (vd "linh" -> id HE LO). Key da bo dau, chu thuong.
function normalizeAliasKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

router.get('/staff-aliases', async (req, res) => {
  try {
    const aliases = (await getAppConfig()).saleStaffAliases;
    res.json({ aliases: aliases && typeof aliases === 'object' ? aliases : {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Body: { aliases: { "Linh": "<id>" } } - ghi de toan bo bang ten goi tat
router.put('/staff-aliases', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const input = req.body?.aliases && typeof req.body.aliases === 'object' ? req.body.aliases : {};
    const aliases = Object.fromEntries(Object.entries(input)
      .map(([alias, staffId]) => [normalizeAliasKey(alias), String(staffId || '').trim()])
      .filter(([alias, staffId]) => alias && /^[\w-]{6,64}$/.test(staffId))
      .slice(0, 200));
    await Config.updateOne({ key: 'app' }, { $set: { saleStaffAliases: aliases, updatedAt: new Date() } }, { upsert: true });
    clearAppConfigCache();
    res.json({ aliases });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Body: { staffIds: [id Pancake], names: { [id]: ten } } - chi admin.
// Luu kem ten de lich ca van hien ten nhan vien ca khi ho khong co hoat dong trong khoang dang xem.
router.put('/sale-staff', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const staffIds = [...new Set((Array.isArray(req.body?.staffIds) ? req.body.staffIds : [])
      .map(id => String(id || '').trim())
      .filter(id => /^[\w-]{6,64}$/.test(id)))].slice(0, 500);
    const inputNames = req.body?.names && typeof req.body.names === 'object' ? req.body.names : {};
    const storedNames = (await getAppConfig({ fresh: true })).saleStaffNames || {};
    const names = Object.fromEntries(staffIds.map(id => [id, String(inputNames[id] || storedNames[id] || '').trim().slice(0, 100)]));
    await Config.updateOne(
      { key: 'app' },
      { $set: { saleStaffIds: staffIds, saleStaffNames: names, updatedAt: new Date() } },
      { upsert: true }
    );
    clearAppConfigCache();
    res.json({ staffIds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Khong tra token ra client, chi 4 ky tu cuoi de nhan biet
function maskPages(pages) {
  return pages.map(page => ({
    pageId: page.pageId,
    name: page.name || '',
    hasToken: Boolean(page.accessToken),
    tokenHint: page.accessToken ? `...${String(page.accessToken).slice(-4)}` : ''
  }));
}

// GET /api/sale-stats/staff?fromDate=&toDate=&pageId=&fresh=1&debug=1 (fresh=1 bo cache 5 phut)
router.get('/staff', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || todayStr()).trim();
    const toDate = String(req.query.toDate || fromDate).trim();
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
      return res.status(400).json({ error: 'fromDate/toDate phai dang YYYY-MM-DD' });
    }
    const config = await getAppConfig();
    const pages = getStoredPages(config);
    if (!pages.length) {
      return res.json({ fromDate, toDate, pages: [], rows: [], errors: [], needsSetup: true });
    }
    const report = await buildSaleStaffStats({
      pages,
      fromDate,
      toDate,
      pageId: String(req.query.pageId || '').trim(),
      staffIds: getSaleStaffIds(config),
      shiftSchedules: getShiftSchedules(config),
      fresh: req.query.fresh === '1',
      // response tho chi cho admin (de doi chieu ten truong khi Pancake doi format)
      debug: req.query.debug === '1' && isAdminUser(req.currentUser)
    });
    // Danh sach nhan vien sale co ten (ke ca nguoi khong co hoat dong trong khoang) cho lich ca
    const activeNames = Object.fromEntries((report.allStaff || []).map(item => [item.id, item.name]));
    const storedNames = config.saleStaffNames || {};
    report.saleStaff = getSaleStaffIds(config).map(id => ({ id, name: activeNames[id] || storedNames[id] || id.slice(0, 8) }));
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/pages', async (req, res) => {
  try {
    res.json({ pages: maskPages(getStoredPages(await getAppConfig())) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Body: { pages: [{ pageId, name, accessToken }] }. accessToken rong = giu token cu cua page do.
router.put('/pages', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const input = Array.isArray(req.body?.pages) ? req.body.pages.slice(0, MAX_PAGES) : [];
    const current = new Map(getStoredPages(await getAppConfig({ fresh: true })).map(page => [page.pageId, page]));
    const pages = [];
    const seen = new Set();
    for (const item of input) {
      const pageId = String(item?.pageId || '').trim();
      if (!/^\d{5,25}$/.test(pageId) || seen.has(pageId)) continue;
      seen.add(pageId);
      const accessToken = String(item?.accessToken || '').trim() || current.get(pageId)?.accessToken || '';
      pages.push({ pageId, name: String(item?.name || '').trim().slice(0, 100), accessToken });
    }
    await Config.updateOne(
      { key: 'app' },
      { $set: { pancakeStatsPages: pages, updatedAt: new Date() } },
      { upsert: true }
    );
    clearAppConfigCache();
    res.json({ pages: maskPages(pages) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
