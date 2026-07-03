const mongoose = require('mongoose');

const ShopeeAffAccountSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  shopeeSubId2Codes: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

ShopeeAffAccountSchema.index({ ownerUserId: 1, createdAt: -1 }, { name: 'shopee_aff_owner_createdAt' });

module.exports = mongoose.model('ShopeeAffAccount', ShopeeAffAccountSchema);
