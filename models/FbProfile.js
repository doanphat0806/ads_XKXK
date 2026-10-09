const mongoose = require('mongoose');

// VIA: mot tai khoan Facebook ca nhan da dang nhap qua OAuth. Moi VIA giu token rieng;
// tai khoan quang cao nhap tu VIA nao thi dung token cua VIA do (Account.fbProfileId).
const FbProfileSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fbUserId: { type: String, required: true },
  name: { type: String, default: '' },
  pictureUrl: { type: String, default: '' },
  token: { type: String, required: true },
  expiresAt: { type: Date },
  lastLoginAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

FbProfileSchema.index({ ownerUserId: 1, fbUserId: 1 }, { unique: true, name: 'fbprofile_owner_fbuser' });

module.exports = mongoose.model('FbProfile', FbProfileSchema);
