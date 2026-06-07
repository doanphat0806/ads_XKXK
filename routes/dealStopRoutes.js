'use strict';

const express = require('express');
const Config = require('../models/Config');
const { getAppConfig, clearAppConfigCache } = require('../services/configService');

const router = express.Router();
const DEAL_STOP_ROW_TEXT_LIMIT = 500;
const DEAL_STOP_ORDER_SIZE_FIELDS = ['orderSizeS', 'orderSizeM', 'orderSizeL', 'orderSizeXL', 'orderSizeFZ'];

function toPlainObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizeDealStopCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function toBoundedText(value = '', limit = DEAL_STOP_ROW_TEXT_LIMIT) {
  return String(value ?? '').slice(0, limit);
}

function normalizeDealStopStateRowsByTab(value = {}) {
  const rowsByTab = toPlainObject(value);
  return Object.fromEntries(
    Object.entries(rowsByTab).map(([tabId, rows]) => [
      String(tabId || '').slice(0, 100),
      Array.isArray(rows) ? rows.slice(0, 5000) : []
    ]).filter(([tabId]) => Boolean(tabId))
  );
}

function normalizeDealStopOrderState(value = {}) {
  const state = toPlainObject(value);
  const actualQtyByCode = toPlainObject(state.actualQtyByCode);
  const cleanActualQtyByCode = Object.fromEntries(
    Object.entries(actualQtyByCode)
      .map(([code, qty]) => [String(code || '').trim().toUpperCase().replace(/\s+/g, ''), Number(qty || 0)])
      .filter(([code, qty]) => Boolean(code) && Number.isFinite(qty) && qty >= 0)
      .slice(0, 10000)
  );

  return {
    dataVersion: Number(state.dataVersion || 0) || 0,
    config: toPlainObject(state.config),
    columnVisibility: toPlainObject(state.columnVisibility),
    staffList: Array.isArray(state.staffList) ? state.staffList.slice(0, 200) : [],
    hiddenCodes: Array.isArray(state.hiddenCodes)
      ? [...new Set(state.hiddenCodes.map(code => String(code || '').trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean))].slice(0, 10000)
      : [],
    actualQtyByCode: cleanActualQtyByCode,
    rowsByTab: normalizeDealStopStateRowsByTab(state.rowsByTab),
    updatedAt: state.updatedAt || '',
    updatedBy: state.updatedBy || ''
  };
}

function normalizeDealStopRowPatch(row = {}, existingRow = {}, code = '') {
  const rowPatch = toPlainObject(row);
  const currentRow = toPlainObject(existingRow);
  const nextRow = {
    ...currentRow,
    ...rowPatch,
    ma: code || normalizeDealStopCode(rowPatch.ma || currentRow.ma),
    id: toBoundedText(rowPatch.id || currentRow.id || `source-${code}`, 150)
  };

  DEAL_STOP_ORDER_SIZE_FIELDS.forEach(field => {
    nextRow[field] = toBoundedText(
      Object.prototype.hasOwnProperty.call(rowPatch, field)
        ? rowPatch[field]
        : currentRow[field],
      100
    );
  });

  if (!Number.isFinite(Number(nextRow.slKhachDat)) || Number(nextRow.slKhachDat) < 2) {
    nextRow.slKhachDat = 2;
  }

  return nextRow;
}

router.get('/state', async (req, res) => {
  try {
    const config = await getAppConfig();
    res.json({
      ok: true,
      state: normalizeDealStopOrderState(config?.dealStopOrderState || {})
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/state/row', async (req, res) => {
  try {
    const tabId = String(req.body?.tabId || '').slice(0, 100);
    const rowPatch = toPlainObject(req.body?.row);
    const code = normalizeDealStopCode(req.body?.ma || rowPatch.ma);

    if (!tabId || !code) {
      return res.status(400).json({ error: 'Thieu tab hoac ma san pham' });
    }

    const now = new Date();
    const config = await getAppConfig();
    const currentState = normalizeDealStopOrderState(config?.dealStopOrderState || {});
    const rowsByTab = normalizeDealStopStateRowsByTab(currentState.rowsByTab);
    const currentRows = Array.isArray(rowsByTab[tabId]) ? rowsByTab[tabId] : [];
    const rowIndex = currentRows.findIndex(row => normalizeDealStopCode(row?.ma) === code);
    const nextRow = normalizeDealStopRowPatch(rowPatch, rowIndex >= 0 ? currentRows[rowIndex] : {}, code);
    const nextRows = rowIndex >= 0
      ? currentRows.map((row, index) => (index === rowIndex ? nextRow : row))
      : [nextRow, ...currentRows].slice(0, 5000);

    const state = normalizeDealStopOrderState({
      ...currentState,
      rowsByTab: {
        ...rowsByTab,
        [tabId]: nextRows
      },
      updatedAt: now.toISOString(),
      updatedBy: String(req.currentUser?.displayName || req.currentUser?.username || '').trim()
    });

    await Config.findOneAndUpdate(
      { key: 'app' },
      {
        $set: {
          dealStopOrderState: state,
          updatedAt: now
        }
      },
      { upsert: true, new: true }
    ).lean();
    clearAppConfigCache();

    res.json({ ok: true, state, row: nextRow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/state', async (req, res) => {
  try {
    const now = new Date();
    const state = normalizeDealStopOrderState({
      ...(req.body?.state || {}),
      updatedAt: now.toISOString(),
      updatedBy: String(req.currentUser?.displayName || req.currentUser?.username || '').trim()
    });

    await Config.findOneAndUpdate(
      { key: 'app' },
      {
        $set: {
          dealStopOrderState: state,
          updatedAt: now
        }
      },
      { upsert: true, new: true }
    ).lean();
    clearAppConfigCache();

    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.normalizeDealStopOrderState = normalizeDealStopOrderState;
