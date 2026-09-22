// Matches Shopee Social Affiliate order data (uploaded client-side) to real Facebook ad spend,
// keyed by sub_id2 — campaigns in this system are named `{sub_id2}{18-char suffix}` at creation
// time (see extractSubId2 in services/legacyRuntimeService.js), so extracting that prefix from
// each Campaign.name is how spend/clicks get attributed back to a Shopee affiliate tracking link.
function registerShopeeSocialAdsRoutes(app, deps = {}) {
  const {
    Account,
    Campaign,
    buildAccountProviderFilter,
    withUserFilter,
    normalizeCampaignDate,
    todayStr,
    extractSubId2
  } = deps;

  app.get('/api/shopee-social/ads-spend', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const fromDate = normalizeCampaignDate(req.query.from || todayStr());
      const toDate = normalizeCampaignDate(req.query.to || todayStr());
      if (!fromDate || !toDate) return res.status(400).json({ error: 'Invalid date' });
      if (fromDate > toDate) return res.status(400).json({ error: '"from" phải trước "to"' });

      const accounts = await Account.find(withUserFilter(req, buildAccountProviderFilter('shopee')))
        .select('_id').lean();
      if (!accounts.length) return res.json({ campaigns: [], fromDate, toDate });

      const accountIds = accounts.map(a => a._id);
      const camps = await Campaign.find({
        accountId: { $in: accountIds },
        date: { $gte: fromDate, $lte: toDate }
      }).select('name date accountId spend clicks').lean();

      // Flat per-campaign rows (carrying accountId) — SubID2 codes alone can collide
      // across two different ad accounts, so attributing spend to a specific Shopee AFF
      // account (which can be pinned to specific ad accounts) needs accountId, not just
      // the SubID2. See client accountTrend.js resolveAdAccountScope/campaignBelongsToScope.
      const campaigns = [];
      for (const camp of camps) {
        const subId2 = extractSubId2(camp.name);
        if (!subId2) continue;
        campaigns.push({
          accountId: String(camp.accountId),
          subId2,
          date: camp.date,
          spend: Number(camp.spend || 0),
          clicks: Number(camp.clicks || 0)
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
