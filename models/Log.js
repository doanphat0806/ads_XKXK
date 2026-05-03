const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  accountName: { type: String },
  level: { type: String, enum: ['info', 'success', 'warn', 'error', 'ai'], default: 'info' },
  message: { type: String },
  createdAt: { type: Date, default: Date.now }
});

LogSchema.index({ createdAt: -1 }, { name: 'log_createdAt_desc' });
LogSchema.index({ accountId: 1, createdAt: -1 }, { name: 'log_account_createdAt_desc' });

module.exports = mongoose.model('Log', LogSchema);
