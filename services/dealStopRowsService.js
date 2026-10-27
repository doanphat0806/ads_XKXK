'use strict';

// Bang "dong deal" (deal stop): tinh tu toan bo lich su don + chi phi QC theo ma SP.
// Tach khoi routes/legacyRoutes.js de de doc/sua; route chi con validate + goi getDealStopRows.

const Order = require('../models/Order');
const Campaign = require('../models/Campaign');
const DataPurchaseOrder = require('../models/DataPurchaseOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const {
  normalizeSkuKey,
  normalizeStatusKey,
  getOrderTagText,
  classifyReturnStatus,
  getOrderItemsFromRaw,
  getOrderItemSku,
  getOrderItemQuantity,
  buildOrderSkuStats,
  buildOrderQuery,
  getOrderDataVersion,
  ORDER_SKU_STATS_FIELDS
} = require('./orderService');
const { getFirstQuantityText, parseQuantity } = require('./purchaseOrderService');
const {
  getDealStopCampaignCache,
  setDealStopCampaignCache,
  getOrderDerivedCache,
  setOrderDerivedCache
} = require('../utils/cacheManager');
const { extractInventoryProductCode, getCampaignSkuCandidates } = require('../utils/productCodeUtils');

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

// campaignRows cua deal stop nam trong cache 24h (cung 1 mang) nhung moi lan co don moi (~2 phut)
// lai tinh lai bang chi phi theo SKU tu dau (~4s CPU, chan event loop). Nho theo chinh mang do.
const campaignSpendBySkuMemo = new WeakMap();

function buildCampaignSpendBySku(campaignRows = []) {
  const memo = campaignSpendBySkuMemo.get(campaignRows);
  if (memo) return memo;
  const spendBySku = {};
  campaignSpendBySkuMemo.set(campaignRows, spendBySku);

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
    const codes = [...new Set(
      String(manual.skuManual || '').split(/\r?\n/)
        .map(line => normalizeDealStopCode(line))
        .filter(Boolean)
    )];
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

  const isEarlierOrder = (nextKey = {}, currentMeta = {}) => {
    const currentKey = {
      time: Number(currentMeta.time || Number.MAX_SAFE_INTEGER),
      rowNumber: Number(currentMeta.rowNumber || Number.MAX_SAFE_INTEGER)
    };

    if (nextKey.time !== currentKey.time) return nextKey.time < currentKey.time;
    return nextKey.rowNumber < currentKey.rowNumber;
  };

  const hasAllowedTag = (order = {}) => {
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
    // Tag va moc thoi gian la cua ca don -> tinh 1 lan/don thay vi moi san pham trong don
    const orderSortKey = getOrderSortKey(order);
    let orderHasAllowedTag;

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
          _hasAllowedTag: false
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

      // Chi can 1 don bat ky cua ma nay co tag oder/order (hoac tag trong) la
      // du dieu kien hien thi - khong chi phu thuoc vao tag cua don dau tien,
      // vi cac ma moi co the bi gan nham tag khac o don dau roi moi sua dung sau.
      if (!row._hasAllowedTag) {
        if (orderHasAllowedTag === undefined) orderHasAllowedTag = hasAllowedTag(order);
        if (orderHasAllowedTag) row._hasAllowedTag = true;
      }

      if (!row._firstOrderMeta || isEarlierOrder(orderSortKey, row._firstOrderMeta)) {
        row._firstOrderMeta = orderSortKey;
      }
    });
  });

  const skuStats = buildOrderSkuStats(orderRows);
  const cpoByCode = buildSkuCpoByCode(Object.keys(rowsByCode), skuStats.counts || {}, campaignRows);

  return Object.values(rowsByCode)
    .filter(row => row._hasAllowedTag === true)
    .filter(row => Number(row.slKhachDat || 0) >= 2)
    .map(row => {
      const returnDenominator = row.daNhan + row.dangHoan + row.daHoan;
      const cpoMeta = cpoByCode[row.ma] || {};
      const sizeBuckets = row._sizeBuckets || {};
      const { _sizeBuckets, _firstOrderMeta, _hasAllowedTag, ...cleanRow } = row;

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

// Dong deal tinh tu toan bo lich su don (~117k don, ~4s, chan event loop ~2s). Cache theo version don
// nen moi lan POS co don moi (~2 phut) la het han. Hai lop chong lap:
// - dealStopRowsInFlight: nhieu tab/nguoi cung luc chi tinh MOT lan cho cung khoa
// - dealStopLatestRows: ban gan nhat theo khoang ngay (khong theo version) -> het han thi tra ban cu
//   ngay va tinh lai ngam (stale-while-revalidate)
const dealStopRowsInFlight = new Map();
const dealStopLatestRows = new Map();

function computeDealStopRowsOnce({ rowsCacheKey, campaignCacheKey, orderVersion, fromDate, toDate, accountIds, campaignMatch }) {
  const pending = dealStopRowsInFlight.get(rowsCacheKey);
  if (pending) return pending;

  const job = (async () => {
    const cachedCampaignRows = getDealStopCampaignCache(campaignCacheKey);
    const [orderRows, campaignRows] = await Promise.all([
      Order.find(buildOrderQuery({ fromDate, toDate }))
        // Chi truong buildDealStopRows doc (khong lay ca rawData): lich su nhe ~4 lan
        .select(`${ORDER_SKU_STATS_FIELDS} createdAt rawData.rowNumber rawData.tags rawData.sheetColumns.col13`)
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
      ]).allowDiskUse(true).then(rows => setDealStopCampaignCache(campaignCacheKey, rows)) : Promise.resolve(setDealStopCampaignCache(campaignCacheKey, [])))
    ]);

    const rows = setOrderDerivedCache(rowsCacheKey, buildDealStopRows(orderRows, campaignRows));
    dealStopLatestRows.delete(campaignCacheKey);
    dealStopLatestRows.set(campaignCacheKey, { orderVersion, rows });
    if (dealStopLatestRows.size > 20) dealStopLatestRows.delete(dealStopLatestRows.keys().next().value);
    return rows;
  })().finally(() => dealStopRowsInFlight.delete(rowsCacheKey));

  dealStopRowsInFlight.set(rowsCacheKey, job);
  return job;
}

