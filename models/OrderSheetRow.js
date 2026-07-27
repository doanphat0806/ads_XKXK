const mongoose = require('mongoose');

const orderSheetRowSchema = new mongoose.Schema({
  rowNumber: { type: Number, required: true },
  source: { type: String, default: 'google_sheet' },
  orderId: { type: String, default: '' },
  status: { type: String, default: '' },
  customerName: { type: String, default: '' },
  totalPrice: { type: Number, default: 0 },
  orderCreatedAt: { type: String, default: '' },
  dateKey: { type: String, default: '' },
  rawData: { type: Object },
  batchId: { type: String, default: '' },
  syncedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

orderSheetRowSchema.index({ rowNumber: 1 }, { unique: true, name: 'order_sheet_row_rowNumber_unique' });
orderSheetRowSchema.index({ batchId: 1 }, { name: 'order_sheet_row_batchId' });

module.exports = mongoose.model('OrderSheetRow', orderSheetRowSchema);
