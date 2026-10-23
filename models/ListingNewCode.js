const mongoose = require('mongoose');

// Ma moi dang (tu file Excel ma moi upload hang tuan). code luu dang chuan hoa, bo tien to "MS" (vd "DH2608478").
const ListingNewCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  letter: { type: String, default: '' },
  postedDate: { type: String, required: true }, // YYYY-MM-DD (gio VN)
  updatedAt: { type: Date, default: Date.now }
});
ListingNewCodeSchema.index({ postedDate: 1 }, { name: 'listing_new_code_posted_date' });

module.exports = mongoose.model('ListingNewCode', ListingNewCodeSchema);
