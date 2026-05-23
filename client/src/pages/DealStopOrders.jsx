import React from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/Common/ConfirmDialog';
import AddOrderModal from '../components/Settings/AddOrderModal';
import ChuaCoSettings from '../components/Settings/ChuaCoSettings';
import StaffSettings from '../components/Settings/StaffSettings';
import OrderTable from '../components/Table/OrderTable';
import ColumnToggle from '../components/Toolbar/ColumnToggle';
import ExportButton from '../components/Toolbar/ExportButton';
import SearchBar from '../components/Toolbar/SearchBar';
import StatsCards from '../components/Toolbar/StatsCards';
import { useChuaCoConfig } from '../hooks/useChuaCoConfig';
import { useColorRules } from '../hooks/useColorRules';
import { useOrderTable } from '../hooks/useOrderTable';
import { api } from '../lib/api';
import {
  EDITABLE_COLUMNS,
  NUMERIC_COLUMNS,
  ORDER_COLUMN_CONFIG,
  PERCENT_COLUMNS,
  TAB_OPTIONS
} from '../types/order.types';
import { parsePercentInput, recalculateRow, toSafeNumber } from '../utils/calculations';
import {
  loadColumnVisibility,
  loadDealStopActualQtyByCode,
  loadDealStopDataVersion,
  loadHiddenCodes,
  loadRowsByTab,
  loadStaffList,
  saveColumnVisibility,
  saveDealStopActualQtyByCode,
  saveDealStopDataVersion,
  saveHiddenCodes,
  saveRowsByTab,
  saveStaffList
} from '../utils/configStorage';
import { exportOrdersToExcel } from '../utils/excelExport';

const DEAL_STOP_DATA_VERSION = 4;
const LOCAL_OVERRIDE_FIELDS = [
  'id',
  'ghiChu',
  'orderSizeS',
  'orderSizeM',
  'orderSizeL',
  'orderSizeXL',
  'orderSizeFZ',
  'dangGuiHang'
];

function getDefaultExpanded(staffList) {
  return staffList.reduce((acc, staff) => {
    acc[staff.prefix] = false;
    return acc;
  }, {});
}

function getNextEditableCell(visibleColumns, rows, currentRowId, currentColumnId) {
  const editableVisibleColumns = visibleColumns.filter(column => EDITABLE_COLUMNS.includes(column.id));
  const rowIndex = rows.findIndex(row => row.id === currentRowId);
  const columnIndex = editableVisibleColumns.findIndex(column => column.id === currentColumnId);
  if (rowIndex < 0 || columnIndex < 0) return null;

  if (columnIndex + 1 < editableVisibleColumns.length) {
    return { rowId: rows[rowIndex].id, columnId: editableVisibleColumns[columnIndex + 1].id };
  }
  if (rowIndex + 1 < rows.length) {
    return { rowId: rows[rowIndex + 1].id, columnId: editableVisibleColumns[0].id };
  }
  return null;
}

const DIRECT_INPUT_COLUMNS = new Set(['orderSizeS', 'orderSizeM', 'orderSizeL', 'orderSizeXL', 'orderSizeFZ']);

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeImportHeader(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function isActualQtyImportHeader(row = []) {
  const first = normalizeImportHeader(row[0]);
  const second = normalizeImportHeader(row[1]);
  return (
    (first.includes('ma') || first.includes('sku') || first.includes('code')) &&
    (second.includes('sl') || second.includes('so luong') || second.includes('thuc dat'))
  );
}

function parseActualQtyRows(rows = []) {
  const qtyByCode = {};

  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length < 2) return;
    if (rowIndex === 0 && isActualQtyImportHeader(row)) return;

    const code = normalizeCode(row[0]);
    const rawQty = row[1];
    if (!code || rawQty === '' || rawQty === null || rawQty === undefined) return;

    const qty = toSafeNumber(rawQty);
    if (!Number.isFinite(qty) || qty < 0) return;

    qtyByCode[code] = Number(qtyByCode[code] || 0) + qty;
  });

  return qtyByCode;
}

