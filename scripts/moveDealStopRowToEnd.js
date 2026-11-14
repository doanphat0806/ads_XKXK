'use strict';

// Chuyen 1 (hoac nhieu) ma ve cuoi danh sach dong da luu cua bang Dong Deal Dung Order.
// Dung khi ma bi day len dau bang do ban cu cua PATCH /api/deal-stop/state/row chen
// ma moi len dau. Khong dong vao ghi chu / order size (van giu nguyen).
//
// Cach dung: node scripts/moveDealStopRowToEnd.js PN1011436 [MA_KHAC ...]
// Luu y: dong cac tab dang mo bang Dong Deal truoc khi chay (tab dang mo se tu luu
// lai thu tu cu), chay xong thi mo lai trang.

require('dotenv').config();
const mongoose = require('mongoose');

const TAB_ID = 'tong-sl-hang-dat-new';

function normalizeCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

async function main() {
  const codes = process.argv.slice(2).map(normalizeCode).filter(Boolean);
  if (!codes.length) {
    console.log('Cach dung: node scripts/moveDealStopRowToEnd.js <MA> [MA ...]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('configs');
  const config = await col.findOne({ key: 'app' }, { projection: { dealStopOrderState: 1 } });
  const rows = config?.dealStopOrderState?.rowsByTab?.[TAB_ID];
  if (!Array.isArray(rows)) {
    console.log('Khong co du lieu bang Dong Deal');
    await mongoose.disconnect();
    return;
  }

  const moved = [];
  const kept = rows.filter(row => {
    if (codes.includes(normalizeCode(row?.ma))) {
      moved.push(row);
      return false;
    }
    return true;
  });

  if (!moved.length) {
    console.log(`Khong tim thay ma ${codes.join(', ')} trong cac dong da luu`);
    await mongoose.disconnect();
    return;
  }

  await col.updateOne(
    { key: 'app' },
    {
      $set: {
        [`dealStopOrderState.rowsByTab.${TAB_ID}`]: [...kept, ...moved],
        'dealStopOrderState.updatedAt': new Date().toISOString(),
        updatedAt: new Date()
      }
    }
  );
  console.log(`Da chuyen ${moved.map(row => row.ma).join(', ')} ve cuoi bang (${rows.length} dong)`);
  await mongoose.disconnect();
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
