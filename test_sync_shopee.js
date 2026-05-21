const mongoose = require('mongoose');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager';

// Define schemas once
const ConfigSchema = new mongoose.Schema({}, { strict: false });
const UserSchema = new mongoose.Schema({}, { strict: false });
const AccountSchema = new mongoose.Schema({}, { strict: false });
const CampaignSchema = new mongoose.Schema({}, { strict: false });

const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema, 'configs');
const User = mongoose.models.User || mongoose.model('User', UserSchema, 'users');
const Account = mongoose.models.Account || mongoose.model('Account', AccountSchema, 'accounts');
const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', CampaignSchema, 'campaigns');

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getAppConfig() {
  return Config.findOne({ key: 'app' });
}

async function getEffectiveSecrets(account) {
  const config = await getAppConfig();
  let ownerFbToken = '';
  let ownerGeminiKey = '';
  if (account.ownerUserId) {
    const owner = await User.findById(account.ownerUserId).select('fbToken geminiKey').lean();
    ownerFbToken = owner?.fbToken || '';
    ownerGeminiKey = owner?.geminiKey || '';
  }
  let fbToken = account.fbToken || ownerFbToken || config?.fbToken || '';
  let geminiKey = account.geminiKey || ownerGeminiKey || config?.geminiKey || '';
  return { fbToken, geminiKey };
}

async function fetchAllFbEdge(fbToken, edge, params = {}) {
  let items = [];
  let url = `https://graph.facebook.com/v17.0/${edge}`;
  let queryParams = { ...params, access_token: fbToken };
  
  while (url) {
    try {
      const response = await axios.get(url, { params: queryParams });
      const data = response.data;
      if (data.data) items.push(...data.data);
      url = data.paging?.next || null;
      queryParams = {}; // Next URL has params embedded
    } catch (error) {
      console.error(`fetchAllFbEdge failed: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
      throw error;
    }
  }
  return { items };
}

async function fetchAccountInsightsInRange(account, fromDate, toDate) {
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const { items } = await fetchAllFbEdge(fbToken, `${acctId}/insights`, {
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,conversions,cost_per_action_type',
    time_range: JSON.stringify({ since: fromDate, until: toDate }),
    level: 'campaign',
    limit: 500,
    time_increment: 1
  });

  return items;
}

async function fetchAccountAdNameMapInRange(account, fromDate, toDate) {
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const { items } = await fetchAllFbEdge(fbToken, `${acctId}/insights`, {
    fields: 'campaign_id,ad_id,ad_name',
    time_range: JSON.stringify({ since: fromDate, until: toDate }),
    level: 'ad',
    limit: 500,
    time_increment: 1
  });

  const byDateCampaign = new Map();
  const byCampaign = new Map();
  for (const row of items) {
    const campaignId = String(row?.campaign_id || '').trim();
    const date = String(row?.date_start || fromDate || '').trim();
    const adName = String(row?.ad_name || '').replace(/\s+/g, ' ').trim();
    if (!campaignId || !date || !adName) continue;

    const dateCampaignKey = `${date}:${campaignId}`;
    byDateCampaign.set(dateCampaignKey, adName);
    byCampaign.set(campaignId, adName);
  }

  return { byDateCampaign, byCampaign };
}

async function fetchCampaignMetaMap(fbToken, campaignIds) {
  const map = new Map();
  if (!campaignIds.length) return map;
  
  const chunks = [];
  for (let i = 0; i < campaignIds.length; i += 50) {
    chunks.push(campaignIds.slice(i, i + 50));
  }

  for (const chunk of chunks) {
    try {
      const url = `https://graph.facebook.com/v17.0/`;
      const response = await axios.get(url, {
        params: {
          access_token: fbToken,
          ids: chunk.join(','),
          fields: 'id,name,status,daily_budget,lifetime_budget,budget_remaining,created_time'
        }
      });
      for (const id of Object.keys(response.data)) {
        const item = response.data[id];
        map.set(id, {
          name: item.name,
          status: item.status,
          dailyBudget: item.daily_budget ? Number(item.daily_budget) : 0,
          lifetimeBudget: item.lifetime_budget ? Number(item.lifetime_budget) : 0,
          createdTime: item.created_time
        });
      }
    } catch (error) {
      console.error('fetchCampaignMetaMap error:', error.message);
    }
  }
  return map;
}

async function upsertDailyCampaign(accountId, campaignId, date, update) {
  const query = { accountId, campaignId, date };
  const doc = {
    ...update,
    accountId,
    campaignId,
    date,
    updatedAt: new Date()
  };

  const result = await Campaign.findOneAndUpdate(query, { $set: doc }, { upsert: true, new: true });
  console.log(`Upserted campaign ${campaignId} (${update.name}): spend=${update.spend}`);
  return result;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const account = await Account.findOne({ name: 'XK11' }).lean();

  console.log('Fetching Shopee Account Data manually for XK11...');
  
  const today = todayStr();
  console.log('Today is:', today);

  const { fbToken } = await getEffectiveSecrets(account);
  console.log('Token exists:', !!fbToken);

  if (fbToken) {
    const insights = await fetchAccountInsightsInRange(account, today, today);
    console.log(`Fetched ${insights.length} insights.`);

    const metricInsights = [];
    const campaignIds = new Set();
    for (const insight of insights) {
      if (!insight.campaign_id) continue;
      const spend = parseFloat(insight.spend || 0);
      const impressions = parseInt(insight.impressions || 0, 10);
      const clicks = parseInt(insight.clicks || 0, 10);
      if (spend <= 0 && impressions <= 0 && clicks <= 0) continue;
      metricInsights.push({ ...insight, spend, impressions, clicks });
      campaignIds.add(String(insight.campaign_id));
    }
    console.log(`Filtered ${metricInsights.length} metric insights with spend/impressions/clicks > 0.`);

    const campaignMetaById = await fetchCampaignMetaMap(fbToken, [...campaignIds]);
    console.log(`Fetched metadata for ${campaignMetaById.size} campaigns.`);

    for (const insight of metricInsights) {
      const campaignId = String(insight.campaign_id);
      const meta = campaignMetaById.get(campaignId) || {};
      const campaignUpdate = {
        ...meta,
        bidAmount: 0,
        name: insight.campaign_name,
        spend: insight.spend,
        impressions: insight.impressions,
        clicks: insight.clicks,
        messages: 0,
        costPerMessage: 0
      };
      await upsertDailyCampaign(account._id, campaignId, today, campaignUpdate);
    }
  }

  await mongoose.connection.close();
}

main().catch(console.error);
