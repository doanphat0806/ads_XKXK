'use strict';

const Account = require('../models/Account');
const Campaign = require('../models/Campaign');
const FacebookPost = require('../models/FacebookPost');
const Order = require('../models/Order');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');
const {
  useSheetOrders,
  getOrderSheetOrders,
  buildOrderQuery,
  buildReturnSummaryOrderStats,
  buildOrderSkuStats,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  normalizeStatusKey
} = require('./orderService');
const { getInventoryFilter, getInventoryOwnerUserId } = require('../lib/helpers');
const { getGoogleAccessTokenForUser, requireGoogleOAuthConfig } = require('../utils/googleOAuth');
const { fetchInventorySheetRowsWithGoogleAccess } = require('./inventorySheetService');

const TOP_CAMPAIGN_LIMIT = 10;
const RECENT_POST_LIMIT = 20;
const POST_MESSAGE_MAX_LENGTH = 200;
const TOP_RETURN_SKU_LIMIT = 10;
const TOP_RESTOCK_LIMIT = 15;

function truncate(text, maxLength) {
  const value = String(text || '').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeInventoryProductCode(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function extractInventoryProductCode(value) {
  const raw = String(value || '')
    .replace(/["']/g, ' ')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';

  let tokens = raw.split(' ').filter(Boolean);
  if (tokens[0] && String(tokens[0]).toUpperCase() === 'MS' && tokens[1] && /[A-Z]*\d/i.test(tokens[1])) {
    tokens = tokens.slice(1);
  }

  return normalizeInventoryProductCode(tokens[0] || '');
}

function isPendingInventoryOrderStatus(value) {
  const status = normalizeStatusKey(value);
  return status.includes('cho hang');
}

async function buildInventoryPendingOrderCounts() {
  const orders = useSheetOrders()
    ? await getOrderSheetOrders({ limit: 200000 })
    : await Order.find(buildOrderQuery({})).select('rawData orderId status').limit(200000).lean();

  const byCode = new Map();
  for (const order of orders) {
    const rawStatus = order.status || order.rawData?.status_name || order.rawData?.status || '';
    if (!isPendingInventoryOrderStatus(rawStatus)) continue;

    for (const item of getOrderItemsFromRaw(order.rawData || {})) {
      const productCode = extractInventoryProductCode(getOrderItemSku(item));
      if (!productCode) continue;
      const quantity = getOrderItemQuantity(item);
      byCode.set(productCode, (byCode.get(productCode) || 0) + quantity);
    }
  }

  return byCode;
}

async function buildOrderContext({ from, to }) {
  const orderRows = useSheetOrders()
    ? await getOrderSheetOrders({ fromDate: from, toDate: to, limit: 200000 })
    : await Order.find(buildOrderQuery({ fromDate: from, toDate: to }))
      .select('orderId status rawData createdAt')
      .limit(200000)
      .lean();

  const returnSummary = buildReturnSummaryOrderStats(orderRows, { fromDate: from, toDate: to });
  const skuStats = buildOrderSkuStats(orderRows);

  const topReturnRateSkus = Object.entries(skuStats.returnStatsBySku || {})
    .map(([sku, stats]) => ({
      sku,
      returned: stats.returned,
      returning: stats.returning,
      received: stats.received,
      rate: stats.rate
    }))
    .filter(row => row.returned + row.returning + row.received > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, TOP_RETURN_SKU_LIMIT);

  const demandByProductCode = new Map();
  for (const [sku, quantity] of Object.entries(skuStats.counts || {})) {
    const productCode = extractInventoryProductCode(sku);
    if (!productCode) continue;
    demandByProductCode.set(productCode, (demandByProductCode.get(productCode) || 0) + quantity);
  }

  return {
    orders: {
      totalOrders: returnSummary.total.orderCount,
      shippedOrderCount: returnSummary.total.shippedOrderCount,
      shipRate: returnSummary.total.shipRate,
      returned: returnSummary.total.returned,
      returning: returnSummary.total.returning,
      received: returnSummary.total.received,
      returnRate: returnSummary.total.returnRate,
      topReturnRateSkus
    },
    demandByProductCode
  };
}

async function buildInventoryContext({ req, demandByProductCode }) {
  const merged = new Map();
  const ensure = (code) => {
    if (!merged.has(code)) {
      merged.set(code, {
        productCode: code,
        name: '',
        salePrice: '',
        scanQuantity: 0,
        sheetQuantity: 0,
        pendingQuantity: 0,
        recentDemand: 0,
        warehouses: new Set()
      });
    }
    return merged.get(code);
  };

  const inventoryFilter = await getInventoryFilter(req, User);
  const scanItems = await InventoryItem.find(inventoryFilter)
    .select('barcode name salePrice warehouseName quantity')
    .lean();

  for (const item of scanItems) {
    const code = extractInventoryProductCode(item.barcode) || normalizeInventoryProductCode(item.barcode);
    if (!code) continue;
    const entry = ensure(code);
    entry.scanQuantity += Number(item.quantity || 0);
    if (item.warehouseName) entry.warehouses.add(String(item.warehouseName).trim());
    if (item.name && !entry.name) entry.name = item.name;
    if (item.salePrice && !entry.salePrice) entry.salePrice = item.salePrice;
  }

  let sheetConnected = false;
  try {
    const inventoryOwnerId = await getInventoryOwnerUserId(req, User);
    const accessToken = await getGoogleAccessTokenForUser(inventoryOwnerId, requireGoogleOAuthConfig(req));
    const [rows, pendingByCode] = await Promise.all([
      fetchInventorySheetRowsWithGoogleAccess(accessToken),
      buildInventoryPendingOrderCounts()
    ]);
    sheetConnected = true;

    for (const row of rows) {
      const code = extractInventoryProductCode(row.barcode);
      if (!code) continue;
      const entry = ensure(code);
      entry.sheetQuantity += Number(row.quantity || 0);
      if (row.warehouseName) entry.warehouses.add(String(row.warehouseName).trim());
      if (row.name && !entry.name) entry.name = row.name;
      if (row.salePrice && !entry.salePrice) entry.salePrice = row.salePrice;
    }
    for (const [code, quantity] of pendingByCode.entries()) {
      ensure(code).pendingQuantity += quantity;
    }
  } catch {
    sheetConnected = false;
  }

  for (const [code, quantity] of (demandByProductCode || new Map()).entries()) {
    ensure(code).recentDemand += quantity;
  }

  const items = [...merged.values()].map(entry => ({
    productCode: entry.productCode,
    name: entry.name,
    salePrice: entry.salePrice,
    sheetQuantity: entry.sheetQuantity,
    scanQuantity: entry.scanQuantity,
    stockQuantity: entry.sheetQuantity > 0 ? entry.sheetQuantity : entry.scanQuantity,
    pendingQuantity: entry.pendingQuantity,
    recentDemand: entry.recentDemand,
    warehouses: [...entry.warehouses]
  }));

  const restockAlerts = items
    .filter(item => item.recentDemand > 0)
    .sort((a, b) => (b.recentDemand - b.stockQuantity) - (a.recentDemand - a.stockQuantity))
    .slice(0, TOP_RESTOCK_LIMIT);

  return {
    sheetConnected,
    totalProductCodes: items.length,
    totalStockQuantity: items.reduce((sum, item) => sum + item.stockQuantity, 0),
    restockAlerts
  };
}

async function buildFacebookContext({ req, from, to }) {
  const ownerUserId = req.currentUser._id;
  const accounts = await Account.find({ ownerUserId, provider: 'facebook' })
    .select('_id name adAccountId status linkedPageIds')
    .lean();

  const accountIds = accounts.map(account => account._id);
  const linkedPageIds = [...new Set(accounts.flatMap(account => account.linkedPageIds || []))];

  const campaigns = accountIds.length
    ? await Campaign.find({ accountId: { $in: accountIds }, date: { $gte: from, $lte: to } })
      .select('accountId name status spend impressions clicks messages costPerMessage date')
      .lean()
    : [];

  const accountNameById = new Map(accounts.map(account => [String(account._id), account.name]));
  const totalsByAccount = new Map();
  for (const campaign of campaigns) {
    const key = String(campaign.accountId);
    const totals = totalsByAccount.get(key) || { accountId: key, accountName: accountNameById.get(key) || '', spend: 0, impressions: 0, clicks: 0, messages: 0 };
    totals.spend += Number(campaign.spend || 0);
    totals.impressions += Number(campaign.impressions || 0);
    totals.clicks += Number(campaign.clicks || 0);
    totals.messages += Number(campaign.messages || 0);
    totalsByAccount.set(key, totals);
  }

  const campaignByKey = new Map();
  for (const campaign of campaigns) {
    const key = `${campaign.accountId}:${campaign.name}`;
    const existing = campaignByKey.get(key) || {
      accountName: accountNameById.get(String(campaign.accountId)) || '',
      name: campaign.name,
      status: campaign.status,
      spend: 0,
      impressions: 0,
      clicks: 0,
      messages: 0
    };
    existing.spend += Number(campaign.spend || 0);
    existing.impressions += Number(campaign.impressions || 0);
    existing.clicks += Number(campaign.clicks || 0);
    existing.messages += Number(campaign.messages || 0);
    existing.status = campaign.status || existing.status;
    campaignByKey.set(key, existing);
  }

  const topCampaigns = [...campaignByKey.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_CAMPAIGN_LIMIT)
    .map(campaign => ({
      ...campaign,
      costPerMessage: campaign.messages > 0 ? Math.round(campaign.spend / campaign.messages) : 0
    }));

  const [recentPosts, orderResult] = await Promise.all([
    linkedPageIds.length
      ? FacebookPost.find({
        pageId: { $in: linkedPageIds },
        createdTime: { $gte: new Date(from), $lte: new Date(`${to}T23:59:59.999Z`) }
      })
        .sort({ createdTime: -1 })
        .limit(RECENT_POST_LIMIT * 3)
        .select('pageName message createdTime likes comments shares permalink')
        .lean()
      : [],
    buildOrderContext({ from, to })
  ]);

  const inventory = await buildInventoryContext({ req, demandByProductCode: orderResult.demandByProductCode });

  const rankedPosts = recentPosts
    .map(post => ({
      pageName: post.pageName || '',
      message: truncate(post.message, POST_MESSAGE_MAX_LENGTH),
      createdTime: post.createdTime,
      likes: post.likes || 0,
      comments: post.comments || 0,
      shares: post.shares || 0,
      permalink: post.permalink || '',
      engagement: (post.likes || 0) + (post.comments || 0) + (post.shares || 0)
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, RECENT_POST_LIMIT);

  return {
    range: { from, to },
    accounts: accounts.map(account => ({
      name: account.name,
      adAccountId: account.adAccountId,
      status: account.status
    })),
    accountTotals: [...totalsByAccount.values()],
    topCampaigns,
    recentPosts: rankedPosts,
    orders: orderResult.orders,
    inventory
  };
}

function buildFacebookSystemPrompt(context, mode = 'chat') {
  const dataJson = JSON.stringify(context, null, 2);
  const baseInstructions = `Bạn là trợ lý AI phân tích dữ liệu quảng cáo Facebook, bài đăng, đơn hàng, tỉ lệ hoàn và tồn kho của người dùng (không bao gồm dữ liệu Shopee).
Chỉ được trả lời dựa trên dữ liệu JSON cung cấp bên dưới (khoảng thời gian ${context.range.from} đến ${context.range.to}). Nếu dữ liệu không đủ để trả lời, hãy nói rõ là không đủ dữ liệu thay vì bịa số liệu.
Trong dữ liệu, mục "orders" chứa tổng số đơn, số đơn đã ship, tỉ lệ ship, số đơn đang/đã hoàn, tỉ lệ hoàn tổng và danh sách sản phẩm (SKU) có tỉ lệ hoàn cao nhất.
Mục "inventory" chứa tổng số mã sản phẩm, tổng tồn kho, và "restockAlerts" là danh sách sản phẩm có nhu cầu bán gần đây (recentDemand) vượt hoặc gần bằng tồn kho hiện tại (stockQuantity) — đây là các sản phẩm nên cân nhắc nhập thêm hàng. "pendingQuantity" là số lượng đang có trong các đơn chờ hàng (chưa về kho). Nếu "sheetConnected" là false, số liệu tồn kho chỉ lấy từ dữ liệu quét kho thủ công (không có pendingQuantity đầy đủ), hãy lưu ý điều này khi trả lời.
Luôn trả lời bằng tiếng Việt.

Dữ liệu:
${dataJson}`;

  if (mode === 'report') {
    return `${baseInstructions}

Hãy viết một báo cáo ngắn gọn gồm:
1. Tổng quan chi tiêu và hiệu quả theo từng tài khoản
2. Chiến dịch tốt nhất và kém nhất, kèm lý do
3. Hiệu quả tương tác các bài đăng nổi bật (nếu có)
4. Tổng quan đơn hàng và tỉ lệ hoàn, sản phẩm nào hoàn nhiều nhất cần lưu ý
5. Tình hình tồn kho và danh sách sản phẩm nên nhập thêm hàng (dựa vào restockAlerts)
6. 2-3 đề xuất hành động cụ thể tiếp theo`;
  }

  return baseInstructions;
}

module.exports = { buildFacebookContext, buildFacebookSystemPrompt };
