'use strict';
const mongoose = require('mongoose');

// So cai chi phi ads Shopee Social Affiliate: luu RIENG, khong phu thuoc Account/Campaign.
// Xoa TKQC (xoa Account + Campaign) thi chi phi da ghi o day van con -> bao cao Shopee Social
// van tinh chi phi cac ngay truoc; TK da xoa thi khong con dong bo nen khong phat sinh them.
//
// Khoa: user + ID TKQC Facebook (act_..., on dinh ke ca khi xoa roi them lai TK) + camp + ngay.
// Moi dong ghi kem acc Shopee AFF (ShopeeAffAccount) duoc gan luc ghi, de tinh rieng tung acc Shopee.
const ShopeeAdSpendSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adAccountId: { type: String, required: true }, // ID TKQC Facebook (act_...)
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }, // Account luc ghi (co the da bi xoa)
  accountName: { type: String, default: '' },
  shopeeAffAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopeeAffAccount', default: null },
  shopeeAffAccountName: { type: String, default: '' },
  campaignId: { type: String, required: true },
  campaignName: { type: String, default: '' },
  subId2: { type: String, default: '' },
  date: { type: String, required: true }, // YYYY-MM-DD (gio VN)
  spend: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  sourceUpdatedAt: { type: Date }, // Campaign.updatedAt cua lan chep gan nhat
  syncedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

ShopeeAdSpendSchema.index(
  { ownerUserId: 1, adAccountId: 1, campaignId: 1, date: 1 },
  { unique: true, name: 'shopee_ad_spend_unique' }
);
ShopeeAdSpendSchema.index({ ownerUserId: 1, date: 1 }, { name: 'shopee_ad_spend_owner_date' });
ShopeeAdSpendSchema.index({ ownerUserId: 1, shopeeAffAccountId: 1, date: 1 }, { name: 'shopee_ad_spend_owner_aff_date' });

module.exports = mongoose.model('ShopeeAdSpend', ShopeeAdSpendSchema);
