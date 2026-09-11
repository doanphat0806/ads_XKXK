import { DEFAULT_CONFIG } from '../types/chuaCoConfig.types';

function roundNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

// Doc so tu chuoi, chap nhan ca dinh dang VN ("1.500", "12,5") lan EN ("1,500", "12.5").
// Ban cu xoa het dau cham roi doi dau phay dau tien thanh cham, nen:
//   "0.5"       -> 5          (sai 10 lan)
//   "1,234,567" -> 1.234567   (sai hoan toan)
// Quy tac moi: dau phan cach xuat hien sau cung la dau thap phan, tru khi no dung
// truoc dung 3 chu so va la loai dau duy nhat - luc do no la dau phan cach nghin
// ("1.500" = 1500 theo cach viet VN).
export function toSafeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  const negative = /^-/.test(raw);
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  const lastSeparatorIndex = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  let normalized;

  if (lastSeparatorIndex < 0) {
    normalized = cleaned;
  } else {
    const separator = cleaned[lastSeparatorIndex];
    const tail = cleaned.slice(lastSeparatorIndex + 1);
    const separatorCount = cleaned.split(separator).length - 1;
    const hasBothSeparators = cleaned.includes('.') && cleaned.includes(',');
    const isGroupSeparator = !hasBothSeparators && separatorCount >= 1 && /^\d{3}$/.test(tail);

    normalized = isGroupSeparator
      ? cleaned.replace(/[.,]/g, '')
      : `${cleaned.slice(0, lastSeparatorIndex).replace(/[.,]/g, '')}.${tail.replace(/[.,]/g, '')}`;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function calcChuaCo(ma, slKhachDat, config = DEFAULT_CONFIG) {
  if (!String(ma || '').trim()) return '';

  // config den tu localStorage/Mongo (kieu Mixed) nen co the thieu tiers hoac
  // tiers rong - doc thang se nem TypeError va lam trang trang toan bo bang.
  const tiers = Array.isArray(config?.tiers) && config.tiers.length ? config.tiers : DEFAULT_CONFIG.tiers;

  for (const tier of tiers) {
    if (tier?.maxQty === null || slKhachDat <= tier?.maxQty) {
      return roundNumber(slKhachDat * toSafeNumber(tier?.rate));
    }
  }

  return roundNumber(slKhachDat * toSafeNumber(tiers[tiers.length - 1]?.rate));
}

export function calcSLCanDatThem(ma, slThucDat, slKhachDat, tiLeHoan) {
  if (!String(ma || '').trim()) return '';

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

function getMaPrefix2(ma) {
  const code = String(ma || '').trim().toUpperCase().replace(/\s+/g, '');
  const prefix = code.slice(0, 2);
  return /^[A-Z]{2}$/.test(prefix) ? prefix : '';
}

export function recalculateRow(row, config = DEFAULT_CONFIG) {
  const normalizeManualText = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    return String(value);
  };

  const normalized = {
    ...row,
    slKhachDat: toSafeNumber(row.slKhachDat),
    slHuy: toSafeNumber(row.slHuy),
    slThucDat: Math.max(0, toSafeNumber(row.slThucDat) - toSafeNumber(row.slHuy)),
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
    maPrefix2: getMaPrefix2(normalized.ma),
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
