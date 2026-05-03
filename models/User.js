const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  displayName: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  provider: { type: String, enum: ['facebook', 'shopee'], default: 'facebook' },
  fbToken: { type: String, default: '' },
  fbTokenExpiresAt: { type: Date },
  fbTokenLastRefreshTime: { type: Date },
  fbTokenLastDebugTime: { type: Date },
  fbTokenLastRefreshError: { type: String, default: '' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

UserSchema.index({ username: 1 }, { unique: true, name: 'user_username_unique' });

module.exports = mongoose.model('User', UserSchema);
