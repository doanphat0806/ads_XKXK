const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  status: { type: String },
  customerName: { type: String },
  totalPrice: { type: Number },
  rawData: { type: Object },
  createdAt: { type: Date, default: Date.now }
});
OrderSchema.index({ createdAt: -1 }, { name: 'order_createdAt_desc' });
OrderSchema.index({ status: 1, createdAt: -1 }, { name: 'order_status_createdAt' });
OrderSchema.index({ createdAt: -1, status: 1, 'rawData.is_deleted': 1 }, { name: 'order_createdAt_status_deleted' });

module.exports = mongoose.model('Order', OrderSchema);
