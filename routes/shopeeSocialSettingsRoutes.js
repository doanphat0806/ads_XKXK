// Cai dat nhap tay cua trang Shopee Social (CPC, so click theo SubID2...) luu vao Mongo
// de restart server / doi trinh duyet khong bi mat.

const MAX_SUBID_ENTRIES = 20000;

// Chi giu so >= 0, bo key rong; gioi han so luong de tranh payload rac
function sanitizeNumberMap(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || '').trim();
    if (!key || key.length > 200) continue;
    // Mongo khong cho key co '.' hoac bat dau bang '$'
    if (key.includes('.') || key.startsWith('$')) continue;
    const num = Number(rawValue);
    if (!Number.isFinite(num) || num < 0) continue;
    result[key] = num;
    count += 1;
    if (count >= MAX_SUBID_ENTRIES) break;
  }
  return result;
}

function toResponse(doc) {
  return {
    defaultCpc: Number(doc?.defaultCpc || 0),
    cpcBySubId: doc?.cpcBySubId || {},
    clicksBySubId: doc?.clicksBySubId || {},
    fileName: doc?.fileName || '',
    updatedAt: doc?.updatedAt || null
  };
}

function registerShopeeSocialSettingsRoutes(app, deps = {}) {
  const { ShopeeSocialSetting } = deps;

  app.get('/api/shopee-social/settings', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const doc = await ShopeeSocialSetting.findOne({ ownerUserId: req.currentUser._id }).lean();
      res.json({ settings: doc ? toResponse(doc) : null });
    } catch (err) {
      console.error('[ShopeeSocial] Loi doc cai dat:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/shopee-social/settings', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      const body = req.body || {};
      const update = { updatedAt: new Date() };
      // Chi cap nhat cac truong co gui len
      if (body.defaultCpc !== undefined) {
        const cpc = Number(body.defaultCpc);
        update.defaultCpc = Number.isFinite(cpc) && cpc > 0 ? cpc : 0;
      }
      if (body.cpcBySubId !== undefined) update.cpcBySubId = sanitizeNumberMap(body.cpcBySubId);
      if (body.clicksBySubId !== undefined) update.clicksBySubId = sanitizeNumberMap(body.clicksBySubId);
      if (body.fileName !== undefined) update.fileName = String(body.fileName || '').slice(0, 500);

      const doc = await ShopeeSocialSetting.findOneAndUpdate(
        { ownerUserId: req.currentUser._id },
        { $set: update },
        { upsert: true, new: true, lean: true }
      );
      res.json({ settings: toResponse(doc) });
    } catch (err) {
      console.error('[ShopeeSocial] Loi luu cai dat:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/shopee-social/settings', async (req, res) => {
    try {
      if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
      await ShopeeSocialSetting.deleteOne({ ownerUserId: req.currentUser._id });
      res.json({ ok: true });
    } catch (err) {
      console.error('[ShopeeSocial] Loi xoa cai dat:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerShopeeSocialSettingsRoutes };
