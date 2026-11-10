const mongoose = require('mongoose');

// Nhom quang cao (level=adset) / quang cao (level=ad) cua Facebook - ban moi nhat (ten, trang thai, ngan sach, creative).
// So lieu theo ngay nam o AdObjectDaily. Dong bo tu services/adObjectService.js.
const AdObjectSchema = new mongoose.Schema({
  level: { type: String, enum: ['adset', 'ad'], required: true },
  objectId: { type: String, required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  campaignId: { type: String, required: true },
  campaignName: { type: String, default: '' },
  adsetId: { type: String, default: '' },
  adsetName: { type: String, default: '' },
  name: { type: String, default: '' },
  status: { type: String, default: '' },
  effectiveStatus: { type: String, default: '' },
  dailyBudget: { type: Number, default: 0 },
  lifetimeBudget: { type: Number, default: 0 },
  budgetType: { type: String, default: '' },
  bidAmount: { type: Number, default: 0 },
  optimizationGoal: { type: String, default: '' },
  creativeId: { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  storyId: { type: String, default: '' },
  body: { type: String, default: '' },
  title: { type: String, default: '' },
  createdTime: { type: Date },
  syncedAt: { type: Date, default: Date.now }
}, { versionKey: false });

AdObjectSchema.index({ level: 1, objectId: 1 }, { unique: true, name: 'ad_object_level_object_unique' });
AdObjectSchema.index({ accountId: 1, level: 1, campaignId: 1 }, { name: 'ad_object_account_level_campaign' });

module.exports = mongoose.model('AdObject', AdObjectSchema);
