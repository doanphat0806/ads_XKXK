'use strict';

// Tien do dong bo lich su theo TUNG tai khoan (giu trong RAM cua process server).
// processCampaignSyncHistoryJob ghi vao day (ca khi chay qua BullMQ worker vi worker chay cung process),
// client tab "Tai khoan quang cao" doc qua GET /api/account-sync/progress de ve thanh % moi dong.

const DONE_KEEP_MS = 30 * 60 * 1000; // giu trang thai xong/loi 30 phut roi xoa
const STALE_ACTIVE_MS = 6 * 60 * 60 * 1000; // dang chay ma 6 tieng khong cap nhat -> coi nhu treo

const progressByAccount = new Map();

function isDoneState(state) {
  return state === 'completed' || state === 'completed_with_errors' || state === 'failed';
}

function setAccountSyncProgress(accountId, patch = {}) {
  const key = String(accountId || '').trim();
  if (!key) return;
  const prev = progressByAccount.get(key) || {};
  progressByAccount.set(key, { ...prev, ...patch, accountId: key, updatedAt: Date.now() });
}

/** Danh dau cac TK dang cho trong hang doi (chua toi luot). Khong de len TK dang chay. */
function markAccountsQueued(accountIds = [], info = {}) {
  for (const id of accountIds) {
    const key = String(id || '').trim();
    if (!key) continue;
    const prev = progressByAccount.get(key);
    if (prev && prev.state === 'active') continue;
    setAccountSyncProgress(key, {
      state: 'queued',
      percent: 0,
      completedDays: 0,
      totalDays: info.totalDays || 0,
      fromDate: info.fromDate || '',
      toDate: info.toDate || '',
      currentDay: '',
      errorCount: 0,
      lastError: '',
      source: info.source || 'manual'
    });
  }
}

function pruneProgress(now = Date.now()) {
  for (const [key, item] of progressByAccount) {
    const age = now - Number(item.updatedAt || 0);
    if ((isDoneState(item.state) && age > DONE_KEEP_MS) || age > STALE_ACTIVE_MS) {
      progressByAccount.delete(key);
    }
  }
}

function getAccountSyncProgress(accountIds = []) {
  pruneProgress();
  const result = {};
  for (const id of accountIds) {
    const key = String(id || '');
    const item = progressByAccount.get(key);
    if (item) result[key] = item;
  }
  return result;
}

module.exports = {
  setAccountSyncProgress,
  markAccountsQueued,
  getAccountSyncProgress
};
