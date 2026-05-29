'use strict';
const mongoose = require('mongoose');

const ShopeeCommissionOrderSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  subId2: { type: String, required: true },
  orderId: { type: String, required: true },
  orderStatus: { type: String, default: '' },
  itemName: { type: String, default: '' },
  orderValue: { type: Number, default: 0 },
  commission: { type: Number, default: 0 },
  actualCommissionRate: { type: Number, default: 0 },
  agreedCommissionRate: { type: Number, default: 0 },
  commissionStatus: { type: String, default: '' },
  channel: { type: String, default: '' },
  importedAt: { type: Date, default: Date.now },
}, { autoIndex: false });

ShopeeCommissionOrderSchema.index(
  { ownerUserId: 1, orderId: 1 },
  { unique: true, name: 'shopee_commission_order_user_order_unique' }
);
ShopeeCommissionOrderSchema.index(
  { ownerUserId: 1, date: 1, subId2: 1 },
  { name: 'shopee_commission_order_user_date_subid2' }
);
ShopeeCommissionOrderSchema.index(
  { ownerUserId: 1, date: 1 },
  { name: 'shopee_commission_order_user_date' }
);

module.exports = mongoose.model('ShopeeCommissionOrder', ShopeeCommissionOrderSchema);
