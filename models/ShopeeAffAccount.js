'use strict';
const mongoose = require('mongoose');

// A user-maintained list of Shopee Affiliate account names, so the Shopee Social
// upload panel can offer a "pick one" dropdown instead of retyping a name every time.
const ShopeeAffAccountSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  // SubID2/campaign name prefix that identifies this account (e.g. "1307A" vs "1307B"
  // for two accounts sharing the "1307" batch code). Lets ad spend be attributed to the
  // right account even for campaigns that haven't produced a completed order yet — an
  // order-based match alone would silently drop that spend from every account's total.
  subIdPrefix: { type: String, default: '', trim: true },
  // Explicit ad accounts (Account docs, provider=shopee) hand-picked as "belonging" to
  // this AFF account. When empty, this account falls back to every ad account NOT
  // explicitly claimed by another AFF account (see accountTrend.js resolveAdAccountScope)
  // — so picking an ad account for one account implicitly excludes it from every other
  // account's default pool, without needing to touch their configs.
  adAccountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: [] }],
  createdAt: { type: Date, default: Date.now }
}, { autoIndex: false });

ShopeeAffAccountSchema.index(
  { ownerUserId: 1, name: 1 },
  { unique: true, name: 'shopee_aff_account_user_name_unique' }
);

module.exports = mongoose.model('ShopeeAffAccount', ShopeeAffAccountSchema);
