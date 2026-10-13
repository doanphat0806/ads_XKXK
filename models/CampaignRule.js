const mongoose = require('mongoose');

// Quy tac auto rieng cho tung camp. Khong gan vao Campaign vi Campaign luu theo
// tung ngay (moi ngay 1 document) -> rule se mat khi sang ngay moi.
// - mode 'skip': auto khong bao gio tat/bat camp nay.
// - mode 'custom': `limits` ghi de cac nguong cua cau hinh chung (cung ten key,
//   xem utils/campaignRuleLimits.js). Key khong co trong `limits` = dung nguong chung.
const CampaignRuleSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  campaignId: { type: String, required: true },
  campaignName: { type: String, default: '' },
  mode: { type: String, enum: ['skip', 'custom'], default: 'custom' },
  limits: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

CampaignRuleSchema.index({ accountId: 1, campaignId: 1 }, { unique: true, name: 'campaignRule_account_campaign' });
CampaignRuleSchema.index({ ownerUserId: 1 }, { name: 'campaignRule_owner' });

module.exports = mongoose.model('CampaignRule', CampaignRuleSchema);