async function readActualQtyImportFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return {};

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false
  });

  return parseActualQtyRows(rows);
}

function hasImportedActualQty(actualQtyByCode = {}, code = '') {
  return Object.prototype.hasOwnProperty.call(actualQtyByCode, normalizeCode(code));
}

function getRowActualQty(sourceRow = {}, actualQtyByCode = {}) {
  const code = normalizeCode(sourceRow.ma);
  return hasImportedActualQty(actualQtyByCode, code)
    ? toSafeNumber(actualQtyByCode[code])
    : Number(sourceRow.slThucDat || 0);
}

function getAllowedPrefixes(staffList) {
  return new Set(
    staffList
      .map(staff => String(staff.prefix || '').trim().toUpperCase())
      .filter(Boolean)
  );
}

function pruneRowsByStaffList(rowsByTab, staffList) {
  const allowedPrefixes = getAllowedPrefixes(staffList);
  let removedCount = 0;
  let changed = false;

  const nextRowsByTab = Object.fromEntries(
    Object.entries(rowsByTab).map(([tabId, tabRows]) => {
      const filteredRows = tabRows.filter(row => {
        const prefix = String(row.ma || '').trim().charAt(0).toUpperCase();
        const keep = allowedPrefixes.has(prefix);
        if (!keep) removedCount += 1;
        return keep;
      });

      if (filteredRows.length !== tabRows.length) {
        changed = true;
      }

      return [tabId, filteredRows];
    })
  );

  return { nextRowsByTab, removedCount, changed };
}

function mergeSourceRowsWithLocal(sourceRows, localRows, hiddenCodes, config, actualQtyByCode = {}) {
  const hidden = new Set(hiddenCodes.map(normalizeCode));
  const localByCode = new Map(localRows.map(row => [normalizeCode(row.ma), row]));

  const mergedSourceRows = sourceRows
    .filter(row => !hidden.has(normalizeCode(row.ma)))
    .map(sourceRow => {
      const localRow = localByCode.get(normalizeCode(sourceRow.ma));
      const overrides = LOCAL_OVERRIDE_FIELDS.reduce((acc, field) => {
        if (localRow && Object.prototype.hasOwnProperty.call(localRow, field)) {
          acc[field] = localRow[field];
        }
        return acc;
      }, {});

      return recalculateRow({
        ...sourceRow,
        ...overrides,
        ma: sourceRow.ma,
        cpo: Number(sourceRow.cpo || 0),
        slKhachDat: Number(sourceRow.slKhachDat || 0),
        slThucDat: getRowActualQty(sourceRow, actualQtyByCode),
        tiLeHoan: Number(sourceRow.tiLeHoan || 0),
        daNhan: Number(sourceRow.daNhan || 0),
        dangHoan: Number(sourceRow.dangHoan || 0),
        daHoan: Number(sourceRow.daHoan || 0),
        tongDaShip: Number(sourceRow.tongDaShip || 0),
        orderSizeS: overrides.orderSizeS ?? '',
        orderSizeM: overrides.orderSizeM ?? '',
        orderSizeL: overrides.orderSizeL ?? '',
        orderSizeXL: overrides.orderSizeXL ?? '',
        orderSizeFZ: overrides.orderSizeFZ ?? ''
      }, config);
    });

  return mergedSourceRows;
}

function migrateDealStopRows(rows = [], currentVersion = 1) {
  if (currentVersion >= DEAL_STOP_DATA_VERSION) return rows;

  return rows.map(row => ({
    ...row,
    orderSizeS: '',
    orderSizeM: '',
    orderSizeL: '',
    orderSizeXL: '',
    orderSizeFZ: ''
  }));
}

