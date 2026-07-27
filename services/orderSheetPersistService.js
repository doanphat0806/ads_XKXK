'use strict';

const OrderSheetRow = require('../models/OrderSheetRow');

const BULK_WRITE_SIZE = 1000;

function rowToDocument(row = {}, batchId) {
  return {
    rowNumber: Number(row.rawData?.rowNumber || 0),
    source: row.source || 'google_sheet',
    orderId: row.orderId || '',
    status: row.status || '',
    customerName: row.customerName || '',
    totalPrice: Number(row.totalPrice || 0),
    orderCreatedAt: row.createdAt || '',
    dateKey: row.dateKey || '',
    rawData: row.rawData || {},
    batchId,
    syncedAt: new Date()
  };
}

function documentToRow(doc = {}) {
  return {
    source: doc.source,
    orderId: doc.orderId,
    status: doc.status,
    customerName: doc.customerName,
    totalPrice: doc.totalPrice,
    createdAt: doc.orderCreatedAt,
    dateKey: doc.dateKey,
    rawData: doc.rawData || {}
  };
}

/**
 * Ghi lai toan bo dong du lieu Sheet vao MongoDB lam ban sao ben (durable cache).
 * Cac dong khong con trong lan dong bo nay (batchId khac) se bi xoa.
 */
async function persistOrderSheetRows(rows = []) {
  if (!rows.length) return;

  const batchId = String(Date.now());
  for (let start = 0; start < rows.length; start += BULK_WRITE_SIZE) {
    const chunk = rows.slice(start, start + BULK_WRITE_SIZE);
    const operations = chunk.map(row => ({
      updateOne: {
        filter: { rowNumber: Number(row.rawData?.rowNumber || 0) },
        update: { $set: rowToDocument(row, batchId) },
        upsert: true
      }
    }));
    await OrderSheetRow.bulkWrite(operations, { ordered: false });
  }

  await OrderSheetRow.deleteMany({ batchId: { $ne: batchId } });
}

async function loadOrderSheetRowsFromDb() {
  const docs = await OrderSheetRow.find().select('-_id -__v -batchId -syncedAt').sort({ rowNumber: 1 }).lean();
  return docs.map(documentToRow);
}

module.exports = {
  persistOrderSheetRows,
  loadOrderSheetRowsFromDb
};
