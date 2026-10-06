const mongoose = require('mongoose');

// Tien do dong bo don hang tu Pancake POS vao bang Order
const PosOrderSyncStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  shopId: { type: String, default: '' },
  backfillFrom: { type: String, default: '' },
  // 'desc': tai tu hom nay lui ve backfillFrom
  backfillDirection: { type: String, default: '' },
  // Ngay (YYYY-MM-DD, gio VN) som nhat da tai du don; tai xong -> backfillDone
  backfillCursor: { type: String, default: '' },
  backfillDone: { type: Boolean, default: false },
  backfillDoneAt: { type: Date, default: null },
  lastSyncedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PosOrderSyncState', PosOrderSyncStateSchema);
