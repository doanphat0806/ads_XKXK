import { DEFAULT_CONFIG } from '../types/chuaCoConfig.types';

function roundNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function toSafeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function calcChuaCo(ma, slKhachDat, config = DEFAULT_CONFIG) {
  if (!String(ma || '').trim()) return '';

  for (const tier of config.tiers) {
    if (tier.maxQty === null || slKhachDat <= tier.maxQty) {
      return roundNumber(slKhachDat * tier.rate);
    }
  }

  return roundNumber(slKhachDat * config.tiers[config.tiers.length - 1].rate);
}

export function calcSLCanDatThem(ma, slThucDat, slKhachDat, tiLeHoan) {
  if (!String(ma || '').trim()) return '';
  if (slThucDat === 0) return 0;

  try {
    if (tiLeHoan <= 0.37) {
      return roundNumber(slKhachDat - (slThucDat + slThucDat * tiLeHoan));
    }

    return roundNumber((1 - tiLeHoan) * slKhachDat - slThucDat);
  } catch {
    return '';
  }
}

export function calcTiLeDat(slThucDat, slKhachDat) {
  if (slKhachDat === 0) return 0;
  return slThucDat / slKhachDat;
}

export function calcTiLeShip(tongDaShip, slKhachDat) {
  if (slKhachDat === 0) return 0;
  return tongDaShip / slKhachDat;
}

export function calcSLChenh(slKhachDat, slThucDat) {
  return slKhachDat - slThucDat;
}

export function recalculateRow(row, config = DEFAULT_CONFIG) {
  const normalizeManualText = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    return String(value);
  };

  const normalized = {
    ...row,
    slKhachDat: toSafeNumber(row.slKhachDat),
    slThucDat: toSafeNumber(row.slThucDat),
    orderSizeS: normalizeManualText(row.orderSizeS),
    orderSizeM: normalizeManualText(row.orderSizeM),
    orderSizeL: normalizeManualText(row.orderSizeL),
    orderSizeXL: normalizeManualText(row.orderSizeXL),
    orderSizeFZ: normalizeManualText(row.orderSizeFZ),
    tiLeHoan: clampPercent(toSafeNumber(row.tiLeHoan)),
    daNhan: toSafeNumber(row.daNhan),
    dangHoan: toSafeNumber(row.dangHoan),
    daHoan: toSafeNumber(row.daHoan),
    dangGuiHang: toSafeNumber(row.dangGuiHang),
    tongDaShip: toSafeNumber(row.tongDaShip)
  };

  return {
    ...normalized,
    slCanDatThem: calcSLCanDatThem(
      normalized.ma,
      normalized.slThucDat,
      normalized.slKhachDat,
      normalized.tiLeHoan
    ),
    tiLeDat: calcTiLeDat(normalized.slThucDat, normalized.slKhachDat),
    tiLeShip: calcTiLeShip(normalized.tongDaShip, normalized.slKhachDat),
    slChenh: calcSLChenh(normalized.slKhachDat, normalized.slThucDat),
    chuaCoTamTinh: calcChuaCo(normalized.ma, normalized.slKhachDat, config)
  };
}

export function parsePercentInput(value) {
  const parsed = toSafeNumber(value);
  if (parsed > 1) return clampPercent(parsed / 100);
  return clampPercent(parsed);
}

export function getPreviewSamples(config = DEFAULT_CONFIG) {
  return [5, 15, 30, 50].map(qty => ({
    qty,
    value: calcChuaCo('TMP', qty, config)
  }));
}

export function averageRate(rows, key) {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => sum + toSafeNumber(row[key]), 0);
  return total / rows.length;
}

export function sumField(rows, key) {
  return rows.reduce((sum, row) => sum + toSafeNumber(row[key]), 0);
}
