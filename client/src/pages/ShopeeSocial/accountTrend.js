export function toDayStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  orders, accountName, subIdPrefix = '', fromDate, toDate, adsSpendBySubId2Daily = {}, commissionReceipts = []
}) {
  const days = enumerateDays(fromDate, toDate);
  if (!days.length) return [];

  const accountOrders = orders.filter(o => (o.accountName || '') === accountName);

  const commissionByDay = new Map();
  const subId2Set = new Set();
  accountOrders.forEach(o => {
    if (!o.orderTime) return;
    const day = toDayStr(o.orderTime);
    // A cancelled order never pays commission — some reports still carry its original
    // (pre-cancellation) commission value instead of zeroing it out, which would
    // overstate "hoa hồng theo báo cáo" for that day if counted.
    if (o.status !== 'cancelled') {
      commissionByDay.set(day, (commissionByDay.get(day) || 0) + o.commissionTotal);
    }
    subId2Set.add(o.subIds[1] || '(Không gắn SubID2)');
  });

  // Prefer prefix-based matching (e.g. account "AFF 01" -> SubID2s starting "1307A",
  // "AFF 02" -> "1307B") so a campaign that's still running but hasn't produced a
  // completed order yet still counts as cost for the right account — matching only
  // via orders would silently drop that spend from every account's total.
  if (subIdPrefix) {
    Object.keys(adsSpendBySubId2Daily).forEach(subId2 => {
      if (subId2.startsWith(subIdPrefix)) subId2Set.add(subId2);
    });
  }

  const receiptByDay = new Map();
  commissionReceipts.forEach(r => {
    if (!r.date || r.accountName !== accountName) return;
    const day = toDayStr(r.date);
    receiptByDay.set(day, (receiptByDay.get(day) || 0) + r.amount);
  });

  let cumulative = 0;
  return days.map(day => {
    const commission = commissionByDay.get(day) || 0;
    let adSpend = 0;
    subId2Set.forEach(subId2 => { adSpend += adsSpendBySubId2Daily[subId2]?.[day]?.spend || 0; });
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
