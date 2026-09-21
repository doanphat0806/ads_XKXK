'use strict';
const mongoose = require('mongoose');

const ShopeeSocialOrderSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountName: { type: String, default: '' },
  orderId: { type: String, required: true },
  itemId: { type: String, default: '' },
  modelId: { type: String, default: '' },
  promotionId: { type: String, default: '' },
  itemName: { type: String, default: '' },
  shopId: { type: String, default: '' },
  shopName: { type: String, default: '' },
  gmv: { type: Number, default: 0 },
  commissionShopee: { type: Number, default: 0 },
  commissionXtra: { type: Number, default: 0 },
  commissionTotal: { type: Number, default: 0 },
  channelRaw: { type: String, default: '' },
  channel: { type: String, default: 'other' },
  statusRaw: { type: String, default: '' },
  status: { type: String, default: 'other' },
  orderTime: { type: Date },
  subIds: { type: [String], default: [] },
  subIdKey: { type: String, default: '' },
  platformKey: { type: String, default: 'khac' },
  platformLabel: { type: String, default: '' },
  sourceFileName: { type: String, default: '' },
  importedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

// Unique per (order, item, model, promotion): affiliate reports have one row per item —
// buying several variants (size/color) of the SAME product shares one Item id with a
// different Model id per row, and Shopee can even split the same item+model across two
// rows under different promotions/vouchers within one order. Keying on fewer fields let
// a later row overwrite an earlier one, silently dropping its commission/GMV — the exact
// "báo cáo 600k nhưng import chỉ còn 500k" bug.
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, orderId: 1, itemId: 1, modelId: 1, promotionId: 1 },
  { unique: true, name: 'shopee_social_order_user_order_item_model_promo_unique' }
);
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, orderTime: 1 },
  { name: 'shopee_social_order_user_time' }
);
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, subIds: 1 },
  { name: 'shopee_social_order_user_subids' }
);
// Lets a Shopee AFF account's orders be filtered or bulk-deleted separately from the
// other accounts a user has imported reports for.
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, accountName: 1 },
  { name: 'shopee_social_order_user_account' }
);

module.exports = mongoose.model('ShopeeSocialOrder', ShopeeSocialOrderSchema);
