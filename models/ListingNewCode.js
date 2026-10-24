const mongoose = require('mongoose');

// Ma moi dang (tu file Excel ma moi upload hang tuan). code luu dang chuan hoa, bo tien to "MS" (vd "DH2608478").
const ListingNewCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  letter: { type: String, default: '' },
  postedDate: { type: String, required: true }, // YYYY-MM-DD (gio VN)
  // Nguoi giu ma = ten tab trong file ma team Z (vd "Khánh"); rong = chia theo chu cai dau ma
  owner: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});
ListingNewCodeSchema.index({ postedDate: 1 }, { name: 'listing_new_code_posted_date' });
ListingNewCodeSchema.index({ owner: 1 }, { name: 'listing_new_code_owner' });

module.exports = mongoose.model('ListingNewCode', ListingNewCodeSchema);
