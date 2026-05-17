const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  displayName: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  provider: { type: String, enum: ['facebook', 'shopee', 'oder'], default: 'facebook' },
  fbToken: { type: String, default: '' },
  fbTokenExpiresAt: { type: Date },
  fbTokenLastRefreshTime: { type: Date },
  fbTokenLastDebugTime: { type: Date },
  fbTokenLastRefreshError: { type: String, default: '' },
  googleAccessToken: { type: String, default: '' },
  googleRefreshToken: { type: String, default: '' },
  googleTokenExpiresAt: { type: Date },
  googleEmail: { type: String, default: '' },
  googleName: { type: String, default: '' },
  googleTokenScope: { type: String, default: '' },
  autoRuleStartTime: { type: String },
  autoRuleEndTime: { type: String },
  shopeeAutoRuleStartTime: { type: String },
  shopeeAutoRuleEndTime: { type: String },
  scheduledDuplicatePauseTime: { type: String },
  dailyZeroMessageSpendLimit: { type: Number },
  dailyHighCostPerMessageLimit: { type: Number },
  dailyHighCostSpendLimit: { type: Number },
  dailyClickLimit: { type: Number },
  dailyCpcLimit: { type: Number },
  lifetimeZeroMessageSpendLimit: { type: Number },
  lifetimeHighCostPerMessageLimit: { type: Number },
  lifetimeHighCostSpendLimit: { type: Number },
  lifetimeClickLimit: { type: Number },
  lifetimeCpcLimit: { type: Number },
  autoPauseCpoLimit: { type: Number },
  autoPauseZeroOrderSpendLimit: { type: Number },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

UserSchema.index({ username: 1 }, { unique: true, name: 'user_username_unique' });

module.exports = mongoose.model('User', UserSchema);
