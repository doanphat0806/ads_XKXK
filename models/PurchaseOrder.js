const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  sourceId: { type: String, required: true },
  sourceName: { type: String, required: true },
  orderId: { type: String, required: true },
  status: { type: String, default: '' },
  statusUpdatedBy: { type: String, default: '' },
  statusUpdatedByName: { type: String, default: '' },
  statusUpdatedAt: { type: Date, default: null },
  receivedQuantity: { type: String, default: '' },
  supplementalTrackingCode: { type: String, default: '' },
  skuManual: { type: String, default: '' },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

PurchaseOrderSchema.index(
  { sourceId: 1, sourceName: 1, orderId: 1 },
  {
    unique: true,
    name: 'purchase_order_source_order_unique',
    partialFilterExpression: {
      sourceId: { $type: 'string' },
      sourceName: { $type: 'string' },
      orderId: { $type: 'string' }
    }
  }
);
PurchaseOrderSchema.index(
  { sourceId: 1, sourceName: 1, orderId: 1, status: 1 },
  { name: 'purchase_order_source_order_status_cover' }
);
PurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, status: 1 }, { name: 'purchase_order_source_status' });
PurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, supplementalTrackingCode: 1 }, { name: 'purchase_order_source_supplemental_tracking' });
PurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, skuManual: 1 }, { name: 'purchase_order_source_sku_manual' });
PurchaseOrderSchema.index({ updatedAt: -1 }, { name: 'purchase_order_updated' });

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
