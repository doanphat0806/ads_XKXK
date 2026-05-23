import { DEFAULT_CONFIG } from '../types/chuaCoConfig.types';
import {
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_STAFF_LIST
} from '../types/order.types';

const STORAGE_KEYS = {
  chuaCoConfig: 'chuaCoConfig',
  colVisibility: 'colVisibility',
  staffList: 'dealStopOrderStaffList',
  hiddenCodes: 'dealStopOrderHiddenCodes',
  actualQtyByCode: 'dealStopOrderActualQtyByCode',
  dataVersion: 'dealStopOrderDataVersion'
};

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  return safeParse(raw, fallback);
}

export function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getRowStorageKey(tabId) {
  return `dealStopOrderRows:${tabId}`;
}

export function loadRowsByTab(tabId, fallbackRows = []) {
  return readJson(getRowStorageKey(tabId), fallbackRows);
}

export function saveRowsByTab(tabId, rows) {
  writeJson(getRowStorageKey(tabId), rows);
}

export function loadChuaCoConfig() {
  return readJson(STORAGE_KEYS.chuaCoConfig, DEFAULT_CONFIG);
}

export function saveChuaCoConfig(config) {
  writeJson(STORAGE_KEYS.chuaCoConfig, config);
}

export function loadColumnVisibility() {
  return { ...DEFAULT_COLUMN_VISIBILITY, ...readJson(STORAGE_KEYS.colVisibility, {}) };
}

export function saveColumnVisibility(visibility) {
  writeJson(STORAGE_KEYS.colVisibility, visibility);
}

export function loadStaffList() {
  const stored = readJson(STORAGE_KEYS.staffList, DEFAULT_STAFF_LIST);
  return Array.isArray(stored) && stored.length ? stored : DEFAULT_STAFF_LIST;
}

export function saveStaffList(staffList) {
  writeJson(STORAGE_KEYS.staffList, staffList);
}

export function loadHiddenCodes() {
  const stored = readJson(STORAGE_KEYS.hiddenCodes, []);
  return Array.isArray(stored) ? stored : [];
}

export function saveHiddenCodes(codes) {
  writeJson(STORAGE_KEYS.hiddenCodes, codes);
}

export function loadDealStopActualQtyByCode() {
  const stored = readJson(STORAGE_KEYS.actualQtyByCode, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

export function saveDealStopActualQtyByCode(qtyByCode) {
  writeJson(STORAGE_KEYS.actualQtyByCode, qtyByCode && typeof qtyByCode === 'object' ? qtyByCode : {});
}

export function loadDealStopDataVersion() {
  return Number(readJson(STORAGE_KEYS.dataVersion, 1) || 1);
}

export function saveDealStopDataVersion(version) {
  writeJson(STORAGE_KEYS.dataVersion, version);
}

export { STORAGE_KEYS };
