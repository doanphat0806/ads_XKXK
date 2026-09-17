import { normalizeHeaderText } from './utils';

export function filterOrders(orders, filters) {
  const { fromDate, toDate, platformKey, status, search } = filters;
  const fromTime = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
  const toTime = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
  const searchNorm = normalizeHeaderText(search);

  return orders.filter(order => {
    if (fromTime !== null || toTime !== null) {
      const t = order.orderTime ? order.orderTime.getTime() : null;
      if (t === null) return false;
      if (fromTime !== null && t < fromTime) return false;
      if (toTime !== null && t > toTime) return false;
    }
    if (platformKey && platformKey !== 'all' && order.platformKey !== platformKey) return false;
    if (status && status !== 'all' && order.status !== status) return false;
    if (searchNorm) {
      const haystack = normalizeHeaderText(
        `${order.orderId} ${order.itemName} ${order.shopName} ${order.subIdKey}`
      );
      if (!haystack.includes(searchNorm)) return false;
    }
    return true;
  });
}

export function computeKpis(orders) {
  const social = orders.filter(o => o.channel === 'social');
  const totalOrders = orders.length;
  const completed = orders.filter(o => o.status === 'completed').length;
  const pending = orders.filter(o => o.status === 'pending').length;
  const cancelled = orders.filter(o => o.status === 'cancelled').length;
  const zeroValue = orders.filter(o => o.status !== 'cancelled' && o.commissionTotal <= 0).length;

  const sum = (arr, fn) => arr.reduce((s, o) => s + fn(o), 0);
  const gmv = sum(orders, o => o.gmv);
  const commissionShopee = sum(orders, o => o.commissionShopee);
  const commissionXtra = sum(orders, o => o.commissionXtra);
  const commissionTotal = sum(orders, o => o.commissionTotal);

  return {
    gmv,
    commissionShopee,
    commissionXtra,
    commissionTotal,
    commissionOverGmv: gmv > 0 ? commissionTotal / gmv : 0,
    totalOrders,
    completed,
    pending,
    cancelled,
    zeroValue,
    cancelRate: totalOrders > 0 ? cancelled / totalOrders : 0,
    zeroValueRate: totalOrders > 0 ? zeroValue / totalOrders : 0,
    socialOrders: social.length,
    socialRate: totalOrders > 0 ? social.length / totalOrders : 0
  };
}

export function evaluateSubIdRow(row) {
  const { adSpend, profit, commissionTotal, orders } = row;
  if (adSpend > 0) {
    if (profit < 0) return { key: 'lo', label: 'Lỗ — Cần tắt Ads', tone: 'critical' };
    const margin = profit / adSpend;
    if (margin < 0.3) return { key: 'tiem_nang', label: 'Tiềm năng', tone: 'warning' };
    return { key: 'loi', label: 'Lời — Siêu hiệu quả', tone: 'good' };
  }
  if (commissionTotal > 0) return { key: 'loi', label: 'Lời (Organic)', tone: 'good' };
  if (orders === 0) return { key: 'khong_hieu_qua', label: 'Không hiệu quả', tone: 'neutral' };
  return { key: 'tiem_nang', label: 'Tiềm năng', tone: 'warning' };
}

// Ad spend is only known at the SubID2 level — that's the unit a campaign is actually created
// for (campaign name = SubID2 + fixed suffix), so grouping the matrix any finer (full 5-level
// combo) would either misattribute or double-count spend shared across sibling products/posts.
export function buildSubIdMatrix(orders, { cpcBySubId = {}, defaultCpc = 0, clicksBySubId = {}, adsSpendBySubId2 = {} } = {}) {
  const groups = new Map();

  orders.forEach(order => {
    const key = order.subIds[1] || '(Không gắn SubID2)';
    if (!groups.has(key)) {
      groups.set(key, {
        subIdKey: key,
        subIds: order.subIds,
        platformKey: order.platformKey,
        platformLabel: order.platformLabel,
        orders: 0,
        completedOrders: 0,
        cancelledOrders: 0,
        gmv: 0,
        commissionShopee: 0,
        commissionXtra: 0,
        commissionTotal: 0
      });
    }
    const g = groups.get(key);
    g.orders += 1;
    if (order.status === 'completed') g.completedOrders += 1;
    if (order.status === 'cancelled') g.cancelledOrders += 1;
    g.gmv += order.gmv;
    g.commissionShopee += order.commissionShopee;
    g.commissionXtra += order.commissionXtra;
    g.commissionTotal += order.commissionTotal;
  });

  return Array.from(groups.values()).map(row => {
    const campaignData = adsSpendBySubId2[row.subIdKey];
    const clicksOverride = clicksBySubId[row.subIdKey];
    const cpcOverride = cpcBySubId[row.subIdKey];
    const hasManualOverride = clicksOverride !== undefined || cpcOverride !== undefined;

    let clicks, cpc, adSpend, spendSource;
    if (hasManualOverride) {
      clicks = clicksOverride ?? (campaignData?.clicks || 0);
      cpc = cpcOverride ?? (campaignData?.cpc ?? defaultCpc);
      adSpend = clicks * cpc;
      spendSource = 'manual';
    } else if (campaignData) {
      clicks = campaignData.clicks;
      cpc = campaignData.cpc;
      adSpend = campaignData.spend;
      spendSource = 'campaign';
    } else {
      clicks = 0;
      cpc = defaultCpc;
      adSpend = 0;
      spendSource = 'none';
    }

    const profit = row.commissionTotal - adSpend;
    const epc = clicks > 0 ? row.commissionTotal / clicks : 0;
    const cvr = clicks > 0 ? row.orders / clicks : 0;
    const enriched = { ...row, cpc, clicks, adSpend, profit, epc, cvr, spendSource };
    return { ...enriched, evaluation: evaluateSubIdRow(enriched) };
  });
}

