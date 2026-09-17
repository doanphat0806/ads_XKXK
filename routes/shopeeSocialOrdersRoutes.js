// Persists Shopee Social Affiliate orders (parsed client-side from the uploaded CSV/XLSX)
// into MongoDB, scoped to the logged-in user, so the report survives across browsers/devices
// instead of living only in that browser's localStorage.
function registerShopeeSocialOrdersRoutes(app, deps = {}) {
  const { ShopeeSocialOrder } = deps;

  const MAX_ORDERS_PER_IMPORT = 20000;
  const MAX_ORDERS_RETURNED = 50000;

  app.post('/api/shopee-social/orders/import', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
      if (!orders.length) return res.status(400).json({ error: 'Không có đơn hàng nào để lưu' });
      if (orders.length > MAX_ORDERS_PER_IMPORT) {
        return res.status(400).json({ error: `File quá lớn (>${MAX_ORDERS_PER_IMPORT} đơn), vui lòng chia nhỏ file` });
      }

      const ownerUserId = req.currentUser._id;
      const sourceFileName = String(req.body?.sourceFileName || '').trim();
      const now = new Date();
      const ops = [];

      for (const order of orders) {
        const orderId = String(order?.orderId || '').trim();
        if (!orderId) continue;
        const orderTime = order.orderTime ? new Date(order.orderTime) : null;

        ops.push({
          updateOne: {
            filter: { ownerUserId, orderId },
            update: {
              $set: {
                itemId: String(order.itemId || ''),
                itemName: String(order.itemName || ''),
                shopId: String(order.shopId || ''),
                shopName: String(order.shopName || ''),
                gmv: Number(order.gmv || 0),
                commissionShopee: Number(order.commissionShopee || 0),
                commissionXtra: Number(order.commissionXtra || 0),
                commissionTotal: Number(order.commissionTotal || 0),
                channelRaw: String(order.channelRaw || ''),
                channel: String(order.channel || 'other'),
                statusRaw: String(order.statusRaw || ''),
                status: String(order.status || 'other'),
                orderTime: orderTime && !Number.isNaN(orderTime.getTime()) ? orderTime : null,
                subIds: Array.isArray(order.subIds) ? order.subIds.map(String) : [],
                subIdKey: String(order.subIdKey || ''),
                platformKey: String(order.platformKey || 'khac'),
                platformLabel: String(order.platformLabel || ''),
                sourceFileName,
                importedAt: now
              },
              $setOnInsert: { ownerUserId }
            },
            upsert: true
          }
        });
      }

      if (!ops.length) return res.status(400).json({ error: 'Không có đơn hàng hợp lệ (thiếu mã đơn)' });

      const result = await ShopeeSocialOrder.bulkWrite(ops, { ordered: false });
      res.json({
        ok: true,
        imported: ops.length,
        upserted: result.upsertedCount,
        modified: result.modifiedCount
      });
    } catch (err) {
      console.error('[ShopeeSocial] Error importing orders:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/shopee-social/orders', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const orders = await ShopeeSocialOrder.find({ ownerUserId: req.currentUser._id })
        .sort({ orderTime: -1 })
        .limit(MAX_ORDERS_RETURNED)
        .lean();

      res.json({ orders });
    } catch (err) {
      console.error('[ShopeeSocial] Error fetching saved orders:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/shopee-social/orders', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

      const result = await ShopeeSocialOrder.deleteMany({ ownerUserId: req.currentUser._id });
      res.json({ ok: true, deleted: result.deletedCount });
    } catch (err) {
      console.error('[ShopeeSocial] Error deleting saved orders:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeSocialOrdersRoutes };
