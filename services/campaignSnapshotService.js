'use strict';

const CampaignSpendSnapshot = require('../models/CampaignSpendSnapshot');
const { mapWithConcurrency } = require('../utils/fbApi');

const SNAPSHOT_METRICS = {
  spend: 's',
  metaOrders: 'o',
  clicks: 'cl',
  impressions: 'im',
  linkClicks: 'lc',
  engagements: 'en',
  messages: 'm'
};
// Moc bat dau sau 00:00 qua khoang nay ma khong co snapshot nao truoc do -> chua co so lieu goc
// (vd: server tat / moi bat dau luu), chi tieu trong khung se bi tinh du.
const MISSING_BASELINE_TOLERANCE_MS = 15 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Chu ky ky truoc cua tung tai khoan; so khong doi thi bo qua, khoi ghi trung
const lastSignatureByAccount = new Map();

function toSnapshotItem(insight = {}) {
  const item = { c: String(insight.campaign_id || insight.campaignId || '') };
  for (const [field, key] of Object.entries(SNAPSHOT_METRICS)) {
    item[key] = Number(insight[field] || 0) || 0;
  }
  return item;
}

/**
 * Luu so luy ke trong ngay cua cac camp sau 1 lan sync. Khong throw (khong lam hong luong sync).
 * @param {{ account: object, date: string, at: Date, insights: object[] }} input
 */
async function recordCampaignSnapshot({ account, date, at = new Date(), insights = [] }) {
  try {
    const accountId = String(account?._id || '');
    if (!accountId || !date) return;
    const items = insights.map(toSnapshotItem).filter(item => item.c);
    items.sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
    // Van ghi ca khi items rong: danh dau "da sync, chua tieu dong nao" de lam moc goc cho ngay
    const signature = `${date}|${JSON.stringify(items)}`;
    if (lastSignatureByAccount.get(accountId) === signature) return;
    await CampaignSpendSnapshot.create({ accountId: account._id, provider: account.provider || 'facebook', date, at, items });
    lastSignatureByAccount.set(accountId, signature);
  } catch (error) {
    console.warn(`[campaign-snapshot] ${account?.name || account?._id}: ${error.message}`);
  }
}

function listDateKeys(fromDate, toDate) {
  const keys = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function findLatestSnapshot(accountId, date, atOrBefore) {
  return CampaignSpendSnapshot.findOne({ accountId, date, at: { $lte: atOrBefore } })
    .sort({ at: -1 })
    .select('at items')
    .lean();
}

/**
 * Cong don chi so cua tung camp trong khung fromTime..toTime (HH:mm, gio VN) cua moi ngay trong khoang.
 * Moi (tai khoan, ngay): lay snapshot gan nhat <= moc ket thuc tru snapshot gan nhat <= moc bat dau.
 */
async function getCampaignMinuteWindow({ accounts = [], fromDate, toDate, fromTime, toTime }) {
  const byCampaign = {};
  const missingBaseline = [];
  let lastSnapshotAt = null;

  const tasks = [];
  for (const date of listDateKeys(fromDate, toDate)) {
    for (const account of accounts) tasks.push({ date, account });
  }

  await mapWithConcurrency(tasks, async ({ date, account }) => {
    const dayStart = new Date(`${date}T00:00:00+07:00`);
    const windowStart = new Date(`${date}T${fromTime}:00+07:00`);
    const windowEnd = new Date(`${date}T${toTime}:59.999+07:00`);
    const startsAtMidnight = windowStart.getTime() === dayStart.getTime();

    const [endDoc, startDoc] = await Promise.all([
      findLatestSnapshot(account._id, date, windowEnd),
      startsAtMidnight ? null : findLatestSnapshot(account._id, date, windowStart)
    ]);
    if (!endDoc) return;
    if (!lastSnapshotAt || endDoc.at > lastSnapshotAt) lastSnapshotAt = endDoc.at;
    if (!startDoc && windowStart - dayStart > MISSING_BASELINE_TOLERANCE_MS) {
      missingBaseline.push({ date, accountId: String(account._id), name: account.name || '' });
    }

    const baseline = new Map((startDoc?.items || []).map(item => [item.c, item]));
    for (const item of endDoc.items || []) {
      const before = baseline.get(item.c) || {};
      const target = byCampaign[item.c] || (byCampaign[item.c] = {});
      for (const [field, key] of Object.entries(SNAPSHOT_METRICS)) {
        // Meta doi khi dieu chinh giam so cu -> khong de am
        const delta = Math.max(0, Number(item[key] || 0) - Number(before[key] || 0));
        target[field] = (target[field] || 0) + delta;
      }
    }
  }, 8);

  return { byCampaign, missingBaseline, lastSnapshotAt };
}

function parseTimeOfDay(value, fallback) {
  const text = String(value || '').trim();
  return TIME_RE.test(text) ? text : fallback;
}

async function ensureCampaignSnapshotIndexes() {
  await CampaignSpendSnapshot.createIndexes();
}

module.exports = {
  recordCampaignSnapshot,
  getCampaignMinuteWindow,
  parseTimeOfDay,
  ensureCampaignSnapshotIndexes
};
