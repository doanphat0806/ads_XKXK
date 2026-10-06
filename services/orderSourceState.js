'use strict';

// Trang thai nguon don hang dung chung (tranh require vong giua orderService va posOrderService).
// ORDERS_SOURCE: 'pos' (mac dinh) | 'sheet' | 'database'.
// 'pos': doc don tu MongoDB (bang Order, dong bo tu Pancake POS) khi da tai xong lich su (posReady);
//        truoc do van dung Google Sheet de so lieu khong bi thieu.
const ORDERS_SOURCE = String(process.env.ORDERS_SOURCE || 'pos').trim().toLowerCase();

const orderSourceState = {
  source: ORDERS_SOURCE,
  posReady: false,
  // Tang moi lan dong bo POS co thay doi -> dung lam khoa cache
  posVersion: 0,
  posLastSyncedAt: null
};

module.exports = { orderSourceState };
