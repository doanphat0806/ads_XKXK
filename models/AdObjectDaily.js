const mongoose = require('mongoose');

// So lieu theo ngay (gio VN, theo date_start cua Meta Insights) cua 1 nhom quang cao / quang cao.
// Ngay khong co chi tieu thi khong co document (coi nhu 0).
const AdObjectDailySchema = new mongoose.Schema({
  level: { type: String, enum: ['adset', 'ad'], required: true },
  objectId: { type: String, required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  campaignId: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  spend: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  reach: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  linkClicks: { type: Number, default: 0 },
  engagements: { type: Number, default: 0 },
  messages: { type: Number, default: 0 },
  metaOrders: { type: Number, default: 0 }
}, { versionKey: false });

AdObjectDailySchema.index({ level: 1, objectId: 1, date: 1 }, { unique: true, name: 'ad_object_daily_unique' });
AdObjectDailySchema.index({ accountId: 1, level: 1, campaignId: 1, date: 1 }, { name: 'ad_object_daily_account_level_campaign_date' });

module.exports = mongoose.model('AdObjectDaily', AdObjectDailySchema);
