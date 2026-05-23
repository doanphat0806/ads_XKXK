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
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_STAFF_LIST,
  EDITABLE_COLUMNS,
  NUMERIC_COLUMNS,
  ORDER_COLUMN_CONFIG,
  PERCENT_COLUMNS,
  TAB_OPTIONS
} from '../types/order.types';
import { DEFAULT_CONFIG } from '../types/chuaCoConfig.types';
import { parsePercentInput, recalculateRow, toSafeNumber } from '../utils/calculations';
import {
  loadChuaCoConfig,
  loadColumnVisibility,
  loadDealStopActualQtyByCode,
  loadDealStopDataVersion,
  loadHiddenCodes,
  loadRowsByTab,
  loadStaffList
} from '../utils/configStorage';
import { exportOrdersToExcel } from '../utils/excelExport';
import { formatCompactInt, formatCurrency, formatPercent } from '../utils/formatters';

const DEAL_STOP_STATE_API = '/deal-stop/state';
const DEAL_STOP_DATA_VERSION = 4;
const CAMP_ALERT_CPO_LIMIT = 100000;
const CAMP_ALERT_RETURN_LIMIT = 0.37;
const CAMP_ALERT_VISIBLE_LIMIT = 12;
const LOCAL_OVERRIDE_FIELDS = [
  'id',
  'ghiChu',
  'slKhachDat',
  'tiLeHoan',
  'orderSizeS',
  'orderSizeM',
  'orderSizeL',
  'orderSizeXL',
  'orderSizeFZ',
  'dangGuiHang',
  'tongDaShip'
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
      const overrideNumber = (field, fallback) => (
        Object.prototype.hasOwnProperty.call(overrides, field)
          ? toSafeNumber(overrides[field])
          : Number(fallback || 0)
      );

      return recalculateRow({
        ...sourceRow,
        ...overrides,
        ma: sourceRow.ma,
        cpo: Number(sourceRow.cpo || 0),
        campaignAmount: Number(sourceRow.campaignAmount || 0),
        hasCampaign: Boolean(sourceRow.hasCampaign),
        slKhachDat: overrideNumber('slKhachDat', sourceRow.slKhachDat),
        slThucDat: getRowActualQty(sourceRow, actualQtyByCode),
        tiLeHoan: overrideNumber('tiLeHoan', sourceRow.tiLeHoan),
        daNhan: Number(sourceRow.daNhan || 0),
        dangHoan: Number(sourceRow.dangHoan || 0),
        daHoan: Number(sourceRow.daHoan || 0),
        dangGuiHang: overrideNumber('dangGuiHang', sourceRow.dangGuiHang),
        tongDaShip: overrideNumber('tongDaShip', sourceRow.tongDaShip),
        orderSizeS: overrides.orderSizeS ?? '',
        orderSizeM: overrides.orderSizeM ?? '',
        orderSizeL: overrides.orderSizeL ?? '',
        orderSizeXL: overrides.orderSizeXL ?? '',
        orderSizeFZ: overrides.orderSizeFZ ?? ''
      }, config);
    });

  return mergedSourceRows;
}

function isCampAlertRow(row = {}) {
  const hasCampaignSignal = (
    Object.prototype.hasOwnProperty.call(row, 'campaignAmount') ||
    Object.prototype.hasOwnProperty.call(row, 'hasCampaign')
  );

  return (
    hasCampaignSignal &&
    Boolean(String(row.ma || '').trim()) &&
    Number(row.campaignAmount || 0) <= 0 &&
    Number(row.cpo || 0) < CAMP_ALERT_CPO_LIMIT &&
    Number(row.tiLeHoan || 0) <= CAMP_ALERT_RETURN_LIMIT
  );
}

function formatCampAlertCpo(value) {
  const cpo = Number(value || 0);
  return cpo > 0 ? formatCurrency(cpo) : 'Chưa có CPO';
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

function getLocalDealStopState(activeTab) {
  const storedDataVersion = loadDealStopDataVersion();
  return {
    dataVersion: DEAL_STOP_DATA_VERSION,
    config: loadChuaCoConfig(),
    columnVisibility: loadColumnVisibility(),
    staffList: loadStaffList(),
    hiddenCodes: loadHiddenCodes(),
    actualQtyByCode: loadDealStopActualQtyByCode(),
    rowsByTab: {
      [activeTab]: migrateDealStopRows(
        loadRowsByTab(activeTab, []).filter(row => Number(row.slKhachDat || 0) >= 2),
        storedDataVersion
      )
    }
  };
}

function normalizeRowsByTab(value, activeTab) {
  const rowsByTab = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rows = Array.isArray(rowsByTab[activeTab]) ? rowsByTab[activeTab] : [];
  return {
    ...rowsByTab,
    [activeTab]: rows.filter(row => Number(row.slKhachDat || 0) >= 2)
  };
}

function normalizeDealStopState(state = {}, activeTab) {
  return {
    dataVersion: Number(state.dataVersion || DEAL_STOP_DATA_VERSION) || DEAL_STOP_DATA_VERSION,
    config: state.config && typeof state.config === 'object' ? state.config : DEFAULT_CONFIG,
    columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY, ...(state.columnVisibility || {}) },
    staffList: Array.isArray(state.staffList) && state.staffList.length ? state.staffList : DEFAULT_STAFF_LIST,
    hiddenCodes: Array.isArray(state.hiddenCodes) ? state.hiddenCodes : [],
    actualQtyByCode: state.actualQtyByCode && typeof state.actualQtyByCode === 'object' && !Array.isArray(state.actualQtyByCode)
      ? state.actualQtyByCode
      : {},
    rowsByTab: normalizeRowsByTab(state.rowsByTab, activeTab)
  };
}

