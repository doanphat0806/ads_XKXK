const mongoose = require('mongoose');

const FacebookAiChatMessageSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: String, enum: ['gemini', 'claude', 'openai'], required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

FacebookAiChatMessageSchema.index({ ownerUserId: 1, provider: 1, createdAt: 1 }, { name: 'fbai_chat_owner_provider_createdAt' });

module.exports = mongoose.model('FacebookAiChatMessage', FacebookAiChatMessageSchema);
