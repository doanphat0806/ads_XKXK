'use strict';
const mongoose = require('mongoose');

// Manual ledger of actual commission money Shopee has paid out to an AFF account.
// The uploaded order report's commissionTotal is Shopee's calculated figure at order
// time — it can still change (returns, cancellations found later) before the real
// payout lands, so this is entered by hand once the money is actually received.
const ShopeeAffCommissionReceiptSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountName: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  amount: { type: Number, required: true },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { autoIndex: false });

ShopeeAffCommissionReceiptSchema.index(
  { ownerUserId: 1, accountName: 1, date: 1 },
  { name: 'shopee_aff_commission_receipt_user_account_date' }
);

module.exports = mongoose.model('ShopeeAffCommissionReceipt', ShopeeAffCommissionReceiptSchema);
