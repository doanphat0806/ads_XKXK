import { detectPlatform, classifyChannel, classifyStatus, buildSubIdKey } from './utils';

// Seeded PRNG so demo data is stable across reloads within a session.
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLATFORMS = [
  { sub1: 'fb', placements: ['group-deal', 'fanpage-post', 'reels-ads'], koc: ['koc-linh', 'koc-mai'], hasAds: true },
  { sub1: 'tiktok', placements: ['bio', 'reels-ads'], koc: ['koc-huy', 'koc-anna'], hasAds: true },
  { sub1: 'tele', placements: ['group-deal', 'kenh-chinh'], koc: ['admin1'], hasAds: false },
  { sub1: 'zalo', placements: ['group-deal', 'oa-post'], koc: ['admin2'], hasAds: false },
  { sub1: 'threads', placements: ['bio', 'post'], koc: ['koc-tam'], hasAds: false },
  { sub1: 'yt', placements: ['shorts', 'description'], koc: ['koc-duy'], hasAds: false }
];

const PRODUCTS = [
  { itemId: 'IT1001', itemName: 'Áo thun cotton unisex', shopId: 'S01', shopName: 'Xưởng May Việt', priceRange: [99000, 189000] },
  { itemId: 'IT1002', itemName: 'Nồi chiên không dầu 5L', shopId: 'S02', shopName: 'Điện Máy Gia Đình', priceRange: [890000, 1290000] },
  { itemId: 'IT1003', itemName: 'Serum dưỡng da Vitamin C', shopId: 'S03', shopName: 'Beauty House', priceRange: [159000, 399000] },
  { itemId: 'IT1004', itemName: 'Tai nghe bluetooth TWS', shopId: 'S04', shopName: 'TechZone Store', priceRange: [199000, 459000] },
  { itemId: 'IT1005', itemName: 'Bộ chăn ga gối cotton', shopId: 'S05', shopName: 'Nhà Xinh Textile', priceRange: [450000, 890000] },
  { itemId: 'IT1006', itemName: 'Giày sneaker nam nữ', shopId: 'S06', shopName: 'Sneaker Hub', priceRange: [259000, 590000] },
  { itemId: 'IT1007', itemName: 'Bình giữ nhiệt 500ml', shopId: 'S02', shopName: 'Điện Máy Gia Đình', priceRange: [89000, 159000] },
  { itemId: 'IT1008', itemName: 'Mặt nạ dưỡng ẩm 10 miếng', shopId: 'S03', shopName: 'Beauty House', priceRange: [69000, 129000] }
];

const PEAK_HOURS = [11, 12, 20, 21, 22];

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function randInt(rng, min, max) { return Math.floor(min + rng() * (max - min + 1)); }

export function generateDemoOrders(count = 72, seed = 20260417) {
  const rng = mulberry32(seed);
  const now = new Date();
  const orders = [];

  for (let i = 0; i < count; i += 1) {
    const platformDef = pick(rng, PLATFORMS);
    const placement = pick(rng, platformDef.placements);
    const koc = pick(rng, platformDef.koc);
    const product = pick(rng, PRODUCTS);
    const campaignId = `camp${randInt(rng, 1, 4)}`;

    const daysAgo = randInt(rng, 0, 13);
    const useGoldenHour = rng() < 0.55;
    const hour = useGoldenHour ? pick(rng, PEAK_HOURS) : randInt(rng, 6, 23);
    const orderTime = new Date(now);
    orderTime.setDate(orderTime.getDate() - daysAgo);
    orderTime.setHours(hour, randInt(rng, 0, 59), 0, 0);

    const price = randInt(rng, product.priceRange[0], product.priceRange[1]);
    const qty = rng() < 0.15 ? 2 : 1;
    const gmv = price * qty;

    const statusRoll = rng();
    const statusRaw = statusRoll < 0.72 ? 'Hoàn thành' : statusRoll < 0.88 ? 'Đang chờ xử lý' : 'Đã hủy';
    const isZeroValue = statusRaw !== 'Đã hủy' && rng() < 0.06;

    const baseRate = 0.05 + rng() * 0.05;
    const commissionShopee = isZeroValue || statusRaw === 'Đã hủy' ? 0 : Math.round(gmv * baseRate);
    const hasXtra = rng() < 0.3;
    const commissionXtra = hasXtra && commissionShopee > 0 ? Math.round(commissionShopee * (0.2 + rng() * 0.3)) : 0;

    const subIds = [platformDef.sub1, placement, campaignId, koc, product.itemId];
    const platform = detectPlatform(subIds[0]);
    const channelRaw = 'Mạng xã hội';

    orders.push({
      id: `DEMO${String(i + 1).padStart(4, '0')}`,
      orderId: `DEMO${String(i + 1).padStart(4, '0')}`,
      itemId: product.itemId,
      itemName: product.itemName,
      shopId: product.shopId,
      shopName: product.shopName,
      gmv,
      commissionShopee,
      commissionXtra,
      commissionTotal: commissionShopee + commissionXtra,
      channelRaw,
      channel: classifyChannel(channelRaw, platform.key),
      statusRaw,
      status: classifyStatus(statusRaw),
      orderTime,
      clicksHint: 0,
      subIds,
      subIdKey: buildSubIdKey(subIds),
      platformKey: platform.key,
      platformLabel: platform.label
    });
  }

  return orders;
}

// Plausible click counts per SubID2 group (the matrix's grouping key), higher for ads-driven platforms.
export function generateDemoClicksBySubId(orders, seed = 99117) {
  const rng = mulberry32(seed);
  const bySubId = {};
  const platformHasAds = {};
  PLATFORMS.forEach(p => { platformHasAds[p.sub1] = p.hasAds; });

  orders.forEach(order => {
    const key = order.subIds[1] || '(Không gắn SubID2)';
    if (bySubId[key] !== undefined) return;
    const hasAds = platformHasAds[order.subIds[0]];
    bySubId[key] = hasAds ? randInt(rng, 300, 2200) : randInt(rng, 40, 500);
  });
  return bySubId;
}

// Default CPC per platform (VND) — ads-driven platforms get a nonzero default, organic ones are free.
export function generateDemoCpcDefaults() {
  return {
    fb: 400,
    tiktok: 320,
    tele: 0,
    zalo: 0,
    threads: 0,
    yt: 0
  };
}
