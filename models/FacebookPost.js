const mongoose = require('mongoose');

const FacebookPostSchema = new mongoose.Schema({
  postId: { type: String, required: true, unique: true },
  pageId: { type: String, index: true },
  pageName: { type: String },
  pageAvatar: { type: String },
  message: { type: String, default: '' },
  createdTime: { type: Date },
  permalink: { type: String },
  picture: { type: String },
  shares: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  rawData: { type: Object },
  fetchedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
FacebookPostSchema.index({ pageId: 1, createdTime: -1 });
FacebookPostSchema.index({ createdTime: -1, fetchedAt: -1 }, { name: 'post_created_fetched_desc' });
FacebookPostSchema.index({ pageId: 1, createdTime: -1, fetchedAt: -1 }, { name: 'post_page_created_fetched_desc' });

module.exports = mongoose.model('FacebookPost', FacebookPostSchema);
