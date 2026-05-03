const mongoose = require('mongoose');

const FacebookTokenSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'facebook_user' },
  appId: { type: String, default: '' },
  appSecret: { type: String, default: '' },
  token: { type: String, required: true },
  expires_at: { type: Date },
  last_refresh_time: { type: Date },
  last_debug_time: { type: Date },
  last_error: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FacebookToken', FacebookTokenSchema);
