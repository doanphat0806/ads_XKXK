'use strict';

// Tai bu chi so phu Meta (Campaign.metaExtra) cho cac ngay cu.
// Chi $set metaExtra len dong camp da co (khong tao dong moi, khong dung so lieu khac).
// Dung: node scripts/backfillMetaExtra.js [so_ngay=30]

require('dotenv').config();
const mongoose = require('mongoose');
const Account = require('../models/Account');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { getAppConfig } = require('../services/configService');
const { fetchAllFbEdge } = require('../utils/fbApi');
const { META_EXTRA_INSIGHT_FIELDS, getMetaExtraMetricsFromInsight } = require('../utils/metaExtraMetrics');

const days = Math.max(1, Math.min(365, parseInt(process.argv[2] || '30', 10) || 30));
const CHUNK_DAYS = 3;

function vnDateString(offsetDays = 0) {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager');
  const config = await getAppConfig();
  const since = vnDateString(days - 1);
  const until = vnDateString(0);
  // Ca tai khoan Shopee: luong Shopee cung lay insights tu Facebook khi co token
  const accounts = await Account.find({}).lean();
  console.log(`Backfill metaExtra ${since}..${until} cho ${accounts.length} tai khoan`);

  let updatedTotal = 0;
  for (const account of accounts) {
    if (!account.adAccountId) continue;
    const owner = account.ownerUserId ? await User.findById(account.ownerUserId).select('fbToken').lean() : null;
    const token = account.fbToken || owner?.fbToken || config?.fbToken;
    if (!token) {
      console.log(`- ${account.name}: bo qua (thieu token)`);
      continue;
    }
    const acctId = account.adAccountId.startsWith('act_') ? account.adAccountId : `act_${account.adAccountId}`;
    // Chi lay nhung ngay tai khoan nay co dong camp trong DB, chia dot ngan de tranh timeout
    const storedDates = (await Campaign.distinct('date', { accountId: account._id, date: { $gte: since, $lte: until } })).sort();
    let matched = 0;
    let modified = 0;
    let insightRows = 0;
    for (let index = 0; index < storedDates.length; index += CHUNK_DAYS) {
      const chunk = storedDates.slice(index, index + CHUNK_DAYS);
      const range = { since: chunk[0], until: chunk[chunk.length - 1] };
      try {
        const { items } = await fetchAllFbEdge(token, `${acctId}/insights`, {
          fields: ['campaign_id,actions', ...META_EXTRA_INSIGHT_FIELDS].join(','),
          time_range: JSON.stringify(range),
          level: 'campaign',
          limit: 100,
          time_increment: 1
        }, { pageTimeoutMs: 60000 });
        insightRows += items.length;
        const ops = items
          .filter(row => row.campaign_id && chunk.includes(row.date_start))
          .map(row => ({
            updateOne: {
              filter: { accountId: account._id, campaignId: String(row.campaign_id), date: row.date_start },
              update: { $set: { metaExtra: getMetaExtraMetricsFromInsight(row) } }
            }
          }));
        if (ops.length) {
          const result = await Campaign.bulkWrite(ops, { ordered: false });
          matched += result.matchedCount || 0;
          modified += result.modifiedCount || 0;
        }
      } catch (error) {
        console.log(`  ${account.name} ${range.since}..${range.until}: loi ${error.message}`);
      }
    }
    updatedTotal += modified;
    console.log(`- ${account.name}: ${storedDates.length} ngay, ${insightRows} dong insights, khop ${matched}, cap nhat ${modified}`);
  }

  console.log(`Xong. Da cap nhat ${updatedTotal} dong camp.`);
  await mongoose.disconnect();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
