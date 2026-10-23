'use strict';

// Chuyen cau hinh Hieu qua Sale / Listing giua 2 database (vd may local -> VPS):
// page token Pancake, nhan vien sale, lich ca, ten nhan vien Listing.
//   Xuat: node scripts/saleConfigTransfer.js export sale-config.json
//   Nhap: node scripts/saleConfigTransfer.js import sale-config.json
// File chua page access token -> xoa file sau khi nhap xong, khong commit.

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Config = require('../models/Config');

const FIELDS = ['pancakeStatsPages', 'saleStaffIds', 'saleShiftSchedule', 'saleShiftSchedules', 'saleStaffAliases', 'saleStaffNames', 'listingStaffNames'];
const [mode, file] = process.argv.slice(2);

async function main() {
  if (!['export', 'import'].includes(mode) || !file) {
    throw new Error('Dung: node scripts/saleConfigTransfer.js export|import <file.json>');
  }
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager');

  if (mode === 'export') {
    const config = await Config.findOne({ key: 'app' }).select(FIELDS.join(' ')).lean();
    const data = Object.fromEntries(FIELDS.map(field => [field, config?.[field] ?? null]));
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Da xuat ${file}: ${(data.pancakeStatsPages || []).length} page, ${(data.saleStaffIds || []).length} nhan vien sale`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const update = Object.fromEntries(FIELDS.filter(field => data[field] !== null && data[field] !== undefined).map(field => [field, data[field]]));
  await Config.updateOne({ key: 'app' }, { $set: { ...update, updatedAt: new Date() } }, { upsert: true });
  console.log(`Da nhap: ${Object.keys(update).join(', ')}. Khoi dong lai server (hoac doi 30s cache) de ap dung.`);
}

main()
  .catch(error => {
    console.error('Loi:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
