export function toDayStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// A SubID2 like "1707AB06" starts with a 4-digit DAILY batch code ("1707" = DD+MM,
// changes every day) followed by a FIXED 2-letter account code ("AB") that never
// changes — so matching from the very start of the string only ever works for one
// day. One account can also cover several codes at once (comma-separated, e.g.
// "AA,AB,AC,AD,AF"), so a SubID2 matches if the part AFTER the 4-digit batch code
// starts with any of them.
export function subIdMatchesAccountCodes(subId2, codesCsv) {
  const codes = String(codesCsv || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!codes.length) return false;
  const value = String(subId2 || '');
  if (value.length <= 4) return false;
  const rest = value.slice(4);
  return codes.some(code => rest.startsWith(code));
}

// Resolves which real ad accounts (Facebook accounts, provider="shopee") "belong" to a
// given Shopee AFF account:
//  - if the account has hand-picked ad account(s) (adAccountIds), that exact set is it —
//    every campaign under those accounts counts, no SubID2 code check needed.
//  - otherwise it falls back to every ad account NOT explicitly claimed by ANOTHER AFF
//    account, still filtered by SubID2 code match (the original behavior) — so picking
//    an ad account for one account automatically keeps its spend out of every other
//    account's default pool, without having to edit their configs too.
export function resolveAdAccountScope(shopeeAccounts, accountName) {
  const account = (shopeeAccounts || []).find(a => a.name === accountName);
  const explicitIds = (account?.adAccountIds || []).map(String);
  if (explicitIds.length) return { explicit: true, ids: new Set(explicitIds) };

  const claimed = new Set();
  (shopeeAccounts || []).forEach(a => {
    if (a.name === accountName) return;
    (a.adAccountIds || []).forEach(id => claimed.add(String(id)));
  });
  return { explicit: false, claimed };
}

// A single ads-spend campaign row ({ accountId, subId2, date, spend, clicks }) belongs to
// an account if it falls within that account's resolved ad-account scope — and, for the
// default (non-explicit) scope, its SubID2 also matches the account's configured codes.
// `scope === null` means "no account filter" (used for the "all accounts" view).
export function campaignBelongsToScope(campaign, scope, subIdPrefix) {
  if (!scope) return true;
  if (scope.explicit) return scope.ids.has(String(campaign.accountId));
  if (scope.claimed.has(String(campaign.accountId))) return false;
  return subIdMatchesAccountCodes(campaign.subId2, subIdPrefix);
}

function enumerateDays(fromDate, toDate) {
  const days = [];
  const cur = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return days;
  // Hard cap so a mistakenly huge range (e.g. "from" typo'd a decade back) can't hang the tab.
  let guard = 0;
  while (cur <= end && guard < 730) {
    days.push(toDayStr(cur));
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return days;
}

// Builds the 4 daily series charted per Shopee AFF account:
//  - commission: hoa hồng theo báo cáo đơn hàng, theo ngày ĐẶT đơn
//  - adSpend: chi phí Ads theo ngày (chỉ tính các SubID2 thuộc tài khoản này)
//  - reportProfit: hoa hồng báo cáo trừ chi phí Ads, theo ngày
//  - reportProfitCumulative: reportProfit cộng dồn theo thời gian
//
// Không dùng "hoa hồng thực nhận" (ghi tay) để tính lời/lỗ theo ngày — Shopee chỉ trả
// tiền sau khi đơn HOÀN THÀNH (mất 5-14 ngày), nên so thực nhận với chi phí Ads cùng
// ngày sẽ luôn hiện "lỗ giả" ở những ngày mới chi mà chưa tới kỳ thanh toán. Hoa hồng
// theo báo cáo (tính ngay theo ngày đặt đơn, không cần chờ) mới phản ánh đúng hiệu quả
// SubID2/ngày đó. "Thực nhận" vẫn được cộng dồn riêng (actualReceived) để đối chiếu
// dòng tiền thật — xem summarizeAccountTrend().
export function buildAccountTrendSeries({
  orders, accountName, subIdPrefix = '', adAccountScope = null, fromDate, toDate, campaigns = [], commissionReceipts = []
}) {
  const days = enumerateDays(fromDate, toDate);
  if (!days.length) return [];

  const accountOrders = orders.filter(o => (o.accountName || '') === accountName);

  const commissionByDay = new Map();
  accountOrders.forEach(o => {
    if (!o.orderTime) return;
    const day = toDayStr(o.orderTime);
    // A cancelled order never pays commission — some reports still carry its original
    // (pre-cancellation) commission value instead of zeroing it out, which would
    // overstate "hoa hồng theo báo cáo" for that day if counted.
    if (o.status !== 'cancelled') {
      commissionByDay.set(day, (commissionByDay.get(day) || 0) + o.commissionTotal);
    }
  });

  // Every campaign whose ad account falls in this account's resolved scope counts as
  // cost here — not just SubID2s that already produced a completed order, or a campaign
  // still running with zero orders so far would silently drop out of every account's total.
  const adSpendByDay = new Map();
  campaigns.forEach(c => {
    if (!campaignBelongsToScope(c, adAccountScope, subIdPrefix)) return;
    adSpendByDay.set(c.date, (adSpendByDay.get(c.date) || 0) + (c.spend || 0));
  });

  const receiptByDay = new Map();
  commissionReceipts.forEach(r => {
    if (!r.date || r.accountName !== accountName) return;
    const day = toDayStr(r.date);
    receiptByDay.set(day, (receiptByDay.get(day) || 0) + r.amount);
  });

  let cumulative = 0;
  return days.map(day => {
    const commission = commissionByDay.get(day) || 0;
    const adSpend = adSpendByDay.get(day) || 0;
    const actualReceived = receiptByDay.get(day) || 0;
    const reportProfit = commission - adSpend;
    cumulative += reportProfit;
    return { date: day, commission, adSpend, actualReceived, reportProfit, reportProfitCumulative: cumulative };
  });
}

// Rolls a trend series up into the headline numbers shown in the account's collapsed
// row and in the all-accounts totals table — kept in one place so both stay consistent.
export function summarizeAccountTrend(series) {
  const totalCommission = series.reduce((s, p) => s + p.commission, 0);
  const totalAdSpend = series.reduce((s, p) => s + p.adSpend, 0);
  const totalActualReceived = series.reduce((s, p) => s + p.actualReceived, 0);
  const reportProfitTotal = series.length ? series[series.length - 1].reportProfitCumulative : 0;
  const avgDaily = series.length ? reportProfitTotal / series.length : 0;
  const peak = series.reduce((best, p) => (!best || p.reportProfit > best.reportProfit ? p : best), null);
  const adsOverCommission = totalCommission > 0 ? (totalAdSpend / totalCommission) * 100 : 0;
  // How much of the report's commission has actually been paid out so far — a big gap
  // (well under 100%) is expected while orders are still within the 5-14 day completion
  // window, but a persistently low number for OLDER orders flags cancellations/returns.
  const receivedOverReported = totalCommission > 0 ? (totalActualReceived / totalCommission) * 100 : 0;
  // Cash-based profit — actual money received minus actual money spent — as opposed to
  // reportProfitTotal, which is based on the report's (not-yet-paid) commission figure.
  const realProfit = totalActualReceived - totalAdSpend;
  return {
    totalCommission, totalAdSpend, totalActualReceived, reportProfitTotal, avgDaily, peak,
    adsOverCommission, receivedOverReported, realProfit
  };
}
