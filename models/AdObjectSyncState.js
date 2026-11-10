const mongoose = require('mongoose');

// Lan cuoi dong bo nhom QC / quang cao cua 1 camp trong 1 ngay -> biet du lieu trong DB con moi hay can lay lai.
const AdObjectSyncStateSchema = new mongoose.Schema({
  level: { type: String, enum: ['adset', 'ad'], required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  campaignId: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  syncedAt: { type: Date, required: true }
}, { versionKey: false });

AdObjectSyncStateSchema.index(
  { level: 1, accountId: 1, campaignId: 1, date: 1 },
  { unique: true, name: 'ad_object_sync_state_unique' }
);

module.exports = mongoose.model('AdObjectSyncState', AdObjectSyncStateSchema);
