import { parsedRowsToOrders } from './mapping';

export async function parseSpreadsheetFile(file) {
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);
  const data = isCsv ? await file.text() : await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: isCsv ? 'string' : 'array', codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('File không có dữ liệu.');
  const sheet = workbook.Sheets[sheetName];
  // raw: true keeps date/time cells as their Excel serial number instead of xlsx's
  // reformatted display text (e.g. "2026-09-18 22:51:44" -> "9/18/26", losing the time
  // and using an M/D/Y order that parseDateTime's D/M/Y regex misreads).
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  if (!rows.length) throw new Error('Không tìm thấy dòng dữ liệu nào trong file.');
  return rows;
}

export async function parseOrdersFile(file) {
  const rows = await parseSpreadsheetFile(file);
  return parsedRowsToOrders(rows);
}

// Optional click-report file: expects a SubID-ish column + a Clicks column.
// Returns a map of subIdKey -> total clicks, matched loosely against any subid columns present.
export async function parseClickReportFile(file) {
  const { parsedRowsToOrders } = await import('./mapping');
  const rows = await parseSpreadsheetFile(file);
  if (!rows.length) return {};
  const pseudoOrders = parsedRowsToOrders(rows);
  const clicksBySubId = {};
  pseudoOrders.forEach(order => {
    const key = order.subIdKey;
    clicksBySubId[key] = (clicksBySubId[key] || 0) + (order.clicksHint || 0);
  });
  return clicksBySubId;
}
