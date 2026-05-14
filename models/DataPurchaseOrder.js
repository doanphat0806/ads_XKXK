const mongoose = require('mongoose');

const DataPurchaseOrderSchema = new mongoose.Schema({
  sourceId: { type: String, required: true },
  sourceName: { type: String, required: true },
  sourceType: { type: String, default: 'google_sheet' },
  rowNumber: { type: Number, required: true },
  col1: { type: String, default: '' },
  col2: { type: String, default: '' },
  col3: { type: String, default: '' },
  col4: { type: String, default: '' },
  col5: { type: String, default: '' },
  col6: { type: String, default: '' },
  col7: { type: String, default: '' },
  col8: { type: String, default: '' },
  col10: { type: String, default: '' },
  col11: { type: String, default: '' },
  col13: { type: String, default: '' },
  col15: { type: String, default: '' },
  col16: { type: String, default: '' },
  col24: { type: String, default: '' },
  col25: { type: String, default: '' },
  col27: { type: String, default: '' },
  spec: { type: String, default: '' },
  productQuantity: { type: String, default: '' },
  logisticsTrackingCode: { type: String, default: '' },
  totalAmount: { type: String, default: '' },
  values: [{ key: String, value: String }],
  searchText: { type: String, default: '' },
  checksum: { type: String, default: '' },
  batchId: { type: String, default: '' },
  orderDateTime: { type: String, default: '' },
  orderDateKey: { type: String, default: '' },
  importedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { autoIndex: false });

DataPurchaseOrderSchema.index(
  { sourceId: 1, sourceName: 1, rowNumber: 1 },
  { unique: true, name: 'data_purchase_order_source_row_unique' }
);
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, updatedAt: -1 }, { name: 'data_purchase_order_source_updated' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, batchId: 1 }, { name: 'data_purchase_order_source_batch' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, orderDateTime: 1 }, { name: 'data_purchase_order_source_orderDateTime' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, orderDateKey: 1, col3: 1 }, { name: 'data_purchase_order_source_date_order' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, searchText: 1 }, { name: 'data_purchase_order_source_searchText' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, searchText: 'text' }, {
  name: 'data_purchase_order_search_text',
  default_language: 'none'
});
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, col1: 1 }, { name: 'data_purchase_order_source_col1' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, col2: 1 }, { name: 'data_purchase_order_source_col2' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, col3: 1 }, { name: 'data_purchase_order_source_col3' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, col4: 1 }, { name: 'data_purchase_order_source_col4' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, col10: 1 }, { name: 'data_purchase_order_source_col10' });
DataPurchaseOrderSchema.index({ sourceId: 1, sourceName: 1, col25: 1 }, { name: 'data_purchase_order_source_col25' });

module.exports = mongoose.model('DataPurchaseOrder', DataPurchaseOrderSchema);
