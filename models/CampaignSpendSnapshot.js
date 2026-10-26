const mongoose = require('mongoose');
const { parseBoundedInt } = require('../utils/number');

// Moi lan sync chi tieu hom nay cua 1 tai khoan -> 1 document chua so LUY KE trong ngay cua cac camp.
// Lay 2 snapshot (gan nhat truoc moc bat dau / ket thuc) tru nhau -> chi tieu theo phut,
// vi Meta Insights chi chia nho nhat theo gio.
const SNAPSHOT_TTL_DAYS = parseBoundedInt(process.env.CAMPAIGN_SNAPSHOT_TTL_DAYS, 30, 1, 365);

const SnapshotItemSchema = new mongoose.Schema({
  c: { type: String, required: true }, // campaignId
  s: { type: Number, default: 0 }, // spend
  o: { type: Number, default: 0 }, // metaOrders
  cl: { type: Number, default: 0 }, // clicks
  im: { type: Number, default: 0 }, // impressions
  lc: { type: Number, default: 0 }, // linkClicks
  en: { type: Number, default: 0 }, // engagements
  m: { type: Number, default: 0 } // messages
}, { _id: false });

const CampaignSpendSnapshotSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  provider: { type: String, default: 'facebook' },
  date: { type: String, required: true }, // YYYY-MM-DD gio VN
  at: { type: Date, required: true },
  items: { type: [SnapshotItemSchema], default: [] }
}, { autoIndex: false, versionKey: false });

CampaignSpendSnapshotSchema.index({ accountId: 1, date: 1, at: 1 }, { name: 'snapshot_account_date_at' });
CampaignSpendSnapshotSchema.index(
  { at: 1 },
  { name: 'snapshot_ttl', expireAfterSeconds: SNAPSHOT_TTL_DAYS * 24 * 60 * 60 }
);

module.exports = mongoose.model('CampaignSpendSnapshot', CampaignSpendSnapshotSchema);
