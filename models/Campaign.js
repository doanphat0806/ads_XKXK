const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  campaignId: { type: String, required: true },
  name: { type: String },
  status: { type: String },
  dailyBudget: { type: Number, default: 0 },
  lifetimeBudget: { type: Number, default: 0 },
  budgetType: { type: String, default: 'DAILY' },
  createdTime: { type: Date },
  spend: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  messages: { type: Number, default: 0 },
  costPerMessage: { type: Number, default: 0 },
  date: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

CampaignSchema.index(
  { accountId: 1, campaignId: 1, date: 1 },
  {
    unique: true,
    name: 'campaign_daily_unique',
    partialFilterExpression: { date: { $type: 'string' } }
  }
);
CampaignSchema.index({ date: 1, spend: -1 }, { name: 'campaign_date_spend' });
CampaignSchema.index({ accountId: 1, date: 1, spend: -1 }, { name: 'campaign_account_date_spend' });
CampaignSchema.index({ date: 1, campaignId: 1, accountId: 1 }, { name: 'campaign_date_campaign_account' });
CampaignSchema.index({ accountId: 1, date: 1, campaignId: 1 }, { name: 'campaign_account_date_campaign' });

module.exports = mongoose.model('Campaign', CampaignSchema);
