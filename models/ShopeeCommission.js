const mongoose = require('mongoose');

const ShopeeCommissionSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  subId2: { type: String, required: true },
  commission: { type: Number, default: 0 },
  rowCount: { type: Number, default: 0 },
  sourceFileName: { type: String, default: '' },
  importedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

ShopeeCommissionSchema.index(
  { ownerUserId: 1, date: 1, subId2: 1 },
  { unique: true, name: 'shopee_commission_owner_date_subid2_unique' }
);
ShopeeCommissionSchema.index(
  { ownerUserId: 1, date: 1, commission: -1 },
  { name: 'shopee_commission_owner_date_commission' }
);
ShopeeCommissionSchema.index(
  { ownerUserId: 1, subId2: 1, date: 1 },
  { name: 'shopee_commission_owner_subid2_date' }
);

module.exports = mongoose.model('ShopeeCommission', ShopeeCommissionSchema);
