'use strict';

// Trinh quan ly quang cao: tach 1 camp ra nhom quang cao (adset) / quang cao (ad) / bai viet.
// Lay truc tiep tu Facebook (DB chi luu so lieu theo camp), chi so theo khoang ngay dang chon.
// Bai viet = gom cac quang cao theo effective_object_story_id (client tu gom tu danh sach ad).

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const User = require('../models/User');
const { withUserFilter } = require('../services/userService');
const { getAppConfig } = require('../services/configService');
const { fetchAllFbEdge, fbGet, fbPost, mapWithConcurrency } = require('../utils/fbApi');
const { readCache, getReadCache, setReadCache, clearCampaignReadCache } = require('../utils/cacheManager');
const { todayStr } = require('../utils/timeUtils');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FB_ID_RE = /^\d{1,32}$/;
const MAX_CAMPAIGNS = 100;
const MAX_RANGE_DAYS = 400;
const LEVELS = new Set(['adset', 'ad']);
const ALLOWED_STATUSES = new Set(['ACTIVE', 'PAUSED']);

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

const toNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAdAccountId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw.replace(/^act_/i, '')}`;
};

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

function mapBudget(item) {
  const dailyBudget = toNumber(item.daily_budget);
  const lifetimeBudget = toNumber(item.lifetime_budget);
  return {
    dailyBudget,
    lifetimeBudget,
    budgetType: lifetimeBudget > 0 ? 'LIFETIME' : (dailyBudget > 0 ? 'DAILY' : '')
  };
}

function buildFields(level, fromDate, toDate) {
  const insights = `insights.time_range(${JSON.stringify({ since: fromDate, until: toDate })}){${INSIGHT_FIELDS}}`;
  if (level === 'adset') {
    return [
      'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_amount,optimization_goal,created_time',
      insights
    ].join(',');
  }
  return [
    'id,name,status,effective_status,campaign_id,adset_id,adset{name},created_time',
    'creative{id,name,thumbnail_url,image_url,effective_object_story_id,object_story_id,body,title}',
    insights
  ].join(',');
}

function mapRow(level, item, account) {
  const base = {
    id: String(item.id || ''),
    name: item.name || '',
    status: String(item.status || '').toUpperCase(),
    effectiveStatus: String(item.effective_status || '').toUpperCase(),
    campaignId: String(item.campaign_id || ''),
    createdTime: item.created_time || null,
    accountId: { _id: account._id, name: account.name || '', adAccountId: account.adAccountId || '' },
    ...parseInsight(item.insights?.data?.[0])
  };
  if (level === 'adset') {
    return {
      ...base,
      ...mapBudget(item),
      bidAmount: toNumber(item.bid_amount),
      optimizationGoal: item.optimization_goal || ''
    };
  }
  const creative = item.creative || {};
  return {
    ...base,
    adsetId: String(item.adset_id || ''),
    adsetName: item.adset?.name || '',
    creativeId: String(creative.id || ''),
    thumbnailUrl: creative.thumbnail_url || creative.image_url || '',
    storyId: String(creative.effective_object_story_id || creative.object_story_id || ''),
    body: creative.body || '',
    title: creative.title || ''
  };
}

function parseCampaignItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const seen = new Set();
  const items = [];
  for (const raw of rawItems) {
    const accountId = String(raw?.accountId || '').trim();
    const campaignId = String(raw?.campaignId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(accountId) || !FB_ID_RE.test(campaignId)) continue;
    const key = `${accountId}:${campaignId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ accountId, campaignId });
  }
  return items;
}