export function computePlatformDistribution(orders) {
  const groups = new Map();
  orders.forEach(order => {
    const key = order.platformKey;
    if (!groups.has(key)) {
      groups.set(key, { platformKey: key, platformLabel: order.platformLabel, orders: 0, gmv: 0, commissionTotal: 0 });
    }
    const g = groups.get(key);
    g.orders += 1;
    g.gmv += order.gmv;
    g.commissionTotal += order.commissionTotal;
  });
  const totalCommission = Array.from(groups.values()).reduce((s, g) => s + g.commissionTotal, 0);
  return Array.from(groups.values())
    .map(g => ({ ...g, share: totalCommission > 0 ? g.commissionTotal / totalCommission : 0 }))
    .sort((a, b) => b.commissionTotal - a.commissionTotal);
}

export function computeHourlyDistribution(orders) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, commissionTotal: 0 }));
  orders.forEach(order => {
    if (!order.orderTime) return;
    const hour = order.orderTime.getHours();
    buckets[hour].orders += 1;
    buckets[hour].commissionTotal += order.commissionTotal;
  });
  const max = Math.max(...buckets.map(b => b.orders), 0);
  const sorted = [...buckets].sort((a, b) => b.orders - a.orders);
  const peakHours = new Set(sorted.filter(b => b.orders > 0).slice(0, 2).map(b => b.hour));
  return buckets.map(b => ({ ...b, isPeak: peakHours.has(b.hour) && max > 0 }));
}

export function computeTopProducts(orders, limit = 5) {
  const groups = new Map();
  orders.forEach(order => {
    const key = order.itemId || order.itemName;
    if (!groups.has(key)) {
      groups.set(key, { itemId: order.itemId, itemName: order.itemName, orders: 0, commissionTotal: 0, commissionXtra: 0 });
    }
    const g = groups.get(key);
    g.orders += 1;
    g.commissionTotal += order.commissionTotal;
    g.commissionXtra += order.commissionXtra;
  });
  return Array.from(groups.values())
    .map(g => ({ ...g, xtraRate: g.commissionTotal > 0 ? g.commissionXtra / g.commissionTotal : 0 }))
    .sort((a, b) => b.commissionTotal - a.commissionTotal)
    .slice(0, limit);
}

export function computeTopShops(orders, limit = 5) {
  const groups = new Map();
  orders.forEach(order => {
    const key = order.shopId || order.shopName;
    if (!groups.has(key)) {
      groups.set(key, { shopId: order.shopId, shopName: order.shopName, orders: 0, cancelledOrders: 0, commissionTotal: 0 });
    }
    const g = groups.get(key);
    g.orders += 1;
    if (order.status === 'cancelled') g.cancelledOrders += 1;
    g.commissionTotal += order.commissionTotal;
  });
  return Array.from(groups.values())
    .map(g => ({ ...g, cancelRate: g.orders > 0 ? g.cancelledOrders / g.orders : 0 }))
    .filter(g => g.cancelRate < 0.5)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, limit);
}

export function computeWarnings(kpis, matrixRows) {
  const warnings = [];
  const losingRows = matrixRows.filter(r => r.evaluation.key === 'lo');
  if (losingRows.length) {
    const totalLoss = losingRows.reduce((s, r) => s + Math.abs(r.profit), 0);
    warnings.push({
      level: 'critical',
      title: `${losingRows.length} SubID đang chạy Ads bị lỗ`,
      detail: `Tổng lỗ ước tính ${Math.round(totalLoss).toLocaleString('vi-VN')}đ. Cân nhắc tắt Ads cho các SubID này.`
    });
  }
  if (kpis.cancelRate > 0.2) {
    warnings.push({
      level: 'warning',
      title: 'Tỷ lệ đơn hủy cao',
      detail: `${(kpis.cancelRate * 100).toFixed(1)}% đơn bị hủy, vượt ngưỡng cảnh báo 20%.`
    });
  }
  if (kpis.zeroValueRate > 0.1) {
    warnings.push({
      level: 'warning',
      title: 'Tỷ lệ đơn 0đ cao',
      detail: `${(kpis.zeroValueRate * 100).toFixed(1)}% đơn có hoa hồng 0đ, vượt ngưỡng cảnh báo 10%.`
    });
  }
  return warnings;
}
