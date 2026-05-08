import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, dateTimeString, downloadFile, formatNumber } from '../lib/api';

export default function InventorySummary() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');

  const loadSummary = async () => {
    setLoading(true);
    try {
      const data = await api('GET', '/inventory/summary');
      setItems(data.items || []);
    } catch (error) {
      toast.error(`Loi tai thong ke kho: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(item =>
      String(item.productCode || '').toLowerCase().includes(term)
      || String(item.name || '').toLowerCase().includes(term)
      || (item.barcodes || []).some(barcode => String(barcode || '').toLowerCase().includes(term))
    );
  }, [items, search]);

  const totalQuantity = useMemo(
    () => filteredItems.reduce((sum, item) => sum + Number(item.totalQuantity || 0), 0),
    [filteredItems]
  );
  const totalPendingQuantity = useMemo(
    () => filteredItems.reduce((sum, item) => sum + Number(item.pendingQuantity || 0), 0),
    [filteredItems]
  );

  const exportSummary = async () => {
    setExporting(true);
    try {
      await downloadFile('/inventory/summary/export', 'inventory_summary.csv');
    } catch (error) {
      toast.error(`Loi xuat file: ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="page-inventory-summary">
      <div className="stats-grid inventory-stats">
        <div className="stat g">
          <div className="stat-label">Tong ma ton kho</div>
          <div className="stat-value">{formatNumber(filteredItems.length)}</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Tong so luong ton</div>
          <div className="stat-value">{formatNumber(totalQuantity)}</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Tong so luong chot</div>
          <div className="stat-value">{formatNumber(totalPendingQuantity)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Thong ke ma ton kho</div>
          <div className="inventory-search">
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') loadSummary();
              }}
              placeholder="Tim theo ma, ten hoac barcode"
            />
            <button className="btn btn-ghost btn-sm" onClick={loadSummary} disabled={loading}>
              Tai lai
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportSummary} disabled={exporting}>
              {exporting ? 'Dang xuat...' : 'Tai CSV'}
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai thong ke...</p></div>
          ) : filteredItems.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co ma ton kho</p></div>
          ) : (
            <table className="tbl inventory-sheet-table">
              <thead>
                <tr>
                  <th>Ten hang</th>
                  <th>Ma SP</th>
                  <th className="text-right">So luong ton</th>
                  <th className="text-right">So luong chot</th>
                  <th>Kho</th>
                  <th>Gia sale</th>
                  <th>Cap nhat</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => (
                  <tr key={item.productCode}>
                    <td>{item.name || '-'}</td>
                    <td className="inventory-sheet-code">{item.productCode}</td>
                    <td className="inventory-sheet-total">{formatNumber(item.totalQuantity || 0)}</td>
                    <td className="inventory-sheet-total">{formatNumber(item.pendingQuantity || 0)}</td>
                    <td>{(item.warehouses || []).join(', ') || '-'}</td>
                    <td>{item.salePrice || '-'}</td>
                    <td className="inventory-sheet-updated">{item.updatedAt ? dateTimeString(item.updatedAt) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
