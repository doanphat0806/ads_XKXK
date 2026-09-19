'use strict';
const mongoose = require('mongoose');

const ShopeeSocialOrderSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: String, required: true },
  itemId: { type: String, default: '' },
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

// Unique per (order, item): affiliate reports have one row per item, and a single order
// can list several items — keying on orderId alone made a second item's row overwrite the
// first's, silently dropping its commission/GMV from the totals.
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, orderId: 1, itemId: 1 },
  { unique: true, name: 'shopee_social_order_user_order_item_unique' }
);
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, orderTime: 1 },
  { name: 'shopee_social_order_user_time' }
);
ShopeeSocialOrderSchema.index(
  { ownerUserId: 1, subIds: 1 },
  { name: 'shopee_social_order_user_subids' }
);

module.exports = mongoose.model('ShopeeSocialOrder', ShopeeSocialOrderSchema);
