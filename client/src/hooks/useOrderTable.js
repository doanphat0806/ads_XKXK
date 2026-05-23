import { useMemo } from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';
import {
  DEFAULT_STAFF_LIST,
  getStaffByMa,
  ORDER_COLUMN_CONFIG
} from '../types/order.types';
import { averageRate, sumField } from '../utils/calculations';
import { normalizeForSearch } from '../utils/formatters';

const columnHelper = createColumnHelper();

function buildColumns() {
  return ORDER_COLUMN_CONFIG.map(config => columnHelper.accessor(config.id, {
    id: config.id,
    header: config.header,
    enableSorting: config.enableSorting !== false,
    meta: config,
    sortingFn: (rowA, rowB, columnId) => {
      const a = rowA.original[columnId];
      const b = rowB.original[columnId];

      if (typeof a === 'number' && typeof b === 'number') return a - b;

      const aText = String(a ?? '').toLowerCase();
      const bText = String(b ?? '').toLowerCase();
      return aText.localeCompare(bText, 'vi');
    }
  }));
}

function buildGroupSummary(rows) {
  return {
    slKhachDat: sumField(rows, 'slKhachDat'),
    slThucDat: sumField(rows, 'slThucDat'),
    tongDaShip: sumField(rows, 'tongDaShip'),
    tiLeDat: averageRate(rows, 'tiLeDat'),
    tiLeHoan: averageRate(rows, 'tiLeHoan'),
    tiLeShip: averageRate(rows, 'tiLeShip'),
    cpo: averageRate(rows, 'cpo'),
    daNhan: sumField(rows, 'daNhan'),
    dangHoan: sumField(rows, 'dangHoan'),
    daHoan: sumField(rows, 'daHoan'),
    dangGuiHang: sumField(rows, 'dangGuiHang')
  };
}

function buildSearchIndex(row) {
  return normalizeForSearch(`${row.ma} ${row.ghiChu}`);
}

export function useOrderTable({
  rows,
  staffList = DEFAULT_STAFF_LIST,
  searchTerm,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange
}) {
  const validRows = useMemo(
    () => rows.filter(row => Boolean(getStaffByMa(row.ma, staffList))),
    [rows, staffList]
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = normalizeForSearch(searchTerm);
    if (!normalizedSearch) return validRows;

    return validRows.filter(row => buildSearchIndex(row).includes(normalizedSearch));
  }, [validRows, searchTerm]);

  const columns = useMemo(() => buildColumns(), []);

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: {
      sorting,
      columnVisibility
    },
    enableMultiSort: true,
    onSortingChange,
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  const sortedRows = table.getRowModel().rows.map(row => row.original);

  const groupedRows = useMemo(() => {
    const groups = staffList.map(staff => ({
      ...staff,
      rows: []
    }));
    const groupMap = new Map(groups.map(group => [String(group.prefix || '').toUpperCase(), group]));

    sortedRows.forEach(row => {
      const staff = getStaffByMa(row.ma, staffList);
      if (!staff) return;

      const existing = groupMap.get(staff.prefix);
      if (existing) {
        existing.rows.push(row);
      }
    });

    return groups
      .filter(group => group.rows.length > 0)
      .map(group => ({
        ...group,
        summary: buildGroupSummary(group.rows)
      }));
  }, [sortedRows, staffList]);

  const visibleColumns = table.getVisibleLeafColumns().map(column => ({
    id: column.id,
    column,
    ...column.columnDef.meta
  }));

  const filteredSummary = useMemo(() => buildGroupSummary(sortedRows), [sortedRows]);
  const overallSummary = useMemo(() => buildGroupSummary(validRows), [validRows]);
  const stats = useMemo(() => ({
    totalOrders: validRows.length,
    totalQuantity: sumField(validRows, 'slKhachDat'),
    averageRate: averageRate(validRows, 'tiLeDat'),
    totalShipped: sumField(validRows, 'tongDaShip')
  }), [validRows]);

  return {
    table,
    filteredRows,
    sortedRows,
    groupedRows,
    visibleColumns,
    filteredSummary,
    overallSummary,
    stats
  };
}