/**
 * Dong deal stop cho cac TKQC Facebook trong khoang ngay (rong = toan bo lich su).
 * Co ban cu thi tra ngay va tinh lai ngam; SL da dat (don nhap hang) luon tinh moi.
 * @param {{ fromDate: string, toDate: string, accountIds: Array }} input
 */
async function getDealStopRows({ fromDate, toDate, accountIds = [] }) {
  const campaignMatch = {
    accountId: { $in: accountIds }
  };
  if (fromDate || toDate) {
    campaignMatch.date = {};
    if (fromDate) campaignMatch.date.$gte = fromDate;
    if (toDate) campaignMatch.date.$lte = toDate;
  }

  const dealStopCampaignCacheKey = `deal-stop-campaign:${fromDate}:${toDate}:${accountIds.map(String).sort().join(',')}`;
  // Dong deal tu don + chi phi QC: nho theo khoang ngay + version don; SL da dat (don dat hang) van tinh moi moi lan
  const orderVersion = getOrderDataVersion();
  const dealStopRowsCacheKey = `deal-stop-rows:${dealStopCampaignCacheKey}:${orderVersion}`;
  const purchasePlacedQtyPromise = buildPurchasePlacedQtyByCode();

  let dealStopRows = getOrderDerivedCache(dealStopRowsCacheKey);
  if (!dealStopRows) {
    const computing = computeDealStopRowsOnce({
      rowsCacheKey: dealStopRowsCacheKey,
      campaignCacheKey: dealStopCampaignCacheKey,
      orderVersion,
      fromDate,
      toDate,
      accountIds,
      campaignMatch
    });
    const stale = dealStopLatestRows.get(dealStopCampaignCacheKey);
    if (stale) {
      // Co ban cu -> tra ngay, tinh lai ngam (khong bat nguoi dung cho ~4s)
      computing.catch(error => console.warn(`[deal-stop] tinh lai ngam loi: ${error.message}`));
      dealStopRows = stale.rows;
    } else {
      dealStopRows = await computing;
    }
  }
  const purchasePlacedQtyByCode = await purchasePlacedQtyPromise;
  return dealStopRows.map(row => {
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
}

module.exports = {
  getDealStopRows,
  buildDealStopRows,
  buildPurchasePlacedQtyByCode,
  isDealStopUnshippedOrder
};
