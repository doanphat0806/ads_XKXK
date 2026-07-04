'use strict';

const Account = require('../models/Account');
const Campaign = require('../models/Campaign');
const FacebookPost = require('../models/FacebookPost');

const TOP_CAMPAIGN_LIMIT = 10;
const RECENT_POST_LIMIT = 20;
const POST_MESSAGE_MAX_LENGTH = 200;

function truncate(text, maxLength) {
  const value = String(text || '').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

async function buildFacebookContext({ ownerUserId, from, to }) {
  const accounts = await Account.find({ ownerUserId, provider: 'facebook' })
    .select('_id name adAccountId status linkedPageIds')
    .lean();

  const accountIds = accounts.map(account => account._id);
  const linkedPageIds = [...new Set(accounts.flatMap(account => account.linkedPageIds || []))];

  const campaigns = accountIds.length
    ? await Campaign.find({ accountId: { $in: accountIds }, date: { $gte: from, $lte: to } })
      .select('accountId name status spend impressions clicks messages costPerMessage date')
      .lean()
    : [];

  const accountNameById = new Map(accounts.map(account => [String(account._id), account.name]));
  const totalsByAccount = new Map();
  for (const campaign of campaigns) {
    const key = String(campaign.accountId);
    const totals = totalsByAccount.get(key) || { accountId: key, accountName: accountNameById.get(key) || '', spend: 0, impressions: 0, clicks: 0, messages: 0 };
    totals.spend += Number(campaign.spend || 0);
    totals.impressions += Number(campaign.impressions || 0);
    totals.clicks += Number(campaign.clicks || 0);
    totals.messages += Number(campaign.messages || 0);
    totalsByAccount.set(key, totals);
  }

  const campaignByKey = new Map();
  for (const campaign of campaigns) {
    const key = `${campaign.accountId}:${campaign.name}`;
    const existing = campaignByKey.get(key) || {
      accountName: accountNameById.get(String(campaign.accountId)) || '',
      name: campaign.name,
      status: campaign.status,
      spend: 0,
      impressions: 0,
      clicks: 0,
      messages: 0
    };
    existing.spend += Number(campaign.spend || 0);
    existing.impressions += Number(campaign.impressions || 0);
    existing.clicks += Number(campaign.clicks || 0);
    existing.messages += Number(campaign.messages || 0);
    existing.status = campaign.status || existing.status;
    campaignByKey.set(key, existing);
  }

  const topCampaigns = [...campaignByKey.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_CAMPAIGN_LIMIT)
    .map(campaign => ({
      ...campaign,
      costPerMessage: campaign.messages > 0 ? Math.round(campaign.spend / campaign.messages) : 0
    }));

  const recentPosts = linkedPageIds.length
    ? await FacebookPost.find({
      pageId: { $in: linkedPageIds },
      createdTime: { $gte: new Date(from), $lte: new Date(`${to}T23:59:59.999Z`) }
    })
      .sort({ createdTime: -1 })
      .limit(RECENT_POST_LIMIT * 3)
      .select('pageName message createdTime likes comments shares permalink')
      .lean()
    : [];

  const rankedPosts = recentPosts
    .map(post => ({
      pageName: post.pageName || '',
      message: truncate(post.message, POST_MESSAGE_MAX_LENGTH),
      createdTime: post.createdTime,
      likes: post.likes || 0,
      comments: post.comments || 0,
      shares: post.shares || 0,
      permalink: post.permalink || '',
      engagement: (post.likes || 0) + (post.comments || 0) + (post.shares || 0)
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, RECENT_POST_LIMIT);

  return {
    range: { from, to },
    accounts: accounts.map(account => ({
      name: account.name,
      adAccountId: account.adAccountId,
      status: account.status
    })),
    accountTotals: [...totalsByAccount.values()],
    topCampaigns,
    recentPosts: rankedPosts
  };
}

function buildFacebookSystemPrompt(context, mode = 'chat') {
  const dataJson = JSON.stringify(context, null, 2);
  const baseInstructions = `Bạn là trợ lý AI phân tích dữ liệu quảng cáo và trang Facebook của người dùng.
Chỉ được trả lời dựa trên dữ liệu JSON cung cấp bên dưới (khoảng thời gian ${context.range.from} đến ${context.range.to}). Nếu dữ liệu không đủ để trả lời, hãy nói rõ là không đủ dữ liệu thay vì bịa số liệu.
Luôn trả lời bằng tiếng Việt.

Dữ liệu:
${dataJson}`;

  if (mode === 'report') {
    return `${baseInstructions}

Hãy viết một báo cáo ngắn gọn gồm:
1. Tổng quan chi tiêu và hiệu quả theo từng tài khoản
2. Chiến dịch tốt nhất và kém nhất, kèm lý do
3. Hiệu quả tương tác các bài đăng nổi bật (nếu có)
4. 2-3 đề xuất hành động cụ thể tiếp theo`;
  }

  return baseInstructions;
}

module.exports = { buildFacebookContext, buildFacebookSystemPrompt };
