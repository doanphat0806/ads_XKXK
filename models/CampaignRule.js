const mongoose = require('mongoose');

// Quy tac auto rieng cho tung camp. Khong gan vao Campaign vi Campaign luu theo
// tung ngay (moi ngay 1 document) -> rule se mat khi sang ngay moi.
// Khoa theo TKQC (adAccountId da chuan hoa act_...) + campaignId, KHONG theo Account._id:
// moi user nhap cung 1 TKQC thanh 1 Account rieng, khoa theo adAccountId thi moi user
// quan ly TKQC do deu thay va dung chung 1 bo quy tac.
// - mode 'skip': auto khong bao gio tat/bat camp nay.
// - mode 'custom': `limits` ghi de cac nguong cua cau hinh chung (cung ten key,
//   xem utils/campaignRuleLimits.js). Key khong co trong `limits` = dung nguong chung.
const CampaignRuleSchema = new mongoose.Schema({
  adAccountId: { type: String, required: true },
  campaignId: { type: String, required: true },
  // Account (cua user sua gan nhat) - chi de tham khao, khong dung lam khoa
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  campaignName: { type: String, default: '' },
  mode: { type: String, enum: ['skip', 'custom'], default: 'custom' },
  limits: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: '' }
  },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

CampaignRuleSchema.index({ adAccountId: 1, campaignId: 1 }, { unique: true, name: 'campaignRule_adAccount_campaign' });

module.exports = mongoose.model('CampaignRule', CampaignRuleSchema);
