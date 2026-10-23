'use strict';

// Bo sung nhan vien chot don (rawData.seller_id/seller_name/seller_avatar) cho don POS cu,
// de trang Hieu qua Sale dem duoc "So don chot". Tai lai don tu POS roi upsert (khong tao don trung).
// Dung: node scripts/backfillPosSeller.js [so_ngay=60]

require('dotenv').config();
const mongoose = require('mongoose');
const { resyncPosOrdersRange } = require('../services/posOrderService');

const days = Math.max(1, Math.min(400, parseInt(process.argv[2] || '60', 10) || 60));

function vnDateString(offsetDays = 0) {
  return new Date(Date.now() + 7 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager');
  const fromDate = vnDateString(days - 1);
  const toDate = vnDateString(0);
  console.log(`Tai lai don POS ${fromDate}..${toDate} de bo sung nhan vien chot don...`);
  const startedAt = Date.now();
  const { total } = await resyncPosOrdersRange(fromDate, toDate, ({ cursor, total: count }) => {
    console.log(`- da xong tu ${cursor}: ${count} don`);
  });
  console.log(`Xong: ${total} don trong ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main()
  .catch(error => {
    console.error('Loi:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