export default function DealStopOrders() {
  const { config, setConfig } = useChuaCoConfig();
  const colorRules = useColorRules();
  const activeTab = TAB_OPTIONS[0].id;
  const storedDataVersion = loadDealStopDataVersion();

  const [staffList, setStaffList] = React.useState(() => loadStaffList());
  const [actualQtyByCode, setActualQtyByCode] = React.useState(() => loadDealStopActualQtyByCode());
  const [rowsByTab, setRowsByTab] = React.useState(() => ({
    [activeTab]: migrateDealStopRows(
      loadRowsByTab(activeTab, []).filter(row => Number(row.slKhachDat || 0) >= 2),
      storedDataVersion
    )
  }));
  const [hiddenCodes, setHiddenCodes] = React.useState(() => loadHiddenCodes());
  const [searchInput, setSearchInput] = React.useState('');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sorting, setSorting] = React.useState([]);
  const [columnVisibility, setColumnVisibility] = React.useState(() => loadColumnVisibility());
  const [groupExpanded, setGroupExpanded] = React.useState(() => getDefaultExpanded(staffList));
  const [editingCell, setEditingCell] = React.useState(null);
  const [editValue, setEditValue] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [staffOpen, setStaffOpen] = React.useState(false);
  const [addOrderOpen, setAddOrderOpen] = React.useState(false);
  const [deleteTargetRow, setDeleteTargetRow] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);
  const [exportDone, setExportDone] = React.useState(false);
  const [importingActualQty, setImportingActualQty] = React.useState(false);
  const [sourceRows, setSourceRows] = React.useState([]);
  const actualQtyInputRef = React.useRef(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    saveColumnVisibility(columnVisibility);
  }, [columnVisibility]);

  React.useEffect(() => {
    saveStaffList(staffList);
  }, [staffList]);

  React.useEffect(() => {
    saveHiddenCodes(hiddenCodes);
  }, [hiddenCodes]);

  React.useEffect(() => {
    saveDealStopActualQtyByCode(actualQtyByCode);
  }, [actualQtyByCode]);

  React.useEffect(() => {
    if (storedDataVersion < DEAL_STOP_DATA_VERSION) {
      saveDealStopDataVersion(DEAL_STOP_DATA_VERSION);
      Object.entries(rowsByTab).forEach(([tabId, tabRows]) => {
        saveRowsByTab(tabId, tabRows);
      });
    }
  }, [rowsByTab, storedDataVersion]);

  React.useEffect(() => {
    setRowsByTab(current => {
      const { nextRowsByTab, changed } = pruneRowsByStaffList(current, staffList);
      const filteredByQtyRows = Object.fromEntries(
        Object.entries(nextRowsByTab).map(([tabId, tabRows]) => [
          tabId,
          tabRows.filter(row => Number(row.slKhachDat || 0) >= 2)
        ])
      );
      const qtyChanged = Object.entries(filteredByQtyRows).some(([tabId, tabRows]) => (
        tabRows.length !== (nextRowsByTab[tabId] || []).length
      ));

      if (!changed && !qtyChanged) return current;

      Object.entries(filteredByQtyRows).forEach(([tabId, tabRows]) => {
        saveRowsByTab(tabId, tabRows);
      });

      return filteredByQtyRows;
    });
  }, [staffList]);

  const loadSourceRows = React.useCallback(async () => {
    try {
      const result = await api('GET', '/orders/deal-stop-rows', null, { timeoutMs: 180000 });
      const sourceRows = Array.isArray(result.rows) ? result.rows : [];
      setSourceRows(sourceRows);

      setRowsByTab(current => {
        const mergedRows = mergeSourceRowsWithLocal(sourceRows, current[activeTab] || [], hiddenCodes, config, actualQtyByCode);
        const next = { ...current, [activeTab]: mergedRows };
        saveRowsByTab(activeTab, mergedRows);
        return next;
      });
    } catch (error) {
      toast.error(`Không lấy được dữ liệu Đơn Hàng: ${error.message}`);
    }
  }, [activeTab, actualQtyByCode, config, hiddenCodes]);

  React.useEffect(() => {
    loadSourceRows();
  }, [loadSourceRows]);

  const rows = React.useMemo(
    () => rowsByTab[activeTab] || [],
    [rowsByTab, activeTab]
  );
  const orderLookupByCode = React.useMemo(
    () => Object.fromEntries(sourceRows.map(row => [
      normalizeCode(row.ma),
      {
        ...row,
        slThucDat: getRowActualQty(row, actualQtyByCode)
      }
    ])),
    [actualQtyByCode, sourceRows]
  );
  const actualQtyImportCount = React.useMemo(
    () => Object.keys(actualQtyByCode || {}).length,
    [actualQtyByCode]
  );

  const {
    table,
    sortedRows,
    groupedRows,
    visibleColumns,
    filteredSummary,
    stats
  } = useOrderTable({
    rows,
    staffList,
    searchTerm,
    sorting,
    onSortingChange: setSorting,
    columnVisibility,
    onColumnVisibilityChange: setColumnVisibility
  });

  React.useEffect(() => {
    setGroupExpanded(current => {
      const next = {};
      staffList.forEach(staff => {
        next[staff.prefix] = typeof current[staff.prefix] === 'undefined' ? false : current[staff.prefix];
      });
      return next;
    });
  }, [staffList]);

  const updateRows = React.useCallback((updater) => {
    setRowsByTab(current => {
      const nextRows = typeof updater === 'function' ? updater(current[activeTab] || []) : updater;
      const next = { ...current, [activeTab]: nextRows };
      saveRowsByTab(activeTab, nextRows);
      return next;
    });
  }, [activeTab]);

  const applyActualQtyByCode = React.useCallback((nextActualQtyByCode) => {
    setActualQtyByCode(nextActualQtyByCode);
    saveDealStopActualQtyByCode(nextActualQtyByCode);

    setRowsByTab(current => {
      const currentRows = current[activeTab] || [];
      const nextRows = sourceRows.length
        ? mergeSourceRowsWithLocal(sourceRows, currentRows, hiddenCodes, config, nextActualQtyByCode)
        : currentRows.map(row => {
            const code = normalizeCode(row.ma);
            if (!hasImportedActualQty(nextActualQtyByCode, code)) {
              return recalculateRow(row, config);
            }

            return recalculateRow({
              ...row,
              slThucDat: toSafeNumber(nextActualQtyByCode[code])
            }, config);
          });

      const next = { ...current, [activeTab]: nextRows };
      saveRowsByTab(activeTab, nextRows);
      return next;
    });
  }, [activeTab, config, hiddenCodes, sourceRows]);

  const importActualQtyFile = React.useCallback(async (file) => {
    if (!file || importingActualQty) return;
    setImportingActualQty(true);

    try {
      const nextActualQtyByCode = await readActualQtyImportFile(file);
      const importedCount = Object.keys(nextActualQtyByCode).length;
      if (!importedCount) {
        toast.error('File không có dòng hợp lệ. Cần 2 cột: mã SP và số lượng thực đặt.');
        return;
      }

      applyActualQtyByCode(nextActualQtyByCode);
      toast.success(`Đã import SL Thực Đặt cho ${importedCount.toLocaleString('vi-VN')} mã SP`);
    } catch (error) {
      toast.error(`Import SL Thực Đặt lỗi: ${error.message}`);
    } finally {
      setImportingActualQty(false);
    }
  }, [applyActualQtyByCode, importingActualQty]);

  const clearActualQtyImport = React.useCallback(() => {
    applyActualQtyByCode({});
    toast.success('Đã xóa dữ liệu import SL Thực Đặt');
  }, [applyActualQtyByCode]);

  const handleDirectInputChange = React.useCallback((rowId, columnId, nextValue) => {
    updateRows(currentRows => currentRows.map(row => (
      row.id !== rowId
        ? row
        : recalculateRow({
            ...row,
            [columnId]: String(nextValue ?? '')
          }, config)
    )));
  }, [config, updateRows]);

  const startEdit = (rowId, columnId, currentValue) => {
    setEditingCell({ rowId, columnId });
    if (PERCENT_COLUMNS.includes(columnId)) {
      setEditValue(String(Math.round(Number(currentValue || 0) * 100)));
      return;
    }
    setEditValue(String(currentValue ?? ''));
  };

  const commitEdit = React.useCallback((targetCell = null) => {
    if (!editingCell) return;

    updateRows(currentRows => currentRows.map(row => {
      if (row.id !== editingCell.rowId) return row;

      let nextValue = editValue;
      if (DIRECT_INPUT_COLUMNS.has(editingCell.columnId)) {
        nextValue = String(editValue ?? '');
      } else if (NUMERIC_COLUMNS.includes(editingCell.columnId)) {
        nextValue = toSafeNumber(editValue);
      } else if (editingCell.columnId === 'tiLeHoan') {
        nextValue = parsePercentInput(editValue);
      }

      return recalculateRow({
        ...row,
        [editingCell.columnId]: nextValue
      }, config);
    }));

    setEditingCell(targetCell);
    if (targetCell) {
      const targetRow = sortedRows.find(row => row.id === targetCell.rowId);
      const nextValue = targetRow?.[targetCell.columnId];
      if (PERCENT_COLUMNS.includes(targetCell.columnId)) {
        setEditValue(String(Math.round(Number(nextValue || 0) * 100)));
      } else {
        setEditValue(String(nextValue ?? ''));
      }
    } else {
      setEditValue('');
    }
  }, [config, editValue, editingCell, sortedRows, updateRows]);

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const handleEditKeyDown = (event) => {
    if (!editingCell) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const nextCell = getNextEditableCell(visibleColumns, sortedRows, editingCell.rowId, editingCell.columnId);
      commitEdit(nextCell);
    }
  };

  const handleSaveConfig = (nextConfig) => {
    setConfig(nextConfig);
    setRowsByTab(current => {
      const next = Object.fromEntries(
        Object.entries(current).map(([tabId, tabRows]) => [
          tabId,
          tabRows.map(row => recalculateRow(row, nextConfig))
        ])
      );
      Object.entries(next).forEach(([tabId, tabRows]) => saveRowsByTab(tabId, tabRows));
      return next;
    });
    toast.success('Đã lưu cấu hình và cập nhật bảng');
  };

  const handleSaveStaff = (nextStaffList) => {
    const { nextRowsByTab, removedCount } = pruneRowsByStaffList(rowsByTab, nextStaffList);

    setStaffList(nextStaffList);
    setRowsByTab(nextRowsByTab);
    Object.entries(nextRowsByTab).forEach(([tabId, tabRows]) => {
      saveRowsByTab(tabId, tabRows);
    });

    if (removedCount > 0) {
      toast.success(`Đã lưu danh sách nhân viên và xóa ${removedCount} mã không còn prefix hợp lệ`);
      return;
    }

    toast.success('Đã lưu danh sách nhân viên');
  };

  const handleAddOrder = (nextRow) => {
    const code = normalizeCode(nextRow.ma);
    if (code) {
      setHiddenCodes(current => current.filter(item => normalizeCode(item) !== code));
    }

    updateRows(currentRows => [nextRow, ...currentRows.filter(row => normalizeCode(row.ma) !== code)]);
    const prefix = String(nextRow.ma || '').trim().charAt(0).toUpperCase();
    if (prefix) {
      setGroupExpanded(current => ({ ...current, [prefix]: true }));
    }
    toast.success('Đã thêm mã mới');
  };

  const handleDeleteRow = (row) => {
    setDeleteTargetRow(row);
  };

  const confirmDeleteRow = () => {
    if (!deleteTargetRow) return;

    const code = normalizeCode(deleteTargetRow.ma);
    if (code) {
      setHiddenCodes(current => [...new Set([...current, code])]);
    }

    updateRows(currentRows => currentRows.filter(row => row.id !== deleteTargetRow.id));
    toast.success(`Đã xóa mã ${deleteTargetRow.ma}`);
    setDeleteTargetRow(null);
  };

  const handleToggleColumn = (columnId) => {
    setColumnVisibility(current => ({
      ...current,
      [columnId]: current[columnId] === false
    }));
  };

  const handleRefreshFilters = () => {
    setSearchInput('');
    setSearchTerm('');
    setSorting([]);
    setGroupExpanded(getDefaultExpanded(staffList));
    cancelEdit();
    loadSourceRows();
    toast('Đã làm mới bộ lọc');
  };

  const handleExport = async () => {
    setExporting(true);
    setExportDone(false);
    try {
      exportOrdersToExcel({
        groupedRows,
        visibility: columnVisibility,
        filenameDate: new Date()
      });
      setExportDone(true);
      toast.success('Xuất Excel thành công');
      window.setTimeout(() => setExportDone(false), 1500);
    } catch (error) {
      toast.error(error.message || 'Xuất Excel thất bại');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="page-deal-stop-orders">
      <StatsCards stats={stats} />

      <div className="deal-toolbar-card">
        <SearchBar value={searchInput} onChange={setSearchInput} />
        <ColumnToggle
          columns={ORDER_COLUMN_CONFIG}
          visibility={columnVisibility}
          onToggle={handleToggleColumn}
        />
        <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setSettingsOpen(true)}>
          Cấu hình tỉ lệ
        </button>
        <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setStaffOpen(true)}>
          Nhân viên
        </button>
        <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setAddOrderOpen(true)}>
          Thêm mã mới
        </button>
        <button
          type="button"
          className="deal-btn deal-btn-ghost"
          onClick={() => actualQtyInputRef.current?.click()}
          disabled={importingActualQty}
          title="File Excel/CSV 2 cột: mã SP và số lượng thực đặt"
        >
          {importingActualQty ? 'Đang import SL TĐ' : 'Import SL TĐ'}
        </button>
        <input
          ref={actualQtyInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          disabled={importingActualQty}
          style={{ display: 'none' }}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            importActualQtyFile(file);
          }}
        />
        {actualQtyImportCount > 0 ? (
          <button
            type="button"
            className="deal-btn deal-btn-ghost"
            onClick={clearActualQtyImport}
            disabled={importingActualQty}
            title="Xóa dữ liệu import và quay lại SL Thực Đặt từ Đặt Hàng"
          >
            Xóa SL TĐ ({actualQtyImportCount.toLocaleString('vi-VN')})
          </button>
        ) : null}
        <button type="button" className="deal-btn deal-btn-ghost" onClick={handleRefreshFilters}>
          Làm mới
        </button>
        <ExportButton loading={exporting} done={exportDone} onClick={handleExport} />
      </div>

      <OrderTable
        groupedRows={groupedRows}
        visibleColumns={visibleColumns}
        table={table}
        groupExpanded={groupExpanded}
        onToggleGroup={(prefix) => setGroupExpanded(current => ({ ...current, [prefix]: current[prefix] === false }))}
        editingCell={editingCell}
        editValue={editValue}
        onStartEdit={startEdit}
        onEditChange={setEditValue}
        onEditKeyDown={handleEditKeyDown}
        onEditBlur={() => commitEdit(null)}
        searchTerm={searchTerm}
        colorRules={colorRules}
        summary={filteredSummary}
        onDeleteRow={handleDeleteRow}
        onDirectInputChange={handleDirectInputChange}
      />

      <ChuaCoSettings
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveConfig}
      />

      <StaffSettings
        open={staffOpen}
        staffList={staffList}
        onClose={() => setStaffOpen(false)}
        onSave={handleSaveStaff}
      />

      <AddOrderModal
        open={addOrderOpen}
        staffList={staffList}
        config={config}
        orderLookupByCode={orderLookupByCode}
        onClose={() => setAddOrderOpen(false)}
        onAdd={handleAddOrder}
      />

      <ConfirmDialog
        open={Boolean(deleteTargetRow)}
        title="Xóa dòng"
        message={deleteTargetRow ? `Xóa mã ${deleteTargetRow.ma}?` : ''}
        confirmText="Xóa"
        cancelText="Hủy"
        onConfirm={confirmDeleteRow}
        onCancel={() => setDeleteTargetRow(null)}
      />
    </div>
  );
}
