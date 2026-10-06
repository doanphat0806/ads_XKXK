// Liet ke chi phi QC va don khong vao nhom nao o bang 'Tong theo nhom' (Tong hoan). Chay: node scripts/check-cpo-groups.js [fromDate] [toDate]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const Order = require('../models/Order');
const { classifyReturnAdNameBucket, classifyReturnOrderTagBucket, getOrderTagText, buildOrderQuery } = require('../services/orderService');
(async () => {
  const [fromDate = '', toDate = ''] = process.argv.slice(2);
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager', { serverSelectionTimeoutMS: 5000 });
  const match = {};
  if (fromDate || toDate) { match.date = {}; if (fromDate) match.date.$gte = fromDate; if (toDate) match.date.$lte = toDate; }
  const ads = await Campaign.aggregate([{ $match: match }, { $group: { _id: '$adName', amount: { $sum: '$spend' } } }]).allowDiskUse(true);
  const bySpend = {}; let none = [];
  for (const a of ads) { const b = classifyReturnAdNameBucket(a._id) || '(khong nhom)'; bySpend[b] = (bySpend[b] || 0) + a.amount; if (b === '(khong nhom)' && a.amount > 0) none.push(a); }
  console.log('Chi phi theo nhom:', Object.fromEntries(Object.entries(bySpend).map(([k, v]) => [k, Math.round(v)])));
  console.log('Top ten QC khong vao nhom nao:');
  none.sort((x, y) => y.amount - x.amount).slice(0, 40).forEach(a => console.log(`  ${Math.round(a.amount).toLocaleString('vi-VN').padStart(14)}  ${JSON.stringify(a._id)}`));
  const orders = await Order.find(buildOrderQuery({ fromDate, toDate })).select('rawData status').lean();
  const tagCount = {};
  let noneOrders = 0;
  for (const o of orders) { if (!classifyReturnOrderTagBucket(getOrderTagText(o))) { noneOrders++; const t = getOrderTagText(o) || '(khong the)'; tagCount[t] = (tagCount[t] || 0) + 1; } }
  console.log(`Don khong vao nhom: ${noneOrders}/${orders.length}. Top the:`);
  Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([t, n]) => console.log(`  ${String(n).padStart(6)}  ${t}`));
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
