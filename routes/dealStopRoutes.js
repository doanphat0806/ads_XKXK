'use strict';

const express = require('express');
const Config = require('../models/Config');
const { getAppConfig, clearAppConfigCache } = require('../services/configService');

const router = express.Router();

function toPlainObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
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
