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

async function runPersist(rows) {
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

let persistRunning = false;
let queuedRows = null;

/**
 * Ghi lai toan bo dong du lieu Sheet vao MongoDB lam ban sao ben (durable cache).
 * Cac dong khong con trong lan dong bo nay (batchId khac) se bi xoa.
 *
 * Cac lan goi duoc gom lai (coalesced) thay vi chay song song: voi sheet ~90k+ dong,
 * mot lan bulkWrite co the mat hon 1 phut, nen neu khong gom lai, lan ghi giu snapshot
 * cu hon nhung hoan tat sau se xoa mat nhung dong moi ma lan ghi khac vua luu.
 */
async function persistOrderSheetRows(rows = []) {
  if (!rows.length) return;
  queuedRows = rows;
  if (persistRunning) return;

  persistRunning = true;
  try {
    while (queuedRows) {
      const toPersist = queuedRows;
      queuedRows = null;
      await runPersist(toPersist);
    }
  } finally {
    persistRunning = false;
  }
}

async function loadOrderSheetRowsFromDb() {
  const docs = await OrderSheetRow.find().select('-_id -__v -batchId -syncedAt').sort({ rowNumber: 1 }).lean();
  return docs.map(documentToRow);
}

module.exports = {
  persistOrderSheetRows,
  loadOrderSheetRowsFromDb
};
