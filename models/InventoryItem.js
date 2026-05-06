const mongoose = require('mongoose');

const InventoryScanSchema = new mongoose.Schema({
  quantity: { type: Number, required: true },
  note: { type: String, default: '' },
  scannedAt: { type: Date, default: Date.now }
}, { _id: false });

const InventoryItemSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  warehouseName: { type: String, default: '' },
  barcode: { type: String, required: true, trim: true },
  name: { type: String, default: '' },
  salePrice: { type: String, default: '' },
  sheetRowNumbers: { type: [Number], default: [] },
  quantity: { type: Number, default: 0 },
  scans: { type: [InventoryScanSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

InventoryItemSchema.index({ ownerUserId: 1, barcode: 1 }, { unique: true, name: 'inventory_owner_barcode_unique' });
InventoryItemSchema.index({ ownerUserId: 1, updatedAt: -1 }, { name: 'inventory_owner_updatedAt' });
InventoryItemSchema.index({ ownerUserId: 1, warehouseName: 1, barcode: 1 }, { name: 'inventory_owner_warehouse_barcode' });
InventoryItemSchema.index({ ownerUserId: 1, warehouseName: 1, updatedAt: -1 }, { name: 'inventory_owner_warehouse_updatedAt' });

module.exports = mongoose.model('InventoryItem', InventoryItemSchema);
