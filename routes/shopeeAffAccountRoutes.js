function normalizeCodes(codes) {
  return Array.isArray(codes)
    ? codes.map(c => String(c || '').trim().toUpperCase()).filter(Boolean)
    : [];
}

function registerShopeeAffAccountRoutes(app, deps = {}) {
  const { ShopeeAffAccount, withUserFilter } = deps;

  app.get('/api/shopee-aff-accounts', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const items = await ShopeeAffAccount.find(withUserFilter(req, {})).sort('-createdAt').lean();
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/shopee-aff-accounts', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Thieu ten tai khoan AFF' });
      const item = await ShopeeAffAccount.create({
        ownerUserId: req.currentUser._id,
        name,
        shopeeSubId2Codes: normalizeCodes(req.body.shopeeSubId2Codes)
      });
      res.json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/shopee-aff-accounts/:id', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const updates = {};
      if (req.body.name !== undefined) {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Thieu ten tai khoan AFF' });
        updates.name = name;
      }
      if (req.body.shopeeSubId2Codes !== undefined) {
        updates.shopeeSubId2Codes = normalizeCodes(req.body.shopeeSubId2Codes);
      }
      const item = await ShopeeAffAccount.findOneAndUpdate(
        withUserFilter(req, { _id: req.params.id }),
        updates,
        { new: true }
      );
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/shopee-aff-accounts/:id', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const item = await ShopeeAffAccount.findOneAndDelete(withUserFilter(req, { _id: req.params.id }));
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeAffAccountRoutes };
