const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  sourceId: { type: String, required: true },
  sourceName: { type: String, required: true },
  orderId: { type: String, required: true },
  status: { type: String, default: '' },
  receivedQuantity: { type: String, default: '' },
  skuManual: { type: String, default: '' },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

PurchaseOrderSchema.index(
  { sourceId: 1, sourceName: 1, orderId: 1 },
  { unique: true, name: 'purchase_order_source_order_unique' }
);
PurchaseOrderSchema.index(
  { sourceId: 1, sourceName: 1, orderId: 1, status: 1 },
  { name: 'purchase_order_source_order_status_cover' }
);
PurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, status: 1 }, { name: 'purchase_order_source_status' });
PurchaseOrderSchema.index({ updatedAt: -1 }, { name: 'purchase_order_updated' });

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
