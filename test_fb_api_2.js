const mongoose = require('mongoose');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const Account = mongoose.model('Account', new mongoose.Schema({}, { strict: false }), 'accounts');
  const Config = mongoose.model('Config', new mongoose.Schema({}, { strict: false }), 'configs');

  const account = await Account.findOne({ name: 'XK11' }).lean();
  const config = await Config.findOne({ key: 'app' }).lean();
  const fbToken = account.fbToken || config?.fbToken;

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const today = new Date().toISOString().slice(0, 10);
  
  try {
    const url = `https://graph.facebook.com/v17.0/${acctId}/insights`;
    const params = {
      access_token: fbToken,
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,conversions,cost_per_action_type',
      time_range: JSON.stringify({ since: today, until: today }),
      level: 'campaign',
      limit: 500,
      time_increment: 1
    };
    const response = await axios.get(url, { params });
    console.log('--- INSIGHTS COUNT TODAY ---:', response.data.data ? response.data.data.length : 0);
    if (response.data.data && response.data.data.length > 0) {
      console.log('Sample Insight:', response.data.data[0]);
    }
  } catch (error) {
    console.error('Failed to fetch insights:', error.response ? error.response.data : error.message);
  }

  try {
    const url = `https://graph.facebook.com/v17.0/${acctId}/campaigns`;
    const params = {
      access_token: fbToken,
      fields: 'id,name,status,effective_status',
      limit: 100
    };
    const response = await axios.get(url, { params });
    console.log('--- CAMPAIGNS COUNT ---:', response.data.data ? response.data.data.length : 0);
  } catch (error) {
    console.error('Failed to fetch campaigns:', error.response ? error.response.data : error.message);
  }

  await mongoose.connection.close();
}

main().catch(console.error);
