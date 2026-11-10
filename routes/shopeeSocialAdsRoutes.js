// Matches Shopee Social Affiliate order data (uploaded client-side) to real Facebook ad spend,
// keyed by sub_id2 — campaigns in this system are named `{sub_id2}{18-char suffix}` at creation
// time (see extractSubId2 in services/legacyRuntimeService.js), so extracting that prefix from
// each Campaign.name is how spend/clicks get attributed back to a Shopee affiliate tracking link.
//
// Nguon du lieu: so cai ShopeeAdSpend (giu chi phi ca khi xoa TKQC). Khi so cai chua chep toan bo
// xong lan dau (vd vua deploy), doc tam tu Campaign nhu cu de trang khong phai doi.
const ShopeeAdSpend = require('../models/ShopeeAdSpend');
const {
  syncShopeeAdSpendLedger,
  getShopeeAdSpendLedgerStatus
} = require('../services/shopeeAdSpendLedgerService');

// Cap nhat nhanh so cai truoc khi doc, toi da 2s (qua thi doc du lieu dang co, khong bat trang doi)
const LEDGER_REFRESH_WAIT_MS = 2000;

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

  // Doc truc tiep tu Campaign (cach cu) - dung khi so cai chua san sang
  async function readFromCampaigns(req, fromDate, toDate) {
    const accounts = await Account.find(withUserFilter(req, buildAccountProviderFilter('shopee')))
      .select('_id').lean();
    if (!accounts.length) return [];
    const camps = await Campaign.find({
      accountId: { $in: accounts.map(a => a._id) },
      date: { $gte: fromDate, $lte: toDate }
    }).select('name date accountId spend clicks').lean();

    const campaigns = [];
    for (const camp of camps) {
      const subId2 = extractSubId2(camp.name);
      if (!subId2) continue;
      // Khong co shopeeAffAccountId -> client tinh acc Shopee theo quy tac cu
      campaigns.push({
        accountId: String(camp.accountId),
        subId2,
        date: camp.date,
        spend: Number(camp.spend || 0),
        clicks: Number(camp.clicks || 0)
      });
    }
    return campaigns;
  }

  async function readFromLedger(req, fromDate, toDate) {
    const rows = await ShopeeAdSpend.find({
      ownerUserId: req.currentUser._id,
      date: { $gte: fromDate, $lte: toDate }
    }).select('accountId adAccountId accountName shopeeAffAccountId shopeeAffAccountName subId2 date spend clicks').lean();

    // Flat per-campaign rows (carrying accountId) — SubID2 codes alone can collide
    // across two different ad accounts, so attributing spend to a specific Shopee AFF
    // account needs more than the SubID2. shopeeAffAccountId: acc Shopee AFF gan san tren
    // so cai -> moi khoan chi phi chi thuoc 1 acc (see client accountTrend.js campaignBelongsToScope).
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
    return campaigns;
  }

  // GET /api/shopee-social/ads-spend/status - so cai chi phi ads da luu xong chua
  app.get('/api/shopee-social/ads-spend/status', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const [rows, latest] = await Promise.all([
        ShopeeAdSpend.countDocuments({ ownerUserId: req.currentUser._id }),
        ShopeeAdSpend.findOne({ ownerUserId: req.currentUser._id }).sort({ syncedAt: -1 }).select('syncedAt').lean()
      ]);
      res.json({ ledger: getShopeeAdSpendLedgerStatus(), rows, lastSavedAt: latest?.syncedAt || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/shopee-social/ads-spend', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const fromDate = normalizeCampaignDate(req.query.from || todayStr());
      const toDate = normalizeCampaignDate(req.query.to || todayStr());
      if (!fromDate || !toDate) return res.status(400).json({ error: 'Invalid date' });
      if (fromDate > toDate) return res.status(400).json({ error: '"from" phải trước "to"' });

      const ledgerStatus = getShopeeAdSpendLedgerStatus();
      if (!ledgerStatus.ready) {
        // Vua restart (chua nap trang thai) hoac dang chep: user DA CO chi phi trong DB thi van doc
        // tu DB - de chi phi tung acc Shopee (ca TKQC da xoa) khong bi hut sau restart.
        // Chi khi chua tung luu dong nao moi doc tam tu Campaign.
        const hasLedgerRows = await ShopeeAdSpend.exists({ ownerUserId: req.currentUser._id });
        if (!hasLedgerRows) {
          const campaigns = await readFromCampaigns(req, fromDate, toDate);
          return res.json({ campaigns, fromDate, toDate, source: 'campaigns', ledger: ledgerStatus });
        }
        const campaigns = await readFromLedger(req, fromDate, toDate);
        return res.json({ campaigns, fromDate, toDate, source: 'ledger', ledger: { ...ledgerStatus, ready: true, syncing: true } });
      }

      await Promise.race([
        syncShopeeAdSpendLedger().catch(error => console.warn(`[ShopeeSocial] cap nhat so cai loi: ${error.message}`)),
        new Promise(resolve => setTimeout(resolve, LEDGER_REFRESH_WAIT_MS))
      ]);

      const campaigns = await readFromLedger(req, fromDate, toDate);
      res.json({ campaigns, fromDate, toDate, source: 'ledger', ledger: getShopeeAdSpendLedgerStatus() });
    } catch (err) {
      console.error('[ShopeeSocial] Error fetching ads spend:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeSocialAdsRoutes };
