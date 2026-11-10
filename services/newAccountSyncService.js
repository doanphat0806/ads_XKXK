'use strict';

// Tu dong dong bo du lieu chi tieu/chien dich cac ngay truoc khi vua them TKQC moi
// (them tay, them hang loat, tu tim, import tu VIA) de trang bao cao co du so lieu ngay.
//
// Logic dong bo nam trong legacy runtime (queue BullMQ, processCampaignSyncHistoryJob...),
// nen runtime dang ky handler qua setNewAccountSyncHandler(). Cac router doc lap
// (vd fbProfileRoutes) chi can goi scheduleNewAccountHistorySync() ma khong phai phu thuoc vong.

let handler = null;

function setNewAccountSyncHandler(fn) {
  handler = typeof fn === 'function' ? fn : null;
}

/**
 * Len lich dong bo lich su cho cac TKQC vua tao. Khong bao gio throw, khong chan response.
 * @param {Array<string|{_id?: any, id?: any}>} accounts - id hoac doc tai khoan
 */
function scheduleNewAccountHistorySync(accounts) {
  const ids = [...new Set((Array.isArray(accounts) ? accounts : [accounts])
    .map(item => String(item?._id || item?.id || item || '').trim())
    .filter(Boolean))];
  if (!ids.length) return;
  if (!handler) {
    console.warn(`[new-account-sync] chua co handler, bo qua ${ids.length} tai khoan`);
    return;
  }
  Promise.resolve()
    .then(() => handler(ids))
    .catch(error => console.error(`[new-account-sync] loi len lich: ${error.message}`));
}

module.exports = { setNewAccountSyncHandler, scheduleNewAccountHistorySync };
