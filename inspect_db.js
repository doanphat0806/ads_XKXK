const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const Account = mongoose.model('Account', new mongoose.Schema({}, { strict: false }), 'accounts');
  const Log = mongoose.model('Log', new mongoose.Schema({}, { strict: false }), 'logs');
  const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }), 'campaigns');

  const accounts = await Account.find({}).lean();
  console.log('\n--- ACCOUNTS ---');
  console.log(accounts.map(a => ({
    _id: a._id,
    name: a.name,
    provider: a.provider,
    autoEnabled: a.autoEnabled,
    status: a.status,
    lastChecked: a.lastChecked,
    hasToken: !!a.fbToken,
    adAccountId: a.adAccountId
  })));

  for (const acc of accounts) {
    if (acc.provider === 'shopee') {
      const logs = await Log.find({ accountId: acc._id }).sort({ createdAt: -1 }).limit(10).lean();
      console.log(`\n--- RECENT LOGS FOR ${acc.name} (${acc._id}) ---`);
      console.log(logs.map(l => ({
        createdAt: l.createdAt,
        level: l.level,
        message: l.message
      })));

      const campaignCount = await Campaign.countDocuments({ accountId: acc._id });
      console.log(`Total campaign records in DB for ${acc.name}: ${campaignCount}`);
      
      const today = new Date().toISOString().split('T')[0];
      const todayCampaigns = await Campaign.find({ accountId: acc._id, date: today }).lean();
      console.log(`Today's (${today}) campaigns count: ${todayCampaigns.length}`);
      console.log(`Today's campaigns spend sum: ${todayCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0)}`);
    }
  }

  await mongoose.connection.close();
}

main().catch(console.error);
