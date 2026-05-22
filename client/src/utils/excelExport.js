import * as XLSX from 'xlsx';
import { ORDER_COLUMN_CONFIG } from '../types/order.types';
import { formatDate } from './formatters';

function getVisibleExportColumns(columns, visibility) {
  return columns.filter(column => visibility[column.id] !== false && column.type !== 'action');
}

function formatExportValue(value, type) {
  if (type === 'percent') return Number(value || 0);
  return value ?? '';
}

export function exportOrdersToExcel({
  groupedRows,
  visibility,
  filenameDate = new Date()
}) {
  const columns = getVisibleExportColumns(ORDER_COLUMN_CONFIG, visibility);
  const aoa = [];

  aoa.push(columns.map(column => column.header));

  groupedRows.forEach(group => {
    aoa.push([`[${group.prefix}] ${group.name}`]);
    group.rows.forEach(row => {
      aoa.push(columns.map(column => formatExportValue(row[column.id], column.type)));
    });
  });

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  worksheet['!cols'] = columns.map(column => ({ wch: Math.max(12, Math.round(column.width / 8)) }));

  const range = XLSX.utils.decode_range(worksheet['!ref']);
  for (let col = 0; col <= range.e.c; col += 1) {
    const headerCell = XLSX.utils.encode_cell({ r: 0, c: col });
    if (worksheet[headerCell]) {
      worksheet[headerCell].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '0891B2' } }
      };
    }
  }

  columns.forEach((column, colIndex) => {
    if (column.type !== 'percent') return;
    for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      if (worksheet[cellAddress] && typeof worksheet[cellAddress].v === 'number') {
        worksheet[cellAddress].z = '0.00%';
      }
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Đóng Deal');

  const safeDate = formatDate(filenameDate).replace(/\//g, '-');
  XLSX.writeFile(workbook, `don-hang-${safeDate}.xlsx`);
}
