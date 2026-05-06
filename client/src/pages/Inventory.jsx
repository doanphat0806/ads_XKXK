import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api, dateTimeString, formatNumber } from '../lib/api';

const SIZE_COLUMNS = ['S', 'M', 'L', 'XL', 'FZ'];

export default function Inventory() {
  const barcodeRef = useRef(null);
  const [items, setItems] = useState([]);
  const [sheetItems, setSheetItems] = useState([]);
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [quickPriceCode, setQuickPriceCode] = useState('');
  const [quickSalePrice, setQuickSalePrice] = useState('');
  const [search, setSearch] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'desc' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickPriceSaving, setQuickPriceSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const aggregatedSheetItems = useMemo(() => aggregateSheetItems(sheetItems), [sheetItems]);

  const totalItemCount = useMemo(() => aggregatedSheetItems.length, [aggregatedSheetItems]);
  const totalQuantity = useMemo(
    () => aggregatedSheetItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [aggregatedSheetItems]
  );
  const inventoryItemsByBarcode = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      if (!map.has(item.barcode)) map.set(item.barcode, item);
    });
    return map;
  }, [items]);
  const sheetRows = useMemo(
    () => aggregatedSheetItems.map(row => buildSheetRow(row, inventoryItemsByBarcode)),
    [aggregatedSheetItems, inventoryItemsByBarcode]
  );
  const sortedSheetRows = useMemo(
    () => sortInventoryRows(sheetRows, sortConfig),
    [sheetRows, sortConfig]
  );
  const pageSize = 500;
  const totalPages = Math.max(1, Math.ceil(sortedSheetRows.length / pageSize));
  const pagedRows = useMemo(
    () => sortedSheetRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedSheetRows, currentPage]
  );

  const loadInventory = async (nextSearch = search, nextWarehouseSearch = warehouseSearch) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextSearch.trim()) params.set('search', nextSearch.trim());
      if (nextWarehouseSearch.trim()) params.set('warehouse', nextWarehouseSearch.trim());
      const [inventoryData, sheetData] = await Promise.all([
        api('GET', '/inventory'),
        api('GET', `/inventory/sheet-rows${params.toString() ? `?${params}` : ''}`)
      ]);
      setItems(inventoryData.items || []);
      setSheetItems(sheetData.rows || []);
      setCurrentPage(1);
    } catch (error) {
      toast.error(`Loi tai kho: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory('');
    barcodeRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = async () => {
    const code = barcode.trim();
    const qty = Number(quantity || 1);
    if (!code || saving) return;
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error('So luong phai lon hon 0');
      return;
    }

    setSaving(true);
    try {
      const data = await api('POST', '/inventory/scan', {
        barcode: code,
        quantity: qty,
        name
      });
      setBarcode('');
      setName('');
      setLastScan(data.item);
      await loadInventory(search, warehouseSearch);
      toast.success(`Da cong ${formatNumber(qty)} vao ${code}`);
    } catch (error) {
      toast.error(`Loi quet ma: ${error.message}`);
    } finally {
      setSaving(false);
      barcodeRef.current?.focus();
    }
  };

  const handleBarcodeKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleScan();
    }
  };

  const importFromSheet = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const data = await api('POST', '/inventory/import-sheet');
      setItems(data.items || []);
      await loadInventory(search, warehouseSearch);
      toast.success(`Da nhap ${formatNumber(data.imported || 0)} ma hang tu Google Sheet`);
    } catch (error) {
      toast.error(`Loi nhap Sheet: ${error.message}`);
    } finally {
      setImporting(false);
      barcodeRef.current?.focus();
    }
  };

  const applyQuickSalePrice = async () => {
    const productCode = quickPriceCode.trim().toUpperCase();
    const salePrice = quickSalePrice.trim();
    if (!productCode || quickPriceSaving) return;

    setQuickPriceSaving(true);
    try {
      const data = await api('POST', '/inventory/price-by-code', { productCode, salePrice });
      setItems(current => current.map(item => (
        data.items.find(updated => updated._id === item._id) || item
      )));
      setQuickPriceCode('');
      setQuickSalePrice('');
      toast.success(`Da cap nhat gia cho ${formatNumber(data.updated || 0)} dong`);
    } catch (error) {
      toast.error(`Loi cap nhat gia: ${error.message}`);
    } finally {
      setQuickPriceSaving(false);
    }
  };

  const updateItem = async (item, patch) => {
    try {
      const data = await api('PATCH', `/inventory/${item._id}`, patch);
      setItems(current => current.map(row => row._id === item._id ? data.item : row));
      toast.success('Da cap nhat kho');
    } catch (error) {
      toast.error(`Loi cap nhat: ${error.message}`);
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(`Xoa ma ${item.barcode} khoi kho?`)) return;
    try {
      await api('DELETE', `/inventory/${item._id}`);
      setItems(current => current.filter(row => row._id !== item._id));
      toast.success('Da xoa san pham');
    } catch (error) {
      toast.error(`Loi xoa: ${error.message}`);
    }
  };

  const toggleSort = (key) => {
    setCurrentPage(1);
    setSortConfig(current => {
      if (current.key === key) {
        return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
      }
      return { key, direction: 'desc' };
    });
  };

  return (
    <div id="page-inventory">
      <div className="stats-grid inventory-stats">
        <div className="stat g">
          <div className="stat-label">Tong ma hang</div>
          <div className="stat-value">{formatNumber(totalItemCount)}</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Tong ton kho</div>
          <div className="stat-value">{formatNumber(totalQuantity)}</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Lan quet gan nhat</div>
          <div className="stat-value stat-value-compact">{lastScan?.barcode || '-'}</div>
          <div className="stat-sub">{lastScan ? `Ton: ${formatNumber(lastScan.quantity)}` : 'Chua quet'}</div>
        </div>
      </div>

      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Quet ma vach nhap kho</div>
          <div className="inventory-header-actions">
            <button className="btn btn-ghost btn-sm" onClick={importFromSheet} disabled={importing}>
              {importing ? 'Dang nhap Sheet...' : 'Nhap tu Google Sheet'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => barcodeRef.current?.focus()}>
              Focus o quet
            </button>
          </div>
        </div>
        <div className="inventory-scan-panel">
          <div className="form-grid inventory-scan-grid">
            <div className="form-group">
              <label>Ma vach</label>
              <input
                ref={barcodeRef}
                value={barcode}
                onChange={event => setBarcode(event.target.value)}
                onKeyDown={handleBarcodeKeyDown}
                placeholder="Ban ma vach roi Enter"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>So luong moi lan quet</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={event => setQuantity(event.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Ten san pham neu co</label>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Co the bo trong"
              />
            </div>
            <div className="form-group inventory-scan-action">
              <button className="btn btn-g" onClick={handleScan} disabled={saving || !barcode.trim()}>
                {saving ? 'Dang cong...' : 'Cong vao kho'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Sua gia nhanh</div>
        </div>
        <div className="inventory-scan-panel">
          <div className="form-grid inventory-scan-grid">
            <div className="form-group">
              <label>Ma SP</label>
              <input
                value={quickPriceCode}
                onChange={event => setQuickPriceCode(event.target.value.toUpperCase())}
                placeholder="Nhap ma san pham"
              />
            </div>
            <div className="form-group">
              <label>Gia sale</label>
              <input
                value={quickSalePrice}
                onChange={event => setQuickSalePrice(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyQuickSalePrice();
                  }
                }}
                placeholder="Nhap gia sale"
              />
            </div>
            <div className="form-group inventory-scan-action">
              <button className="btn btn-g" onClick={applyQuickSalePrice} disabled={quickPriceSaving || !quickPriceCode.trim()}>
                {quickPriceSaving ? 'Dang cap nhat...' : 'Cap nhat gia'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Ton kho ({formatNumber(sortedSheetRows.length)} dong)</div>
          <div className="inventory-search">
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              onPaste={event => {
                const pastedText = event.clipboardData?.getData('text') || '';
                const nextValue = pastedText.trim();
                setSearch(nextValue);
                setTimeout(() => {
                  loadInventory(nextValue);
                }, 0);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') loadInventory(search, warehouseSearch);
              }}
              placeholder="Tim theo ten hoac ma"
            />
            <input
              value={warehouseSearch}
              onChange={event => setWarehouseSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') loadInventory(search, warehouseSearch);
              }}
              placeholder="Tim theo kho"
            />
            <button className="btn btn-ghost btn-sm" onClick={() => loadInventory(search)} disabled={loading}>
              Tim
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setSearch('');
              setWarehouseSearch('');
              loadInventory('', '');
            }}>
              Tat ca
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai kho...</p></div>
          ) : sheetRows.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co hang trong kho</p></div>
          ) : (
            <table className="tbl inventory-sheet-table">
              <thead>
                <tr>
                  <th rowSpan="2" className="inventory-sheet-col-warehouse">Ten kho</th>
                  <th rowSpan="2">Ma</th>
                  <th rowSpan="2">Mau</th>
                  <th colSpan="6">So luong</th>
                  <th rowSpan="2">Ten hang</th>
                  <th rowSpan="2">Gia</th>
                  <th rowSpan="2">Ton</th>
                  <th rowSpan="2">Cap nhat</th>
                  <th rowSpan="2" style={{ textAlign: 'right' }}>Thao tac</th>
                </tr>
                <tr>
                  {SIZE_COLUMNS.map(size => (
                    <th key={size}>
                      <button type="button" className="inventory-sort-btn" onClick={() => toggleSort(`size:${size}`)}>
                        {size}{renderSortMark(sortConfig, `size:${size}`)}
                      </button>
                    </th>
                  ))}
                  <th>
                    <button type="button" className="inventory-sort-btn" onClick={() => toggleSort('pendingQuantity')}>
                      SL chot{renderSortMark(sortConfig, 'pendingQuantity')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(row => (
                  <InventoryRow
                    key={row.rowKey}
                    row={row}
                    onUpdate={updateItem}
                    onDelete={deleteItem}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
        {sortedSheetRows.length > 0 && (
          <div className="inventory-pagination">
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(page => Math.max(1, page - 1))} disabled={currentPage <= 1}>
              &lt;
            </button>
            <div className="inventory-pagination-label">{currentPage} / {totalPages}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages}>
              &gt;
            </button>
            <span className="inventory-pagination-note">500 dong / trang</span>
          </div>
        )}
      </div>
    </div>
  );
}

const InventoryRow = React.memo(function InventoryRow({ row, onUpdate, onDelete }) {
  const item = row.editableItem;
  const [name, setName] = useState(item?.name || row.raw.name || '');
  const [salePrice, setSalePrice] = useState(item?.salePrice || row.raw.salePrice || '');
  const [quantity, setQuantity] = useState(item?.quantity ?? row.raw.quantity ?? 0);

  useEffect(() => {
    setName(item?.name || row.raw.name || '');
    setSalePrice(item?.salePrice || row.raw.salePrice || '');
    setQuantity(item?.quantity ?? row.raw.quantity ?? 0);
  }, [item, row.raw.name, row.raw.quantity, row.raw.salePrice]);

  return (
    <tr className="inventory-sheet-row">
      <td className="inventory-sheet-warehouse">{row.warehouseName}</td>
      <td className="inventory-sheet-code">{row.code}</td>
      <td className="inventory-sheet-color">{row.color || ''}</td>
      {SIZE_COLUMNS.map(size => (
        <td key={size} className="inventory-sheet-size-cell">{row.sizes[size] || ''}</td>
      ))}
      <td className="inventory-sheet-total">{row.totalQuantity}</td>
      <td>
        <input
          className="inventory-inline-input"
          value={name}
          onChange={event => setName(event.target.value)}
          onBlur={() => item && name !== (item.name || '') && onUpdate(item, { name })}
          placeholder="Ten hang"
          disabled={!item}
        />
      </td>
      <td className="inventory-sheet-price">
        <input
          className="inventory-qty-input"
          type="text"
          value={salePrice}
          onChange={event => setSalePrice(event.target.value)}
          onBlur={() => item && salePrice !== (item.salePrice || row.raw.salePrice || '') && onUpdate(item, { salePrice })}
          placeholder="Gia sale"
          disabled={!item}
        />
      </td>
      <td className="inventory-sheet-stock">
        <input
          className="inventory-qty-input"
          type="number"
          min="0"
          value={quantity}
          onChange={event => setQuantity(event.target.value)}
          onBlur={() => item && Number(quantity) !== Number(item.quantity || 0) && onUpdate(item, { quantity })}
          disabled={!item}
        />
      </td>
      <td className="inventory-sheet-updated">
        {item ? dateTimeString(item.updatedAt || item.createdAt) : ''}
      </td>
      <td className="inventory-sheet-action">
        {item ? (
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(item)}>Xoa</button>
        ) : null}
      </td>
    </tr>
  );
});

function buildSheetRow(rawRow, inventoryItemsByBarcode) {
  const parsed = parseInventoryBarcode(rawRow.barcode, rawRow.name);
  const editableItem = inventoryItemsByBarcode.get(rawRow.barcode) || null;
  const sizes = Object.fromEntries(SIZE_COLUMNS.map(size => [size, '']));
  SIZE_COLUMNS.forEach(size => {
    sizes[size] = formatSheetQuantity(rawRow.sizeValues?.[size] || 0);
  });
  if (!SIZE_COLUMNS.some(size => sizes[size]) && parsed.size && sizes[parsed.size] !== undefined) {
    sizes[parsed.size] = formatSheetQuantity(rawRow.quantity);
  }

  return {
    rowKey: `${rawRow.rowNumber || 'row'}:${rawRow.barcode}`,
    raw: rawRow,
    editableItem,
    warehouseName: rawRow.warehouseName || '',
    code: parsed.code,
    color: parsed.color,
    size: parsed.size,
    sizes,
    totalQuantity: formatSheetQuantity(rawRow.pendingQuantity || 0)
  };
}

function parseInventoryBarcode(barcode, name) {
  const raw = String(barcode || name || '')
    .replace(/["']/g, ' ')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = raw.split(' ').filter(Boolean);
  if (!tokens.length) {
    return { code: '', color: '', size: '' };
  }

  const normalizedTokens = tokens.map(token => token.toUpperCase());
  let workingTokens = tokens.slice();

  if (
    normalizedTokens[0] === 'MS' &&
    workingTokens.length > 1 &&
    /[A-Z]*\d/.test(workingTokens[1].toUpperCase())
  ) {
    workingTokens = workingTokens.slice(1);
  }

  if (!workingTokens.length) {
    return { code: '', color: '', size: '' };
  }

  const code = workingTokens[0];
  const detailTokens = workingTokens.slice(1);
  const sizeIndex = detailTokens.findIndex(token => SIZE_COLUMNS.includes(token.toUpperCase()));
  const size = sizeIndex >= 0 ? detailTokens[sizeIndex].toUpperCase() : '';
  const colorTokens = detailTokens.filter((_, index) => index !== sizeIndex);

  return {
    code: code.toUpperCase(),
    color: colorTokens.join(' '),
    size
  };
}

function formatSheetQuantity(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? formatNumber(number) : '';
}

function sortInventoryRows(rows, sortConfig) {
  if (!sortConfig?.key) return rows;

  const direction = sortConfig.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aValue = getSortValue(a, sortConfig.key);
    const bValue = getSortValue(b, sortConfig.key);
    if (aValue === bValue) return 0;
    return aValue > bValue ? direction : -direction;
  });
}

function getSortValue(row, key) {
  if (key.startsWith('size:')) {
    const size = key.split(':')[1];
    return Number(row.raw.sizeValues?.[size] || 0);
  }
  if (key === 'pendingQuantity') {
    return Number(row.raw.pendingQuantity || 0);
  }
  return 0;
}

function renderSortMark(sortConfig, key) {
  if (sortConfig.key !== key) return '';
  return sortConfig.direction === 'desc' ? ' v' : ' ^';
}

function aggregateSheetItems(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    const warehouseName = String(row.warehouseName || '').trim();
    const barcode = String(row.barcode || '').trim();
    if (!barcode) return;

    const key = `${warehouseName}\u0000${barcode}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...row,
        warehouseName,
        barcode,
        quantity: Number(row.quantity || 0),
        sheetTotalQuantity: Number(row.sheetTotalQuantity || 0),
        sizeValues: { ...(row.sizeValues || {}) }
      });
      return;
    }

    const current = grouped.get(key);
    current.quantity += Number(row.quantity || 0);
    current.sheetTotalQuantity += Number(row.sheetTotalQuantity || 0);
    Object.entries(row.sizeValues || {}).forEach(([size, value]) => {
      current.sizeValues[size] = Number(current.sizeValues[size] || 0) + Number(value || 0);
    });
    if (!current.name && row.name) current.name = row.name;
  });

  return Array.from(grouped.values());
}
