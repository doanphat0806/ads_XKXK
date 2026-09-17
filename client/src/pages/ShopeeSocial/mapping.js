import { normalizeHeaderText, parseNumber, parseDateTime, detectPlatform, classifyChannel, classifyStatus, buildSubIdKey } from './utils';

// Ordered matchers: first pattern that matches a normalized header wins that header.
// Order matters — more specific patterns (xtra, total) must be checked before generic ones.
const FIELD_MATCHERS = [
  { field: 'orderId', test: h => /ma don|order id|order sn|ordersn|so don hang/.test(h) },
  { field: 'itemId', test: h => /id san pham|item id|ma san pham/.test(h) },
  { field: 'itemName', test: h => /ten san pham|item name|ten hang/.test(h) },
  { field: 'shopId', test: h => /id shop|shop id|ma shop/.test(h) },
  { field: 'shopName', test: h => /ten shop|shop name/.test(h) },
  { field: 'commissionXtra', test: h => /xtra|thuong hieu|brand commission/.test(h) },
  { field: 'commissionTotal', test: h => /tong hoa hong|total commission|tong tien hoa hong/.test(h) },
  { field: 'commissionShopee', test: h => /hoa hong shopee|platform commission|hoa hong (san|nen tang)/.test(h) },
  { field: 'commissionShopee', test: h => /^hoa hong$|estimated commission|commission$/.test(h) },
  { field: 'gmv', test: h => /gia tri don hang|actual amount|order value|gmv|doanh so|gia tri thanh toan/.test(h) },
  { field: 'channel', test: h => /kenh ban|kenh$|channel|referrer|nguon/.test(h) },
  { field: 'status', test: h => /trang thai/.test(h) || h === 'status' },
  { field: 'orderTime', test: h => /thoi gian dat|ngay dat|order time|thoi gian mua|ngay mua|purchase time|^ngay$|^thoi gian$/.test(h) },
  { field: 'clicks', test: h => /^click|so click|luot click|clicks$/.test(h) },
  { field: 'subId1', test: h => /sub ?id ?1|subid1/.test(h) },
  { field: 'subId2', test: h => /sub ?id ?2|subid2/.test(h) },
  { field: 'subId3', test: h => /sub ?id ?3|subid3/.test(h) },
  { field: 'subId4', test: h => /sub ?id ?4|subid4/.test(h) },
  { field: 'subId5', test: h => /sub ?id ?5|subid5/.test(h) },
  { field: 'subIdCombined', test: h => /utm content|sub ?id$|subid$/.test(h) }
];

export function buildColumnMap(headers) {
  const map = {};
  for (const rawHeader of headers) {
    const normalized = normalizeHeaderText(rawHeader);
    if (!normalized) continue;
    for (const matcher of FIELD_MATCHERS) {
      if (map[matcher.field]) continue;
      if (matcher.test(normalized)) {
        map[matcher.field] = rawHeader;
        break;
      }
    }
  }
  return map;
}

function splitCombinedSubId(value) {
  return String(value || '')
    .split(/[-|_,/]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function rowToOrder(row, columnMap, index) {
  const get = field => (columnMap[field] ? row[columnMap[field]] : undefined);

  let subIds = [get('subId1'), get('subId2'), get('subId3'), get('subId4'), get('subId5')]
    .map(v => (v === undefined || v === null ? '' : String(v).trim()));

  if (!subIds.some(Boolean) && columnMap.subIdCombined) {
    const parts = splitCombinedSubId(get('subIdCombined'));
    subIds = [0, 1, 2, 3, 4].map(i => parts[i] || '');
  }

  const platform = detectPlatform(subIds[0]);
  const channelRaw = get('channel') || '';
  const statusRaw = get('status') || '';
  const commissionShopee = parseNumber(get('commissionShopee'));
  const commissionXtra = parseNumber(get('commissionXtra'));
  const commissionTotalRaw = get('commissionTotal');
  const commissionTotal = commissionTotalRaw !== undefined
    ? parseNumber(commissionTotalRaw)
    : commissionShopee + commissionXtra;

  return {
    id: get('orderId') || `row-${index}`,
    orderId: get('orderId') || `(#${index + 1})`,
    itemId: get('itemId') || '',
    itemName: get('itemName') || '(Không rõ sản phẩm)',
    shopId: get('shopId') || '',
    shopName: get('shopName') || '(Không rõ shop)',
    gmv: parseNumber(get('gmv')),
    commissionShopee,
    commissionXtra,
    commissionTotal: commissionTotal || (commissionShopee + commissionXtra),
    channelRaw,
    channel: classifyChannel(channelRaw, platform.key),
    statusRaw,
    status: classifyStatus(statusRaw),
    orderTime: parseDateTime(get('orderTime')),
    clicksHint: get('clicks') !== undefined ? parseNumber(get('clicks')) : 0,
    subIds,
    subIdKey: buildSubIdKey(subIds),
    platformKey: platform.key,
    platformLabel: platform.label
  };
}

export function parsedRowsToOrders(rows) {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const columnMap = buildColumnMap(headers);
  return rows.map((row, index) => rowToOrder(row, columnMap, index));
}
