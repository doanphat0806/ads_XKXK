// Matches Shopee Social Affiliate order data (uploaded client-side) to real Facebook ad spend,
// keyed by sub_id2 — campaigns in this system are named `{sub_id2}{18-char suffix}` at creation
// time (see extractSubId2 in services/legacyRuntimeService.js), so extracting that prefix from
// each Campaign.name is how spend/clicks get attributed back to a Shopee affiliate tracking link.
const ShopeeAdSpend = require('../models/ShopeeAdSpend');
const { syncShopeeAdSpendLedger } = require('../services/shopeeAdSpendLedgerService');

function registerShopeeSocialAdsRoutes(app, deps = {}) {
  const {
    normalizeCampaignDate,
    todayStr
  } = deps;

  app.get('/api/shopee-social/ads-spend', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const fromDate = normalizeCampaignDate(req.query.from || todayStr());
      const toDate = normalizeCampaignDate(req.query.to || todayStr());
      if (!fromDate || !toDate) return res.status(400).json({ error: 'Invalid date' });
      if (fromDate > toDate) return res.status(400).json({ error: '"from" phải trước "to"' });

      // Doc tu so cai ShopeeAdSpend (khong phai Campaign) de chi phi cua TKQC da xoa van con.
      // Chep not cac dong vua cap nhat truoc khi doc (toi da 15s, qua thi doc du lieu dang co).
      await Promise.race([
        syncShopeeAdSpendLedger().catch(error => console.warn(`[ShopeeSocial] cap nhat so cai loi: ${error.message}`)),
        new Promise(resolve => setTimeout(resolve, 15000))
      ]);

      const rows = await ShopeeAdSpend.find({
        ownerUserId: req.currentUser._id,
        date: { $gte: fromDate, $lte: toDate }
      }).select('accountId adAccountId accountName shopeeAffAccountId shopeeAffAccountName subId2 date spend clicks').lean();

      // Flat per-campaign rows (carrying accountId) — SubID2 codes alone can collide
      // across two different ad accounts, so attributing spend to a specific Shopee AFF
      // account (which can be pinned to specific ad accounts) needs accountId, not just
      // the SubID2. See client accountTrend.js resolveAdAccountScope/campaignBelongsToScope.
      // shopeeAffAccountId: acc Shopee AFF gan luc ghi so cai (tinh rieng tung acc Shopee).
      const campaigns = [];
      for (const row of rows) {
        if (!row.subId2) continue;
        campaigns.push({
          accountId: String(row.accountId || ''),
          adAccountId: row.adAccountId,
          accountName: row.accountName || '',
          shopeeAffAccountId: row.shopeeAffAccountId ? String(row.shopeeAffAccountId) : '',
          shopeeAffAccountName: row.shopeeAffAccountName || '',
          subId2: row.subId2,
          date: row.date,
          spend: Number(row.spend || 0),
          clicks: Number(row.clicks || 0)
        });
      }

      res.json({ campaigns, fromDate, toDate });
    } catch (err) {
      console.error('[ShopeeSocial] Error fetching ads spend:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeSocialAdsRoutes };
