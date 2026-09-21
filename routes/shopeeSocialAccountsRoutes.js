// Manages the user's list of Shopee Affiliate account names, so the Shopee Social
// upload panel can offer a dropdown of accounts to tag an import with instead of
// retyping a name (and risking typos that split one account's data in two) each time.
function registerShopeeSocialAccountsRoutes(app, deps = {}) {
  const { ShopeeAffAccount, ShopeeSocialOrder, ShopeeAffCommissionReceipt } = deps;

  app.get('/api/shopee-social/accounts', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const accounts = await ShopeeAffAccount.find({ ownerUserId: req.currentUser._id })
        .sort({ name: 1 })
        .lean();
      res.json({ accounts });
    } catch (err) {
      console.error('[ShopeeSocial] Error fetching accounts:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/shopee-social/accounts', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const name = String(req.body?.name || '').trim();
      const subIdPrefix = String(req.body?.subIdPrefix || '').trim();
      if (!name) return res.status(400).json({ error: 'Tên tài khoản không được để trống' });

      const ownerUserId = req.currentUser._id;
      // Upsert so re-adding an existing name is a no-op instead of a duplicate-key error.
      // A non-empty prefix on a re-add must still apply to the existing doc (not just on
      // insert) — otherwise typing a corrected prefix for an already-created account here
      // silently does nothing, with no error shown.
      const update = { $setOnInsert: { ownerUserId, name } };
      if (subIdPrefix) update.$set = { subIdPrefix };
      else update.$setOnInsert.subIdPrefix = subIdPrefix;

      const account = await ShopeeAffAccount.findOneAndUpdate(
        { ownerUserId, name },
        update,
        { upsert: true, new: true }
      );
      res.json({ account });
    } catch (err) {
      console.error('[ShopeeSocial] Error creating account:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/shopee-social/accounts/:id', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const ownerUserId = req.currentUser._id;

      const existing = await ShopeeAffAccount.findOne({ _id: req.params.id, ownerUserId });
      if (!existing) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

      const update = {};
      let renamedFrom = null;
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) return res.status(400).json({ error: 'Tên tài khoản không được để trống' });
        if (name !== existing.name) renamedFrom = existing.name;
        update.name = name;
      }
      if (req.body?.subIdPrefix !== undefined) {
        update.subIdPrefix = String(req.body.subIdPrefix).trim();
      }

      const account = await ShopeeAffAccount.findOneAndUpdate(
        { _id: req.params.id, ownerUserId },
        { $set: update },
        { new: true }
      );

      // accountName on orders/receipts is a denormalized copy of the name, not a
      // reference to this account's _id — a rename must cascade to them, otherwise
      // every order/receipt already tagged with the old name becomes orphaned (shows
      // as a separate "ghost" account) while the renamed account looks empty.
      if (renamedFrom && ShopeeSocialOrder && ShopeeAffCommissionReceipt) {
        await Promise.all([
          ShopeeSocialOrder.updateMany(
            { ownerUserId, accountName: renamedFrom },
            { $set: { accountName: account.name } }
          ),
          ShopeeAffCommissionReceipt.updateMany(
            { ownerUserId, accountName: renamedFrom },
            { $set: { accountName: account.name } }
          )
        ]);
      }

      res.json({ account });
    } catch (err) {
      console.error('[ShopeeSocial] Error updating account:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/shopee-social/accounts/:id', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const result = await ShopeeAffAccount.deleteOne({ _id: req.params.id, ownerUserId: req.currentUser._id });
      res.json({ ok: true, deleted: result.deletedCount });
    } catch (err) {
      console.error('[ShopeeSocial] Error deleting account:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeSocialAccountsRoutes };
