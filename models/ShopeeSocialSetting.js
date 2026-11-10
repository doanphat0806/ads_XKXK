'use strict';
const mongoose = require('mongoose');

// Cai dat nhap tay cua trang Shopee Social (truoc chi luu localStorage -> doi trinh duyet / xoa cache la mat):
// CPC mac dinh, CPC + so click nhap tay theo SubID2 (hoac tu bao cao click), ten file bao cao gan nhat.
// Moi user 1 document.
const ShopeeSocialSettingSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  defaultCpc: { type: Number, default: 0 },
  cpcBySubId: { type: mongoose.Schema.Types.Mixed, default: {} },
  clicksBySubId: { type: mongoose.Schema.Types.Mixed, default: {} },
  fileName: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false, minimize: false });

ShopeeSocialSettingSchema.index(
  { ownerUserId: 1 },
  { unique: true, name: 'shopee_social_setting_owner' }
);

module.exports = mongoose.model('ShopeeSocialSetting', ShopeeSocialSettingSchema);
