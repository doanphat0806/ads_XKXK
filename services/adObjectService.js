'use strict';

// Nhom quang cao / quang cao cua camp: luu vao MongoDB theo ngay, doc tu DB cho nhanh.
// - Chua tung dong bo (camp + ngay) -> goi Facebook ngay (cho ket qua) roi luu.
// - Da co nhung cu (hom nay > 5 phut, ngay cu chua chot) -> tra du lieu DB ngay, lam moi ngam.
// - Ngay cu da dong bo sau 03:00 ngay hom sau -> coi nhu da chot, khong goi lai.
// - Ten / trang thai / ngan sach cu > 10 phut -> lam moi ngam (chi lay thong tin, khong lay so lieu).

const User = require('../models/User');
const AdObject = require('../models/AdObject');
const AdObjectDaily = require('../models/AdObjectDaily');
const AdObjectSyncState = require('../models/AdObjectSyncState');
const { getAppConfig } = require('./configService');
const { fetchAllFbEdge, mapWithConcurrency } = require('../utils/fbApi');
const { todayStr } = require('../utils/timeUtils');
const { parseBoundedInt } = require('../utils/number');

const TODAY_STALE_MS = parseBoundedInt(process.env.AD_OBJECT_TODAY_STALE_MS, 5 * 60 * 1000, 30 * 1000, 6 * 60 * 60 * 1000);
const PAST_STALE_MS = parseBoundedInt(process.env.AD_OBJECT_PAST_STALE_MS, 30 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
const META_STALE_MS = parseBoundedInt(process.env.AD_OBJECT_META_STALE_MS, 10 * 60 * 1000, 30 * 1000, 24 * 60 * 60 * 1000);
// Ngay D coi la da chot khi dong bo sau 03:00 (gio VN) ngay D+1 (Meta con cap nhat so lieu muon)
const FINAL_AFTER_MS = 27 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Sync state: campaignId = ALL_CAMPAIGNS -> da dong bo ca tai khoan; date = META_DATE -> lan lay thong tin
const ALL_CAMPAIGNS = '*';
const META_DATE = 'meta';
// Loc theo camp toi da bay nhieu id / lan goi Facebook, nhieu hon thi lay ca tai khoan
const MAX_FILTER_CAMPAIGNS = 100;

const PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.fb_pixel_purchase',
  'onsite_conversion.messaging_purchase',
  'onsite_conversion.purchase'
]);
const MESSAGE_ACTION_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'omni_initiated_conversation'
];
const INSIGHT_FIELDS = 'spend,impressions,reach,clicks,inline_link_clicks,inline_post_engagement,actions,conversions';
const META_FIELDS = {
  adset: 'id,name,status,effective_status,campaign_id,campaign{name},daily_budget,lifetime_budget,bid_amount,optimization_goal,created_time',
  ad: 'id,name,status,effective_status,campaign_id,campaign{name},adset_id,adset{name},created_time,creative{id,thumbnail_url,image_url,effective_object_story_id,object_story_id,body,title}'
};
const METRIC_KEYS = ['spend', 'impressions', 'reach', 'clicks', 'linkClicks', 'engagements', 'messages', 'metaOrders'];

// Dang dong bo (tranh goi Facebook trung khi nhieu nguoi / nhieu tab mo cung luc)
const inFlight = new Map();

const toNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function normalizeAdAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw.replace(/^act_/i, '')}`;
}

// Giong getEffectiveSecrets trong legacy runtime: token tai khoan -> token chu tai khoan -> token chung
async function getAccountFbToken(account) {
  if (account.fbToken) return account.fbToken;
  if (account.ownerUserId) {
    const owner = await User.findById(account.ownerUserId).select('fbToken').lean();
    if (owner?.fbToken) return owner.fbToken;
  }
  const config = await getAppConfig();
  return config?.fbToken || '';
}

function listDates(fromDate, toDate) {
  const dates = [];
  for (let time = Date.parse(`${fromDate}T00:00:00Z`); time <= Date.parse(`${toDate}T00:00:00Z`); time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

function isSyncStale(date, syncedAt, today, now) {
  if (!syncedAt) return true;
  const syncedMs = new Date(syncedAt).getTime();
  if (date >= today) return now - syncedMs > TODAY_STALE_MS;
  const finalAt = Date.parse(`${date}T00:00:00+07:00`) + FINAL_AFTER_MS;
  if (syncedMs >= finalAt) return false;
  return now - syncedMs > PAST_STALE_MS;
}

function getActionValue(list, matcher) {
  if (!Array.isArray(list)) return 0;
  const values = list.filter(matcher).map(action => toNumber(action.value));
  return values.length ? Math.max(...values) : 0;
}

function parseInsight(insight = {}) {
  const actions = Array.isArray(insight.actions) ? insight.actions : [];
  const isPurchase = (action) => {
    const type = String(action?.action_type || '').toLowerCase();
    return PURCHASE_ACTION_TYPES.has(type) || type.endsWith('_purchase');
  };
  let messages = 0;
  for (const type of MESSAGE_ACTION_TYPES) {
    const found = actions.find(action => String(action?.action_type || '').toLowerCase() === type);
    if (found) {
      messages = toNumber(found.value);
      break;
    }
  }
  const postEngagement = actions.find(action => String(action?.action_type || '').toLowerCase() === 'post_engagement');
  return {
    spend: toNumber(insight.spend),
    impressions: Math.round(toNumber(insight.impressions)),
    reach: Math.round(toNumber(insight.reach)),
    clicks: Math.round(toNumber(insight.clicks)),
    linkClicks: Math.round(toNumber(insight.inline_link_clicks)),
    engagements: Math.round(toNumber(insight.inline_post_engagement) || toNumber(postEngagement?.value)),
    messages: Math.round(messages),
    metaOrders: Math.round(Math.max(getActionValue(insight.conversions, isPurchase), getActionValue(actions, isPurchase)))
  };
}

function mapMeta(level, item, accountId, syncedAt) {
  const dailyBudget = toNumber(item.daily_budget);
  const lifetimeBudget = toNumber(item.lifetime_budget);
  const creative = item.creative || {};
  return {
    level,
    objectId: String(item.id || ''),
    accountId,
    campaignId: String(item.campaign_id || ''),
    campaignName: item.campaign?.name || '',
    adsetId: level === 'ad' ? String(item.adset_id || '') : '',
    adsetName: level === 'ad' ? (item.adset?.name || '') : '',
    name: item.name || '',
    status: String(item.status || '').toUpperCase(),
    effectiveStatus: String(item.effective_status || '').toUpperCase(),
    dailyBudget,
    lifetimeBudget,
    budgetType: lifetimeBudget > 0 ? 'LIFETIME' : (dailyBudget > 0 ? 'DAILY' : ''),
    bidAmount: toNumber(item.bid_amount),
    optimizationGoal: item.optimization_goal || '',
    creativeId: String(creative.id || ''),
    thumbnailUrl: creative.thumbnail_url || creative.image_url || '',
    storyId: String(creative.effective_object_story_id || creative.object_story_id || ''),
    body: creative.body || '',
    title: creative.title || '',
    createdTime: item.created_time ? new Date(item.created_time) : undefined,
    syncedAt
  };
}

// campaignIds = null -> ca tai khoan (khong loc camp). Sync state luu campaignId = ALL_CAMPAIGNS.
// date = META_DATE: lan cuoi lay thong tin (ten / trang thai / ngan sach).
async function syncAccountFromFacebook(level, account, campaignIds, dates) {
  const fbToken = await getAccountFbToken(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');
  const actId = normalizeAdAccountId(account.adAccountId);
  const filterParams = campaignIds
    ? { filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]) }
    : {};
  const syncedAt = new Date();
  const edge = level === 'adset' ? 'adsets' : 'ads';

  const sortedDates = [...dates].sort();
  const [metaResult, insightResult] = await Promise.all([
    fetchAllFbEdge(fbToken, `${actId}/${edge}`, { fields: META_FIELDS[level], ...filterParams, limit: 200 }, { maxPages: 200 }),
    sortedDates.length
      ? fetchAllFbEdge(fbToken, `${actId}/insights`, {
        level,
        fields: `${level === 'adset' ? 'adset_id' : 'ad_id,adset_id'},campaign_id,${INSIGHT_FIELDS}`,
        ...filterParams,
        time_range: JSON.stringify({ since: sortedDates[0], until: sortedDates[sortedDates.length - 1] }),
        time_increment: 1,
        limit: 500
      }, { maxPages: 500 })
      : Promise.resolve({ items: [] })
  ]);

  const metaOps = metaResult.items
    .map(item => mapMeta(level, item, account._id, syncedAt))
    .filter(doc => doc.objectId && doc.campaignId)
    .map(doc => ({ updateOne: { filter: { level, objectId: doc.objectId }, update: { $set: doc }, upsert: true } }));
  if (metaOps.length) await AdObject.bulkWrite(metaOps, { ordered: false });

  if (sortedDates.length) {
    const dateSet = new Set(sortedDates);
    const dailyOps = [];
    for (const row of insightResult.items) {
      const objectId = String((level === 'adset' ? row.adset_id : row.ad_id) || '');
      const date = String(row.date_start || '');
      if (!objectId || !dateSet.has(date)) continue;
      dailyOps.push({
        updateOne: {
          filter: { level, objectId, date },
          update: { $set: { level, objectId, date, accountId: account._id, campaignId: String(row.campaign_id || ''), ...parseInsight(row) } },
          upsert: true
        }
      });
    }
    // Xoa so lieu cu cua cac ngay vua lay roi ghi lai (doi tuong het chi tieu trong ngay -> khong con dong)
    await AdObjectDaily.deleteMany({
      level,
      accountId: account._id,
      ...(campaignIds ? { campaignId: { $in: campaignIds } } : {}),
      date: { $in: sortedDates }
    });
    if (dailyOps.length) await AdObjectDaily.bulkWrite(dailyOps, { ordered: false });
  }

  const stateOps = [];
  for (const campaignId of (campaignIds || [ALL_CAMPAIGNS])) {
    for (const date of [...sortedDates, META_DATE]) {
      stateOps.push({
        updateOne: {
          filter: { level, accountId: account._id, campaignId, date },
          update: { $set: { syncedAt } },
          upsert: true
        }
      });
    }
  }
  await AdObjectSyncState.bulkWrite(stateOps, { ordered: false });
}

function runSync(level, account, campaignIds, dates) {
  const scopeKey = campaignIds ? [...campaignIds].sort().join(',') : ALL_CAMPAIGNS;
  const key = [level, String(account._id), scopeKey, [...dates].sort().join(',')].join(':');
  if (inFlight.has(key)) return inFlight.get(key);
  const startedAt = Date.now();
  const promise = syncAccountFromFacebook(level, account, campaignIds, dates)
    .then(() => {
      console.log('[ad-objects:' + level + '] dong bo ' + (account.name || account._id)
        + ' camps=' + (campaignIds ? campaignIds.length : 'tat ca') + ' days=' + dates.length + ' ' + (Date.now() - startedAt) + 'ms');
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// Ke hoach dong bo cho 1 tai khoan: blocking = co (camp, ngay) chua tung dong bo -> phai cho.
// Dong bo ca tai khoan (ALL_CAMPAIGNS) cung tinh cho tung camp cua tai khoan do.
async function planAccountSync(level, account, campaignIds, dates, today, now) {
  const keys = campaignIds || [ALL_CAMPAIGNS];
  const states = await AdObjectSyncState.find({
    level,
    accountId: account._id,
    campaignId: { $in: campaignIds ? [...campaignIds, ALL_CAMPAIGNS] : [ALL_CAMPAIGNS] },
    date: { $in: [...dates, META_DATE] }
  }).select('campaignId date syncedAt').lean();
  const stateByKey = new Map(states.map(state => [state.campaignId + ':' + state.date, new Date(state.syncedAt).getTime()]));
  const latestSync = (campaignId, date) => {
    const own = stateByKey.get(campaignId + ':' + date) || 0;
    const all = stateByKey.get(ALL_CAMPAIGNS + ':' + date) || 0;
    return Math.max(own, all) || null;
  };

  let blocking = false;
  let metaStale = false;
  const staleDates = new Set();
  for (const key of keys) {
    const metaSyncedAt = latestSync(key, META_DATE);
    if (!metaSyncedAt) blocking = true;
    else if (now - metaSyncedAt > META_STALE_MS) metaStale = true;
    for (const date of dates) {
      const syncedAt = latestSync(key, date);
      if (!syncedAt) blocking = true;
      if (isSyncStale(date, syncedAt, today, now)) staleDates.add(date);
    }
  }
  return { blocking, staleDates: [...staleDates], metaStale };
}

// scopeByAccount: Map<accountId, string[] | null> (null = tat ca camp cua tai khoan)
async function readRowsFromDb(level, accounts, scopeByAccount, fromDate, toDate) {
  const accountById = new Map(accounts.map(account => [String(account._id), account]));
  const scopeFilters = [...scopeByAccount.entries()]
    .filter(([accountId]) => accountById.has(accountId))
    .map(([accountId, campaignIds]) => {
      const accountObjectId = accountById.get(accountId)._id;
      return campaignIds ? { accountId: accountObjectId, campaignId: { $in: campaignIds } } : { accountId: accountObjectId };
    });
  if (!scopeFilters.length) return [];
  const sumFields = Object.fromEntries(METRIC_KEYS.map(key => [key, { $sum: '$' + key }]));
  const [objects, dailyTotals] = await Promise.all([
    AdObject.find({ level, $or: scopeFilters }).lean(),
    AdObjectDaily.aggregate([
      { $match: { level, $or: scopeFilters, date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$objectId', accountId: { $first: '$accountId' }, campaignId: { $first: '$campaignId' }, ...sumFields } }
    ]).allowDiskUse(true)
  ]);

  const totalsById = new Map(dailyTotals.map(item => [String(item._id), item]));
  const zero = Object.fromEntries(METRIC_KEYS.map(key => [key, 0]));
  const pickTotals = (totals) => Object.fromEntries(METRIC_KEYS.map(key => [key, totals[key] || 0]));
  const toAccountInfo = (accountId) => {
    const account = accountById.get(String(accountId)) || {};
    return { _id: accountId, name: account.name || '', adAccountId: account.adAccountId || '' };
  };

  const rows = [];
  const seen = new Set();
  for (const object of objects) {
    seen.add(object.objectId);
    const totals = totalsById.get(object.objectId);
    rows.push({
      id: object.objectId,
      name: object.name,
      status: object.status,
      effectiveStatus: object.effectiveStatus,
      campaignId: object.campaignId,
      campaignName: object.campaignName || '',
      createdTime: object.createdTime || null,
      accountId: toAccountInfo(object.accountId),
      dailyBudget: object.dailyBudget,
      lifetimeBudget: object.lifetimeBudget,
      budgetType: object.budgetType,
      bidAmount: object.bidAmount,
      optimizationGoal: object.optimizationGoal,
      adsetId: object.adsetId,
      adsetName: object.adsetName,
      creativeId: object.creativeId,
      thumbnailUrl: object.thumbnailUrl,
      storyId: object.storyId,
      body: object.body,
      title: object.title,
      ...zero,
      ...(totals ? pickTotals(totals) : {})
    });
  }
  // Co so lieu nhung doi tuong da bi xoa / luu tru tren Facebook -> van tinh vao tong
  for (const totals of dailyTotals) {
    const objectId = String(totals._id);
    if (seen.has(objectId)) continue;
    rows.push({
      id: objectId,
      name: '(Đã xóa) ' + objectId,
      status: 'DELETED',
      effectiveStatus: 'DELETED',
      campaignId: totals.campaignId,
      accountId: toAccountInfo(totals.accountId),
      ...pickTotals(totals)
    });
  }
  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}

/**
 * @param {'adset'|'ad'} level
 * @param {object[]} accounts tai khoan (da loc theo user) - can _id, name, adAccountId, fbToken, ownerUserId
 * @param {Map<string, string[] | null>} scopeByAccount camp can xem cua tung tai khoan (null = tat ca)
 * @param {{ fromDate: string, toDate: string, forceRefresh?: boolean }} options
 */
async function getAdObjects(level, accounts, scopeByAccount, { fromDate, toDate, forceRefresh = false }) {
  const today = todayStr();
  const now = Date.now();
  // Khong co so lieu cho ngay tuong lai
  const dates = fromDate > today ? [] : listDates(fromDate, toDate < today ? toDate : today);
  const accountById = new Map(accounts.map(account => [String(account._id), account]));

  const errors = [];
  let refreshing = false;
  const entries = [...scopeByAccount.entries()];
  const results = await mapWithConcurrency(entries, async ([accountId, scope]) => {
    const account = accountById.get(accountId);
    if (!account) return;
    // Chon qua nhieu camp -> lay ca tai khoan (filtering IN qua dai), van loc khi doc DB
    const campaignIds = scope && scope.length <= MAX_FILTER_CAMPAIGNS ? scope : null;
    const plan = await planAccountSync(level, account, campaignIds, dates, today, now);
    const syncDates = forceRefresh ? dates : plan.staleDates;
    const needSync = forceRefresh || plan.blocking || syncDates.length > 0 || plan.metaStale;
    if (!needSync) return;

    const promise = runSync(level, account, campaignIds, syncDates);
    if (plan.blocking || forceRefresh) {
      try {
        await promise;
      } catch (error) {
        errors.push({ accountId, accountName: account.name || '', error: error.message || String(error) });
      }
    } else {
      refreshing = true;
      promise.catch(error => console.warn('[ad-objects:' + level + '] lam moi ngam loi ' + (account.name || accountId) + ': ' + error.message));
    }
  }, 3);
  results.forEach((result, index) => {
    if (!result?.error) return;
    const accountId = entries[index][0];
    errors.push({ accountId, accountName: accountById.get(accountId)?.name || '', error: result.error.message || String(result.error) });
  });

  const rows = await readRowsFromDb(level, accounts, scopeByAccount, fromDate, toDate);
  return { rows, errors, refreshing };
}

async function updateAdObjectStatus(objectId, status) {
  await AdObject.updateMany({ objectId }, { $set: { status, effectiveStatus: status } });
}

module.exports = {
  getAdObjects,
  getAccountFbToken,
  normalizeAdAccountId,
  updateAdObjectStatus
};