// POST /api/ads-manager/children { level: 'adset' | 'ad', fromDate, toDate, items: [{ accountId, campaignId }] }
router.post('/children', async (req, res) => {
  const startedAt = Date.now();
  try {
    const level = String(req.body?.level || '').trim();
    if (!LEVELS.has(level)) return res.status(400).json({ error: 'level phai la adset hoac ad' });
    const fromDate = String(req.body?.fromDate || todayStr()).trim();
    const toDate = String(req.body?.toDate || fromDate).trim();
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return res.status(400).json({ error: 'Ngay khong hop le' });
    if (fromDate > toDate) return res.status(400).json({ error: '"fromDate" phai truoc "toDate"' });
    const rangeDays = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;
    if (rangeDays > MAX_RANGE_DAYS) return res.status(400).json({ error: `Toi da ${MAX_RANGE_DAYS} ngay` });

    const items = parseCampaignItems(req.body?.items);
    if (!items.length) return res.json({ rows: [], errors: [] });
    if (items.length > MAX_CAMPAIGNS) return res.status(400).json({ error: `Chi chon toi da ${MAX_CAMPAIGNS} camp` });

    const sortedKeys = items.map(item => `${item.accountId}:${item.campaignId}`).sort().join(',');
    const cacheKey = `${req.currentUser?._id || 'public'}:ads-manager:${level}:${fromDate}:${toDate}:${sortedKeys}`;
    const cached = getReadCache(cacheKey);
    if (cached) return res.json(cached);

    // Chi lay tai khoan cua user hien tai
    const accountIds = [...new Set(items.map(item => item.accountId))];
    const accounts = await Account.find(withUserFilter(req, { _id: { $in: accountIds } }))
      .select('_id name adAccountId provider fbToken ownerUserId')
      .lean();
    const accountById = new Map(accounts.map(account => [String(account._id), account]));
    const campaignIdsByAccount = new Map();
    for (const item of items) {
      if (!accountById.has(item.accountId)) continue;
      if (!campaignIdsByAccount.has(item.accountId)) campaignIdsByAccount.set(item.accountId, []);
      campaignIdsByAccount.get(item.accountId).push(item.campaignId);
    }

    const fields = buildFields(level, fromDate, toDate);
    const edge = level === 'adset' ? 'adsets' : 'ads';
    const results = await mapWithConcurrency([...campaignIdsByAccount.entries()], async ([accountId, campaignIds]) => {
      const account = accountById.get(accountId);
      const fbToken = await getAccountFbToken(account);
      if (!fbToken) throw new Error('Thieu Facebook Access Token');
      // 1 lan goi / tai khoan: loc theo danh sach camp
      const { items: fbItems } = await fetchAllFbEdge(fbToken, `${normalizeAdAccountId(account.adAccountId)}/${edge}`, {
        fields,
        filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
        limit: 100
      }, { maxPages: 50 });
      return fbItems.map(item => mapRow(level, item, account));
    }, 3);

    const rows = [];
    const errors = [];
    [...campaignIdsByAccount.keys()].forEach((accountId, index) => {
      const result = results[index];
      if (result?.error) {
        errors.push({ accountId, accountName: accountById.get(accountId)?.name || '', error: result.error.message || String(result.error) });
      } else if (Array.isArray(result)) {
        rows.push(...result);
      }
    });
    rows.sort((a, b) => b.spend - a.spend);

    const payload = { rows, errors };
    console.log(`[ads-manager:${level}] ${fromDate}..${toDate} campaigns=${items.length} rows=${rows.length} errors=${errors.length} ${Date.now() - startedAt}ms`);
    res.json(errors.length ? payload : setReadCache(cacheKey, payload));
  } catch (error) {
    console.error(`[ads-manager] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ads-manager/status { accountId, objectId, status: 'ACTIVE' | 'PAUSED' } - bat/tat nhom QC hoac quang cao
router.post('/status', async (req, res) => {
  try {
    const accountId = String(req.body?.accountId || '').trim();
    const objectId = String(req.body?.objectId || '').trim();
    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!mongoose.Types.ObjectId.isValid(accountId) || !FB_ID_RE.test(objectId)) {
      return res.status(400).json({ error: 'Thieu accountId / objectId' });
    }
    if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ error: 'status phai la ACTIVE hoac PAUSED' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }))
      .select('_id name adAccountId fbToken ownerUserId')
      .lean();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const fbToken = await getAccountFbToken(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    // Doi tuong phai thuoc dung tai khoan quang cao cua user
    const target = await fbGet(fbToken, objectId, { fields: 'account_id' });
    if (normalizeAdAccountId(target?.account_id) !== normalizeAdAccountId(account.adAccountId)) {
      return res.status(403).json({ error: 'Doi tuong khong thuoc tai khoan nay' });
    }

    await fbPost(fbToken, objectId, { status });
    clearCampaignReadCache();
    for (const key of readCache.keys()) {
      if (key.includes(':ads-manager:')) readCache.delete(key);
    }
    res.json({ ok: true, status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
