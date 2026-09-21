// Manual ledger of actual Shopee AFF commission payouts (see ShopeeAffCommissionReceipt
// model) — hand-entered because the uploaded report's commission figure is provisional
// until Shopee actually pays it out.
function registerShopeeSocialCommissionReceiptsRoutes(app, deps = {}) {
  const { ShopeeAffCommissionReceipt } = deps;

  app.get('/api/shopee-social/commission-receipts', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const receipts = await ShopeeAffCommissionReceipt.find({ ownerUserId: req.currentUser._id })
        .sort({ date: -1 })
        .lean();
      res.json({ receipts });
    } catch (err) {
      console.error('[ShopeeSocial] Error fetching commission receipts:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/shopee-social/commission-receipts', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const accountName = String(req.body?.accountName || '').trim();
      const amount = Number(req.body?.amount);
      const dateRaw = String(req.body?.date || '').trim();
      // A bare "YYYY-MM-DD" (from <input type="date">) must be parsed as LOCAL midnight,
      // not UTC midnight — `new Date("2026-09-21")` alone is UTC, which lands on the
      // previous calendar day in any timezone behind UTC (masked so far since this app's
      // users are in Asia/Ho_Chi_Minh, UTC+7, ahead of UTC).
      const date = dateRaw
        ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? `${dateRaw}T00:00:00` : dateRaw)
        : null;
      const note = String(req.body?.note || '').trim();

      if (!accountName) return res.status(400).json({ error: 'Thiếu tài khoản' });
      if (!date || Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Ngày không hợp lệ' });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Số tiền không hợp lệ' });

      const receipt = await ShopeeAffCommissionReceipt.create({
        ownerUserId: req.currentUser._id,
        accountName,
        date,
        amount,
        note
      });
      res.json({ receipt });
    } catch (err) {
      console.error('[ShopeeSocial] Error creating commission receipt:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/shopee-social/commission-receipts/:id', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const result = await ShopeeAffCommissionReceipt.deleteOne({ _id: req.params.id, ownerUserId: req.currentUser._id });
      res.json({ ok: true, deleted: result.deletedCount });
    } catch (err) {
      console.error('[ShopeeSocial] Error deleting commission receipt:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeSocialCommissionReceiptsRoutes };
