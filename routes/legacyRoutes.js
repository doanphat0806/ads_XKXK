// Legacy route registrar extracted from server.js.
// This keeps the current behavior while server.js is split into route modules.
const registerPageRoutes = require('./pageRoutes');

function registerLegacyRoutes(app, deps = {}) {
  const routeDeps = Object.create(deps);
  routeDeps.app = app;
  routeDeps.registerPageRoutes = registerPageRoutes;

  // The extracted legacy code still expects the old server.js lexical scope.
  // Route handlers are registered inside this scope so they can resolve the
  // models, services, queues, and helpers supplied by server.js.
  with (routeDeps) {
app.get('/api/accounts', async (req, res) => {
  try {
    const { provider } = req.query;
    const filter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const accounts = await Account.find(filter).select('-fbToken -claudeKey').sort('-createdAt').lean();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { provider, date, fromDate, toDate } = req.query;
    const filter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const fDate = fromDate || date || todayStr();
    const tDate = toDate || date || fDate;
    const includeOrders = req.query.includeOrders !== 'false' && req.query.includeOrders !== false;
    const cacheKey = userScopedCacheKey(req, `stats:${provider || 'all'}:${fDate}:${tDate}:${includeOrders ? 'with-orders' : 'no-orders'}`);
    const cached = getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const accountList = await Account.find(filter).select('_id status').lean();
    const totalAccounts = accountList.length;
    const connectedAccounts = accountList.reduce((total, account) => (
      account.status === 'connected' ? total + 1 : total
    ), 0);

    // Lọc campaign theo tài khoản thuộc provider
    let campaignQuery = { date: { $gte: fDate, $lte: tDate } };
    campaignQuery.accountId = { $in: accountList.map(account => account._id) };

    const [campaignTotals = {}] = accountList.length ? await Campaign.aggregate([
      { $match: campaignQuery },
      {
        $group: {
          _id: null,
          activeCount: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$spend', 0] }, { $eq: [{ $toUpper: '$status' }, 'ACTIVE'] }] },
                1,
                0
              ]
            }
          },
          pausedCount: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$spend', 0] }, { $eq: [{ $toUpper: '$status' }, 'PAUSED'] }] },
                1,
                0
              ]
            }
          },
          totalSpend: { $sum: '$spend' },
          totalMessages: { $sum: '$messages' },
          totalClicks: { $sum: '$clicks' }
        }
      },
      {
        $project: {
          _id: 0,
          activeCount: 1,
          pausedCount: 1,
          totalSpend: 1,
          totalMessages: 1,
          totalClicks: 1,
          avgCPM: {
            $cond: [{ $gt: ['$totalMessages', 0] }, { $divide: ['$totalSpend', '$totalMessages'] }, 0]
          }
        }
      }
    ]).allowDiskUse(true) : [{}];

    let totalOrders;
    let ordersError;
    if (includeOrders) {
      totalOrders = 0;
      ordersError = '';
      try {
      if (useSheetOrders()) {
        const todayRows = await getOrderSheetOrders({ fromDate: fDate, toDate: tDate, limit: 5000 });
        // Chỉ đếm dòng có ID2 (orderId) không trống
        totalOrders = todayRows.filter(o => o.orderId && String(o.orderId).trim() !== '').length;
      } else {
        totalOrders = await Order.countDocuments(buildOrderQuery({ fromDate: fDate, toDate: tDate }));
      }
      } catch (error) {
        ordersError = error.message;
      }
    }

    res.json(setReadCache(cacheKey, {
      totalAccounts,
      connectedAccounts,
      activeCount: campaignTotals.activeCount || 0,
      pausedCount: campaignTotals.pausedCount || 0,
      totalSpend: campaignTotals.totalSpend || 0,
      totalMessages: campaignTotals.totalMessages || 0,
      totalClicks: campaignTotals.totalClicks || 0,
      avgCPM: campaignTotals.avgCPM || 0,
      ...(includeOrders ? { totalOrders, ordersError } : {}),
      fromDate: fDate,
      toDate: tDate
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(['/token', '/api/token'], async (req, res) => {
  try {
    const tokenState = await configureFacebookToken({
      app_id: req.body.app_id,
      app_secret: req.body.app_secret,
      long_lived_user_access_token: req.body.long_lived_user_access_token
    });

    res.status(201).json({
      ok: true,
      token: tokenState.token,
      expires_at: tokenState.expires_at,
      last_refresh_time: tokenState.last_refresh_time,
      last_debug_time: tokenState.last_debug_time
    });
  } catch (error) {
    await sendTokenAlert('Facebook token configure failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get(['/token', '/api/token'], async (req, res) => {
  try {
    const [tokenState, config] = await Promise.all([
      FacebookToken.findOne({ key: FACEBOOK_TOKEN_KEY }),
      getAppConfig()
    ]);

    const token = tokenState?.token || config?.fbToken || '';
    if (!token) return res.status(404).json({ error: 'No Facebook token configured' });

    res.json({
      token,
      expires_at: tokenState?.expires_at || config?.fbTokenExpiresAt || null,
      last_refresh_time: tokenState?.last_refresh_time || config?.fbTokenLastRefreshTime || null,
      last_debug_time: tokenState?.last_debug_time || config?.fbTokenLastDebugTime || null,
      last_error: tokenState?.last_error || config?.fbTokenLastRefreshError || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(['/token/refresh', '/api/token/refresh'], async (req, res) => {
  try {
    const result = await checkAndRefreshFacebookToken({ force: Boolean(req.body.force), source: 'api' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const payload = await buildAccountPayload({ ...req.body, ownerUserId: req.currentUser._id });
    if (!payload.name || !payload.adAccountId) {
      return res.status(400).json({ error: 'Thieu ten tai khoan hoac Ad Account ID' });
    }
    const providerNameError = getAccountProviderNameError(payload.provider, payload.name);
    if (providerNameError) return res.status(400).json({ error: providerNameError });
    if (!isValidAdAccountId(payload.adAccountId, payload.provider)) {
      return res.status(400).json({
        error: payload.provider === 'shopee'
          ? 'Ad Account/Shopee shop ID khong hop le.'
          : 'Ad Account ID khong hop le. Dung dang act_123456789 hoac chi nhap so.'
      });
    }
    if (payload.provider === 'facebook' && !payload.fbToken) {
      return res.status(400).json({ error: 'Thieu Facebook Access Token dung chung hoac rieng cho tai khoan' });
    }

    const account = await Account.create(payload);
    try {
      const { fbToken } = await getEffectiveSecrets(account);
      const me = await fbGet(fbToken, 'me', { fields: 'name,id' });
      await Account.findByIdAndUpdate(account._id, { status: 'connected' });
      await addLog(account._id, account.name, 'success', `Ket noi thanh cong: ${me.name} (${me.id})`);
    } catch (error) {
      await Account.findByIdAndUpdate(account._id, { status: 'error' });
      await addLog(account._id, account.name, 'error', `Loi ket noi: ${error.message}`);
    }

    res.json(account);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accounts/auto-discover', async (req, res) => {
  try {
    const config = await getAppConfig();
    const currentUser = await User.findById(req.currentUser._id).select('fbToken').lean();
    const fbToken = req.body.fbToken || currentUser?.fbToken || config?.fbToken || '';
    const provider = normalizeProvider(req.body.provider);
    const fastSync = req.body.fast === true || req.body.fast === 'true' || req.body.mode === 'fast';
    const spendDatePreset = String(req.body.spendDatePreset || 'this_year').trim() || 'this_year';
    const maxPages = req.body.maxPages
      ? parseBoundedInt(req.body.maxPages, 1000, 1, 1000)
      : (fastSync ? 5 : 1000);
    if (!fbToken) {
      return res.status(400).json({ error: 'Thieu Facebook Access Token. Hay luu token dung chung truoc.' });
    }

    const startedAt = Date.now();
    console.log(`[auto-discover] start provider=${provider} fast=${fastSync} maxPages=${maxPages}`);

    const allAdAccounts = [];
    const seenAdAccountIds = new Set();
    const addAdAccounts = (items = []) => {
      for (const item of items) {
        const accountId = getAdAccountNumericId(item);
        if (!accountId || seenAdAccountIds.has(accountId)) continue;
        seenAdAccountIds.add(accountId);
        allAdAccounts.push({ ...item, account_id: accountId });
      }
    };
    const sources = [];
    const sourceErrors = [];
    const adAccountFields = 'name,account_id,account_status,currency';

    const directAccounts = await fetchAllFbEdge(fbToken, 'me/adaccounts', {
      fields: adAccountFields,
      limit: 200
    }, {
      maxPages,
      pageTimeoutMs: fastSync ? 15000 : 30000,
      requestOptions: fastSync ? { retries: 1, rateLimitRetries: 1 } : {}
    });
    addAdAccounts(directAccounts.items);
    sources.push({ source: 'me/adaccounts', count: directAccounts.items.length, pages: directAccounts.pageCount });
    console.log(`[auto-discover] fetched ${directAccounts.items.length} accounts in ${directAccounts.pageCount} pages after ${Date.now() - startedAt}ms`);

    if (!allAdAccounts.length) {
      return res.json({ ok: true, found: 0, created: [], skipped: [], sources, sourceErrors, message: 'Khong tim thay tai khoan quang cao nao duoc gan cho user/token nay.' });
    }

    const discoveredAdAccounts = allAdAccounts.filter(account => {
      const isShopeeName = isShopeeAdAccountName(account.name);
      return provider === 'shopee' ? isShopeeName : !isShopeeName;
    });

    if (!discoveredAdAccounts.length) {
      return res.json({
        ok: true,
        found: 0,
        totalFetched: allAdAccounts.length,
        created: [],
        skipped: [],
        sources,
        sourceErrors,
        message: provider === 'shopee'
          ? `Tim thay ${allAdAccounts.length} tai khoan nhung khong co tai khoan Shopee nao bat dau bang XK lien sau la so (vi du: XK11).`
          : `Tim thay ${allAdAccounts.length} tai khoan nhung tat ca deu thuoc nhom Shopee (ten bat dau bang XK lien sau la so).`
      });
    }

    let accountsWithSpend = [];
    let spendCheckErrors = [];
    let finalAdAccounts = discoveredAdAccounts;

    if (!fastSync) {
      console.log(`Checking spend for ${discoveredAdAccounts.length} ${provider} accounts with batch insights (${spendDatePreset})...`);
      const spendResult = await fetchAdAccountsWithSpend(fbToken, discoveredAdAccounts, {
        datePreset: spendDatePreset,
        batchSize: 50,
        concurrency: 3
      });
      accountsWithSpend = spendResult.accountsWithSpend;
      spendCheckErrors = spendResult.spendCheckErrors;

      console.log(`Found ${accountsWithSpend.length}/${discoveredAdAccounts.length} accounts with confirmed spend > 0 (${spendDatePreset})`);

      if (!accountsWithSpend.length) {
        return res.json({
          ok: true,
          found: 0,
          totalFetched: allAdAccounts.length,
          accountsChecked: discoveredAdAccounts.length,
          created: [],
          skipped: [],
          sources,
          sourceErrors,
          spendCheckErrors,
          fast: false,
          spendScope: spendDatePreset,
          message: `Tim thay ${discoveredAdAccounts.length} tai khoan ${provider} nhung khong co tai khoan nao da chi tieu theo khoang ${spendDatePreset}.`
        });
      }

      finalAdAccounts = accountsWithSpend;
    }

    // Check existing accounts in DB
    const existingAccounts = await Account.find(withUserFilter(req, buildAccountProviderFilter(provider)), 'adAccountId');
    const existingIds = new Set(existingAccounts.map(a => {
      const id = String(a.adAccountId || '').trim();
      return id.startsWith('act_') ? id : `act_${id}`;
    }).filter(id => id !== 'act_'));

    const pendingCreates = [];
    const skipped = [];

    for (const adAccount of finalAdAccounts) {
      const actId = normalizeAdAccountId(adAccount.account_id);
      if (existingIds.has(actId)) {
        skipped.push({ name: adAccount.name, adAccountId: actId });
        continue;
      }

      try {
        const name = String(adAccount.name || `Account ${adAccount.account_id}`).trim();
        if (!name || !isValidAdAccountId(actId, provider)) {
          throw new Error('Ad Account ID khong hop le');
        }
        pendingCreates.push({
          payload: {
            ownerUserId: req.currentUser._id,
            name,
            provider,
            fbToken: provider === 'facebook' ? fbToken : '',
            adAccountId: provider === 'facebook' ? actId : String(actId || '').trim(),
            geminiKey: String(config?.geminiKey || '').trim(),
            spendThreshold: 20000,
            checkInterval: 60,
            autoEnabled: false,
            linkedPageIds: []
          },
          source: {
            name,
            adAccountId: actId
          }
        });
        existingIds.add(actId); // Prevent duplicates within same batch
      } catch (error) {
        skipped.push({ name: adAccount.name, adAccountId: actId, error: error.message });
      }
    }

    const created = [];
    if (pendingCreates.length) {
      try {
        const insertedAccounts = await Account.insertMany(pendingCreates.map(item => item.payload), { ordered: true });
        insertedAccounts.forEach((account, index) => {
          const source = pendingCreates[index].source;
          created.push({ id: account._id, name: source.name, adAccountId: source.adAccountId });
        });
      } catch (error) {
        for (const item of pendingCreates) {
          try {
            const account = await Account.create(item.payload);
            created.push({ id: account._id, name: item.source.name, adAccountId: item.source.adAccountId });
          } catch (createError) {
            skipped.push({
              name: item.source.name,
              adAccountId: item.source.adAccountId,
              error: createError.message
            });
          }
        }
      }
    }
    console.log(`[auto-discover] done provider=${provider} found=${finalAdAccounts.length} created=${created.length} skipped=${skipped.length} after ${Date.now() - startedAt}ms`);

    res.json({
      ok: true,
      found: finalAdAccounts.length,
      totalFetched: allAdAccounts.length,
      accountsChecked: discoveredAdAccounts.length,
      accountsWithSpend: accountsWithSpend.length,
      fast: fastSync,
      created,
      skipped,
      sources,
      sourceErrors,
      spendCheckErrors,
      spendScope: fastSync ? 'all' : spendDatePreset,
      message: fastSync
        ? `Dong bo tai khoan duoc gan trong BM: tim thay ${finalAdAccounts.length}/${discoveredAdAccounts.length} tai khoan ${provider}. Da them ${created.length}, bo qua ${skipped.length} (da ton tai).`
        : `Tim thay ${finalAdAccounts.length}/${discoveredAdAccounts.length} tai khoan ${provider} duoc gan trong BM va da chi tieu theo khoang ${spendDatePreset}. Da them ${created.length}, bo qua ${skipped.length} (da ton tai).`
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accounts/bulk', async (req, res) => {
  try {
    const items = Array.isArray(req.body.accounts)
      ? req.body.accounts
      : Array.isArray(req.body.items)
        ? req.body.items
        : [];
    if (!items.length) {
      return res.status(400).json({ error: 'Chua co tai khoan nao de them' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < items.length; i += 1) {
      try {
        const payload = await buildAccountPayload({ ...items[i], ownerUserId: req.currentUser._id });
        if (!payload.name || !payload.adAccountId) {
          throw new Error('Thieu ten tai khoan hoac Ad Account ID');
        }
        const providerNameError = getAccountProviderNameError(payload.provider, payload.name);
        if (providerNameError) throw new Error(providerNameError);
        if (!isValidAdAccountId(payload.adAccountId, payload.provider)) {
          throw new Error(payload.provider === 'shopee'
            ? 'Ad Account/Shopee shop ID khong hop le.'
            : 'Ad Account ID khong hop le. Dung dang act_123456789 hoac chi nhap so.');
        }
        if (payload.provider === 'facebook' && !payload.fbToken) {
          throw new Error('Thieu Facebook Access Token dung chung');
        }

        const account = await Account.create(payload);
        created.push({ id: account._id, name: account.name });
      } catch (error) {
        errors.push({ index: i, name: items[i]?.name || '', error: error.message });
      }
    }

    res.json({ ok: true, created, errors });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/accounts/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ownerUserId;
    const existingAccount = await Account.findOne(withUserFilter(req, { _id: req.params.id })).select('provider name').lean();
    if (!existingAccount) return res.status(404).json({ error: 'Not found' });

    if (!updates.fbToken) delete updates.fbToken;
    if (!updates.claudeKey) delete updates.claudeKey;
    if (!updates.geminiKey) delete updates.geminiKey;
    if (Object.prototype.hasOwnProperty.call(updates, 'provider')) {
      updates.provider = normalizeProvider(updates.provider);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'adAccountId')) {
      const provider = updates.provider || existingAccount.provider || 'facebook';
      updates.adAccountId = provider === 'facebook' ? normalizeAdAccountId(updates.adAccountId) : String(updates.adAccountId || '').trim();
      if (!isValidAdAccountId(updates.adAccountId, provider)) {
        return res.status(400).json({
          error: provider === 'shopee'
            ? 'Ad Account/Shopee shop ID khong hop le.'
            : 'Ad Account ID khong hop le. Dung dang act_123456789 hoac chi nhap so.'
        });
      }
    }
    const nextProvider = updates.provider || existingAccount.provider || 'facebook';
    const nextName = Object.prototype.hasOwnProperty.call(updates, 'name') ? updates.name : existingAccount.name;
    const providerNameError = getAccountProviderNameError(nextProvider, nextName);
    if (providerNameError) return res.status(400).json({ error: providerNameError });
    if (req.body.linkedPageIds !== undefined) {
      updates.linkedPageIds = Array.isArray(req.body.linkedPageIds) ? req.body.linkedPageIds : [];
    }

    const account = await Account.findOneAndUpdate(withUserFilter(req, { _id: req.params.id }), updates, { new: true });
    if (!account) return res.status(404).json({ error: 'Not found' });

    if (account.autoEnabled) {
      await startAccountScheduler(account);
      await addLog(account._id, account.name, 'info', 'Da cap nhat cau hinh tu dong');
    }

    res.json(account);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const provider = String(req.query.provider || '').trim();
    const filter = withUserFilter(req, { _id: req.params.id });
    if (provider) Object.assign(filter, buildAccountProviderFilter(provider));

    const account = await Account.findOneAndDelete(filter);
    if (!account) return res.status(404).json({ error: 'Not found' });

    await Campaign.deleteMany({ accountId: account._id });
    await Log.deleteMany({ accountId: account._id });
    stopAccountScheduler(req.params.id);
    res.json({ ok: true, deletedCount: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts/:id/auto', async (req, res) => {
  try {
    console.log('TOGGLE AUTO BODY:', req.body);

    const { enabled } = req.body;
    const account = await Account.findOne(withUserFilter(req, { _id: req.params.id }));
    if (!account) return res.status(404).json({ error: 'Not found' });

    account.autoEnabled = Boolean(enabled);
    await account.save();

    if (account.autoEnabled) {
      await startAccountScheduler(account);
      await addLog(account._id, account.name, 'info', 'AUTO: ON');
    } else {
      stopAccountScheduler(account._id.toString());
      await addLog(account._id, account.name, 'warn', 'AUTO: OFF');
    }

    res.json({ ok: true, autoEnabled: account.autoEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/toggle-auto-bulk', async (req, res) => {
  try {
    const { ids, enabled } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ids must be an array' });

    const scopeFilter = withUserFilter(req, { _id: { $in: ids } });
    await Account.updateMany(scopeFilter, { autoEnabled: Boolean(enabled) });

    const accounts = await Account.find(scopeFilter);
    for (const account of accounts) {
      if (account.autoEnabled) {
        await startAccountScheduler(account);
        await addLog(account._id, account.name, 'info', 'AUTO: ON (Bulk)');
      } else {
        stopAccountScheduler(account._id.toString());
        await addLog(account._id, account.name, 'warn', 'AUTO: OFF (Bulk)');
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/delete-bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    const provider = String(req.body.provider || '').trim();
    console.log(`Bulk deleting ${ids?.length} accounts...`);
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ids must be an array' });

    const filter = withUserFilter(req, { _id: { $in: ids } });
    if (provider) Object.assign(filter, buildAccountProviderFilter(provider));
    const accounts = await Account.find(filter).select('_id').lean();
    const matchedIds = accounts.map(account => account._id);

    for (const id of matchedIds) {
      stopAccountScheduler(id);
    }

    const accResult = matchedIds.length
      ? await Account.deleteMany({ _id: { $in: matchedIds } })
      : { deletedCount: 0 };
    const campResult = matchedIds.length
      ? await Campaign.deleteMany({ accountId: { $in: matchedIds } })
      : { deletedCount: 0 };
    const logResult = matchedIds.length
      ? await Log.deleteMany({ accountId: { $in: matchedIds } })
      : { deletedCount: 0 };

    console.log(`Deleted: ${accResult.deletedCount} accounts, ${campResult.deletedCount} campaigns, ${logResult.deletedCount} logs`);
    res.json({ ok: true, deletedCount: accResult.deletedCount });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/refresh', async (req, res) => {
  let account = null;
  let runStarted = false;
  try {
    account = await Account.findOne(withUserFilter(req, { _id: req.params.id }));
    if (!account) return res.status(404).json({ error: 'Not found' });
    if (getAccountRateLimitDelayMs && getAccountRateLimitDelayMs(account._id) > 0) {
      return res.json({ ok: false, skipped: true, transient: true, rateLimitedCooldown: true, accountId: account._id });
    }
    if (tryStartAccountRun && !tryStartAccountRun(account._id)) {
      return res.json({ ok: false, skipped: true, inFlight: true, accountId: account._id });
    }
    runStarted = true;

    const result = account.provider === 'shopee'
      ? await fetchShopeeAccountData(account)
      : await fetchAccountData(account);

    await Account.findByIdAndUpdate(account._id, {
      lastChecked: new Date(),
      status: 'connected'
    });
    clearCampaignReadCache();
    clearDealStopCampaignCache();

    res.json({ ok: true, ...result });
  } catch (error) {
    if (!account) account = await Account.findOne(withUserFilter(req, { _id: req.params.id })).catch(() => null);
    if (error.transient) {
      if (account) {
        if (error.rateLimited) {
          if (markAccountRateLimited) markAccountRateLimited(account._id);
          await Account.findByIdAndUpdate(account._id, {
            lastChecked: new Date(),
            status: 'connected'
          });
        }
        await addLog(account._id, account.name, 'warn', `Bo qua refresh tam thoi: ${error.message}`);
      }
      return res.json({ ok: false, skipped: true, transient: true, accountId: account?._id, error: error.message });
    }

    if (account) {
      await Account.findByIdAndUpdate(account._id, { status: 'error' });
    }
    res.status(400).json({ error: error.message });
  } finally {
    if (runStarted && finishAccountRun) finishAccountRun(req.params.id);
  }
});

async function setCampaignStatusForAccount({
  account,
  fbToken,
  campaignId,
  currentStatus,
  targetStatus,
  fromDate,
  toDate,
  fetchLiveStatus = true,
  skipNoChange = false
}) {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId) throw new Error('Thieu campaignId');

  const storedCampaign = await Campaign.findOne({
    accountId: account._id,
    campaignId: normalizedCampaignId,
    date: { $gte: fromDate, $lte: toDate }
  }).sort({ updatedAt: -1, _id: -1 }).lean();

  let effectiveStatus = normalizeCampaignStatus(currentStatus);
  if (fetchLiveStatus) {
    try {
      const liveCampaign = await fbGet(fbToken, normalizedCampaignId, { fields: 'id,status' }, { retries: 2, rateLimitRetries: 2 });
      effectiveStatus = normalizeCampaignStatus(liveCampaign?.status || effectiveStatus);
    } catch (error) {
      effectiveStatus = normalizeCampaignStatus(storedCampaign?.status || effectiveStatus);
      if (!effectiveStatus) throw error;
    }
  } else if (!effectiveStatus) {
    effectiveStatus = normalizeCampaignStatus(storedCampaign?.status || effectiveStatus);
  }

  const requestedTargetStatus = normalizeCampaignStatus(targetStatus);
  const newStatus = requestedTargetStatus === 'PAUSED' || requestedTargetStatus === 'ACTIVE'
    ? requestedTargetStatus
    : (isCampaignServingStatus(effectiveStatus) ? 'PAUSED' : 'ACTIVE');

  if (skipNoChange && effectiveStatus) {
    const alreadyTarget = newStatus === 'PAUSED'
      ? !isCampaignServingStatus(effectiveStatus)
      : isCampaignServingStatus(effectiveStatus);
    if (alreadyTarget) {
      return {
        ok: true,
        skipped: true,
        previousStatus: effectiveStatus,
        newStatus,
        campaignId: normalizedCampaignId
      };
    }
  }

  await fbPost(fbToken, normalizedCampaignId, { status: newStatus });
  const updateFilter = storedCampaign
    ? { _id: storedCampaign._id }
    : { accountId: account._id, campaignId: normalizedCampaignId, date: { $gte: fromDate, $lte: toDate } };
  await Campaign.findOneAndUpdate(updateFilter, { $set: { status: newStatus, updatedAt: new Date() } }, { new: true });

  return {
    ok: true,
    skipped: false,
    previousStatus: effectiveStatus,
    newStatus,
    campaignId: normalizedCampaignId
  };
}

app.post('/api/campaigns/bulk-toggle', async (req, res) => {
  try {
    const targetStatus = normalizeCampaignStatus(req.body.targetStatus);
    if (targetStatus !== 'PAUSED' && targetStatus !== 'ACTIVE') {
      return res.status(400).json({ error: 'targetStatus chi ho tro ACTIVE hoac PAUSED' });
    }

    const fromDate = normalizeCampaignDate(req.body.fromDate || req.body.date);
    const toDate = normalizeCampaignDate(req.body.toDate || req.body.date || fromDate);
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    const requestedItems = rawItems
      .map(item => ({
        accountId: String(item?.accountId || '').trim(),
        campaignId: String(item?.campaignId || '').trim(),
        currentStatus: normalizeCampaignStatus(item?.currentStatus)
      }))
      .filter(item => item.campaignId && mongoose.Types.ObjectId.isValid(item.accountId));

    const uniqueItems = [];
    const seen = new Set();
    for (const item of requestedItems) {
      const key = `${item.accountId}:${item.campaignId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueItems.push(item);
    }

    if (!uniqueItems.length) {
      return res.status(400).json({ error: 'Chua chon campaign' });
    }
    if (uniqueItems.length > 2000) {
      return res.status(400).json({ error: 'Chi cho phep xu ly toi da 2000 campaign moi lan' });
    }

    const accountIds = [...new Set(uniqueItems.map(item => item.accountId))];
    const accounts = await Account.find(withUserFilter(req, { _id: { $in: accountIds } }));
    const accountsById = new Map(accounts.map(account => [String(account._id), account]));
    const tokenByAccountId = new Map();
    const results = [];
    const errors = [];

    for (const item of uniqueItems) {
      const account = accountsById.get(item.accountId);
      if (!account) {
        errors.push({ ...item, error: 'Account not found' });
        continue;
      }

      try {
        let fbToken = tokenByAccountId.get(item.accountId);
        if (fbToken === undefined) {
          const secrets = await getEffectiveSecrets(account);
          fbToken = secrets.fbToken || '';
          tokenByAccountId.set(item.accountId, fbToken);
        }
        if (!fbToken) throw new Error('Thieu Facebook Access Token');

        const result = await setCampaignStatusForAccount({
          account,
          fbToken,
          campaignId: item.campaignId,
          currentStatus: item.currentStatus,
          targetStatus,
          fromDate,
          toDate,
          fetchLiveStatus: false,
          skipNoChange: false
        });
        results.push({
          ...item,
          ...result,
          accountName: account.name
        });
      } catch (error) {
        errors.push({ ...item, accountName: account.name, error: error.message });
      }
    }

    const changedCount = results.filter(item => !item.skipped).length;
    const skippedCount = results.filter(item => item.skipped).length;
    if (changedCount > 0) clearCampaignReadCache();

    const logLevel = targetStatus === 'ACTIVE' ? 'success' : 'warn';
    const logMessage = `Thu cong bulk: ${targetStatus} ${changedCount}/${uniqueItems.length} camp${skippedCount ? `, bo qua ${skippedCount}` : ''}${errors.length ? `, loi ${errors.length}` : ''}`;
    for (const account of accounts) {
      const accountChangedCount = results.filter(item => String(item.accountId) === String(account._id) && !item.skipped).length;
      if (accountChangedCount <= 0) continue;
      await addLog(account._id, account.name, logLevel, `${logMessage} (${accountChangedCount} camp trong tai khoan nay)`);
    }

    res.json({
      ok: errors.length === 0,
      targetStatus,
      requested: uniqueItems.length,
      changed: changedCount,
      skipped: skippedCount,
      failed: errors.length,
      results,
      errors,
      logLevel,
      logMessage
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/toggle', async (req, res) => {
  try {
    const { accountId, currentStatus } = req.body;
    const fromDate = normalizeCampaignDate(req.body.fromDate || req.body.date);
    const toDate = normalizeCampaignDate(req.body.toDate || req.body.date || fromDate);
    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    const campaignId = String(req.params.campaignId || '').trim();
    if (!campaignId) return res.status(400).json({ error: 'Thieu campaignId' });

    const result = await setCampaignStatusForAccount({
      account,
      fbToken,
      campaignId,
      currentStatus,
      targetStatus: req.body.targetStatus,
      fromDate,
      toDate,
      fetchLiveStatus: true
    });
    clearCampaignReadCache();

    const logLevel = result.newStatus === 'ACTIVE' ? 'success' : 'warn';
    const logMessage = `Thu cong: ${result.previousStatus || normalizeCampaignStatus(currentStatus) || 'UNKNOWN'} -> ${result.newStatus} (${campaignId})`;

    await addLog(
      account._id,
      account.name,
      logLevel,
      logMessage
    );

    res.json({ ok: true, previousStatus: result.previousStatus, newStatus: result.newStatus, logLevel, logMessage });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/rename', async (req, res) => {
  try {
    const { accountId } = req.body;
    const date = normalizeCampaignDate(req.body.date);
    const name = String(req.body.name || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Ten campaign khong duoc de trong' });
    if (name.length > 400) return res.status(400).json({ error: 'Ten campaign qua dai' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    await fbPost(fbToken, req.params.campaignId, { name });
    await Campaign.findOneAndUpdate(
      { accountId, campaignId: req.params.campaignId, date },
      { $set: { name, updatedAt: new Date() } },
      { new: true }
    );
    clearCampaignReadCache();

    await addLog(account._id, account.name, 'success', `Doi ten camp ${req.params.campaignId}: ${name}`);
    res.json({ ok: true, name });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/budget', async (req, res) => {
  try {
    const { accountId } = req.body;
    const date = normalizeCampaignDate(req.body.date);
    const budget = Math.round(Number(req.body.budget || 0));
    if (!Number.isFinite(budget) || budget <= 0) return res.status(400).json({ error: 'Ngan sach khong hop le' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    const campaign = await Campaign.findOne({ accountId, campaignId: req.params.campaignId, date }).lean();
    const isLifetime = String(campaign?.budgetType || '').toUpperCase() === 'LIFETIME' || Number(campaign?.lifetimeBudget || 0) > 0;
    const field = isLifetime ? 'lifetime_budget' : 'daily_budget';
    await fbPost(fbToken, req.params.campaignId, { [field]: budget });

    const update = isLifetime
      ? { lifetimeBudget: budget, dailyBudget: 0, budgetType: 'LIFETIME', updatedAt: new Date() }
      : { dailyBudget: budget, lifetimeBudget: 0, budgetType: 'DAILY', updatedAt: new Date() };
    await Campaign.findOneAndUpdate(
      { accountId, campaignId: req.params.campaignId, date },
      { $set: update },
      { new: true }
    );
    clearCampaignReadCache();

    await addLog(account._id, account.name, 'success', `Doi ngan sach camp ${req.params.campaignId}: ${budget.toLocaleString()}d`);
    res.json({ ok: true, budget, budgetType: update.budgetType });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function processCampaignDuplicateExactRequest(body = {}, onProgress = null) {
  const ownerUserId = body.ownerUserId || null;
  const provider = normalizeProvider(body.provider);
  const date = normalizeCampaignDate(body.date);
  const copyCount = parseBoundedInt(body.copyCount, 1, 1, 20);
  const selectedItems = Array.isArray(body.items) ? body.items : [];
  const cloneStart = parseVietnamCampaignStart(body.startTime);
  const cloneEnd = parseVietnamCampaignEnd(body.endTime);

  if (cloneEnd && new Date(cloneEnd.utc).getTime() <= new Date(cloneStart.utc).getTime()) {
    throw new Error('Thoi gian ket thuc phai lon hon thoi gian bat dau');
  }

  const requested = selectedItems
    .map(item => ({
      campaignId: String(item?.campaignId || '').trim(),
      accountId: String(item?.accountId || '').trim()
    }))
    .filter(item => item.campaignId && mongoose.Types.ObjectId.isValid(item.accountId));

  const selectedKeys = [...new Set(requested.map(item => `${item.accountId}:${item.campaignId}`))];
  if (!selectedKeys.length) {
    throw new Error('Chua chon campaign de nhan ban');
  }

  if (selectedKeys.length * copyCount > 100) {
    throw new Error('Chi cho phep tao toi da 100 ban copy moi lan');
  }

  const query = {
    date,
    $or: selectedKeys.map(key => {
      const [accountId, campaignId] = key.split(':');
      return { accountId, campaignId };
    })
  };
  if (ownerUserId) {
    const ownerAccounts = await Account.find({ ownerUserId, _id: { $in: requested.map(item => item.accountId) } }).select('_id').lean();
    const ownerAccountIds = new Set(ownerAccounts.map(account => String(account._id)));
    query.$or = query.$or.filter(item => ownerAccountIds.has(String(item.accountId)));
  }

  const campaigns = await Campaign.find(query)
    .populate('accountId', 'name adAccountId provider fbToken claudeKey')
    .lean();

  const validCampaigns = campaigns.filter(campaign => {
    const account = campaign.accountId;
    if (!account) return false;
    if (provider === 'shopee') return account.provider === 'shopee';
    return account.provider === 'facebook' || !account.provider;
  });

  const copyOptions = {
    start_time: cloneStart.fbStartTime,
    ...(cloneEnd ? { end_time: cloneEnd.fbStartTime } : {})
  };
  const scheduledCampaignDate = campaignDateFromScheduledStart(cloneStart);

  const copied = [];
  const errors = [];
  const totalCopies = validCampaigns.length * copyCount;
  let finishedCopies = 0;

  if (onProgress) await onProgress({ copied: 0, errors: 0, totalCopies, percent: 0 });

  for (const campaign of validCampaigns) {
    const account = campaign.accountId;
    const accountIdValue = account?._id || account;
    try {
      const { fbToken } = await getEffectiveSecrets(account);
      if (!fbToken) throw new Error('Thieu Facebook Access Token');

      for (let index = 0; index < copyCount; index += 1) {
        const copyResult = await duplicateCampaignExactQueued(fbToken, campaign, copyOptions);
        const copiedCampaignId = copyResult.copiedCampaignId;
        const copiedAdName = combineAdNames(copyResult.copiedAds) || campaign.adName || '';

        await upsertDailyCampaign(accountIdValue, copiedCampaignId, scheduledCampaignDate, {
          name: copyResult.copiedCampaignName || campaign.name || campaign.campaignId,
          adName: copiedAdName,
          status: 'ACTIVE',
          dailyBudget: campaign.dailyBudget || 0,
          lifetimeBudget: campaign.lifetimeBudget || 0,
          budgetType: campaign.budgetType || (campaign.lifetimeBudget > 0 ? 'LIFETIME' : 'DAILY'),
          isScheduled: true,
          scheduledStartTime: cloneStart.fbStartTime,
          scheduledStartTimeUtc: cloneStart.utc,
          scheduledStartTimeDisplay: cloneStart.display,
          scheduledEndTime: cloneEnd?.fbStartTime || '',
          scheduledEndTimeUtc: cloneEnd?.utc,
          scheduledEndTimeDisplay: cloneEnd?.display || ''
        });

        copied.push({
          sourceCampaignId: campaign.campaignId,
          copiedCampaignId,
          copyIndex: index + 1,
          sourceName: campaign.name || '',
          name: copyResult.copiedCampaignName || campaign.name || '',
          copiedCampaignName: copyResult.copiedCampaignName || campaign.name || '',
          adName: copiedAdName,
          copiedCampaignStatus: 'ACTIVE',
          accountId: String(accountIdValue),
          accountName: account.name || '',
          copyMode: 'queued',
          copiedAdSetCount: copyResult.copiedAdSets.length,
          copiedAdCount: copyResult.copiedAds.length,
          raw: copyResult.raw
        });

        finishedCopies += 1;
        if (onProgress) {
          await onProgress({
            copied: copied.length,
            errors: errors.length,
            totalCopies,
            percent: totalCopies ? Math.round((finishedCopies / totalCopies) * 100) : 100
          });
        }
      }

      await addLog(
        accountIdValue,
        account.name || '',
        'success',
        `Nhan ban y nguyen theo hang doi ${copyCount} ban: ${campaign.name || campaign.campaignId}`
      );
    } catch (error) {
      await addLog(
        accountIdValue,
        account?.name || '',
        'error',
        `Nhan ban y nguyen that bai ${campaign.name || campaign.campaignId}: ${error.message}`
      );

      errors.push({
        sourceCampaignId: campaign.campaignId,
        name: campaign.name || '',
        accountId: accountIdValue ? String(accountIdValue) : '',
        accountName: account?.name || '',
        error: error.message
      });

      finishedCopies += copyCount;
      if (onProgress) {
        await onProgress({
          copied: copied.length,
          errors: errors.length,
          totalCopies,
          percent: totalCopies ? Math.round((finishedCopies / totalCopies) * 100) : 100
        });
      }
    }
  }

  const foundKeys = new Set(validCampaigns.map(campaign => `${campaign.accountId?._id || campaign.accountId}:${campaign.campaignId}`));
  for (const key of selectedKeys) {
    if (!foundKeys.has(key)) {
      const [, campaignId] = key.split(':');
      errors.push({ sourceCampaignId: campaignId, error: 'Khong tim thay campaign phu hop voi tai khoan/provider da chon' });
    }
  }

  return {
    ok: true,
    date,
    count: selectedKeys.length,
    copyCount,
    copied,
    errors,
    startTime: cloneStart.fbStartTime,
    endTime: cloneEnd?.fbStartTime || ''
  };
}

app.post('/api/campaigns/duplicate-exact', async (req, res) => {
  try {
    req.body.ownerUserId = req.currentUser._id;
    if (campaignDuplicateQueue && req.body?.queue === true) {
      startCampaignDuplicateWorker();
      const job = await campaignDuplicateQueue.add('duplicate-exact', req.body);
      return res.status(202).json({
        ok: true,
        queued: true,
        queue: CAMPAIGN_DUPLICATE_QUEUE_NAME,
        jobId: String(job.id),
        statusUrl: `/api/queues/campaign-duplicates/jobs/${job.id}`
      });
    }

    const result = await processCampaignDuplicateExactRequest(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/queues/campaign-duplicates/jobs/:id', async (req, res) => {
  try {
    if (!campaignDuplicateQueue) {
      return res.status(404).json({ error: 'Campaign duplicate queue is not enabled' });
    }

    const job = await campaignDuplicateQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job' });

    const state = await job.getState();
    res.json({
      ok: true,
      id: String(job.id),
      name: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason || '',
      returnvalue: job.returnvalue || null,
      timestamp: job.timestamp,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/create-from-posts', async (req, res) => {
  try {
    const { accountId } = req.body;
    const campaignItems = parseCampaignCreateItems(req.body.codes);
    const selectedPageId = String(req.body.pageId || '').trim();
    const campaignPrefix = String(req.body.campaignPrefix || '').trim();
    const adNamePrefix = String(req.body.adNamePrefix || DEFAULT_AD_NAME_PREFIX).trim() || DEFAULT_AD_NAME_PREFIX;
    const adNameStatus = normalizeAdNameStatus(req.body.adNameStatus);

    if (!accountId) return res.status(400).json({ error: 'Thieu tai khoan quang cao' });
    if (!campaignItems.length) return res.status(400).json({ error: 'Chua co ma san pham nao' });

    const account = await Account.findOne(withUserFilter(req, { _id: accountId }));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { fbToken } = await getEffectiveSecrets(account);
    if (!fbToken) return res.status(400).json({ error: 'Thieu Facebook Access Token' });

    const acctId = account.adAccountId.startsWith('act_')
      ? account.adAccountId
      : `act_${account.adAccountId}`;

    const isShopee = account.provider === 'shopee';
    const dailyBudgetDefault = isShopee ? SHOPEE_CAMPAIGN_DAILY_BUDGET : DEFAULT_CAMPAIGN_DAILY_BUDGET;
    const dailyBudget = Math.max(1000, Number(req.body.dailyBudget || dailyBudgetDefault));
    const requestedBidAmount = Number(req.body.bidAmount);
    const shopeeBidAmount = Number.isFinite(requestedBidAmount) && requestedBidAmount > 0
      ? Math.round(requestedBidAmount)
      : SHOPEE_AD_SET_BID_AMOUNT;
    const fbBidMode = req.body.fbBidMode === 'bid' ? 'bid' : 'normal';
    const requestedFbBidAmount = Number(req.body.fbBidAmount);
    const fbBidAmount = Number.isFinite(requestedFbBidAmount) && requestedFbBidAmount > 0
      ? Math.round(requestedFbBidAmount)
      : 0;
    const { ageMin, ageMax } = parseCampaignAgeRange(
      req.body.ageMin,
      req.body.ageMax,
      isShopee ? SHOPEE_AGE_MIN : 18,
      isShopee ? SHOPEE_AGE_MAX : 50
    );
    const objective = isShopee ? 'OUTCOME_TRAFFIC' : DEFAULT_CAMPAIGN_OBJECTIVE;
    const destinationType = isShopee ? 'UNDEFINED' : DEFAULT_AD_SET_DESTINATION_TYPE;
    const optimizationGoal = isShopee ? 'LINK_CLICKS' : DEFAULT_AD_SET_OPTIMIZATION_GOAL;
    const campaignBidStrategy = isShopee
      ? SHOPEE_CAMPAIGN_BID_STRATEGY
      : (fbBidMode === 'bid' ? 'LOWEST_COST_WITH_BID_CAP' : DEFAULT_CAMPAIGN_BID_STRATEGY);
    const shopeeCallToActionType = normalizeShopeeCallToActionType(req.body.callToActionType);
    const campaignGender = isShopee ? parseCampaignGender(req.body.gender) : 'female';
    const genderTargeting = getMetaGenderTargeting(campaignGender);

    const scheduledStart = parseVietnamCampaignStart(req.body.startTime);
    const campaignDate = campaignDateFromScheduledStart(scheduledStart);

    const created = [];
    const errors = [];
    const createConcurrency = parseBoundedInt(
      req.body.createConcurrency || req.body.concurrency,
      CAMPAIGN_CREATE_CONCURRENCY,
      1,
      3
    );
    const createItemDelayMs = parseBoundedInt(
      req.body.createItemDelayMs,
      CAMPAIGN_CREATE_ITEM_DELAY_MS,
      0,
      60000
    );

    const processCampaignItem = async (item) => {
      const code = item.campaignName;
      const lookupTerm = item.lookupTerm;
      const destinationUrl = getDestinationUrlFromLookupTerm(item.destinationUrl || lookupTerm);
      let matchedPostInfo = null;
      try {
        const lookupTerms = buildPostLookupTerms(lookupTerm);
        const postQuery = {
          $or: lookupTerms.map(term => ({
            message: { $regex: escapeRegExp(term), $options: 'i' }
          }))
        };
        if (selectedPageId) {
          postQuery.pageId = selectedPageId;
        }

        const post = await FacebookPost.findOne(postQuery).sort({ createdTime: -1, fetchedAt: -1 }).lean();
        matchedPostInfo = post ? {
          postId: post.postId,
          pageId: post.pageId,
          pageName: post.pageName
        } : null;

        if (!post) {
          const pageScope = selectedPageId ? ` tren Page ${selectedPageId}` : '';
          return { error: { code, lookupTerm, error: `Khong tim thay bai viet da luu co link/ma nay${pageScope}` } };
        }

        const cleanCode = code.replace(/\s+/g, ' ');
        const baseName = buildCampaignName(cleanCode, campaignPrefix);
        const pageId = getPostPageId(post);
        if (!pageId) {
          return { error: { code, lookupTerm, error: 'Khong xac dinh duoc Page ID cua bai viet de tao camp luot mua qua tin nhan' } };
        }
        const objectStoryId = getPostObjectStoryId(post);
        if (!objectStoryId || !objectStoryId.includes('_')) {
          return {
            error: {
              code,
              lookupTerm,
              error: `Bai viet ${post.postId || post.id || ''} chua co object_story_id hop le. Hay bam cap nhat bai viet Page roi tao lai camp.`
            }
          };
        }

        const adName = buildAdName(cleanCode, adNamePrefix, adNameStatus);
        const finalAdName = isShopee ? baseName : adName;
        let campaign = await fbPost(fbToken, `${acctId}/campaigns`, {
          name: baseName,
          objective: objective,
          status: 'ACTIVE',
          special_ad_categories: [],
          buying_type: 'AUCTION',
          daily_budget: Math.round(dailyBudget),
          bid_strategy: campaignBidStrategy
        }, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        const buildAdSetPayload = (campaignId, nextDestinationType, nextOptimizationGoal) => ({
          name: isShopee ? baseName : DEFAULT_AD_SET_NAME,
          campaign_id: campaignId,
          ...(nextDestinationType && nextDestinationType !== 'UNDEFINED'
            ? { destination_type: nextDestinationType }
            : {}),
          billing_event: 'IMPRESSIONS',
          optimization_goal: nextOptimizationGoal,
          ...(isShopee ? {} : { optimization_sub_event: 'NONE' }),
          ...(isShopee ? { bid_amount: shopeeBidAmount } : (fbBidMode === 'bid' && fbBidAmount > 0 ? { bid_amount: fbBidAmount } : {})),
          ...(nextDestinationType === 'MESSENGER'
            ? { promoted_object: { page_id: pageId, smart_pse_enabled: false } }
            : {}),
          attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }],
          targeting: {
            geo_locations: {
              countries: ['VN'],
              location_types: isShopee ? ['home', 'recent'] : ['frequently_in', 'home', 'recent']
            },
            brand_safety_content_filter_levels: isShopee ? ['FACEBOOK_RELAXED'] : ['FACEBOOK_STANDARD', 'AN_STANDARD'],
            targeting_automation: {
              advantage_audience: 0
            },
            ...(isShopee ? {
              publisher_platforms: ['facebook'],
              facebook_positions: ['feed', 'facebook_reels', 'facebook_reels_overlay', 'profile_feed', 'notification', 'instream_video', 'marketplace', 'story', 'search'],
              device_platforms: ['mobile', 'desktop'],
              ...(genderTargeting.length ? { genders: genderTargeting } : {})
            } : {
              genders: [2]
            }),
            age_min: ageMin,
            age_max: ageMax
          },
          start_time: scheduledStart.fbStartTime,
          status: 'ACTIVE'
        });

        const adSetPayload = buildAdSetPayload(campaign.id, destinationType, optimizationGoal);

        const adSet = await fbPost(fbToken, `${acctId}/adsets`, adSetPayload, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        const creativePayload = {
          name: `${baseName} - Creative`,
          object_story_id: objectStoryId,
          contextual_multi_ads: {
            enroll_status: 'OPT_OUT'
          }
        };

        if (isShopee && shopeeCallToActionType !== 'NO_BUTTON' && destinationUrl) {
          creativePayload.call_to_action_type = shopeeCallToActionType;
          creativePayload.link_url = destinationUrl;
        }

        const creative = await fbPost(fbToken, `${acctId}/adcreatives`, creativePayload, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        const ad = await fbPost(fbToken, `${acctId}/ads`, {
          name: finalAdName,
          adset_id: adSet.id,
          creative: { creative_id: creative.id },
          status: 'ACTIVE'
        }, FB_CAMPAIGN_CREATE_REQUEST_OPTIONS);

        await upsertDailyCampaign(account._id, campaign.id, campaignDate, {
          name: baseName,
          adName: finalAdName,
          status: 'ACTIVE',
          dailyBudget,
          bidAmount: isShopee ? shopeeBidAmount : (fbBidMode === 'bid' ? fbBidAmount : 0),
          budgetType: 'DAILY',
          isScheduled: true,
          scheduledStartTime: scheduledStart.fbStartTime,
          scheduledStartTimeUtc: scheduledStart.utc,
          scheduledStartTimeDisplay: scheduledStart.display
        });

        await addLog(
          account._id,
          account.name,
          'success',
          isShopee
            ? `Tao camp Shopee traffic tu bai viet: ${cleanCode} -> ${campaign.id}, bat dau ${scheduledStart.display}`
            : `Tao camp luot mua qua tin nhan tu bai viet: ${cleanCode} -> ${campaign.id}, bat dau ${scheduledStart.display}`
        );

        return {
          created: {
            code,
            lookupTerm,
            postId: post.postId,
            pageName: post.pageName,
            objective,
            destinationType,
            optimizationGoal,
            campaignBidStrategy,
            bidAmount: isShopee ? shopeeBidAmount : undefined,
            callToActionType: isShopee ? shopeeCallToActionType : undefined,
            gender: isShopee ? campaignGender : 'female',
            destinationUrl: isShopee ? destinationUrl : undefined,
            adName: finalAdName,
            campaignId: campaign.id,
            adSetId: adSet.id,
            creativeId: creative.id,
            adId: ad.id,
            status: 'ACTIVE',
            startTime: scheduledStart.fbStartTime,
            startTimeUtc: scheduledStart.utc,
            startTimeDisplay: scheduledStart.display
          }
        };
      } catch (error) {
        const purchaseOptimizationHint = isMessagingPurchaseOptimizationError(error) && matchedPostInfo
          ? ` Page "${matchedPostInfo.pageName || matchedPostInfo.pageId}" (${matchedPostInfo.pageId}) chua du dieu kien toi uu hoa luot mua qua tin nhan.`
          : '';
        return {
          error: {
            code,
            lookupTerm,
            error: `${error.message}${purchaseOptimizationHint}`,
            rateLimited: Boolean(error.rateLimited),
            objective,
            destinationType,
            optimizationGoal,
            campaignBidStrategy,
            bidAmount: isShopee ? shopeeBidAmount : undefined,
            callToActionType: isShopee ? shopeeCallToActionType : undefined,
            gender: isShopee ? campaignGender : 'female',
            destinationUrl: isShopee ? destinationUrl : undefined,
            postPageId: matchedPostInfo?.pageId,
            postPageName: matchedPostInfo?.pageName,
            postId: matchedPostInfo?.postId
          }
        };
      }
    };

    let stoppedByRateLimit = false;
    for (let i = 0; i < campaignItems.length; i += createConcurrency) {
      const chunk = campaignItems.slice(i, i + createConcurrency);
      const itemResults = await Promise.allSettled(chunk.map(processCampaignItem));

      for (const result of itemResults) {
        if (result.status === 'fulfilled') {
          if (result.value?.created) created.push(result.value.created);
          if (result.value?.error) errors.push(result.value.error);
          if (result.value?.error?.rateLimited) stoppedByRateLimit = true;
          continue;
        }

        errors.push({ code: 'unknown', error: result.reason?.message || String(result.reason || 'Unknown error') });
        if (result.reason?.rateLimited) stoppedByRateLimit = true;
      }

      if (stoppedByRateLimit) {
        break;
      }

      if (createItemDelayMs > 0 && i + createConcurrency < campaignItems.length) {
        await sleep(createItemDelayMs);
      }
    }

    res.json({
      ok: true,
      created,
      errors,
      createConcurrency,
      createItemDelayMs,
      stoppedByRateLimit,
      startTime: scheduledStart.fbStartTime,
      startTimeDisplay: scheduledStart.display
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/accounts/:id/campaigns', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { date, fromDate, toDate } = req.query;
    const fDate = fromDate || date || todayStr();
    const tDate = toDate || date || fDate;
    const provider = String(req.query.provider || '').trim();
    const includeScheduledNoSpend = req.query.includeScheduledNoSpend === 'true' || req.query.includeScheduledNoSpend === true;
    const includeLiveCreated = req.query.includeLiveCreated === 'true' || req.query.includeLiveCreated === true;
    const includeLiveCampaigns = includeScheduledNoSpend && includeLiveCreated && dateRangeTouchesTodayOrFuture(fDate, tDate);
    const cacheKey = userScopedCacheKey(req, `campaigns:account:${req.params.id}:${provider || 'all'}:${fDate}:${tDate}:${includeScheduledNoSpend ? 'with-scheduled-zero' : 'default'}:${includeLiveCampaigns ? 'live-created' : 'stored'}`);
    const cached = includeLiveCampaigns ? null : getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const ownedAccount = await Account.findOne(withUserFilter(req, { _id: req.params.id }))
      .select('_id name adAccountId provider fbToken ownerUserId')
      .lean();
    if (!ownedAccount) return res.json([]);

    if (provider) {
      const account = await Account.findOne(withUserFilter(req, {
        _id: req.params.id,
        ...buildAccountProviderFilter(provider)
      })).select('_id').lean();
      if (!account) return res.json([]);
    }
    const match = {
      accountId: new mongoose.Types.ObjectId(req.params.id),
      date: { $gte: fDate, $lte: tDate }
    };

    const campaigns = await Campaign.aggregate([
      { $match: match },
      { $sort: { date: 1, updatedAt: 1, _id: 1 } },
      {
        $group: {
          _id: '$campaignId',
          campaignId: { $first: '$campaignId' },
          accountId: { $first: '$accountId' },
          name: { $first: '$name' },
          adName: { $max: '$adName' },
          status: { $last: '$status' },
          dailyBudget: { $last: '$dailyBudget' },
          lifetimeBudget: { $last: '$lifetimeBudget' },
          budgetType: { $last: '$budgetType' },
          createdTime: { $last: '$createdTime' },
          spend: { $sum: '$spend' },
          messages: { $sum: '$messages' },
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
          costPerMessage: { $last: '$costPerMessage' },
          metaOrders: { $sum: '$metaOrders' }
        }
      },
      {
        $project: {
          _id: 0,
          campaignId: 1,
          accountId: 1,
          name: 1,
          adName: 1,
          status: 1,
          dailyBudget: 1,
          lifetimeBudget: 1,
          budgetType: 1,
          createdTime: 1,
          spend: 1,
          messages: 1,
          clicks: 1,
          impressions: 1,
          metaOrders: 1,
          costPerMessage: 1
        }
      },
      { $sort: { spend: -1 } }
    ]);
    let result = campaigns;
    if (includeScheduledNoSpend) {
      try {
        const existingCampaignIds = new Set(campaigns.map(campaign => campaign.campaignId));
        const extraCampaigns = await fetchScheduledCampaignRowsFromDb(
          [ownedAccount._id],
          fDate,
          tDate,
          {
            includeAccountInfo: false,
            includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
            existingCampaignIds
          }
        );
        if (extraCampaigns.length > 0) {
          result = mergeCampaignReportRows(result, extraCampaigns);
          for (const campaign of extraCampaigns) {
            existingCampaignIds.add(String(campaign.campaignId || '').trim());
          }
        }

        if (includeLiveCampaigns) {
          const liveCampaigns = await fetchLiveCampaignRowsForReportByAccounts(
            [ownedAccount],
            fDate,
            tDate,
            {
              includeAccountInfo: false,
              includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
              existingCampaignIds
            }
          );
          if (liveCampaigns.length > 0) {
            result = mergeCampaignReportRows(result, liveCampaigns);
          }
        }
      } catch (error) {
        console.warn(`[campaigns:account] extra campaign merge failed for ${req.params.id}: ${error.message}`);
      }
    }

    console.log(`[campaigns:account] account=${req.params.id} ${fDate}..${tDate} rows=${result.length} ${Date.now() - startedAt}ms`);
    res.json(includeLiveCampaigns ? result : setReadCache(cacheKey, result));
  } catch (error) {
    console.error(`[campaigns:account] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/campaigns/today', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { provider, date, fromDate, toDate } = req.query;
    const fDate = fromDate || date || todayStr();
    const tDate = toDate || date || fDate;
    const includeScheduledNoSpend = req.query.includeScheduledNoSpend === 'true' || req.query.includeScheduledNoSpend === true;
    const includeLiveCreated = req.query.includeLiveCreated === 'true' || req.query.includeLiveCreated === true;
    const includeMetaInsights = req.query.includeMetaInsights === 'true' || req.query.includeMetaInsights === true;
    const includeLiveCampaigns = includeScheduledNoSpend && includeLiveCreated && dateRangeTouchesTodayOrFuture(fDate, tDate);
    const today = todayStr();
    const shouldFetchMetaInsights = includeMetaInsights && provider !== 'shopee' && String(fDate) <= today;
    const metaInsightsToDate = String(tDate) > today ? today : tDate;
    const cacheKey = userScopedCacheKey(req, `campaigns:today:${provider || 'all'}:${fDate}:${tDate}:${includeScheduledNoSpend ? 'with-scheduled-zero' : 'default'}:${includeLiveCampaigns ? 'live-created' : 'stored'}:${shouldFetchMetaInsights ? 'meta-insights' : 'stored-insights'}`);
    const cached = includeLiveCampaigns || shouldFetchMetaInsights ? null : getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const accountFilter = provider ? buildAccountProviderFilter(provider) : {};
    const accounts = await Account.find(withUserFilter(req, accountFilter))
      .select('_id name adAccountId provider fbToken ownerUserId')
      .lean();
    if (!accounts.length) return res.json(setReadCache(cacheKey, []));

    const accountById = new Map(accounts.map(account => [
      String(account._id),
      {
        _id: account._id,
        name: account.name,
        adAccountId: account.adAccountId,
        provider: account.provider
      }
    ]));

    let match = {
      date: { $gte: fDate, $lte: tDate }
    };
    match.accountId = { $in: accounts.map(account => account._id) };

    // Nếu là khoảng ngày, ta group theo campaignId để cộng dồn spend/messages
    const campaigns = await Campaign.aggregate([
      { $match: match },
      { $sort: { date: 1, updatedAt: 1, _id: 1 } },
      {
        $group: {
          _id: '$campaignId',
          campaignId: { $first: '$campaignId' },
          accountId: { $first: '$accountId' },
          name: { $first: '$name' },
          adName: { $max: '$adName' },
          status: { $last: '$status' },
          dailyBudget: { $last: '$dailyBudget' },
          lifetimeBudget: { $last: '$lifetimeBudget' },
          budgetType: { $last: '$budgetType' },
          createdTime: { $last: '$createdTime' },
          spend: { $sum: '$spend' },
          messages: { $sum: '$messages' },
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
          costPerMessage: { $last: '$costPerMessage' },
          metaOrders: { $sum: '$metaOrders' }
        }
      },
      {
        $project: {
          _id: 0,
          campaignId: 1,
          accountId: 1,
          name: 1,
          adName: 1,
          status: 1,
          dailyBudget: 1,
          lifetimeBudget: 1,
          budgetType: 1,
          createdTime: 1,
          spend: 1,
          messages: 1,
          clicks: 1,
          impressions: 1,
          metaOrders: 1,
          costPerMessage: 1
        }
      },
      { $sort: { spend: -1 } }
    ]);

    let result = campaigns.map(campaign => ({
      ...campaign,
      accountId: accountById.get(String(campaign.accountId)) || campaign.accountId
    }));
    if (includeScheduledNoSpend && accounts.length > 0) {
      const existingCampaignIds = new Set(result.map(campaign => campaign.campaignId));
      const extraCampaigns = await fetchScheduledCampaignRowsFromDb(
        accounts.map(account => account._id),
        fDate,
        tDate,
        {
          includeAccountInfo: true,
          includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
          existingCampaignIds
        }
      );

      if (extraCampaigns.length > 0) {
        result = mergeCampaignReportRows(result, extraCampaigns);
        for (const campaign of extraCampaigns) {
          existingCampaignIds.add(String(campaign.campaignId || '').trim());
        }
      }

      if (includeLiveCampaigns) {
        const liveCampaigns = await fetchLiveCampaignRowsForReportByAccounts(
          accounts,
          fDate,
          tDate,
          {
            includeAccountInfo: true,
            includeFutureScheduled: dateRangeIncludesToday(fDate, tDate),
            existingCampaignIds
          }
        );
        if (liveCampaigns.length > 0) {
          result = mergeCampaignReportRows(result, liveCampaigns);
        }
      }
    }

    if (shouldFetchMetaInsights && accounts.length > 0) {
      const metaRows = await fetchMetaCampaignMetricRowsForReport(accounts, fDate, metaInsightsToDate, { includeAccountInfo: true, persist: true });
      result = applyMetaCampaignMetricRows(result, metaRows);
    }

    console.log(`[campaigns:today] provider=${provider || 'all'} ${fDate}..${tDate} rows=${result.length} meta=${shouldFetchMetaInsights ? 'yes' : 'no'} ${Date.now() - startedAt}ms`);
    res.json(includeLiveCampaigns || shouldFetchMetaInsights ? result : setReadCache(cacheKey, result));
  } catch (error) {
    console.error(`[campaigns:today] failed after ${Date.now() - startedAt}ms: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

async function fetchAccountInsightsInRange(account, fromDate, toDate) {
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const { items } = await fetchAllFbEdge(fbToken, `${acctId}/insights`, {
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,conversions,cost_per_action_type',
    time_range: JSON.stringify({ since: fromDate, until: toDate }),
    level: 'campaign',
    limit: 500,
    time_increment: 1
  });

  return items;
}

async function fetchAccountAdNameMapInRange(account, fromDate, toDate) {
  const { fbToken } = await getEffectiveSecrets(account);
  if (!fbToken) throw new Error('Thieu Facebook Access Token');

  const acctId = account.adAccountId.startsWith('act_')
    ? account.adAccountId
    : `act_${account.adAccountId}`;

  const { items } = await fetchAllFbEdge(fbToken, `${acctId}/insights`, {
    fields: 'campaign_id,ad_id,ad_name',
    time_range: JSON.stringify({ since: fromDate, until: toDate }),
    level: 'ad',
    limit: 500,
    time_increment: 1
  });

  const byDateCampaign = new Map();
  const byCampaign = new Map();
  for (const row of items) {
    const campaignId = String(row?.campaign_id || '').trim();
    const date = String(row?.date_start || fromDate || '').trim();
    const adName = String(row?.ad_name || '').replace(/\s+/g, ' ').trim();
    if (!campaignId || !date || !adName) continue;

    const dateCampaignKey = `${normalizeCampaignDate(date)}:${campaignId}`;
    byDateCampaign.set(dateCampaignKey, combineAdNames([byDateCampaign.get(dateCampaignKey), adName]));
    byCampaign.set(campaignId, combineAdNames([byCampaign.get(campaignId), adName]));
  }

  return { byDateCampaign, byCampaign };
}

async function syncAccountHistoricalData(account, fromDate, toDate, options = {}) {
  const { fbToken } = await getEffectiveSecrets(account);
  const insights = await fetchAccountInsightsInRange(account, fromDate, toDate);
  const isShopee = normalizeProvider(account?.provider) === 'shopee';
  let adNamesByDateCampaign = new Map();
  try {
    const adNameMap = await fetchAccountAdNameMapInRange(account, fromDate, toDate);
    adNamesByDateCampaign = adNameMap.byDateCampaign;
  } catch (error) {
    console.warn(`[campaigns:adnames] skip ${account?.name || account?._id} ${fromDate}..${toDate}: ${error.message}`);
  }
  let count = 0;
  const seenByDate = new Map();

  for (const insight of insights) {
    const date = insight.date_start;
    if (!date || !insight.campaign_id) continue;
    if (!seenByDate.has(date)) seenByDate.set(date, new Set());
    seenByDate.get(date).add(String(insight.campaign_id));

    const spend = parseFloat(insight.spend || 0);
    const impressions = parseInt(insight.impressions || 0, 10);
    const clicks = parseInt(insight.clicks || 0, 10);
    const msgAction = isShopee ? null : getMetaMessageActionFromInsight(insight);
    const messages = isShopee ? 0 : parseInt(msgAction?.value || 0, 10);
    const costPerMessage = isShopee ? 0 : getMetaCostPerMessageFromInsight(insight);
    const metaOrders = isShopee ? 0 : getMetaOrdersFromInsight(insight);
    const adName = adNamesByDateCampaign.get(`${normalizeCampaignDate(date)}:${String(insight.campaign_id).trim()}`) || '';

    const campaignUpdate = {
      name: insight.campaign_name,
      bidAmount: 0,
      spend,
      impressions,
      clicks,
      messages,
      costPerMessage,
      metaOrders
    };
    if (adName) campaignUpdate.adName = adName;

    await upsertDailyCampaign(account._id, insight.campaign_id, date, campaignUpdate);
    count++;
  }

  if (options.prune === true && fromDate === toDate) {
    const seenCampaignIds = [...(seenByDate.get(fromDate) || new Set())];
    const pruneFilter = {
      accountId: account._id,
      date: fromDate
    };
    if (seenCampaignIds.length) {
      pruneFilter.campaignId = { $nin: seenCampaignIds };
    }
    const result = await Campaign.deleteMany(pruneFilter);
    if (result.deletedCount) {
      clearCampaignReadCache();
      clearDealStopCampaignCache();
      await addLog(account._id, account.name, 'info', `Chot ngay ${fromDate}: xoa ${result.deletedCount} camp cu khong con trong snapshot`);
    }
  }

  return count;
}

let finalSpendSyncRunning = false;
const syncHistoryJobs = new Map();
const dataPurchaseOrderSyncJobs = new Map();
const orderSheetSyncJobs = new Map();
let activeDataPurchaseOrderSyncJobId = '';
let activeOrderSheetSyncJobId = '';

function createSyncHistoryJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDataPurchaseOrderSyncJobId() {
  return `data-po-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function createOrderSheetSyncJobId() {
  return `orders-sheet-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function setDataPurchaseOrderSyncJob(jobId, updates) {
  const current = dataPurchaseOrderSyncJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
  dataPurchaseOrderSyncJobs.set(jobId, next);
  return next;
}

function toDataPurchaseOrderSyncJobPayload(job = {}) {
  return {
    id: job.id || '',
    state: job.state || 'unknown',
    percent: Number(job.percent || 0),
    imported: Number(job.imported || 0),
    matched: Number(job.matched || 0),
    modified: Number(job.modified || 0),
    upserted: Number(job.upserted || 0),
    deleted: Number(job.deleted || 0),
    sourceType: job.sourceType || '',
    message: job.message || '',
    error: job.error || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    finishedAt: job.finishedAt || ''
  };
}

async function runDataPurchaseOrderSyncJob(jobId, { accessToken = '', userId = '', googleConfig = null } = {}) {
  try {
    const job = dataPurchaseOrderSyncJobs.get(jobId);
    if (!job) return;

    setDataPurchaseOrderSyncJob(jobId, {
      state: 'active',
      percent: 10,
      message: 'Dang dong bo DATA dat hang'
    });

    let token = accessToken;
    if (!token && userId && googleConfig) {
      setDataPurchaseOrderSyncJob(jobId, {
        percent: 5,
        message: 'Dang lay quyen Google Sheet'
      });
      try {
        token = await getGoogleAccessTokenForUser(userId, googleConfig);
      } catch {
        token = '';
      }
    }

    setDataPurchaseOrderSyncJob(jobId, {
      percent: 10,
      message: 'Dang dong bo DATA dat hang'
    });

    const result = await syncDataPurchaseOrdersFromSheet({ accessToken: token });
    clearPurchaseOrderReadCache();
    setDataPurchaseOrderSyncJob(jobId, {
      state: 'completed',
      percent: 100,
      imported: result.imported || 0,
      matched: result.matched || 0,
      modified: result.modified || 0,
      upserted: result.upserted || 0,
      deleted: result.deleted || 0,
      sourceType: result.sourceType || '',
      finishedAt: new Date().toISOString(),
      message: 'Da dong bo DATA dat hang'
    });
  } catch (error) {
    setDataPurchaseOrderSyncJob(jobId, {
      state: 'failed',
      percent: 100,
      error: error.message,
      finishedAt: new Date().toISOString(),
      message: error.message
    });
  } finally {
    if (activeDataPurchaseOrderSyncJobId === jobId) {
      activeDataPurchaseOrderSyncJobId = '';
    }
    setTimeout(() => dataPurchaseOrderSyncJobs.delete(jobId), 60 * 60 * 1000);
  }
}

function setOrderSheetSyncJob(jobId, updates) {
  const current = orderSheetSyncJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
  orderSheetSyncJobs.set(jobId, next);
  return next;
}

function toOrderSheetSyncJobPayload(job = {}) {
  return {
    id: job.id || '',
    state: job.state || 'unknown',
    source: job.source || 'google_sheet',
    fromDate: job.fromDate || '',
    toDate: job.toDate || '',
    totalRows: Number(job.totalRows || 0),
    synced: Number(job.synced || 0),
    percent: Number(job.percent || 0),
    message: job.message || '',
    error: job.error || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    finishedAt: job.finishedAt || ''
  };
}

async function runOrderSheetSyncJob(jobId, { fromDate = '', toDate = '' } = {}) {
  try {
    const job = orderSheetSyncJobs.get(jobId);
    if (!job) return;

    setOrderSheetSyncJob(jobId, {
      state: 'active',
      percent: 10,
      message: 'Dang tai Google Sheet'
    });

    const result = await processOrderSheetSyncJob({ fromDate, toDate }, progress => {
      setOrderSheetSyncJob(jobId, {
        state: progress.state || 'active',
        percent: progress.percent || 0,
        message: progress.message || '',
        totalRows: progress.totalRows || 0,
        synced: progress.synced || 0,
        fromDate: progress.fromDate || fromDate,
        toDate: progress.toDate || toDate
      });
    });

    setOrderSheetSyncJob(jobId, {
      ...result,
      state: result.state || 'completed',
      finishedAt: new Date().toISOString()
    });
  } catch (error) {
    setOrderSheetSyncJob(jobId, {
      state: 'failed',
      percent: 100,
      error: error.message,
      message: error.message,
      finishedAt: new Date().toISOString()
    });
  } finally {
    if (activeOrderSheetSyncJobId === jobId) {
      activeOrderSheetSyncJobId = '';
    }
    setTimeout(() => orderSheetSyncJobs.delete(jobId), 60 * 60 * 1000);
  }
}

function getDateKeysInRange(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('Khoang ngay khong hop le');
  }

  const dates = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push(cursor.toISOString().split('T')[0]);
  }
  return dates;
}

function assertPastCampaignSyncRange(fromDate, toDate) {
  if (toDate >= todayStr()) {
    throw new Error('Chi dong bo thu cong cac ngay truoc hom nay. Du lieu hom nay duoc cap nhat rieng va se duoc chot tu dong cuoi ngay.');
  }
  return getDateKeysInRange(fromDate, toDate);
}

function setSyncHistoryJob(jobId, updates) {
  const current = syncHistoryJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
  syncHistoryJobs.set(jobId, next);
  return next;
}

async function runSyncHistoryJob(jobId, { fromDate, toDate, provider, accountId }) {
  try {
    const job = syncHistoryJobs.get(jobId);
    if (!job) return;

    const filter = {
      _id: accountId,
      ...(provider ? buildAccountProviderFilter(provider) : {})
    };
    if (job.ownerUserId) filter.ownerUserId = job.ownerUserId;
    const account = await Account.findOne(filter);
    if (!account) throw new Error('Khong tim thay tai khoan can dong bo');

    const dates = assertPastCampaignSyncRange(fromDate, toDate);
    setSyncHistoryJob(jobId, {
      state: 'active',
      accountName: account.name,
      totalDays: dates.length,
      currentDay: '',
      message: 'Đang Đồng Bộ'
    });

    let syncedRows = 0;
    const errors = [];

    for (let index = 0; index < dates.length; index += 1) {
      const dateKey = dates[index];
      setSyncHistoryJob(jobId, {
        currentDay: dateKey,
        completedDays: index,
        percent: Math.round((index / dates.length) * 100)
      });

      try {
        const count = await syncAccountHistoricalData(account, dateKey, dateKey, { prune: true });
        syncedRows += count;
        await addLog(account._id, account.name, 'success', `Dong bo ngay ${dateKey}: ${count} camp`);
      } catch (error) {
        errors.push({ date: dateKey, error: error.message });
        await addLog(account._id, account.name, 'error', `Loi dong bo ngay ${dateKey}: ${error.message}`);
      }

      if (index < dates.length - 1) {
        await sleep(300);
      }
    }

    setSyncHistoryJob(jobId, {
      state: errors.length ? 'completed_with_errors' : 'completed',
      completedDays: dates.length,
      percent: 100,
      syncedRows,
      errors,
      currentDay: '',
      finishedAt: new Date().toISOString(),
      message: errors.length ? 'Dong bo xong nhung co loi' : 'Dong bo xong'
    });
    setTimeout(() => syncHistoryJobs.delete(jobId), 60 * 60 * 1000);
  } catch (error) {
    setSyncHistoryJob(jobId, {
      state: 'failed',
      error: error.message,
      finishedAt: new Date().toISOString(),
      message: error.message
    });
    setTimeout(() => syncHistoryJobs.delete(jobId), 60 * 60 * 1000);
  }
}

async function processCampaignSyncHistoryJob(data = {}, onProgress = null) {
  const { fromDate, toDate, provider, accountId } = data;
  const normalizedProvider = normalizeProvider(provider);
  const filter = {
    ...(normalizedProvider ? buildAccountProviderFilter(normalizedProvider) : {})
  };
  if (data.ownerUserId) {
    filter.ownerUserId = data.ownerUserId;
  }
  if (accountId) {
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      throw new Error('Tai khoan dong bo khong hop le');
    }
    filter._id = accountId;
  }
  const accounts = await Account.find(filter).sort('name');
  if (!accounts.length) throw new Error('Khong tim thay tai khoan can dong bo');

  const dates = assertPastCampaignSyncRange(fromDate, toDate);
  const totalSteps = Math.max(1, accounts.length * dates.length);
  const baseProgress = {
    state: 'active',
    accountId: accountId ? String(accounts[0]._id) : '',
    accountName: accountId ? accounts[0].name : 'Tat ca tai khoan',
    totalAccounts: accounts.length,
    completedAccounts: 0,
    fromDate,
    toDate,
    totalDays: dates.length,
    completedDays: 0,
    currentDay: '',
    percent: 0,
    syncedRows: 0,
    errors: [],
    message: 'Đang Đồng Bộ'
  };

  if (onProgress) await onProgress(baseProgress);

  let syncedRows = 0;
  const errors = [];
  let completedSteps = 0;

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
    const account = accounts[accountIndex];
    for (let index = 0; index < dates.length; index += 1) {
      const dateKey = dates[index];
      if (onProgress) {
        await onProgress({
          ...baseProgress,
          accountId: String(account._id),
          accountName: account.name,
          completedAccounts: accountIndex,
          syncedRows,
          errors,
          currentDay: dateKey,
          completedDays: index,
          percent: Math.round((completedSteps / totalSteps) * 100)
        });
      }

      try {
        const count = await syncAccountHistoricalData(account, dateKey, dateKey, { prune: true });
        syncedRows += count;
        await addLog(account._id, account.name, 'success', `Dong bo ngay ${dateKey}: ${count} camp`);
      } catch (error) {
        errors.push({ accountId: String(account._id), accountName: account.name, date: dateKey, error: error.message });
        await addLog(account._id, account.name, 'error', `Loi dong bo ngay ${dateKey}: ${error.message}`);
      }

      completedSteps += 1;
      if (completedSteps < totalSteps && CAMPAIGN_SYNC_DAY_DELAY_MS > 0) {
        await sleep(CAMPAIGN_SYNC_DAY_DELAY_MS);
      }
    }
  }

  const result = {
    state: errors.length ? 'completed_with_errors' : 'completed',
    accountId: accountId ? String(accounts[0]._id) : '',
    accountName: accountId ? accounts[0].name : 'Tat ca tai khoan',
    totalAccounts: accounts.length,
    completedAccounts: accounts.length,
    fromDate,
    toDate,
    totalDays: dates.length,
    completedDays: dates.length,
    currentDay: '',
    percent: 100,
    syncedRows,
    errors,
    message: errors.length ? 'Dong bo xong nhung co loi' : 'Dong bo xong',
    finishedAt: new Date().toISOString()
  };

  if (onProgress) await onProgress(result);
  return result;
}

async function syncFinalSpendForDate(dateKey = dateKeyFromVnOffset(-1)) {
  if (finalSpendSyncRunning) {
    console.log(`Final spend sync skipped for ${dateKey}: previous run still active`);
    return { skipped: true, date: dateKey };
  }

  finalSpendSyncRunning = true;
  let syncedAccounts = 0;
  let failedAccounts = 0;
  let syncedRows = 0;

  try {
    const accounts = await Account.find(buildAccountProviderFilter('facebook'));
    console.log(`Final spend sync: closing ${dateKey} for ${accounts.length} Facebook accounts`);

    for (const account of accounts) {
      try {
        const count = await syncAccountHistoricalData(account, dateKey, dateKey, { prune: true });
        syncedRows += count;
        syncedAccounts += 1;
        await addLog(account._id, account.name, 'success', `Chot chi tieu ngay ${dateKey}: ${count} camp`);
      } catch (error) {
        failedAccounts += 1;
        await addLog(account._id, account.name, 'error', `Loi chot chi tieu ngay ${dateKey}: ${error.message}`);
      }
    }

    console.log(`Final spend sync finished for ${dateKey}: accounts=${syncedAccounts}, rows=${syncedRows}, failed=${failedAccounts}`);
    return { ok: true, date: dateKey, syncedAccounts, failedAccounts, syncedRows };
  } finally {
    finalSpendSyncRunning = false;
  }
}

function startFinalSpendCron() {
  if (!cron.validate(FINAL_SPEND_CRON)) {
    console.warn(`Invalid FINAL_SPEND_CRON "${FINAL_SPEND_CRON}", final spend cron disabled`);
    return null;
  }

  const task = cron.schedule(FINAL_SPEND_CRON, async () => {
    try {
      await syncFinalSpendForDate(dateKeyFromVnOffset(-1));
    } catch (error) {
      console.error(`Final spend cron failed: ${error.message}`);
    }
  }, { timezone: FINAL_SPEND_TIMEZONE });

  console.log(`Final spend cron scheduled: ${FINAL_SPEND_CRON} (${FINAL_SPEND_TIMEZONE})`);
  return task;
}

function startShopeeReactivateCron() {
  if (!cron.validate(SHOPEE_REACTIVATE_CRON)) {
    console.warn(`Invalid SHOPEE_REACTIVATE_CRON "${SHOPEE_REACTIVATE_CRON}", Shopee reactivate cron disabled`);
    return null;
  }

  const task = cron.schedule(SHOPEE_REACTIVATE_CRON, async () => {
    try {
      if (!isMongoReady()) return;
      const accounts = await Account.find({ autoEnabled: true, ...buildAccountProviderFilter('shopee') });
      for (const account of accounts) {
        await runAutoControlSafely(account, 'Shopee midnight reactivate', {
          allowShopeeReactivateAtMidnight: true
        });
      }
    } catch (error) {
      console.error(`Shopee reactivate cron failed: ${error.message}`);
    }
  }, { timezone: FINAL_SPEND_TIMEZONE });

  console.log(`Shopee reactivate cron scheduled: ${SHOPEE_REACTIVATE_CRON} (${FINAL_SPEND_TIMEZONE})`);
  return task;
}
app.post('/api/campaigns/sync-history', async (req, res) => {
  try {
    const { fromDate, toDate, provider, accountId } = req.body;
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Thieu fromDate hoac toDate' });
    }
    if (accountId && !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ error: 'Tai khoan dong bo khong hop le' });
    }

    const dates = assertPastCampaignSyncRange(fromDate, toDate);
    const payload = {
      fromDate,
      toDate,
      provider: normalizeProvider(provider),
      ownerUserId: req.currentUser._id,
      totalDays: dates.length
    };
    if (accountId) payload.accountId = accountId;

    if (campaignSyncQueue && req.body?.queue === true) {
      const job = await campaignSyncQueue.add('sync-history', payload);
      startCampaignSyncWorker();

      return res.status(202).json({
        ok: true,
        queued: true,
        queue: CAMPAIGN_SYNC_QUEUE_NAME,
        jobId: String(job.id),
        statusUrl: `/api/campaigns/sync-history/${job.id}`,
        message: 'Dang dong bo trong nen'
      });
    }

    const result = await processCampaignSyncHistoryJob(payload);
    res.json({ ok: true, queued: false, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/campaigns/sync-history/:jobId', async (req, res) => {
  try {
    if (!campaignSyncQueue) {
      return res.status(404).json({ error: 'Campaign sync queue is not enabled' });
    }

    const job = await campaignSyncQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job dong bo' });

    const state = await job.getState();
    const progress = typeof job.progress === 'object' && job.progress !== null ? job.progress : {};
    const returnvalue = job.returnvalue || {};
    const failedJob = state === 'failed';
    const payload = {
      id: String(job.id),
      state: failedJob ? 'failed' : (returnvalue.state || progress.state || state),
      accountId: progress.accountId || returnvalue.accountId || job.data.accountId,
      accountName: progress.accountName || returnvalue.accountName || '',
      totalAccounts: progress.totalAccounts || returnvalue.totalAccounts || 0,
      completedAccounts: progress.completedAccounts || returnvalue.completedAccounts || 0,
      fromDate: progress.fromDate || returnvalue.fromDate || job.data.fromDate,
      toDate: progress.toDate || returnvalue.toDate || job.data.toDate,
      totalDays: progress.totalDays || returnvalue.totalDays || job.data.totalDays || 0,
      completedDays: progress.completedDays || returnvalue.completedDays || 0,
      currentDay: progress.currentDay || returnvalue.currentDay || '',
      percent: progress.percent || returnvalue.percent || 0,
      syncedRows: progress.syncedRows || returnvalue.syncedRows || 0,
      errors: progress.errors || returnvalue.errors || [],
      message: failedJob ? (job.failedReason || 'Dong bo loi') : (progress.message || returnvalue.message || state),
      error: failedJob ? job.failedReason : '',
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : '',
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : '',
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : (returnvalue.finishedAt || '')
    };

    res.json({ ok: true, job: payload });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const SHOPEE_COMMISSION_DATE_HEADERS = [
  'Thời Gian Đặt Hàng',
  'Thoi Gian Dat Hang',
  'Thời gian đặt hàng',
  'Ngay dat hang',
  'Order Time',
  'Order Date'
];
const SHOPEE_COMMISSION_SUB_ID2_HEADERS = ['Sub_id2', 'Sub ID2', 'sub_id2', 'subid2'];
const SHOPEE_COMMISSION_TOTAL_HEADERS = [
  'Tổng hoa hồng đơn hàng(₫)',
  'Tong hoa hong don hang',
  'Tổng hoa hồng đơn hàng',
  'Tổng hoa hồng',
  'Total Order Commission',
  'Total Commission'
];

function getRequiredCsvColumnIndex(headers = [], candidates = [], label = '') {
  const index = getCsvColumnIndex(headers, candidates);
  if (index < 0) throw new Error(`CSV thieu cot ${label || candidates[0]}`);
  return index;
}

async function importShopeeCommissionsFromCsvText(req, csvText = '', options = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error('File CSV khong co du lieu');

  const headers = rows[0];
  const dateIndex = getRequiredCsvColumnIndex(headers, SHOPEE_COMMISSION_DATE_HEADERS, 'ngay thang');
  const subId2Index = getRequiredCsvColumnIndex(headers, SHOPEE_COMMISSION_SUB_ID2_HEADERS, 'Sub_id2');
  const commissionIndex = getRequiredCsvColumnIndex(headers, SHOPEE_COMMISSION_TOTAL_HEADERS, 'tong hoa hong');
  const ownerUserId = req.currentUser?._id;
  if (!ownerUserId) throw new Error('Chua xac dinh duoc user import');

  const grouped = new Map();
  const skipped = {
    noDate: 0,
    noSubId2: 0,
    zeroCommission: 0
  };

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some(cell => String(cell || '').trim())) continue;

    const date = parseCsvCampaignDate(row[dateIndex]);
    if (!date) {
      skipped.noDate += 1;
      continue;
    }

    const subId2 = String(row[subId2Index] || '').trim();
    if (!subId2) {
      skipped.noSubId2 += 1;
      continue;
    }

    const rawCommission = String(row[commissionIndex] || '').split('.')[0];
    const commission = parseCsvNumber(rawCommission);
    if (!commission) skipped.zeroCommission += 1;

    const key = `${date}\u0000${subId2}`;
    const current = grouped.get(key) || { date, subId2, commission: 0, rowCount: 0 };
    current.commission += commission;
    current.rowCount += 1;
    grouped.set(key, current);
  }

  if (!grouped.size) throw new Error('CSV khong co dong hoa hong hop le de import');

  const now = new Date();
  const sourceFileName = String(options.sourceFileName || '').trim().slice(0, 300);
  const operations = [...grouped.values()].map(item => ({
    updateOne: {
      filter: { ownerUserId, date: item.date, subId2: item.subId2 },
      update: {
        $set: {
          commission: item.commission,
          rowCount: item.rowCount,
          sourceFileName,
          importedAt: now,
          updatedAt: now
        },
        $setOnInsert: { ownerUserId }
      },
      upsert: true
    }
  }));

  const result = await ShopeeCommission.bulkWrite(operations, { ordered: false });
  const totalCommission = [...grouped.values()].reduce((sum, item) => sum + item.commission, 0);

  // Also import per-order detail rows for Sheet 2 reconciliation
  let orderImport = { ok: false, skipped: true };
  try {
    orderImport = await importCommissionOrders(ownerUserId, rows, subId2Index, dateIndex, commissionIndex, parseCsvCampaignDate);
  } catch (e) {
    orderImport = { ok: false, error: e.message };
  }

  return {
    ok: true,
    imported: grouped.size,
    sourceRows: Math.max(0, rows.length - 1),
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
    upserted: result.upsertedCount || 0,
    totalCommission,
    skipped,
    orderImport,
  };
}

function resolveCsvCampaignAccount(row, columnIndexes, accountsById, accountsByAdId, accountsByName, fallbackAccount) {
  const accountObjectId = getCsvCell(row, columnIndexes.accountObjectIds);
  if (accountObjectId && accountsById.has(accountObjectId)) return accountsById.get(accountObjectId);

  const adAccountId = getCsvCell(row, columnIndexes.adAccountIds);
  if (adAccountId) {
    const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
    const numericAdAccountId = normalizedAdAccountId.replace(/^act_/i, '');
    const matched = accountsByAdId.get(normalizedAdAccountId) || accountsByAdId.get(numericAdAccountId);
    if (matched) return matched;
  }

  const accountName = getCsvCell(row, columnIndexes.accountNames);
  if (accountName) {
    const matched = accountsByName.get(accountName.toLowerCase());
    if (matched) return matched;
  }

  return fallbackAccount || null;
}

async function importCampaignsFromCsvText(req, csvText = '', options = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error('File CSV khong co du lieu');

  const headers = rows[0];
  const provider = normalizeProvider(options.provider || 'facebook');
  const accountFilter = withUserFilter(req, buildAccountProviderFilter(provider));
  const accounts = await Account.find(accountFilter).select('_id name adAccountId provider').lean();
  if (!accounts.length) throw new Error('Khong tim thay tai khoan de import');

  let fallbackAccount = null;
  if (options.accountId) {
    fallbackAccount = accounts.find(account => String(account._id) === String(options.accountId)) || null;
    if (!fallbackAccount) throw new Error('Tai khoan import khong hop le');
  }

  const accountsById = new Map(accounts.map(account => [String(account._id), account]));
  const accountsByAdId = new Map();
  const accountsByName = new Map();
  for (const account of accounts) {
    const normalizedAdAccountId = normalizeAdAccountId(account.adAccountId);
    if (normalizedAdAccountId) {
      accountsByAdId.set(normalizedAdAccountId, account);
      accountsByAdId.set(normalizedAdAccountId.replace(/^act_/i, ''), account);
    }
    if (account.name) accountsByName.set(String(account.name).trim().toLowerCase(), account);
  }

  const columnIndexes = {
    dates: [getCsvColumnIndex(headers, ['Ngay', 'Date', 'Day', 'Date Start', 'date_start', 'dateStart', 'Start Date', 'Reporting starts', 'Ngay bat dau bao cao'])],
    endDates: [getCsvColumnIndex(headers, ['Date End', 'date_stop', 'dateStop', 'End Date', 'Reporting ends', 'Ngay ket thuc bao cao'])],
    campaignIds: [getCsvColumnIndex(headers, ['ID Campaign', 'Campaign ID', 'campaign_id', 'campaignId', 'Ma campaign', 'ID chien dich'])],
    campaignNames: [getCsvColumnIndex(headers, ['Ten Campaign', 'Campaign name', 'campaign_name', 'campaignName', 'Campaign', 'Ten chien dich', 'Chien dich'])],
    accountObjectIds: [getCsvColumnIndex(headers, ['accountId', 'Account Object ID', '_id'])],
    adAccountIds: [getCsvColumnIndex(headers, ['ID TKQC', 'Ad account ID', 'Account ID', 'account_id', 'adAccountId', 'ID tai khoan quang cao', 'ID tai khoan'])],
    accountNames: [getCsvColumnIndex(headers, ['Ten TKQC', 'Account name', 'Ad account name', 'account_name', 'Ten tai khoan quang cao', 'Ten tai khoan'])],
    adNames: [getCsvColumnIndex(headers, ['Ad Name', 'Ten quang cao', 'ad_name'])],
    statuses: [getCsvColumnIndex(headers, ['Trang Thai', 'Status', 'Delivery', 'campaign_status', 'Phan phoi'])],
    spends: [getCsvColumnIndex(headers, ['Chi tieu', 'Spend', 'Amount spent', 'Amount Spent', 'amount_spent', 'So tien da chi tieu', 'So tien da chi tieu VND'])],
    messages: [getCsvColumnIndex(headers, ['Tin nhan', 'Messages', 'Messaging conversations started', 'Conversations', 'Bat dau tro chuyen', 'BDCT', 'Luot bat dau cuoc tro chuyen qua tin nhan', 'So luot bat dau cuoc tro chuyen qua tin nhan'])],
    costPerMessages: [getCsvColumnIndex(headers, ['Gia/TN', 'Cost per messaging conversation started', 'Cost per message', 'costPerMessage', 'cost_per_message', 'Chi phi tren moi luot bat dau cuoc tro chuyen qua tin nhan'])],
    clicks: [getCsvColumnIndex(headers, ['Clicks', 'Link clicks', 'clicks', 'Luot click vao lien ket', 'Luot click'])],
    impressions: [getCsvColumnIndex(headers, ['Hien thi', 'Impressions', 'impressions', 'Luot hien thi'])],
    metaOrders: [getCsvColumnIndex(headers, ['Don Meta', 'Meta orders', 'Purchases', 'Website purchases', 'metaOrders', 'Luot mua', 'Giao dich mua'])]
  };

  if (columnIndexes.dates.every(index => index < 0) && columnIndexes.endDates.every(index => index < 0)) throw new Error('CSV thieu cot ngay');
  if (columnIndexes.campaignIds.every(index => index < 0) && columnIndexes.campaignNames.every(index => index < 0)) {
    throw new Error('CSV thieu cot campaign name hoac campaign id');
  }
  const hasAccountColumn = columnIndexes.adAccountIds.some(index => index >= 0)
    || columnIndexes.accountNames.some(index => index >= 0)
    || columnIndexes.accountObjectIds.some(index => index >= 0);
  if (!fallbackAccount && !hasAccountColumn) {
    throw new Error('CSV thieu cot tai khoan. Hay chon mot tai khoan truoc khi import hoac them cot ID TKQC/Ten TKQC.');
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];
  const campaignRowsByKey = new Map();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some(cell => String(cell || '').trim())) continue;

    const date = parseCsvCampaignDate(getCsvCell(row, columnIndexes.dates) || getCsvCell(row, columnIndexes.endDates));
    const campaignName = getCsvCell(row, columnIndexes.campaignNames);
    const campaignId = getCsvCell(row, columnIndexes.campaignIds) || campaignName;
    const adName = getCsvCell(row, columnIndexes.adNames);
    const account = resolveCsvCampaignAccount(row, columnIndexes, accountsById, accountsByAdId, accountsByName, fallbackAccount);

    if (!date || !campaignId || !account) {
      skipped += 1;
      if (errors.length < 20) {
        errors.push({
          row: rowIndex + 1,
          error: !date ? 'Thieu ngay hop le' : (!campaignId ? 'Thieu campaign id' : 'Khong map duoc tai khoan')
        });
      }
      continue;
    }

    const spend = parseCsvNumber(getCsvCell(row, columnIndexes.spends));
    const rawCostPerMessage = parseCsvNumber(getCsvCell(row, columnIndexes.costPerMessages));
    const rawMessages = parseCsvInteger(getCsvCell(row, columnIndexes.messages));
    const messages = rawMessages > 0 ? rawMessages : (spend > 0 && rawCostPerMessage > 0 ? Math.round(spend / rawCostPerMessage) : 0);
    const costPerMessage = rawCostPerMessage > 0 ? rawCostPerMessage : (messages > 0 ? spend / messages : 0);
    const clicks = parseCsvInteger(getCsvCell(row, columnIndexes.clicks));
    const impressions = parseCsvInteger(getCsvCell(row, columnIndexes.impressions));
    const metaOrders = parseCsvInteger(getCsvCell(row, columnIndexes.metaOrders));
    const key = `${account._id}:${date}:${campaignId}`;
    const aggregate = campaignRowsByKey.get(key) || {
      account,
      date,
      campaignId,
      name: campaignName || campaignId,
      adName: adName || '',
      status: getCsvCell(row, columnIndexes.statuses),
      spend: 0,
      messages: 0,
      costPerMessage: 0,
      clicks: 0,
      impressions: 0,
      metaOrders: 0,
      costPerMessageWeightedTotal: 0,
      costPerMessageWeight: 0
    };

    aggregate.spend += spend;
    aggregate.messages += messages;
    aggregate.clicks += clicks;
    aggregate.impressions += impressions;
    aggregate.metaOrders += metaOrders;
    if (campaignName && !aggregate.name) aggregate.name = campaignName;
    if (adName) aggregate.adName = combineAdNames([aggregate.adName, adName]);
    if (costPerMessage > 0 && messages > 0) {
      aggregate.costPerMessageWeightedTotal += costPerMessage * messages;
      aggregate.costPerMessageWeight += messages;
    }
    campaignRowsByKey.set(key, aggregate);
  }

  for (const aggregate of campaignRowsByKey.values()) {
    const costPerMessage = aggregate.costPerMessageWeight > 0
      ? aggregate.costPerMessageWeightedTotal / aggregate.costPerMessageWeight
      : (aggregate.messages > 0 ? aggregate.spend / aggregate.messages : 0);

    const campaignUpdate = {
      name: aggregate.name || aggregate.campaignId,
      status: aggregate.status,
      spend: aggregate.spend,
      messages: aggregate.messages,
      costPerMessage,
      clicks: aggregate.clicks,
      impressions: aggregate.impressions,
      metaOrders: aggregate.metaOrders
    };
    if (aggregate.adName) campaignUpdate.adName = aggregate.adName;

    await upsertDailyCampaign(aggregate.account._id, aggregate.campaignId, aggregate.date, campaignUpdate);

    imported += 1;
  }

  return { ok: true, imported, skipped, errors, totalRows: Math.max(0, rows.length - 1), sourceRows: Math.max(0, rows.length - 1) };
}

app.post('/api/campaigns/import-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';
    let provider = '';
    let accountId = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chua chon file CSV' });
      }
      csvText = await csvFile.text();
      provider = String(formData.get('provider') || '');
      accountId = String(formData.get('accountId') || '');
    } else {
      csvText = String(req.body?.csv || '');
      provider = String(req.body?.provider || '');
      accountId = String(req.body?.accountId || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rong hoac khong doc duoc du lieu' });
    }

    const result = await importCampaignsFromCsvText(req, csvText, { provider, accountId });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/campaigns/finalize-day', async (req, res) => {
  try {
    const dateKey = normalizeCampaignDate(req.body.date || dateKeyFromVnOffset(-1));
    const result = await syncFinalSpendForDate(dateKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/export-spending', async (req, res) => {
  try {
    const { fromDate, toDate, provider } = req.query;
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Thieu fromDate hoac toDate' });
    }

    const filter = {
      date: { $gte: fromDate, $lte: toDate }
    };

    const accountFilter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    const accounts = await Account.find(accountFilter).select('_id').lean();
    if (!accounts.length) {
      return res.status(404).json({ error: 'Khong co du lieu trong khoang thoi gian nay' });
    }
    filter.accountId = { $in: accounts.map(a => a._id) };

    const campaigns = await Campaign.find(filter)
      .populate('accountId', 'name adAccountId')
      .sort({ date: 1, spend: -1 })
      .lean();

    if (!campaigns.length) {
      return res.status(404).json({ error: 'Khong co du lieu trong khoang thoi gian nay' });
    }

    const rows = campaigns.map(c => ({
      'Ngay': c.date,
      'ID TKQC': c.accountId?.adAccountId || 'N/A',
      'Ten TKQC': c.accountId?.name || 'N/A',
      'ID Campaign': c.campaignId,
      'Ten Campaign': c.name,
      'Ten quang cao': c.adName || '',
      'Chi tieu': c.spend,
      'Tin nhan': c.messages,
      'Gia/TN': c.costPerMessage,
      'Clicks': c.clicks,
      'Hien thi': c.impressions
    }));

    const header = Object.keys(rows[0]).join(',');
    const csvContent = rows.map(row =>
      Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const csv = `\ufeff${header}\n${csvContent}`; // BOM for UTF-8 Excel support

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=spending_report_${fromDate}_to_${toDate}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shopee/commission-summary', async (req, res) => {
  try {
    const defaultFromDate = '2026-04-27';
    const fromDate = normalizeCampaignDate(req.query.fromDate || defaultFromDate);
    const toDate = normalizeCampaignDate(req.query.toDate || todayStr());
    if (fromDate > toDate) {
      return res.status(400).json({ error: 'fromDate phai nho hon hoac bang toDate' });
    }

    const accountFilter = withUserFilter(req, buildAccountProviderFilter('shopee'));
    const accounts = await Account.find(accountFilter).select('_id name adAccountId').lean();
    const accountIds = accounts.map(account => account._id);
    const dateMs = 24 * 60 * 60 * 1000;
    const rangeStart = new Date(`${fromDate}T00:00:00Z`);
    const rangeEnd = new Date(`${toDate}T00:00:00Z`);
    const rangeDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / dateMs) + 1);
    const previousToDate = new Date(rangeStart.getTime() - dateMs).toISOString().split('T')[0];
    const previousFromDate = new Date(rangeStart.getTime() - (rangeDays * dateMs)).toISOString().split('T')[0];

    const match = {
      accountId: { $in: accountIds },
      date: { $gte: fromDate, $lte: toDate }
    };
    const previousMatch = {
      accountId: { $in: accountIds },
      date: { $gte: previousFromDate, $lte: previousToDate }
    };
    const commissionMatch = {
      ownerUserId: req.currentUser._id,
      date: { $gte: fromDate, $lte: toDate }
    };
    const previousCommissionMatch = {
      ownerUserId: req.currentUser._id,
      date: { $gte: previousFromDate, $lte: previousToDate }
    };

    const [totalRows, byDate, byAccount, commissionBySubId, commissionByDate, spendByCampaignName, previousCommissionBySubId, previousSpendByCampaignName] = await Promise.all([
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalSpend: { $sum: '$spend' },
            totalClicks: { $sum: '$clicks' },
            totalCampaignRows: { $sum: 1 },
            activeDays: { $addToSet: '$date' }
          }
        },
        {
          $project: {
            _id: 0,
            totalSpend: 1,
            totalClicks: 1,
            totalCampaignRows: 1,
            activeDayCount: { $size: '$activeDays' }
          }
        }
      ]),
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$date',
            spend: { $sum: '$spend' },
            clicks: { $sum: '$clicks' },
            campaignRows: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', spend: 1, clicks: 1, campaignRows: 1 } },
        { $sort: { date: 1 } }
      ]),
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$accountId',
            spend: { $sum: '$spend' },
            clicks: { $sum: '$clicks' },
            campaignRows: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'accounts',
            localField: '_id',
            foreignField: '_id',
            as: 'account'
          }
        },
        { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            accountId: '$_id',
            accountName: '$account.name',
            adAccountId: '$account.adAccountId',
            spend: 1,
            clicks: 1,
            campaignRows: 1
          }
        },
        { $sort: { spend: -1 } }
      ]),
      ShopeeCommission.aggregate([
        { $match: commissionMatch },
        {
          $group: {
            _id: '$subId2',
            commission: { $sum: '$commission' },
            rowCount: { $sum: '$rowCount' },
            activeDays: { $addToSet: '$date' }
          }
        },
        {
          $project: {
            _id: 0,
            subId2: '$_id',
            commission: 1,
            rowCount: 1,
            activeDayCount: { $size: '$activeDays' }
          }
        },
        { $sort: { commission: -1, subId2: 1 } }
      ]),
      ShopeeCommission.aggregate([
        { $match: commissionMatch },
        {
          $group: {
            _id: '$date',
            commission: { $sum: '$commission' },
            subIdCount: { $sum: 1 },
            rowCount: { $sum: '$rowCount' }
          }
        },
        { $project: { _id: 0, date: '$_id', commission: 1, subIdCount: 1, rowCount: 1 } },
        { $sort: { date: 1 } }
      ]),
      Campaign.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $toLower: '$name' },
            spend: { $sum: '$spend' },
            clicks: { $sum: '$clicks' },
            campaignRows: { $sum: 1 },
            bidWeightedSpend: { $sum: { $multiply: [{ $ifNull: ['$bidAmount', 0] }, { $ifNull: ['$spend', 0] }] } },
            bidSpendWeight: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$bidAmount', 0] }, 0] }, { $ifNull: ['$spend', 0] }, 0] } },
            bidTotal: { $sum: { $ifNull: ['$bidAmount', 0] } },
            bidCount: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$bidAmount', 0] }, 0] }, 1, 0] } },
            activeDays: { $addToSet: '$date' },
            dailySpendRows: {
              $push: {
                date: '$date',
                spend: '$spend',
                clicks: '$clicks'
              }
            },
            originalName: { $first: '$name' }
          }
        }
      ]),
      ShopeeCommission.aggregate([
        { $match: previousCommissionMatch },
        {
          $group: {
            _id: '$subId2',
            commission: { $sum: '$commission' },
            rowCount: { $sum: '$rowCount' }
          }
        },
        { $project: { _id: 0, subId2: '$_id', commission: 1, rowCount: 1 } }
      ]),
      Campaign.aggregate([
        { $match: previousMatch },
        {
          $group: {
            _id: { $toLower: '$name' },
            spend: { $sum: '$spend' },
            clicks: { $sum: '$clicks' },
            campaignRows: { $sum: 1 },
            bidWeightedSpend: { $sum: { $multiply: [{ $ifNull: ['$bidAmount', 0] }, { $ifNull: ['$spend', 0] }] } },
            bidSpendWeight: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$bidAmount', 0] }, 0] }, { $ifNull: ['$spend', 0] }, 0] } },
            bidTotal: { $sum: { $ifNull: ['$bidAmount', 0] } },
            bidCount: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$bidAmount', 0] }, 0] }, 1, 0] } },
            activeDays: { $addToSet: '$date' },
            dailySpendRows: {
              $push: {
                date: '$date',
                spend: '$spend',
                clicks: '$clicks'
              }
            },
            originalName: { $first: '$name' }
          }
        }
      ])
    ]);

    const totals = totalRows[0] || {};
    const commissionTotal = commissionBySubId.reduce((sum, item) => sum + Number(item.commission || 0), 0);
    const autoConfig = await getUserAutoConfig(req.currentUser._id);

    const labelByAction = {
      pause: 'TẮT',
      warning: 'CẢNH BÁO',
      testing: 'TEST THÊM',
      keep: 'GIỮ',
      scale: 'SCALE NHẸ',
      scale_strong: 'SCALE MẠNH'
    };
    const buildDailySpendStats = (dailyRows = [], fallbackTotalSpend = 0, options = {}) => {
      const dailyMap = new Map();
      for (const row of dailyRows || []) {
        const date = String(row?.date || '').trim();
        if (!date) continue;
        const item = dailyMap.get(date) || { date, spend: 0, clicks: 0 };
        item.spend += Number(row.spend || 0);
        item.clicks += Number(row.clicks || 0);
        dailyMap.set(date, item);
      }

      let daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
      const optionFromDate = String(options.fromDate || '').trim();
      const optionToDate = String(options.toDate || '').trim();
      if (optionFromDate && optionToDate && optionFromDate <= optionToDate) {
        const fullDaily = [];
        for (let time = new Date(`${optionFromDate}T00:00:00Z`).getTime(); time <= new Date(`${optionToDate}T00:00:00Z`).getTime(); time += dateMs) {
          const date = new Date(time).toISOString().split('T')[0];
          fullDaily.push(dailyMap.get(date) || { date, spend: 0, clicks: 0 });
        }
        daily = fullDaily;
      }
      const totalSpend = daily.reduce((sum, row) => sum + Number(row.spend || 0), 0) || Number(fallbackTotalSpend || 0);
      const activeDayCount = daily.filter(row => Number(row.spend || 0) > 0).length;
      const avgDailySpend = activeDayCount > 0 ? totalSpend / activeDayCount : 0;
      const recentRows = daily.slice(-3);
      const recentSpend = recentRows.reduce((sum, row) => sum + Number(row.spend || 0), 0);
      const recentAvgDailySpend = recentRows.length > 0 ? recentSpend / recentRows.length : 0;
      const recentDaysWithData = recentRows.filter(row => dailyMap.has(row.date)).length;
      const lastDaySpend = Number(daily[daily.length - 1]?.spend || 0);
      const recentSpendRate = avgDailySpend > 0 ? recentAvgDailySpend / avgDailySpend : 1;
      const slowSpend = activeDayCount >= 3 && avgDailySpend > 0 && recentSpendRate < 0.7;

      return {
        activeDayCount,
        avgDailySpend,
        recentAvgDailySpend,
        recentDaysWithData,
        lastDaySpend,
        recentSpendRate,
        slowSpend,
        daily
      };
    };
    const buildProfitRows = (commissionRows = [], spendRows = [], options = {}) => {
      const unifiedMap = new Map();
      for (const item of commissionRows) {
        const key = String(item.subId2 || '').trim().toLowerCase();
        unifiedMap.set(key, {
          sub_id2: item.subId2,
          hoa_hong: Number(item.commission || 0),
          rowCount: Number(item.rowCount || 0),
          chi_phi_pb: 0,
          clicks: 0,
          campaignRows: 0,
          bidWeightedSpend: 0,
          bidSpendWeight: 0,
          bidTotal: 0,
          bidCount: 0,
          dailySpendRows: []
        });
      }

      for (const item of spendRows) {
        const key = String(item._id || '').trim().toLowerCase();
        const existing = unifiedMap.get(key) || {
          sub_id2: item.originalName || item._id,
          hoa_hong: 0,
          rowCount: 0,
          chi_phi_pb: 0,
          clicks: 0,
          campaignRows: 0,
          bidWeightedSpend: 0,
          bidSpendWeight: 0,
          bidTotal: 0,
          bidCount: 0,
          dailySpendRows: []
        };
        existing.chi_phi_pb += Number(item.spend || 0);
        existing.clicks += Number(item.clicks || 0);
        existing.campaignRows += Number(item.campaignRows || 0);
        existing.bidWeightedSpend += Number(item.bidWeightedSpend || 0);
        existing.bidSpendWeight += Number(item.bidSpendWeight || 0);
        existing.bidTotal += Number(item.bidTotal || 0);
        existing.bidCount += Number(item.bidCount || 0);
        existing.dailySpendRows.push(...(Array.isArray(item.dailySpendRows) ? item.dailySpendRows : []));
        unifiedMap.set(key, existing);
      }

      return Array.from(unifiedMap.values()).map(item => {
        const profit = item.hoa_hong - item.chi_phi_pb;
        const roi = item.chi_phi_pb > 0 ? (profit / item.chi_phi_pb) * 100 : (profit > 0 ? 100 : 0);
        const bidAmount = item.bidSpendWeight > 0
          ? item.bidWeightedSpend / item.bidSpendWeight
          : (item.bidCount > 0 ? item.bidTotal / item.bidCount : 0);
        const dailySpendStats = buildDailySpendStats(item.dailySpendRows, item.chi_phi_pb, options);
        const shouldIncreaseBid = dailySpendStats.slowSpend && roi > 0 && item.hoa_hong > 0;
        const optimization = getShopeeOptimizationDecision({
          spend: item.chi_phi_pb,
          commission: item.hoa_hong,
          minSpendLimit: autoConfig.autoPauseShopeeMinSpendLimit
        });
        const lowRecentSpend = dailySpendStats.recentDaysWithData >= SHOPEE_LOW_SPEND_WINDOW_DAYS
          && dailySpendStats.recentAvgDailySpend < SHOPEE_LOW_SPEND_AVG_DAILY_LIMIT;
        return {
          sub_id2: item.sub_id2,
          hoa_hong: item.hoa_hong,
          hh_tb: item.rowCount > 0 ? item.hoa_hong / item.rowCount : 0,
          chi_phi_pb: item.chi_phi_pb,
          clicks: item.clicks,
          cpc: item.clicks > 0 ? item.chi_phi_pb / item.clicks : 0,
          so_camp: item.campaignRows,
          bid_amount: bidAmount,
          spend_ngay_tb: dailySpendStats.avgDailySpend,
          spend_3_ngay_tb: dailySpendStats.recentAvgDailySpend,
          spend_ngay_cuoi: dailySpendStats.lastDaySpend,
          ti_le_tieu_gan_day: dailySpendStats.recentSpendRate,
          tieu_cham: dailySpendStats.slowSpend,
          tieu_3_ngay_thap: lowRecentSpend,
          goi_y_bid: shouldIncreaseBid ? 'TĂNG BID' : 'GIỮ BID',
          roi,
          danh_gia: lowRecentSpend ? labelByAction.pause : (labelByAction[optimization.action] || optimization.label || '')
        };
      });
    };

    let unifiedList = buildProfitRows(commissionBySubId, spendByCampaignName, { fromDate, toDate });
    const previousList = buildProfitRows(previousCommissionBySubId, previousSpendByCampaignName, { fromDate: previousFromDate, toDate: previousToDate });
    const previousBySubId = new Map(previousList.map(item => [String(item.sub_id2 || '').trim().toLowerCase(), item]));

    unifiedList.sort((a, b) => b.hoa_hong - a.hoa_hong || b.roi - a.roi);
    unifiedList = unifiedList.slice(0, 500);
    const alertCandidates = [];
    unifiedList.forEach(item => {
      const previous = previousBySubId.get(String(item.sub_id2 || '').trim().toLowerCase());
      if (!previous) return;
      const previousCommission = Number(previous.hoa_hong || 0);
      const currentCommission = Number(item.hoa_hong || 0);
      if (previousCommission > 0 && currentCommission < previousCommission * 0.8) {
        alertCandidates.push({
          type: 'warning',
          sub_id2: item.sub_id2,
          previous_hoa_hong: previousCommission,
          current_hoa_hong: currentCommission
        });
      }
      if (previousCommission > 0 && currentCommission > previousCommission * 1.3) {
        alertCandidates.push({
          type: 'positive',
          sub_id2: item.sub_id2,
          previous_hoa_hong: previousCommission,
          current_hoa_hong: currentCommission
        });
      }
      if (Number(previous.roi || 0) >= SHOPEE_STRONG_SCALE_ROI_PERCENT && Number(item.roi || 0) < 50) {
        alertCandidates.push({
          type: 'orange',
          sub_id2: item.sub_id2,
          previous_roi: previous.roi,
          current_roi: item.roi
        });
      }
    });

    // Swap original array contents
    commissionBySubId.length = 0;
    commissionBySubId.push(...unifiedList);

    res.json({
      fromDate,
      toDate,
      accountCount: accounts.length,
      totalSpend: totals.totalSpend || 0,
      totalClicks: totals.totalClicks || 0,
      totalCampaignRows: totals.totalCampaignRows || 0,
      activeDayCount: totals.activeDayCount || 0,
      totalCommission: commissionTotal,
      totalProfit: commissionTotal - Number(totals.totalSpend || 0),
      totalRoi: Number(totals.totalSpend || 0) > 0
        ? ((commissionTotal - Number(totals.totalSpend || 0)) / Number(totals.totalSpend || 0)) * 100
        : (commissionTotal > 0 ? 100 : 0),
      autoPauseShopeeMinSpendLimit: autoConfig.autoPauseShopeeMinSpendLimit,
      commissionSubIdCount: commissionBySubId.length,
      commissionBySubId,
      alerts: alertCandidates,
      previousPeriod: {
        fromDate: previousFromDate,
        toDate: previousToDate
      },
      commissionByDate,
      byDate,
      byAccount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shopee/commission-import-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';
    let sourceFileName = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chua chon file CSV hoa hong Shopee' });
      }
      csvText = await csvFile.text();
      sourceFileName = String(csvFile.name || '');
    } else {
      csvText = String(req.body?.csv || '');
      sourceFileName = String(req.body?.sourceFileName || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rong hoac khong doc duoc du lieu' });
    }

    const result = await importShopeeCommissionsFromCsvText(req, csvText, { sourceFileName });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const { accountId, provider, limit = 100 } = req.query;
    const accountFilter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    if (accountId) accountFilter._id = accountId;
    const accountIds = (await Account.find(accountFilter).select('_id').lean()).map(account => account._id);
    if (!accountIds.length) return res.json([]);
    const query = { accountId: { $in: accountIds } };
    const safeLimit = parseBoundedInt(limit, 100, 1, 500);
    const logs = await Log.find(query).sort('-createdAt').limit(safeLimit).lean();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/logs', async (req, res) => {
  try {
    const { accountId, provider } = req.query;
    const accountFilter = withUserFilter(req, provider ? buildAccountProviderFilter(provider) : {});
    if (accountId) accountFilter._id = accountId;
    const accountIds = (await Account.find(accountFilter).select('_id').lean()).map(account => account._id);
    if (!accountIds.length) return res.json({ ok: true });
    const query = { accountId: { $in: accountIds } };
    await Log.deleteMany(query);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-token', async (req, res) => {
  try {
    const { fbToken } = req.body;
    if (!fbToken) return res.status(400).json({ error: 'Thieu token' });

    const me = await fbGet(fbToken, 'me', { fields: 'name,id' });
    res.json({ ok: true, name: me.name, id: me.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/webhooks/pancake', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Pancake Webhook payload:', JSON.stringify(payload, null, 2));

    // Pancake webhook structure usually has event type and data
    // Fallback to simple extraction if exact structure is unknown
    const orderData = payload.data || payload || {};
    const orderId = orderData.id || orderData.order_id || `temp_${Date.now()}`;
    const status = orderData.status || payload.event || 'unknown';

    const newOrder = await Order.findOneAndUpdate(
      { orderId: String(orderId) },
      {
        status: String(status),
        customerName: orderData.customer_name || orderData.customer?.name || '',
        totalPrice: Number(orderData.total_price || orderData.total || 0),
        rawData: payload,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, message: 'Webhook processed successfully', orderId: newOrder.orderId });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const search = String(req.query.search || '').trim();
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const wantsPaged = req.query.page !== undefined || req.query.limit !== undefined;

    if (useSheetOrders()) {
      if (wantsPaged) {
        const data = await getOrderSheetPage({ fromDate, toDate, search, page, limit });
        res.json({
          ok: true,
          source: 'google_sheet',
          ...data
        });
        return;
      }
      const orders = await getOrderSheetOrders({ fromDate, toDate, search });
      res.json(orders);
      return;
    }

    const query = buildOrderQuery({ fromDate, toDate });
    if (search) {
      const searchRegex = escapeRegExp(search);
      query.$or = [
        { orderId: { $regex: searchRegex, $options: 'i' } },
        { status: { $regex: searchRegex, $options: 'i' } },
        { customerName: { $regex: searchRegex, $options: 'i' } },
        { 'rawData.status_name': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col4': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col8': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col11': { $regex: searchRegex, $options: 'i' } },
        { 'rawData.sheetColumns.col13': { $regex: searchRegex, $options: 'i' } }
      ];
    }
    if (wantsPaged) {
      const [orders, total, statsOrders] = await Promise.all([
        Order.find(query)
          .select('orderId status rawData createdAt')
          .sort('-createdAt')
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Order.countDocuments(query),
        Order.find(query).select('rawData orderId status customerName').limit(200000).lean()
      ]);
      res.json({
        ok: true,
        source: 'database',
        orders,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        stats: buildOrderTableStats(statsOrders)
      });
      return;
    }

    const orders = await Order.find(query)
      .select('orderId status rawData createdAt')
      .sort('-createdAt')
      .limit(200000)
      .lean();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/sku-counts', async (req, res) => {
  try {
    const fromDate = req.query.fromDate || todayStr();
    const { toDate } = req.query;
    const cacheKey = useSheetOrders() ? getOrderStatsCacheKey({ fromDate, toDate }) : '';

    if (cacheKey && orderStatsCache.has(cacheKey)) {
      res.json({ ok: true, ...orderStatsCache.get(cacheKey), cached: true });
      return;
    }

    const allOrders = useSheetOrders()
      ? await getOrderSheetOrders({ fromDate, toDate, limit: 200000 })
      : await Order.find(buildOrderQuery({ fromDate, toDate })).select('rawData orderId status').lean();

    const stats = buildOrderSkuStats(allOrders);
    if (cacheKey) {
      orderStatsCache.set(cacheKey, stats);
      if (orderStatsCache.size > 50) {
        const oldestKey = orderStatsCache.keys().next().value;
        orderStatsCache.delete(oldestKey);
      }
    }

    res.json({ ok: true, ...stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function createReturnSummaryBucketMap() {
  return RETURN_SUMMARY_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = {
      key: bucket.key,
      label: bucket.label,
      orderCount: 0,
      amount: 0,
      costPerOrder: 0
    };
    return acc;
  }, {});
}

function finalizeReturnSummaryBucket(bucket = {}) {
  const orderCount = Number(bucket.orderCount || 0);
  const amount = Number(bucket.amount || 0);
  return {
    ...bucket,
    orderCount,
    amount,
    costPerOrder: orderCount > 0 ? amount / orderCount : 0
  };
}

function makeReturnSummaryDateKeys(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const keys = [];
  for (let cursor = start, guard = 0; cursor <= end && guard < 370; guard += 1) {
    keys.push(cursor.toISOString().split('T')[0]);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return keys;
}

function getReturnSummaryDailyRow(dailyMap, dateKey) {
  if (!dailyMap.has(dateKey)) {
    dailyMap.set(dateKey, {
      date: dateKey,
      categories: createReturnSummaryBucketMap(),
      totalAmount: 0,
      totalOrderCount: 0,
      totalShippedOrderCount: 0
    });
  }
  return dailyMap.get(dateKey);
}

function finalizeReturnSummaryDailyRow(row = {}) {
  const categories = RETURN_SUMMARY_BUCKETS.map(bucket => (
    finalizeReturnSummaryBucket(row.categories?.[bucket.key] || {
      key: bucket.key,
      label: bucket.label
    })
  ));
  const totalOrderCount = Number(row.totalOrderCount || 0);
  const total = finalizeReturnSummaryBucket({
    key: 'total',
    label: 'Tổng',
    orderCount: Number.isFinite(totalOrderCount) && totalOrderCount >= 0 ? totalOrderCount : 0,
    amount: Number(row.totalAmount || 0)
  });
  total.shippedOrderCount = Number(row.totalShippedOrderCount || 0);
  total.shipRate = total.orderCount > 0 ? total.shippedOrderCount / total.orderCount : 0;

  return {
    date: row.date,
    categories,
    total
  };
}

function getReturnSummaryMonthlyRow(monthlyMap, monthKey) {
  if (!monthlyMap.has(monthKey)) {
    monthlyMap.set(monthKey, {
      month: monthKey,
      totalAmount: 0,
      amount: 0,
      orderCount: 0,
      shippedOrderCount: 0,
      returned: 0,
      returning: 0,
      received: 0
    });
  }
  return monthlyMap.get(monthKey);
}

function finalizeReturnSummaryMonthlyRow(row = {}) {
  const orderCount = Number(row.orderCount || 0);
  const amount = Number(row.totalAmount || 0);
  const shippedOrderCount = Number(row.shippedOrderCount || 0);
  const returned = Number(row.returned || 0);
  const returning = Number(row.returning || 0);
  const received = Number(row.received || 0);
  const returnCount = returned + returning;
  const returnDenominator = returnCount + received;

  return {
    month: row.month,
    orderCount,
    shippedOrderCount,
    shipRate: orderCount > 0 ? shippedOrderCount / orderCount : 0,
    returned,
    returning,
    received,
    returnCount,
    returnDenominator,
    returnRate: returnDenominator > 0 ? returnCount / returnDenominator : 0,
    amount,
    costPerOrder: orderCount > 0 ? amount / orderCount : 0
  };
}

function buildProductReturnSummary(orderRows = []) {
  const skuStats = buildOrderSkuStats(orderRows);
  const rows = Object.entries(skuStats.returnStatsBySku || {})
    .map(([sku, stats = {}]) => {
      const returned = Number(stats.returned || 0);
      const returning = Number(stats.returning || 0);
      const received = Number(stats.received || 0);
      const returnCount = returned + returning;
      const denominator = Number(stats.denominator || (returnCount + received));
      return {
        sku,
        returned,
        returning,
        received,
        returnCount,
        denominator,
        rate: denominator > 0 ? returnCount / denominator : 0
      };
    })
    .filter(row => row.denominator > 0)
    .sort((a, b) => (
      (b.rate - a.rate) ||
      (b.returnCount - a.returnCount) ||
      (b.denominator - a.denominator) ||
      a.sku.localeCompare(b.sku)
    ));

  const total = rows.reduce((acc, row) => {
    acc.returned += row.returned;
    acc.returning += row.returning;
    acc.received += row.received;
    acc.returnCount += row.returnCount;
    acc.denominator += row.denominator;
    return acc;
  }, {
    returned: 0,
    returning: 0,
    received: 0,
    returnCount: 0,
    denominator: 0,
    rate: 0
  });
  total.rate = total.denominator > 0 ? total.returnCount / total.denominator : 0;

  return {
    rows: rows.slice(0, 100),
    total
  };
}

function isDealStopUnshippedOrder(order = {}) {
  const rawStatus = order.status || order.rawData?.status_name || order.rawData?.status || '';
  const status = normalizeStatusKey(rawStatus);
  if (!status) return false;

  return status === 'moi' ||
    status === 'new' ||
    status.includes('don moi') ||
    status.includes('cho hang');
}

function normalizeDealStopCode(value = '') {
  const extracted = extractInventoryProductCode(value);
  const normalized = normalizeSkuKey(extracted || value);
  if (!normalized) return '';

  const compact = normalized.replace(/\s+/g, '');
  if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(compact)) return '';
  if (compact.startsWith('MS') && compact.length > 2) {
    return compact.slice(2);
  }

  return compact;
}

function getSkuCodeCandidates(value = '') {
  const normalized = normalizeDealStopCode(value);
  if (!normalized) return [];

  const base = normalized;
  const withMs = `MS${normalized}`;

  return [...new Set([normalized, base, withMs].filter(Boolean))];
}

function buildCampaignSpendBySku(campaignRows = []) {
  const spendBySku = {};

  campaignRows.forEach(row => {
    const amount = Number(row.amount || 0);
    if (!amount) return;

    // getCampaignSkuCandidates() da tu sinh ca hai dang "MS<ma>" va "<ma>" cho moi
    // ma trich xuat duoc, nen khong duoc cong don them theo "withoutMs" o day -
    // lam vay se cong trung chi phi cua cung mot chien dich vao cung mot ma SKU
    // (vd: "MSPG..." -> cong vao "PG..." roi candidate "PG..." lai cong tiep),
    // khien CPO bi nhan doi.
    const seenForRow = new Set();
    getCampaignSkuCandidates(row.adName).forEach(candidate => {
      const normalized = normalizeSkuKey(candidate);
      if (!normalized || seenForRow.has(normalized)) return;
      seenForRow.add(normalized);

      spendBySku[normalized] = Number(spendBySku[normalized] || 0) + amount;
    });
  });

  return spendBySku;
}

function buildSkuCpoByCode(codes = [], skuCounts = {}, campaignRows = []) {
  const spendBySku = buildCampaignSpendBySku(campaignRows);
  const result = {};

  codes.forEach(code => {
    const normalizedCode = normalizeDealStopCode(code);
    if (!normalizedCode) return;

    const candidates = getSkuCodeCandidates(normalizedCode);
    let orderCount = 0;
    let amount = 0;

    for (const candidate of candidates) {
      const candidateCount = Number(skuCounts[candidate] || 0);
      if (!orderCount && candidateCount > 0) {
        orderCount = candidateCount;
      }

      const candidateAmount = Number(spendBySku[candidate] || 0);
      if (!amount && candidateAmount > 0) {
        amount = candidateAmount;
      }
    }

    result[normalizedCode] = {
      code: normalizedCode,
      orderCount,
      amount,
      campaignAmount: amount,
      hasCampaign: amount > 0,
      cpo: orderCount > 0 ? amount / orderCount : 0
    };
  });

  return result;
}

function parseDealStopManualQty(value = '') {
  const text = String(value || '').trim();
  if (!text) return 0;
  const match = text.match(/\d+(?:[.,]\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function buildPurchasePlacedQtyByCode() {
  const dataPurchaseSheetId = process.env.DATA_PURCHASE_ORDERS_SHEET_ID || '1Btx1zA2X19t0Ta7hZzTfBu8PJypMf8Extoe4s9qk7MM';
  const dataPurchaseSheetName = process.env.DATA_PURCHASE_ORDERS_SHEET_NAME || 'Data';

  const groupedRows = await DataPurchaseOrder.aggregate([
    {
      $match: {
        sourceId: dataPurchaseSheetId,
        sourceName: dataPurchaseSheetName,
        col3: { $nin: ['', null] },
        orderDateKey: { $gte: '2026-05-25' }
      }
    },
    { $sort: { rowNumber: 1 } },
    {
      $group: {
        _id: '$col3',
        orderId: { $last: '$col3' },
        quantityRaw: { $last: '$productQuantity' },
        quantityFallback: { $last: '$col15' }
      }
    }
  ]).allowDiskUse(true);

  const orderIds = groupedRows.map(row => String(row.orderId || '').trim()).filter(Boolean);
  const manualRows = orderIds.length
    ? await PurchaseOrder.find({
        sourceId: dataPurchaseSheetId,
        sourceName: dataPurchaseSheetName,
        orderId: { $in: orderIds }
      })
        .select('orderId skuManual')
        .lean()
    : [];

  const manualByOrderId = new Map(
    manualRows.map(row => [String(row.orderId || '').trim(), row])
  );
  const qtyByCode = {};

  groupedRows.forEach(row => {
    const manual = manualByOrderId.get(String(row.orderId || '').trim()) || {};
    const codes = String(manual.skuManual || '').split(/\r?\n/)
      .map(line => normalizeDealStopCode(line))
      .filter(Boolean);
    if (!codes.length) return;

    const quantityText = getFirstQuantityText(row.quantityRaw, row.quantityFallback);
    const qty = parseQuantity(quantityText);
    if (qty <= 0) return;

    codes.forEach(code => {
      qtyByCode[code] = Number(qtyByCode[code] || 0) + qty;
    });
  });

  return qtyByCode;
}

function buildDealStopRows(orderRows = [], campaignRows = []) {
  const rowsByCode = {};

  const getOrderSortKey = (order = {}) => ({
    time: Number.isFinite(new Date(order.createdAt || 0).getTime()) ? new Date(order.createdAt || 0).getTime() : Number.MAX_SAFE_INTEGER,
    rowNumber: Number(order.rawData?.rowNumber || 0) || Number.MAX_SAFE_INTEGER
  });

  const isEarlierOrder = (nextOrder = {}, currentMeta = {}) => {
    const nextKey = getOrderSortKey(nextOrder);
    const currentKey = {
      time: Number(currentMeta.time || Number.MAX_SAFE_INTEGER),
      rowNumber: Number(currentMeta.rowNumber || Number.MAX_SAFE_INTEGER)
    };

    if (nextKey.time !== currentKey.time) return nextKey.time < currentKey.time;
    return nextKey.rowNumber < currentKey.rowNumber;
  };

  const hasAllowedFirstTag = (order = {}) => {
    const normalizedTag = String(getOrderTagText(order) || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, ' ')
      .trim();

    if (!normalizedTag) return true;
    return normalizedTag.includes('oder') || normalizedTag.includes('order');
  };

  const getSizeFieldKey = (item = {}) => {
    const raw = [
      item.size,
      item.variation_value,
      item.variation_info?.detail,
      item.variation_info?.name
    ]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();

    if (!raw) return '';
    if (/(^|[^A-Z])FZ([^A-Z]|$)|FREE|FREESIZE/.test(raw)) return 'orderSizeFZ';
    if (/(^|[^A-Z])XL([^A-Z]|$)/.test(raw)) return 'sizeXL';
    if (/(^|[^A-Z])L([^A-Z]|$)/.test(raw)) return 'sizeL';
    if (/(^|[^A-Z])M([^A-Z]|$)/.test(raw)) return 'sizeM';
    if (/(^|[^A-Z])S([^A-Z]|$)/.test(raw)) return 'sizeS';
    return '';
  };

  orderRows.forEach(order => {
    const returnStatus = classifyReturnStatus(order);
    const shipped = !isDealStopUnshippedOrder(order);

    getOrderItemsFromRaw(order.rawData || {}).forEach(item => {
      const code = normalizeDealStopCode(getOrderItemSku(item));
      const quantity = getOrderItemQuantity(item);
      if (!code || quantity <= 0) return;

      if (!rowsByCode[code]) {
        rowsByCode[code] = {
          id: `source-${code}`,
          ngayKetThuc: 0,
          ghiChu: '',
          ma: code,
          cpo: 0,
          slKhachDat: 0,
          slThucDat: 0,
          slCanDatThem: 0,
          orderSizeS: '',
          orderSizeM: '',
          orderSizeL: '',
          orderSizeXL: '',
          orderSizeFZ: '',
          sizeS: '',
          sizeM: '',
          sizeL: '',
          sizeXL: '',
          slChenh: 0,
          tiLeDat: 0,
          tiLeHoan: 0,
          daNhan: 0,
          dangHoan: 0,
          daHoan: 0,
          dangGuiHang: 0,
          tongDaShip: 0,
          tiLeShip: 0,
          _sizeBuckets: {
            sizeS: 0,
            sizeM: 0,
            sizeL: 0,
            sizeXL: 0,
            orderSizeFZ: 0
          },
          _firstOrderMeta: null,
          _firstOrderAllowed: false
        };
      }

      const row = rowsByCode[code];
      row.slKhachDat += quantity;
      if (shipped) row.tongDaShip += quantity;
      if (returnStatus === 'received') row.daNhan += quantity;
      if (returnStatus === 'returning') row.dangHoan += quantity;
      if (returnStatus === 'returned') row.daHoan += quantity;
      if (shipped && !returnStatus) row.dangGuiHang += quantity;

      const sizeFieldKey = getSizeFieldKey(item);
      if (sizeFieldKey) {
        row._sizeBuckets[sizeFieldKey] += quantity;
      }

      if (!row._firstOrderMeta || isEarlierOrder(order, row._firstOrderMeta)) {
        row._firstOrderMeta = getOrderSortKey(order);
        row._firstOrderAllowed = hasAllowedFirstTag(order);
      }
    });
  });

  const skuStats = buildOrderSkuStats(orderRows);
  const cpoByCode = buildSkuCpoByCode(Object.keys(rowsByCode), skuStats.counts || {}, campaignRows);

  return Object.values(rowsByCode)
    .filter(row => row._firstOrderAllowed === true)
    .filter(row => Number(row.slKhachDat || 0) >= 2)
    .map(row => {
      const returnDenominator = row.daNhan + row.dangHoan + row.daHoan;
      const cpoMeta = cpoByCode[row.ma] || {};
      const sizeBuckets = row._sizeBuckets || {};
      const { _sizeBuckets, _firstOrderMeta, _firstOrderAllowed, ...cleanRow } = row;

      return {
        ...cleanRow,
        firstOrderTime: Number(row._firstOrderMeta?.time || 0),
        cpo: Number(cpoMeta.cpo || 0),
        campaignAmount: Number(cpoMeta.campaignAmount ?? cpoMeta.amount ?? 0),
        hasCampaign: Boolean(cpoMeta.hasCampaign),
        orderSizeS: '',
        orderSizeM: '',
        orderSizeL: '',
        orderSizeXL: '',
        orderSizeFZ: '',
        sizeS: sizeBuckets.sizeS > 0 ? String(sizeBuckets.sizeS) : '',
        sizeM: sizeBuckets.sizeM > 0 ? String(sizeBuckets.sizeM) : '',
        sizeL: sizeBuckets.sizeL > 0 ? String(sizeBuckets.sizeL) : '',
        sizeXL: sizeBuckets.sizeXL > 0 ? String(sizeBuckets.sizeXL) : '',
        tiLeHoan: returnDenominator > 0 ? (row.dangHoan + row.daHoan) / returnDenominator : 0,
        tiLeShip: row.slKhachDat > 0 ? row.tongDaShip / row.slKhachDat : 0
      };
    })
    .sort((a, b) => {
      const timeA = Number(a.firstOrderTime || 0);
      const timeB = Number(b.firstOrderTime || 0);
      if (timeA !== timeB) return timeA - timeB;
      return a.ma.localeCompare(b.ma);
    });
}

app.get('/api/return-summary', async (req, res) => {
  try {
    if (normalizeProvider(req.currentUser?.provider) !== 'facebook') {
      return res.status(403).json({ error: 'Chi tai khoan Facebook moi duoc xem Tong hoan' });
    }

    const provider = 'facebook';
    const fromDate = String(req.query.fromDate || '').slice(0, 10);
    const toDate = String(req.query.toDate || '').slice(0, 10);
    const refresh = req.query.refresh === 'true' || req.query.refresh === true;
    const hasValidFromDate = !fromDate || /^\d{4}-\d{2}-\d{2}$/.test(fromDate);
    const hasValidToDate = !toDate || /^\d{4}-\d{2}-\d{2}$/.test(toDate);
    if (!hasValidFromDate || !hasValidToDate || (fromDate && toDate && fromDate > toDate)) {
      return res.status(400).json({ error: 'Khoang ngay khong hop le' });
    }

    const cacheKey = userScopedCacheKey(req, `return-summary:${provider}:${fromDate || 'all'}:${toDate || 'all'}:${ordersSheetCache.fetchedAt || 0}`);
    const cached = refresh ? null : getReadCache(cacheKey);
    if (cached) return res.json(cached);

    const accounts = await Account.find(withUserFilter(req, buildAccountProviderFilter(provider)))
      .select('_id')
      .lean();
    const accountIds = accounts.map(account => account._id);
    const campaignMatch = {
      accountId: { $in: accountIds }
    };
    if (fromDate || toDate) {
      campaignMatch.date = {};
      if (fromDate) campaignMatch.date.$gte = fromDate;
      if (toDate) campaignMatch.date.$lte = toDate;
    }

    const [orderRows, campaignRows] = await Promise.all([
      useSheetOrders()
        ? getOrderSheetOrders({ fromDate, toDate, limit: 200000, refresh })
        : Order.find(buildOrderQuery({ fromDate, toDate }))
          .select('orderId status rawData createdAt')
          .limit(200000)
          .lean(),
      accountIds.length ? Campaign.aggregate([
        {
          $match: campaignMatch
        },
        {
          $group: {
            _id: { date: '$date', adName: '$adName' },
            date: { $first: '$date' },
            adName: { $first: '$adName' },
            amount: { $sum: '$spend' }
          }
        },
        { $project: { _id: 0, date: 1, adName: 1, amount: 1 } }
      ]).allowDiskUse(true) : Promise.resolve([])
    ]);

    const orderStats = buildReturnSummaryOrderStats(orderRows, { fromDate, toDate });
    const productReturnSummary = buildProductReturnSummary(orderRows);
    const productReturnRateSummary = buildReturnProductRateStats(orderRows);
    const categories = createReturnSummaryBucketMap();
    const dailyMap = new Map();
    const monthlyMap = new Map();

    RETURN_SUMMARY_BUCKETS.forEach(bucket => {
      categories[bucket.key].orderCount = Number(orderStats.categories?.[bucket.key]?.orderCount || 0);
    });

    Object.entries(orderStats.daily || {}).forEach(([dateKey, byBucket]) => {
      const day = getReturnSummaryDailyRow(dailyMap, dateKey);
      day.totalOrderCount = Number(byBucket?.total?.orderCount || 0);
      day.totalShippedOrderCount = Number(byBucket?.total?.shippedOrderCount || 0);
      RETURN_SUMMARY_BUCKETS.forEach(bucket => {
        day.categories[bucket.key].orderCount = Number(byBucket?.[bucket.key]?.orderCount || 0);
      });
    });

    Object.entries(orderStats.monthly || {}).forEach(([monthKey, stats]) => {
      const month = getReturnSummaryMonthlyRow(monthlyMap, monthKey);
      const totalStats = stats?.total || {};
      month.orderCount = Number(totalStats.orderCount || 0);
      month.shippedOrderCount = Number(totalStats.shippedOrderCount || 0);
      month.returned = Number(totalStats.returned || 0);
      month.returning = Number(totalStats.returning || 0);
      month.received = Number(totalStats.received || 0);
    });

    campaignRows.forEach(row => {
      const dateKey = String(row.date || '').slice(0, 10);
      if (!dateKey) return;
      const monthKey = dateKey.slice(0, 7);
      const amount = Number(row.amount || 0);
      getReturnSummaryDailyRow(dailyMap, dateKey).totalAmount += amount;
      getReturnSummaryMonthlyRow(monthlyMap, monthKey).totalAmount += amount;

      const bucketKey = classifyReturnAdNameBucket(row.adName);
      if (!bucketKey || !categories[bucketKey]) return;
      categories[bucketKey].amount += amount;
      getReturnSummaryDailyRow(dailyMap, dateKey).categories[bucketKey].amount += amount;
      getReturnSummaryMonthlyRow(monthlyMap, monthKey).amount += amount;
    });

    const categoryRows = RETURN_SUMMARY_BUCKETS.map(bucket => finalizeReturnSummaryBucket(categories[bucket.key]));
    const total = finalizeReturnSummaryBucket({
      key: 'total',
      label: 'Tổng',
      orderCount: Number(orderStats.total?.orderCount || 0),
      amount: campaignRows.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    });
    total.shippedOrderCount = Number(orderStats.total?.shippedOrderCount || 0);
    total.shipRate = total.orderCount > 0 ? total.shippedOrderCount / total.orderCount : 0;

    const fullDateKeys = makeReturnSummaryDateKeys(fromDate, toDate);
    const dateKeys = fullDateKeys.length > 0 && fullDateKeys.length <= 120
      ? [...fullDateKeys].reverse()
      : [...dailyMap.keys()].sort((a, b) => b.localeCompare(a));
    const dailyRows = dateKeys
      .map(dateKey => finalizeReturnSummaryDailyRow(getReturnSummaryDailyRow(dailyMap, dateKey)))
      .filter(row => fullDateKeys.length <= 120 || row.total.orderCount > 0 || row.total.amount > 0);
    const monthlyRows = [...monthlyMap.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map(monthKey => finalizeReturnSummaryMonthlyRow(getReturnSummaryMonthlyRow(monthlyMap, monthKey)))
      .filter(row => row.orderCount > 0 || row.amount > 0);

    res.json(setReadCache(cacheKey, {
      ok: true,
      source: {
        orders: useSheetOrders() ? 'google_sheet' : 'database',
        campaigns: 'database'
      },
      fromDate,
      toDate,
      provider,
      categories: categoryRows,
      total,
      monthlyRows,
      dailyRows,
      productReturnRows: productReturnSummary.rows,
      productReturnTotal: productReturnRateSummary.total,
      productReturnCategories: productReturnRateSummary.categories,
      orderTotal: Number(orderStats.total?.orderCount || 0),
      campaignRowCount: campaignRows.length
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/sku-cpo', async (req, res) => {
  try {
    const rawCodes = Array.isArray(req.body?.codes) ? req.body.codes : [];
    const codes = [...new Set(rawCodes.map(code => normalizeDealStopCode(code)).filter(Boolean))].slice(0, 1000);

    if (!codes.length) {
      return res.json({ ok: true, cpoByCode: {} });
    }

    const fromDate = String(req.body?.fromDate || '').slice(0, 10);
    const toDate = String(req.body?.toDate || '').slice(0, 10);
    const hasValidFromDate = !fromDate || /^\d{4}-\d{2}-\d{2}$/.test(fromDate);
    const hasValidToDate = !toDate || /^\d{4}-\d{2}-\d{2}$/.test(toDate);
    if (!hasValidFromDate || !hasValidToDate || (fromDate && toDate && fromDate > toDate)) {
      return res.status(400).json({ error: 'Khoang ngay khong hop le' });
    }

    const facebookAccounts = await Account.find(withUserFilter(req, buildAccountProviderFilter('facebook')))
      .select('_id')
      .lean();
    const accountIds = facebookAccounts.map(account => account._id);

    const campaignMatch = {
      accountId: { $in: accountIds }
    };
    if (fromDate || toDate) {
      campaignMatch.date = {};
      if (fromDate) campaignMatch.date.$gte = fromDate;
      if (toDate) campaignMatch.date.$lte = toDate;
    }

    const [orderRows, campaignRows] = await Promise.all([
      useSheetOrders()
        ? getOrderSheetOrders({ fromDate, toDate, limit: 200000 })
        : Order.find(buildOrderQuery({ fromDate, toDate }))
          .select('orderId status rawData createdAt')
          .limit(200000)
          .lean(),
      accountIds.length ? Campaign.aggregate([
        {
          $match: campaignMatch
        },
        {
          $group: {
            _id: '$adName',
            adName: { $first: '$adName' },
            amount: { $sum: '$spend' }
          }
        },
        { $project: { _id: 0, adName: 1, amount: 1 } }
      ]).allowDiskUse(true) : Promise.resolve([])
    ]);

    const skuStats = buildOrderSkuStats(orderRows);
    const cpoByCode = buildSkuCpoByCode(codes, skuStats.counts || {}, campaignRows);

    res.json({
      ok: true,
      fromDate,
      toDate,
      cpoByCode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/deal-stop-rows', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || '').slice(0, 10);
    const toDate = String(req.query.toDate || '').slice(0, 10);
    const hasValidFromDate = !fromDate || /^\d{4}-\d{2}-\d{2}$/.test(fromDate);
    const hasValidToDate = !toDate || /^\d{4}-\d{2}-\d{2}$/.test(toDate);
    if (!hasValidFromDate || !hasValidToDate || (fromDate && toDate && fromDate > toDate)) {
      return res.status(400).json({ error: 'Khoang ngay khong hop le' });
    }

    const facebookAccounts = await Account.find(withUserFilter(req, buildAccountProviderFilter('facebook')))
      .select('_id')
      .lean();
    const accountIds = facebookAccounts.map(account => account._id);

    const campaignMatch = {
      accountId: { $in: accountIds }
    };
    if (fromDate || toDate) {
      campaignMatch.date = {};
      if (fromDate) campaignMatch.date.$gte = fromDate;
      if (toDate) campaignMatch.date.$lte = toDate;
    }

    const dealStopCampaignCacheKey = `deal-stop-campaign:${fromDate}:${toDate}:${accountIds.map(String).sort().join(',')}`;
    const cachedCampaignRows = getDealStopCampaignCache(dealStopCampaignCacheKey);

    const [orderRows, campaignRows, purchasePlacedQtyByCode] = await Promise.all([
      useSheetOrders()
        ? getOrderSheetOrders({ fromDate, toDate, limit: 200000 })
        : Order.find(buildOrderQuery({ fromDate, toDate }))
          .select('orderId status rawData createdAt')
          .limit(200000)
          .lean(),
      cachedCampaignRows || (accountIds.length ? Campaign.aggregate([
        {
          $match: campaignMatch
        },
        {
          $group: {
            _id: '$adName',
            adName: { $first: '$adName' },
            amount: { $sum: '$spend' }
          }
        },
        { $project: { _id: 0, adName: 1, amount: 1 } }
      ]).allowDiskUse(true).then(rows => setDealStopCampaignCache(dealStopCampaignCacheKey, rows)) : Promise.resolve(setDealStopCampaignCache(dealStopCampaignCacheKey, []))),
      buildPurchasePlacedQtyByCode()
    ]);

    const rows = buildDealStopRows(orderRows, campaignRows).map(row => {
      const slKhachDat = Number(row.slKhachDat || 0);
      const slThucDat = Number(purchasePlacedQtyByCode[row.ma] || 0);
      const tiLeHoan = Number(row.tiLeHoan || 0);
      const tongDaShip = Number(row.tongDaShip || 0);
      const slCanDatThem = !String(row.ma || '').trim()
        ? ''
        : (tiLeHoan <= 0.37
            ? Math.round(slKhachDat - (slThucDat + slThucDat * tiLeHoan))
            : Math.round((1 - tiLeHoan) * slKhachDat - slThucDat));

      return {
        ...row,
        slThucDat,
        slCanDatThem,
        slChenh: slKhachDat - slThucDat,
        tiLeDat: slKhachDat > 0 ? slThucDat / slKhachDat : 0,
        tiLeShip: slKhachDat > 0 ? tongDaShip / slKhachDat : 0
      };
    });

    res.json({
      ok: true,
      fromDate,
      toDate,
      rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Đồng bộ đơn hàng từ Google Sheet ──

app.get('/api/data-purchase-orders', async (req, res) => {
  try {
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const search = String(req.query.search || '').trim();
    const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());

    if (refresh) {
      let accessToken = '';
      try {
        accessToken = await getGoogleAccessToken(req);
      } catch {
        accessToken = '';
      }
      await syncDataPurchaseOrdersFromSheet({ accessToken });
      clearPurchaseOrderReadCache();
    }

    const cacheKey = `data-purchase-orders:${page}:${limit}:${search}`;
    const cached = !refresh ? getPurchaseOrderReadCache(cacheKey) : null;
    if (cached) return res.json(cached);

    const data = await getDataPurchaseOrders({ page, limit, search });
    res.json(setPurchaseOrderReadCache(cacheKey, { ok: true, ...data }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/data-purchase-orders/sync', async (req, res) => {
  try {
    if (activeDataPurchaseOrderSyncJobId) {
      const activeJob = dataPurchaseOrderSyncJobs.get(activeDataPurchaseOrderSyncJobId);
      if (activeJob && ['pending', 'active'].includes(activeJob.state)) {
        return res.status(202).json({
          ok: true,
          queued: true,
          jobId: activeJob.id,
          job: toDataPurchaseOrderSyncJobPayload(activeJob),
          statusUrl: `/api/data-purchase-orders/sync/${activeJob.id}`,
          message: 'DATA dat hang dang duoc dong bo trong nen'
        });
      }
      activeDataPurchaseOrderSyncJobId = '';
    }

    const userId = String(req.currentUser?._id || '');
    const googleConfig = getGoogleOAuthConfig(req);

    const jobId = createDataPurchaseOrderSyncJobId();
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      state: 'pending',
      percent: 0,
      imported: 0,
      message: 'Dang cho dong bo DATA dat hang',
      createdAt: now,
      updatedAt: now
    };
    dataPurchaseOrderSyncJobs.set(jobId, job);
    activeDataPurchaseOrderSyncJobId = jobId;

    setImmediate(() => {
      runDataPurchaseOrderSyncJob(jobId, { userId, googleConfig });
    });

    res.status(202).json({
      ok: true,
      queued: true,
      jobId,
      job: toDataPurchaseOrderSyncJobPayload(job),
      statusUrl: `/api/data-purchase-orders/sync/${jobId}`,
      message: 'Da bat dau dong bo DATA dat hang trong nen'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/data-purchase-orders/sync/:jobId', async (req, res) => {
  try {
    const job = dataPurchaseOrderSyncJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job dong bo DATA' });
    res.json({ ok: true, job: toDataPurchaseOrderSyncJobPayload(job) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/data-purchase-orders/import-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chưa chọn file CSV' });
      }
      csvText = await csvFile.text();
    } else {
      csvText = String(req.body?.csv || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rỗng hoặc không đọc được dữ liệu' });
    }

    const result = await importDataPurchaseOrdersFromCsvText(csvText);
    clearPurchaseOrderReadCache();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/purchase-orders', async (req, res) => {
  try {
    const page = parseBoundedInt(req.query.page, 1, 1, 100000);
    const limit = parseBoundedInt(req.query.limit, 100, 1, 1000);
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();
    const search = String(req.query.search || '').trim();
    const cacheKey = `purchase-orders:${page}:${limit}:${fromDate}:${toDate}:${search}`;
    const cached = getPurchaseOrderReadCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await getPurchaseOrders({ fromDate, toDate, search, page, limit });
    res.json(setPurchaseOrderReadCache(cacheKey, { ok: true, ...data }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/purchase-orders/import-status-csv', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let csvText = '';

    if (contentType.includes('multipart/form-data')) {
      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      const csvFile = formData.get('file') || formData.get('csv');
      if (!csvFile || typeof csvFile.text !== 'function') {
        return res.status(400).json({ error: 'Chưa chọn file CSV' });
      }
      csvText = await csvFile.text();
    } else {
      csvText = String(req.body?.csv || '');
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV rỗng hoặc không đọc được dữ liệu' });
    }

    const result = await importPurchaseOrderStatusesFromCsvText(csvText, {
      currentUser: req.currentUser
    });
    clearPurchaseOrderReadCache();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/purchase-orders/:orderId', async (req, res) => {
  try {
    const result = await updatePurchaseOrder(req.params.orderId, req.body || {}, {
      currentUser: req.currentUser
    });
    clearPurchaseOrderReadCache();
    res.json({ ok: true, order: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/oder/dashboard', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'fromDate va toDate la bat buoc' });
    }

    const cacheKey = `oder-dashboard:${fromDate}:${toDate}`;
    const cached = getPurchaseOrderReadCache(cacheKey);
    if (cached) return res.json(cached);

    const result = await getPurchaseOrderDashboard({ fromDate, toDate });
    return res.json(setPurchaseOrderReadCache(cacheKey, { ok: true, ...result }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/oder/dashboard/cancellations/:dateKey', async (req, res) => {
  try {
    const result = await updatePurchaseOrderDashboardCancellation(
      req.params.dateKey,
      req.body?.huy ?? req.body?.canceledCount ?? 0
    );
    clearPurchaseOrderReadCache();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/oder/dashboard/notes/:dateKey', async (req, res) => {
  try {
    const result = await updatePurchaseOrderDashboardNote(
      req.params.dateKey,
      req.body?.note ?? ''
    );
    clearPurchaseOrderReadCache();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const filter = await getInventoryFilter(req);
    const term = String(search || '').trim();

    if (term) {
      const regex = new RegExp(escapeRegExp(term), 'i');
      filter.$or = [{ barcode: regex }, { name: regex }];
    }

    const items = await InventoryItem.find(filter)
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ ok: true, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/summary', async (req, res) => {
  try {
    const googleAccessToken = await getInventoryGoogleAccessToken(req);
    const [rows, pendingCounts] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(googleAccessToken),
      buildInventoryPendingOrderCounts()
    ]);

    const grouped = new Map();
    for (const row of rows) {
      const rawBarcode = String(row.barcode || '').trim();
      if (!rawBarcode) continue;

      const productCode = extractInventoryProductCode(rawBarcode);
      const key = productCode || rawBarcode;
      if (!grouped.has(key)) {
        grouped.set(key, {
          productCode: key,
          totalQuantity: 0,
          pendingQuantity: pendingCounts.byCode.get(key) || 0,
          variants: 0,
          warehouses: new Set(),
          barcodes: [],
          names: new Set(),
          salePrices: new Set(),
          updatedAt: null
        });
      }

      const current = grouped.get(key);
      current.totalQuantity += Number(row.quantity || 0);
      current.variants += 1;
      if (row.warehouseName) current.warehouses.add(String(row.warehouseName).trim());
      if (rawBarcode) current.barcodes.push(rawBarcode);
      if (row.name) current.names.add(String(row.name).trim());
      if (row.salePrice) current.salePrices.add(String(row.salePrice).trim());
    }

    const itemsSummary = Array.from(grouped.values())
      .map(item => ({
        productCode: item.productCode,
        totalQuantity: item.totalQuantity,
        pendingQuantity: item.pendingQuantity,
        variants: item.variants,
        warehouseCount: item.warehouses.size,
        warehouses: Array.from(item.warehouses).sort(),
        name: Array.from(item.names)[0] || '',
        salePrice: Array.from(item.salePrices)[0] || '',
        updatedAt: item.updatedAt,
        barcodes: item.barcodes.sort()
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity || a.productCode.localeCompare(b.productCode));

    res.json({
      ok: true,
      totalCodes: itemsSummary.length,
      totalQuantity: itemsSummary.reduce((sum, item) => sum + Number(item.totalQuantity || 0), 0),
      items: itemsSummary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/summary/export', async (req, res) => {
  try {
    const googleAccessToken = await getInventoryGoogleAccessToken(req);
    const [rows, pendingCounts] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(googleAccessToken),
      buildInventoryPendingOrderCounts()
    ]);

    const grouped = new Map();
    for (const row of rows) {
      const rawBarcode = String(row.barcode || '').trim();
      if (!rawBarcode) continue;

      const productCode = extractInventoryProductCode(rawBarcode);
      const key = productCode || rawBarcode;
      if (!grouped.has(key)) {
        grouped.set(key, {
          productCode: key,
          totalQuantity: 0,
          pendingQuantity: pendingCounts.byCode.get(key) || 0,
          warehouses: new Set(),
          names: new Set(),
          salePrices: new Set()
        });
      }

      const current = grouped.get(key);
      current.totalQuantity += Number(row.quantity || 0);
      if (row.warehouseName) current.warehouses.add(String(row.warehouseName).trim());
      if (row.name) current.names.add(String(row.name).trim());
      if (row.salePrice) current.salePrices.add(String(row.salePrice).trim());
    }

    const itemsSummary = Array.from(grouped.values())
      .map(item => ({
        name: Array.from(item.names)[0] || '',
        productCode: item.productCode,
        totalQuantity: item.totalQuantity,
        pendingQuantity: item.pendingQuantity,
        warehouses: Array.from(item.warehouses).sort().join(', '),
        salePrice: Array.from(item.salePrices)[0] || ''
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity || a.productCode.localeCompare(b.productCode));

    const header = ['Ten hang', 'Ma SP', 'So luong ton', 'So luong chot', 'Kho', 'Gia sale'];
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvContent = itemsSummary.map(item => ([
      escapeCsv(item.name),
      escapeCsv(item.productCode),
      item.totalQuantity,
      item.pendingQuantity,
      escapeCsv(item.warehouses),
      escapeCsv(item.salePrice)
    ].join(',')));
    const totalQuantity = itemsSummary.reduce((sum, item) => sum + Number(item.totalQuantity || 0), 0);
    const totalPendingQuantity = itemsSummary.reduce((sum, item) => sum + Number(item.pendingQuantity || 0), 0);
    const totalRow = [
      escapeCsv('Tong cong'),
      escapeCsv(''),
      totalQuantity,
      totalPendingQuantity,
      escapeCsv(''),
      escapeCsv('')
    ].join(',');
    const csv = `\ufeff${header.join(',')}\n${csvContent.join('\n')}\n${totalRow}`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_summary_${todayStr()}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/scan-summary', async (req, res) => {
  try {
    const fromDate = normalizeCampaignDate(req.query.fromDate || todayStr());
    const toDate = normalizeCampaignDate(req.query.toDate || fromDate);
    const fromRange = buildVnDateRange(fromDate);
    const toRange = buildVnDateRange(toDate);

    const items = await InventoryItem.find(await getInventoryFilter(req))
      .select('barcode scans')
      .lean();

    const totalsByBarcode = {};
    let totalScannedQuantity = 0;

    for (const item of items) {
      const barcode = String(item.barcode || '').trim();
      if (!barcode || !Array.isArray(item.scans)) continue;

      let barcodeTotal = 0;
      for (const scan of item.scans) {
        const scannedAt = new Date(scan?.scannedAt || 0);
        if (Number.isNaN(scannedAt.getTime())) continue;
        if (scannedAt < fromRange.startUtc || scannedAt >= toRange.endUtc) continue;
        const quantity = Number(scan?.quantity || 0);
        if (!Number.isFinite(quantity) || quantity === 0) continue;
        barcodeTotal += quantity;
      }

      if (barcodeTotal !== 0) {
        totalsByBarcode[barcode] = barcodeTotal;
        totalScannedQuantity += barcodeTotal;
      }
    }

    res.json({
      ok: true,
      fromDate,
      toDate,
      totalScannedQuantity,
      totalsByBarcode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/sheet-rows', async (req, res) => {
  try {
    const googleAccessToken = await getInventoryGoogleAccessToken(req);
    const [rows, pendingCounts] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(googleAccessToken),
      buildInventoryPendingOrderCounts()
    ]);
    const search = String(req.query.search || '').trim().toLowerCase();
    const warehouse = String(req.query.warehouse || '').trim().toLowerCase();
    const filteredRows = rows
      .filter(row => (
        !search || (
          String(row.barcode || '').toLowerCase().includes(search) ||
          String(row.name || '').toLowerCase().includes(search) ||
          String(row.warehouseName || '').toLowerCase().includes(search)
        )
      ))
      .filter(row => (
        !warehouse || String(row.warehouseName || '').toLowerCase().includes(warehouse)
      ))
      .map(row => {
        const identity = parseInventorySheetIdentity(row.barcode || row.name || '');
        const pendingQuantity = identity.productCode
          ? (identity.size
              ? (pendingCounts.byCodeSize.get(`${identity.productCode}\u0000${identity.size}`) || 0)
              : (pendingCounts.byCode.get(identity.productCode) || 0))
          : 0;
        return { ...row, pendingQuantity };
      });

    res.json({ ok: true, rows: filteredRows, total: filteredRows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/scan', async (req, res) => {
  try {
    const barcode = normalizeBarcode(req.body?.barcode);
    const quantity = parseBoundedInt(req.body?.quantity, 1, 1, 100000);
    const name = String(req.body?.name || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!barcode) return res.status(400).json({ error: 'Thieu ma vach' });

    const now = new Date();
    const setFields = { updatedAt: now };
    if (name) setFields.name = name;
    if (req.body?.salePrice !== undefined) setFields.salePrice = String(req.body.salePrice || '').trim();
    const insertFields = { createdAt: now };
    if (!name) insertFields.name = '';

    const item = await InventoryItem.findOneAndUpdate(
      await getInventoryFilter(req, { barcode }),
      {
        $inc: { quantity },
        $set: setFields,
        $setOnInsert: insertFields,
        $push: {
          scans: {
            $each: [{ quantity, note, scannedAt: now }],
            $slice: -50
          }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ ok: true, item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/import-sheet', async (req, res) => {
  try {
    let sheetItems = [];
    let source = 'public';
    const ownerUserId = await getInventoryOwnerUserId(req);
    try {
      const googleAccessToken = await getInventoryGoogleAccessToken(req);
      sheetItems = await fetchInventorySheetItemsWithGoogleAccess(googleAccessToken, { refresh: true });
      source = 'google_oauth';
    } catch (googleError) {
      if (
        !/google|token|scope|permission|access|sheet/i.test(String(googleError.message || '')) &&
        googleError.response?.status !== 401 &&
        googleError.response?.status !== 403
      ) {
        throw googleError;
      }
      sheetItems = await fetchInventorySheetItems();
    }

    const now = new Date();
    const sheetBarcodes = new Set(sheetItems.map(item => String(item.barcode || '').trim()).filter(Boolean));
    const operations = sheetItems.map(item => ({
        updateOne: {
          filter: withInventoryOwnerFilter(ownerUserId, { barcode: item.barcode }),
          update: {
            $set: {
              warehouseName: item.warehouseName || '',
              name: item.name || '',
              salePrice: item.salePrice || '',
              sheetRowNumbers: Array.isArray(item.rowNumbers) ? item.rowNumbers : (item.rowNumber ? [item.rowNumber] : []),
              quantity: item.quantity,
              updatedAt: now
          },
          $setOnInsert: { createdAt: now }
        },
        upsert: true
      }
    }));

    if (operations.length) {
      await InventoryItem.bulkWrite(operations, { ordered: false });
    }

    const deleteFilter = withInventoryOwnerFilter(ownerUserId, sheetBarcodes.size
      ? { barcode: { $nin: Array.from(sheetBarcodes) } }
      : {});
    const deleteResult = await InventoryItem.deleteMany(deleteFilter);

    const items = await InventoryItem.find(withInventoryOwnerFilter(ownerUserId))
      .sort({ updatedAt: -1 })
      .limit(1000)
      .lean();

    res.json({
      ok: true,
      imported: sheetItems.length,
      deleted: deleteResult.deletedCount || 0,
      source,
      items
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/price-by-code', async (req, res) => {
  try {
    const productCode = normalizeInventoryProductCode(req.body?.productCode);
    const salePrice = String(req.body?.salePrice || '').trim();
    const ownerUserId = await getInventoryOwnerUserId(req);
    if (!productCode) {
      return res.status(400).json({ error: 'Thieu ma san pham' });
    }

    const inventoryItems = await InventoryItem.find(withInventoryOwnerFilter(ownerUserId))
      .select('_id barcode sheetRowNumbers')
      .lean();
    const matchedItems = inventoryItems
      .filter(item => extractInventoryProductCode(item.barcode) === productCode);
    const matchedIds = matchedItems.map(item => item._id);

    if (!matchedIds.length) {
      return res.status(404).json({ error: 'Khong tim thay san pham theo ma nay' });
    }

    const now = new Date();
    await syncInventorySalePriceToSheet(req, matchedItems, salePrice);

    await InventoryItem.updateMany(
      withInventoryOwnerFilter(ownerUserId, { _id: { $in: matchedIds } }),
      { $set: { salePrice, updatedAt: now } }
    );

    const items = await InventoryItem.find(withInventoryOwnerFilter(ownerUserId, { _id: { $in: matchedIds } }))
      .sort({ barcode: 1 })
      .lean();

    res.json({ ok: true, updated: items.length, productCode, salePrice, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/inventory/:id', async (req, res) => {
  try {
    const ownerUserId = await getInventoryOwnerUserId(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID san pham khong hop le' });
    }

    const currentItem = await InventoryItem.findOne(withInventoryOwnerFilter(ownerUserId, { _id: req.params.id }))
      .lean();
    if (!currentItem) return res.status(404).json({ error: 'Khong tim thay san pham trong kho' });

    const update = { updatedAt: new Date() };
    if (req.body?.name !== undefined) update.name = String(req.body.name || '').trim();
    if (req.body?.salePrice !== undefined) update.salePrice = String(req.body.salePrice || '').trim();
    if (req.body?.quantity !== undefined) update.quantity = parseBoundedInt(req.body.quantity, 0, 0, 100000000);

    if (
      req.body?.salePrice !== undefined &&
      String(update.salePrice || '') !== String(currentItem.salePrice || '')
    ) {
      await syncInventorySalePriceToSheet(req, [currentItem], update.salePrice);
    }

    const item = await InventoryItem.findOneAndUpdate(
      withInventoryOwnerFilter(ownerUserId, { _id: req.params.id }),
      { $set: update },
      { new: true }
    ).lean();

    res.json({ ok: true, item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const ownerUserId = await getInventoryOwnerUserId(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID san pham khong hop le' });
    }

    const result = await InventoryItem.deleteOne(withInventoryOwnerFilter(ownerUserId, { _id: req.params.id }));
    if (!result.deletedCount) return res.status(404).json({ error: 'Khong tim thay san pham trong kho' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/sync', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    if (orderSheetSyncQueue && req.body?.queue === true) {
      const job = await orderSheetSyncQueue.add('sync-sheet', { fromDate, toDate });
      return res.status(202).json({
        ok: true,
        queued: true,
        queue: ORDER_SHEET_SYNC_QUEUE_NAME,
        jobId: String(job.id),
        statusUrl: `/api/orders/sync/${job.id}`,
        message: 'Dang tai don hang trong nen'
      });
    }

    if (req.body?.queue === true) {
      if (activeOrderSheetSyncJobId) {
        const activeJob = orderSheetSyncJobs.get(activeOrderSheetSyncJobId);
        if (activeJob && ['pending', 'active'].includes(activeJob.state)) {
          return res.status(202).json({
            ok: true,
            queued: true,
            jobId: activeJob.id,
            job: toOrderSheetSyncJobPayload(activeJob),
            statusUrl: `/api/orders/sync/${activeJob.id}`,
            message: 'Dang tai don hang trong nen'
          });
        }
        activeOrderSheetSyncJobId = '';
      }

      const jobId = createOrderSheetSyncJobId();
      const now = new Date().toISOString();
      const job = {
        id: jobId,
        state: 'pending',
        source: 'google_sheet',
        fromDate: fromDate || '',
        toDate: toDate || '',
        totalRows: 0,
        synced: 0,
        percent: 0,
        message: 'Dang cho tai Google Sheet',
        createdAt: now,
        updatedAt: now
      };
      orderSheetSyncJobs.set(jobId, job);
      activeOrderSheetSyncJobId = jobId;

      setImmediate(() => {
        runOrderSheetSyncJob(jobId, { fromDate, toDate });
      });

      return res.status(202).json({
        ok: true,
        queued: true,
        jobId,
        job: toOrderSheetSyncJobPayload(job),
        statusUrl: `/api/orders/sync/${jobId}`,
        message: 'Dang tai don hang trong nen'
      });
    }

    const rows = await fetchOrderSheetRows({ refresh: true });
    const orders = rows
      .filter(row => {
        if (fromDate && row.dateKey < fromDate) return false;
        if (toDate && row.dateKey > toDate) return false;
        return true;
      })
      .map(({ dateKey, ...order }) => order);
    res.json({ success: true, synced: orders.length, source: 'google_sheet', cachedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Lỗi tải đơn từ Google Sheet:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/sync/:jobId', async (req, res) => {
  try {
    const memoryJob = orderSheetSyncJobs.get(req.params.jobId);
    if (memoryJob) {
      return res.json({ ok: true, job: toOrderSheetSyncJobPayload(memoryJob) });
    }

    if (!orderSheetSyncQueue) {
      return res.status(404).json({ error: 'Order sheet sync queue is not enabled' });
    }

    const job = await orderSheetSyncQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Khong tim thay job tai don hang' });

    const state = await job.getState();
    const progress = typeof job.progress === 'object' && job.progress !== null ? job.progress : {};
    const returnvalue = job.returnvalue || {};
    const failedJob = state === 'failed';
    const payload = {
      id: String(job.id),
      state: failedJob ? 'failed' : (returnvalue.state || progress.state || state),
      source: returnvalue.source || progress.source || 'google_sheet',
      fromDate: returnvalue.fromDate || progress.fromDate || job.data.fromDate || '',
      toDate: returnvalue.toDate || progress.toDate || job.data.toDate || '',
      totalRows: returnvalue.totalRows || progress.totalRows || 0,
      synced: returnvalue.synced || progress.synced || 0,
      percent: returnvalue.percent || progress.percent || 0,
      message: failedJob ? (job.failedReason || 'Tai don hang loi') : (returnvalue.message || progress.message || state),
      error: failedJob ? job.failedReason : '',
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : '',
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : '',
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : (returnvalue.cachedAt || '')
    };

    res.json({ ok: true, job: payload });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Pages & Posts (for campaign creation) ──

registerPageRoutes(app, {
  axios,
  FacebookPost,
  User,
  getAppConfig,
  fbGet,
  fbPost,
  FACEBOOK_GRAPH_API_VERSION,
  escapeRegExp,
  normalizeProvider,
  POSTS_PER_PAGE_LIMIT,
  SHOPEE_POSTS_PER_PAGE_LIMIT,
  ALL_POSTS_MAX_LIMIT,
  META_POST_REQUEST_LIMIT
});

    return {
      setCampaignStatusForAccount,
      processCampaignDuplicateExactRequest,
      fetchAccountInsightsInRange,
      fetchAccountAdNameMapInRange,
      syncAccountHistoricalData,
      processCampaignSyncHistoryJob,
      syncFinalSpendForDate,
      startFinalSpendCron,
      startShopeeReactivateCron
    };
  }
}

module.exports = { registerLegacyRoutes };