function hasPersistedDealStopState(state = {}, activeTab) {
  return Boolean(
    state?.config?.tiers ||
    Object.keys(state?.columnVisibility || {}).length ||
    (Array.isArray(state?.staffList) && state.staffList.length) ||
    (Array.isArray(state?.hiddenCodes) && state.hiddenCodes.length) ||
    Object.keys(state?.actualQtyByCode || {}).length ||
    (Array.isArray(state?.rowsByTab?.[activeTab]) && state.rowsByTab[activeTab].length)
  );
}

export default function DealStopOrders() {
  const { config, replaceConfig } = useChuaCoConfig();
  const colorRules = useColorRules();
  const activeTab = TAB_OPTIONS[0].id;
  const initialState = React.useMemo(() => getLocalDealStopState(activeTab), [activeTab]);

  const [staffList, setStaffList] = React.useState(() => initialState.staffList);
  const [actualQtyByCode, setActualQtyByCode] = React.useState(() => initialState.actualQtyByCode);
  const [rowsByTab, setRowsByTab] = React.useState(() => initialState.rowsByTab);
  const [hiddenCodes, setHiddenCodes] = React.useState(() => initialState.hiddenCodes);
  const [searchInput, setSearchInput] = React.useState('');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sorting, setSorting] = React.useState([]);
  const [columnVisibility, setColumnVisibility] = React.useState(() => initialState.columnVisibility);
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
  const [stateReady, setStateReady] = React.useState(false);
  const actualQtyInputRef = React.useRef(null);
  const latestStateRef = React.useRef(initialState);
  const saveTimerRef = React.useRef(null);
  const saveStateRequestRef = React.useRef(Promise.resolve());

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadSharedState() {
      try {
        const data = await api('GET', DEAL_STOP_STATE_API, null, { timeoutMs: 60000 });
        const remoteState = data?.state || {};
        const nextState = normalizeDealStopState(
          hasPersistedDealStopState(remoteState, activeTab) ? remoteState : initialState,
          activeTab
        );
        if (cancelled) return;

        replaceConfig(nextState.config);
        setStaffList(nextState.staffList);
        setActualQtyByCode(nextState.actualQtyByCode);
        setRowsByTab(nextState.rowsByTab);
        setHiddenCodes(nextState.hiddenCodes);
        setColumnVisibility(nextState.columnVisibility);
        latestStateRef.current = nextState;
        setStateReady(true);

        if (!hasPersistedDealStopState(remoteState, activeTab) && hasPersistedDealStopState(initialState, activeTab)) {
          await api('PUT', DEAL_STOP_STATE_API, { state: nextState }, { timeoutMs: 60000 });
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`Không tải được dữ liệu Đóng deal dùng chung: ${error.message}`);
          setStateReady(false);
        }
      }
    }

    loadSharedState();
    return () => {
      cancelled = true;
    };
  }, [activeTab, initialState, replaceConfig]);

  React.useEffect(() => {
    latestStateRef.current = normalizeDealStopState({
      dataVersion: DEAL_STOP_DATA_VERSION,
      config,
      columnVisibility,
      staffList,
      hiddenCodes,
      actualQtyByCode,
      rowsByTab
    }, activeTab);
  }, [activeTab, actualQtyByCode, columnVisibility, config, hiddenCodes, rowsByTab, staffList]);

  const saveSharedState = React.useCallback((state, { silent = false } = {}) => {
    const nextState = normalizeDealStopState(state, activeTab);
    latestStateRef.current = nextState;
    saveStateRequestRef.current = saveStateRequestRef.current
      .catch(() => {})
      .then(() => api('PUT', DEAL_STOP_STATE_API, { state: nextState }, { timeoutMs: 60000 }))
      .catch(error => {
        if (!silent) toast.error(`Lưu dữ liệu Đóng deal lỗi: ${error.message}`);
      });
    return saveStateRequestRef.current;
  }, [activeTab]);

  const scheduleSaveSharedState = React.useCallback(() => {
    if (!stateReady) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveSharedState(latestStateRef.current, { silent: true });
    }, 600);
  }, [saveSharedState, stateReady]);

  React.useEffect(() => {
    scheduleSaveSharedState();
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [actualQtyByCode, columnVisibility, config, hiddenCodes, rowsByTab, scheduleSaveSharedState, staffList]);

  React.useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveSharedState(latestStateRef.current, { silent: true });
    }
  }, [saveSharedState]);

  React.useEffect(() => {
    if (!stateReady) return;
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

      return filteredByQtyRows;
    });
  }, [staffList, stateReady]);

  const loadSourceRows = React.useCallback(async () => {
    if (!stateReady) return;
    try {
      const result = await api('GET', '/orders/deal-stop-rows', null, { timeoutMs: 180000 });
      const sourceRows = Array.isArray(result.rows) ? result.rows : [];
      setSourceRows(sourceRows);

      setRowsByTab(current => {
        const mergedRows = mergeSourceRowsWithLocal(sourceRows, current[activeTab] || [], hiddenCodes, config, actualQtyByCode);
        return { ...current, [activeTab]: mergedRows };
      });
    } catch (error) {
      toast.error(`Không lấy được dữ liệu Đơn Hàng: ${error.message}`);
    }
  }, [activeTab, actualQtyByCode, config, hiddenCodes, stateReady]);

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
  const campAlertRows = React.useMemo(
    () => rows
      .filter(isCampAlertRow)
      .sort((a, b) => {
        const returnDiff = Number(a.tiLeHoan || 0) - Number(b.tiLeHoan || 0);
        if (returnDiff !== 0) return returnDiff;

        const cpoDiff = Number(a.cpo || 0) - Number(b.cpo || 0);
        if (cpoDiff !== 0) return cpoDiff;

        return Number(b.slKhachDat || 0) - Number(a.slKhachDat || 0);
      }),
    [rows]
  );
  const visibleCampAlertRows = React.useMemo(
    () => campAlertRows.slice(0, CAMP_ALERT_VISIBLE_LIMIT),
    [campAlertRows]
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
      return { ...current, [activeTab]: nextRows };
    });
  }, [activeTab]);

  const applyActualQtyByCode = React.useCallback((nextActualQtyByCode) => {
    setActualQtyByCode(nextActualQtyByCode);

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

      return { ...current, [activeTab]: nextRows };
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
    replaceConfig(nextConfig);
    setRowsByTab(current => {
      const next = Object.fromEntries(
        Object.entries(current).map(([tabId, tabRows]) => [
          tabId,
          tabRows.map(row => recalculateRow(row, nextConfig))
        ])
      );
      return next;
    });
    toast.success('Đã lưu cấu hình và cập nhật bảng');
  };

  const handleSaveStaff = (nextStaffList) => {
    const { nextRowsByTab, removedCount } = pruneRowsByStaffList(rowsByTab, nextStaffList);

    setStaffList(nextStaffList);
    setRowsByTab(nextRowsByTab);

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

  const handleFilterCampAlertCode = React.useCallback((code) => {
    const nextSearch = String(code || '').trim();
    setSearchInput(nextSearch);
    setSearchTerm(nextSearch);
  }, []);

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
        <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setSettingsOpen(true)} disabled={!stateReady}>
          Cấu hình tỉ lệ
        </button>
        <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setStaffOpen(true)} disabled={!stateReady}>
          Nhân viên
        </button>
        <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setAddOrderOpen(true)} disabled={!stateReady}>
          Thêm mã mới
        </button>
        <button
          type="button"
          className="deal-btn deal-btn-ghost"
          onClick={() => actualQtyInputRef.current?.click()}
          disabled={importingActualQty || !stateReady}
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
            disabled={importingActualQty || !stateReady}
            title="Xóa dữ liệu import và quay lại SL Thực Đặt từ Đặt Hàng"
          >
            Xóa SL TĐ ({actualQtyImportCount.toLocaleString('vi-VN')})
          </button>
        ) : null}
        <button type="button" className="deal-btn deal-btn-ghost" onClick={handleRefreshFilters} disabled={!stateReady}>
          Làm mới
        </button>
        <ExportButton loading={exporting} done={exportDone} onClick={handleExport} />
      </div>

      {campAlertRows.length > 0 ? (
        <section className="deal-camp-alert" aria-label="Thong bao ma nen len camp">
          <div className="deal-camp-alert-copy">
            <div className="deal-camp-alert-title">Mã nên lên camp ({campAlertRows.length})</div>
            <div className="deal-camp-alert-subtitle">Hoàn thấp hoặc chưa có hoàn, CPO dưới 100k, chưa có chi tiêu camp.</div>
          </div>
          <div className="deal-camp-alert-list">
            {visibleCampAlertRows.map(row => (
              <button
                key={row.id || row.ma}
                type="button"
                className="deal-camp-alert-chip"
                onClick={() => handleFilterCampAlertCode(row.ma)}
                title={`Lọc mã ${row.ma}`}
              >
                <span className="deal-camp-alert-code">{row.ma}</span>
                <span>{formatCampAlertCpo(row.cpo)}</span>
                <span>Hoàn {formatPercent(row.tiLeHoan)}</span>
                <span>KĐ {formatCompactInt(row.slKhachDat)}</span>
              </button>
            ))}
            {campAlertRows.length > visibleCampAlertRows.length ? (
              <span className="deal-camp-alert-more">
                +{formatCompactInt(campAlertRows.length - visibleCampAlertRows.length)} mã
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

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
