'use strict';

const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const Order = require('../models/Order');
const InventoryItem = require('../models/InventoryItem');
const Account = require('../models/Account');
const Campaign = require('../models/Campaign');
const PurchaseOrder = require('../models/PurchaseOrder');
const DataPurchaseOrder = require('../models/DataPurchaseOrder');
const { getDealStopRows } = require('../services/dealStopRowsService');
const { getAppConfig } = require('../services/configService');
const { orderSourceState } = require('../services/orderSourceState');
const {
  buildOrderQuery,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  getOrderTagText,
  orderMatchesSearch,
  createOrderSkuStatsAccumulator,
  accumulateOrderSkuStat,
  finalizeOrderSkuStats,
  ORDER_SKU_STATS_FIELDS
} = require('../services/orderService');

const router = express.Router();

const POS_SHOPS_CACHE_TTL_MS = 5 * 60 * 1000;
let posShopCache = { apiKey: '', shopId: '', data: null, at: 0 };

function getTodayVnDate() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function extractApiKey(req) {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();

  const authHeader = req.headers.authorization || '';
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  if (typeof req.query.api_key === 'string' && req.query.api_key.trim()) {
    return req.query.api_key.trim();
  }
  return '';
}

function timingSafeMatch(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (!bufA.length || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function authenticateShopApiKey(req, res, next) {
  try {
    const config = await getAppConfig();
    const expectedKey = String(config?.shopApiKey || process.env.SHOP_API_KEY || '').trim();
    if (!expectedKey) {
      return res.status(401).json({ error: 'Shop API Key chua duoc kich hoat trong Cau hinh' });
    }

    const providedKey = extractApiKey(req);
    if (!providedKey || !timingSafeMatch(providedKey, expectedKey)) {
      return res.status(401).json({ error: 'API Key khong hop le hoac bi thieu (truyen qua header x-api-key)' });
    }

    req.appConfig = config;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function fetchPancakeShopDetails(config) {
  const apiKey = String(process.env.PANCAKE_API_KEY || config?.pancakeApiKey || '').trim();
  const configuredShopId = String(process.env.PANCAKE_SHOP_ID || config?.pancakeShopId || '').trim();
  if (!apiKey) {
    return {
      pancakeConnected: false,
      shopId: configuredShopId,
      name: '',
      avatarUrl: '',
      address: '',
      phone: '',
      warehouses: []
    };
  }

  const now = Date.now();
  if (
    posShopCache.data &&
    posShopCache.apiKey === apiKey &&
    posShopCache.shopId === configuredShopId &&
    now - posShopCache.at < POS_SHOPS_CACHE_TTL_MS
  ) {
    return posShopCache.data;
  }

  try {
    const { data } = await axios.get('https://pos.pages.fm/api/v1/shops', {
      params: { api_key: apiKey },
      timeout: 15000
    });
    const shops = Array.isArray(data?.shops) ? data.shops : [];
    const matched = (configuredShopId
      ? shops.find(s => String(s?.id || '') === configuredShopId)
      : null) || shops[0] || null;

    const result = {
      pancakeConnected: Boolean(matched),
      shopId: String(matched?.id || configuredShopId || ''),
      name: String(matched?.name || ''),
      avatarUrl: String(matched?.avatar_url || ''),
      address: String(matched?.address || matched?.full_address || ''),
      phone: String(matched?.phone_number || matched?.phone || ''),
      warehouses: Array.isArray(matched?.warehouses)
        ? matched.warehouses.map(w => ({ id: w.id, name: w.name, address: w.address || '' }))
        : []
    };

    posShopCache = { apiKey, shopId: configuredShopId, data: result, at: now };
    return result;
  } catch {
    return {
      pancakeConnected: false,
      shopId: configuredShopId,
      name: '',
      avatarUrl: '',
      address: '',
      phone: '',
      warehouses: []
    };
  }
}

router.use(authenticateShopApiKey);

// GET /api/public/shop -> Tong quan shop, thong ke don hang, ton kho & ads
router.get('/', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || getTodayVnDate()).trim();
    const toDate = String(req.query.toDate || fromDate).trim();
    const providerFilter = String(req.query.provider || '').trim().toLowerCase();

    const accountQuery = providerFilter === 'facebook' || providerFilter === 'shopee'
      ? { provider: providerFilter }
      : {};

    const [shopInfo, inventoryAgg, skuStats, accounts, dataPoCount, poStatusAgg] = await Promise.all([
      fetchPancakeShopDetails(req.appConfig),
      InventoryItem.aggregate([
        {
          $group: {
            _id: null,
            totalItems: { $sum: 1 },
            totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } }
          }
        }
      ]),
      (async () => {
        const acc = createOrderSkuStatsAccumulator();
        const cursor = Order.find(buildOrderQuery({ fromDate, toDate }))
          .select(ORDER_SKU_STATS_FIELDS)
          .lean()
          .cursor({ batchSize: 2000 });
        let processed = 0;
        for await (const order of cursor) {
          accumulateOrderSkuStat(acc, order);
          processed += 1;
          if (processed % 2000 === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
        return finalizeOrderSkuStats(acc);
      })(),
      Account.find(accountQuery).select('_id status provider').lean(),
      DataPurchaseOrder.countDocuments({}),
      PurchaseOrder.aggregate([
        { $group: { _id: { $ifNull: ['$status', ''] }, count: { $sum: 1 } } }
      ])
    ]);

    const accountIds = accounts.map(a => a._id);
    const adsAgg = accountIds.length
      ? await Campaign.aggregate([
        {
          $match: {
            accountId: { $in: accountIds },
            date: { $gte: fromDate, $lte: toDate }
          }
        },
        {
          $group: {
            _id: null,
            totalSpend: { $sum: { $ifNull: ['$spend', 0] } },
            totalMessages: { $sum: { $ifNull: ['$messages', 0] } },
            totalClicks: { $sum: { $ifNull: ['$clicks', 0] } },
            totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
            totalMetaOrders: { $sum: { $ifNull: ['$metaOrders', 0] } }
          }
        }
      ])
      : [];

    const inv = inventoryAgg[0] || { totalItems: 0, totalQuantity: 0 };
    const ads = adsAgg[0] || { totalSpend: 0, totalMessages: 0, totalClicks: 0, totalImpressions: 0, totalMetaOrders: 0 };
    const dealStopState = req.appConfig?.dealStopOrderState || {};
    const dealStopTabs = Array.isArray(dealStopState.tabs) ? dealStopState.tabs.length : 0;

    res.json({
      ok: true,
      shop: {
        ...shopInfo,
        posReady: Boolean(orderSourceState.posReady),
        lastPosSyncAt: orderSourceState.posLastSyncedAt || null
      },
      ordersSummary: {
        fromDate,
        toDate,
        totalOrders: skuStats.totalOrders,
        returnStats: skuStats.returnStats,
        countsBySku: skuStats.counts
      },
      inventorySummary: {
        totalItems: Number(inv.totalItems || 0),
        totalQuantity: Number(inv.totalQuantity || 0)
      },
      adsSummary: {
        fromDate,
        toDate,
        totalAccounts: accounts.length,
        connectedAccounts: accounts.filter(a => a.status === 'connected').length,
        totalSpend: Number(ads.totalSpend || 0),
        totalMessages: Number(ads.totalMessages || 0),
        totalClicks: Number(ads.totalClicks || 0),
        totalImpressions: Number(ads.totalImpressions || 0),
        totalMetaOrders: Number(ads.totalMetaOrders || 0),
        avgCostPerMessage: ads.totalMessages > 0 ? Math.round(ads.totalSpend / ads.totalMessages) : 0
      },
      purchaseOrdersSummary: {
        totalDataRows: Number(dataPoCount || 0),
        statusCounts: poStatusAgg.reduce((acc, row) => {
          acc[row._id || 'Chưa có trạng thái'] = row.count;
          return acc;
        }, {})
      },
      dealStopSummary: {
        tabCount: dealStopTabs
      },
      endpoints: [
        '/api/public/shop',
        '/api/public/shop/orders',
        '/api/public/shop/ads',
        '/api/public/shop/ads/accounts',
        '/api/public/shop/inventory',
        '/api/public/shop/purchase-orders',
        '/api/public/shop/deal-stop'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/shop/orders -> Danh sach don hang cua shop
router.get('/orders', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || getTodayVnDate()).trim();
    const toDate = String(req.query.toDate || fromDate).trim();
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const query = buildOrderQuery({ fromDate, toDate });
    if (statusFilter) {
      query.status = statusFilter;
    }

    if (!search) {
      const [total, docs] = await Promise.all([
        Order.countDocuments(query),
        Order.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean()
      ]);

      const orders = docs.map(order => ({
        orderId: order.orderId,
        status: order.status || order.rawData?.status_name || '',
        customerName: order.customerName || '',
        totalPrice: Number(order.totalPrice || 0),
        createdAt: order.createdAt,
        tags: getOrderTagText(order),
        items: getOrderItemsFromRaw(order.rawData || {}).map(item => ({
          sku: getOrderItemSku(item),
          name: item.variation_info?.name || item.name || '',
          quantity: getOrderItemQuantity(item),
          size: item.size || ''
        }))
      }));

      return res.json({
        ok: true,
        fromDate,
        toDate,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        orders
      });
    }

    const allDocs = await Order.find(query).sort({ createdAt: -1 }).limit(5000).lean();
    const matched = allDocs.filter(order => orderMatchesSearch(order, search));
    const total = matched.length;
    const paged = matched.slice((page - 1) * limit, page * limit);

    return res.json({
      ok: true,
      fromDate,
      toDate,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      orders: paged.map(order => ({
        orderId: order.orderId,
        status: order.status || order.rawData?.status_name || '',
        customerName: order.customerName || '',
        totalPrice: Number(order.totalPrice || 0),
        createdAt: order.createdAt,
        tags: getOrderTagText(order),
        items: getOrderItemsFromRaw(order.rawData || {}).map(item => ({
          sku: getOrderItemSku(item),
          name: item.variation_info?.name || item.name || '',
          quantity: getOrderItemQuantity(item),
          size: item.size || ''
        }))
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/public/shop/inventory -> Danh sach ton kho san pham
router.get('/inventory', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const warehouse = String(req.query.warehouse || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const query = {};
    if (warehouse) query.warehouseName = warehouse;
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ barcode: regex }, { name: regex }];
    }

    const [total, items] = await Promise.all([
      InventoryItem.countDocuments(query),
      InventoryItem.find(query)
        .select('warehouseName barcode name salePrice quantity updatedAt -_id')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/shop/ads/accounts -> Danh sach tai khoan quang cao + chi so tong hop
router.get('/ads/accounts', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || getTodayVnDate()).trim();
    const toDate = String(req.query.toDate || fromDate).trim();
    const providerFilter = String(req.query.provider || '').trim().toLowerCase();

    const accountQuery = providerFilter === 'facebook' || providerFilter === 'shopee'
      ? { provider: providerFilter }
      : {};

    const accounts = await Account.find(accountQuery)
      .select('_id name provider adAccountId status autoEnabled lastChecked spendThreshold checkInterval')
      .sort({ createdAt: -1 })
      .lean();

    const accountIds = accounts.map(a => a._id);
    const statsRows = accountIds.length
      ? await Campaign.aggregate([
        {
          $match: {
            accountId: { $in: accountIds },
            date: { $gte: fromDate, $lte: toDate }
          }
        },
        {
          $sort: { date: -1, updatedAt: -1 }
        },
        {
          $group: {
            _id: { accountId: '$accountId', campaignId: '$campaignId' },
            status: { $first: '$status' },
            spend: { $sum: { $ifNull: ['$spend', 0] } },
            messages: { $sum: { $ifNull: ['$messages', 0] } },
            impressions: { $sum: { $ifNull: ['$impressions', 0] } },
            clicks: { $sum: { $ifNull: ['$clicks', 0] } },
            metaOrders: { $sum: { $ifNull: ['$metaOrders', 0] } }
          }
        },
        {
          $group: {
            _id: '$_id.accountId',
            totalCampaigns: { $sum: 1 },
            activeCampaigns: {
              $sum: { $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$status', ''] } }, 'ACTIVE'] }, 1, 0] }
            },
            spend: { $sum: '$spend' },
            messages: { $sum: '$messages' },
            impressions: { $sum: '$impressions' },
            clicks: { $sum: '$clicks' },
            metaOrders: { $sum: '$metaOrders' }
          }
        }
      ])
      : [];

    const statsByAccountId = new Map(statsRows.map(row => [String(row._id), row]));
    const result = accounts.map(acc => {
      const s = statsByAccountId.get(String(acc._id)) || {};
      const spend = Number(s.spend || 0);
      const messages = Number(s.messages || 0);
      return {
        id: String(acc._id),
        name: acc.name,
        provider: acc.provider,
        adAccountId: acc.adAccountId,
        status: acc.status,
        autoEnabled: Boolean(acc.autoEnabled),
        lastChecked: acc.lastChecked || null,
        totalCampaigns: Number(s.totalCampaigns || 0),
        activeCampaigns: Number(s.activeCampaigns || 0),
        spend,
        messages,
        costPerMessage: messages > 0 ? Math.round(spend / messages) : 0,
        impressions: Number(s.impressions || 0),
        clicks: Number(s.clicks || 0),
        metaOrders: Number(s.metaOrders || 0)
      };
    });

    res.json({
      ok: true,
      fromDate,
      toDate,
      total: result.length,
      accounts: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/shop/ads -> Danh sach chien dich quang cao + chi phi/chi so
router.get('/ads', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || getTodayVnDate()).trim();
    const toDate = String(req.query.toDate || fromDate).trim();
    const providerFilter = String(req.query.provider || '').trim().toLowerCase();
    const accountIdFilter = String(req.query.accountId || '').trim();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const accountQuery = providerFilter === 'facebook' || providerFilter === 'shopee'
      ? { provider: providerFilter }
      : {};
    const accounts = await Account.find(accountQuery)
      .select('_id name provider adAccountId')
      .lean();
    const accountMap = new Map(accounts.map(acc => [String(acc._id), acc]));
    const filteredAccounts = accountIdFilter
      ? accounts.filter(acc => String(acc._id) === accountIdFilter || String(acc.adAccountId) === accountIdFilter)
      : accounts;
    const accountIds = filteredAccounts.map(acc => acc._id);

    if (!accountIds.length) {
      return res.json({
        ok: true,
        fromDate,
        toDate,
        page,
        limit,
        total: 0,
        totalPages: 1,
        totals: { spend: 0, messages: 0, impressions: 0, clicks: 0, metaOrders: 0 },
        campaigns: []
      });
    }

    const rows = await Campaign.aggregate([
      {
        $match: {
          accountId: { $in: accountIds },
          date: { $gte: fromDate, $lte: toDate }
        }
      },
      { $sort: { date: -1, updatedAt: -1 } },
      {
        $group: {
          _id: { accountId: '$accountId', campaignId: '$campaignId' },
          name: { $first: '$name' },
          adName: { $first: '$adName' },
          status: { $first: '$status' },
          dailyBudget: { $first: '$dailyBudget' },
          lifetimeBudget: { $first: '$lifetimeBudget' },
          budgetType: { $first: '$budgetType' },
          spend: { $sum: { $ifNull: ['$spend', 0] } },
          impressions: { $sum: { $ifNull: ['$impressions', 0] } },
          clicks: { $sum: { $ifNull: ['$clicks', 0] } },
          reach: { $sum: { $ifNull: ['$reach', 0] } },
          engagements: { $sum: { $ifNull: ['$engagements', 0] } },
          linkClicks: { $sum: { $ifNull: ['$linkClicks', 0] } },
          messages: { $sum: { $ifNull: ['$messages', 0] } },
          metaOrders: { $sum: { $ifNull: ['$metaOrders', 0] } },
          updatedAt: { $max: '$updatedAt' }
        }
      },
      { $sort: { spend: -1 } }
    ]);

    let mapped = rows.map(row => {
      const acc = accountMap.get(String(row._id.accountId)) || {};
      const spend = Number(row.spend || 0);
      const messages = Number(row.messages || 0);
      const budgetType = row.budgetType || 'DAILY';
      const budget = budgetType === 'LIFETIME' ? Number(row.lifetimeBudget || 0) : Number(row.dailyBudget || 0);
      return {
        campaignId: row._id.campaignId,
        name: row.name || '',
        adName: row.adName || '',
        status: String(row.status || '').toUpperCase(),
        accountId: String(row._id.accountId),
        accountName: acc.name || '',
        adAccountId: acc.adAccountId || '',
        provider: acc.provider || '',
        budgetType,
        budget,
        spend,
        messages,
        costPerMessage: messages > 0 ? Math.round(spend / messages) : 0,
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        reach: Number(row.reach || 0),
        engagements: Number(row.engagements || 0),
        linkClicks: Number(row.linkClicks || 0),
        metaOrders: Number(row.metaOrders || 0),
        updatedAt: row.updatedAt || null
      };
    });

    if (statusFilter) {
      mapped = mapped.filter(c => c.status === statusFilter);
    }
    if (search) {
      mapped = mapped.filter(c => (
        c.name.toLowerCase().includes(search) ||
        c.campaignId.toLowerCase().includes(search) ||
        c.accountName.toLowerCase().includes(search) ||
        c.adAccountId.toLowerCase().includes(search)
      ));
    }

    const totals = mapped.reduce((acc, c) => {
      acc.spend += c.spend;
      acc.messages += c.messages;
      acc.impressions += c.impressions;
      acc.clicks += c.clicks;
      acc.metaOrders += c.metaOrders;
      return acc;
    }, { spend: 0, messages: 0, impressions: 0, clicks: 0, metaOrders: 0 });

    const total = mapped.length;
    const paged = mapped.slice((page - 1) * limit, page * limit);

    return res.json({
      ok: true,
      fromDate,
      toDate,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totals,
      campaigns: paged
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/public/shop/purchase-orders -> Danh sach dat hang (DataPurchaseOrder + trang thai PurchaseOrder)
router.get('/purchase-orders', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const query = {};
    if (fromDate || toDate) {
      query.orderDateKey = {};
      if (fromDate) query.orderDateKey.$gte = fromDate;
      if (toDate) query.orderDateKey.$lte = toDate;
    }
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { searchText: regex },
        { col3: regex },
        { col4: regex },
        { logisticsTrackingCode: regex }
      ];
    }

    const total = await DataPurchaseOrder.countDocuments(query);
    const dataRows = await DataPurchaseOrder.find(query)
      .sort({ orderDateKey: -1, rowNumber: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const orderIds = [...new Set(dataRows.map(r => String(r.col3 || '').trim()).filter(Boolean))];
    const poDocs = orderIds.length
      ? await PurchaseOrder.find({ orderId: { $in: orderIds } }).lean()
      : [];
    const poMap = new Map(poDocs.map(doc => [`${doc.sourceId}:${doc.sourceName}:${doc.orderId}`, doc]));

    let items = dataRows.map(row => {
      const orderId = String(row.col3 || '').trim();
      const po = poMap.get(`${row.sourceId}:${row.sourceName}:${orderId}`) || {};
      return {
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        rowNumber: row.rowNumber,
        orderId,
        orderDateKey: row.orderDateKey || '',
        orderDateTime: row.orderDateTime || '',
        sku: row.col4 || row.col2 || '',
        spec: row.spec || '',
        productQuantity: row.productQuantity || row.col7 || '',
        totalAmount: row.totalAmount || row.col8 || '',
        logisticsTrackingCode: row.logisticsTrackingCode || '',
        status: po.status || '',
        receivedQuantity: po.receivedQuantity || '',
        supplementalTrackingCode: po.supplementalTrackingCode || '',
        skuManual: po.skuManual || '',
        note: po.note || '',
        statusUpdatedByName: po.statusUpdatedByName || '',
        statusUpdatedAt: po.statusUpdatedAt || null
      };
    });

    if (statusFilter) {
      items = items.filter(item => item.status.toLowerCase() === statusFilter.toLowerCase());
    }

    return res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/public/shop/deal-stop -> Du lieu dong deal (tong hop don + CPO + ti le hoan theo ma SP)
router.get('/deal-stop', async (req, res) => {
  try {
    const fromDate = String(req.query.fromDate || '2026-02-22').trim();
    const toDate = String(req.query.toDate || getTodayVnDate()).trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const facebookAccounts = await Account.find({ provider: 'facebook' }).select('_id').lean();
    let rows = await getDealStopRows({
      fromDate,
      toDate,
      accountIds: facebookAccounts.map(acc => acc._id)
    });

    if (search) {
      rows = rows.filter(r => String(r.ma || '').toLowerCase().includes(search) || String(r.ghiChu || '').toLowerCase().includes(search));
    }

    const total = rows.length;
    const paged = rows.slice((page - 1) * limit, page * limit);

    return res.json({
      ok: true,
      fromDate,
      toDate,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      rows: paged
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
