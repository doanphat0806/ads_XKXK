import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Trash2, Save } from 'lucide-react';

export default function ShopeeAffAccountsModal({ accounts, adAccounts = [], onCreate, onUpdate, onDelete, onClose }) {
  const [rows, setRows] = useState(() => accounts.map(a => ({ ...a, adAccountIds: (a.adAccountIds || []).map(String) })));
  const [newName, setNewName] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [newAdAccountIds, setNewAdAccountIds] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [adding, setAdding] = useState(false);

  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => (r._id === id ? { ...r, [field]: value } : r)));
  }

  async function handleSaveRow(id) {
    const row = rows.find(r => r._id === id);
    if (!row) return;
    const name = row.name.trim();
    if (!name) { toast.error('Tên tài khoản không được để trống'); return; }
    setSavingId(id);
    const account = await onUpdate(id, {
      name,
      subIdPrefix: (row.subIdPrefix || '').trim(),
      adAccountIds: row.adAccountIds || []
    });
    setSavingId(null);
    if (account) toast.success(`Đã lưu "${account.name}"`);
  }

  function toggleAdAccountId(ids, setIds, accId) {
    setIds(ids.includes(accId) ? ids.filter(x => x !== accId) : [...ids, accId]);
  }

  // A dropdown (not an always-open checkbox list) so this stays usable with dozens of ad
  // accounts — search filters the list, and the trigger shows a compact summary instead
  // of every option taking up vertical space in the table row.
  function AdAccountPicker({ selectedIds, onToggle }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);

    useEffect(() => {
      if (!open) return;
      function handleClickOutside(e) {
        if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
      }
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    if (!adAccounts.length) {
      return <div style={{ fontSize: 11, color: 'var(--muted2)' }}>Chưa có tài khoản QC</div>;
    }

    const selectedNames = adAccounts.filter(a => selectedIds.includes(a._id)).map(a => a.name);
    const filtered = search.trim()
      ? adAccounts.filter(a => a.name.toLowerCase().includes(search.trim().toLowerCase()))
      : adAccounts;

    return (
      <div ref={containerRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="shopee-social-input"
          style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
          onClick={() => setOpen(v => !v)}
        >
          {selectedNames.length ? `${selectedNames.length} đã chọn: ${selectedNames.join(', ')}` : 'Mặc định (chưa pin)'}
        </button>
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30, width: 240,
            background: 'var(--s1)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)', padding: 8
          }}>
            {adAccounts.length > 6 && (
              <input
                autoFocus
                className="shopee-social-input"
                style={{ width: '100%', marginBottom: 6 }}
                placeholder="Tìm tài khoản QC..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            )}
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {filtered.length ? filtered.map(acc => (
                <label key={acc._id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer', padding: '2px 4px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(acc._id)}
                    onChange={() => onToggle(acc._id)}
                  />
                  {acc.name}
                </label>
              )) : <div style={{ fontSize: 11, color: 'var(--muted2)', padding: 4 }}>Không tìm thấy</div>}
            </div>
          </div>
        )}
      </div>
    );
  }

  async function handleDeleteRow(id, name) {
    if (!window.confirm(`Xóa tài khoản "${name}" khỏi danh sách? (Đơn hàng đã lưu của tài khoản này sẽ không bị xóa)`)) return;
    await onDelete(id);
    setRows(prev => prev.filter(r => r._id !== id));
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) { toast.error('Nhập tên tài khoản'); return; }
    setAdding(true);
    const account = await onCreate(name, newPrefix.trim(), newAdAccountIds);
    setAdding(false);
    if (account) {
      setRows(prev => (prev.some(r => r._id === account._id) ? prev : [...prev, { ...account, adAccountIds: (account.adAccountIds || []).map(String) }]));
      setNewName('');
      setNewPrefix('');
      setNewAdAccountIds([]);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        className="card"
        style={{ border: 'none', margin: 0, width: 700, maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="card-header">
          <div className="card-title">Danh Sách Tài Khoản Shopee AFF</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 18px 10px', fontSize: 11.5, color: 'var(--muted2)' }}>
          Mã SubID2 là phần chữ ngay sau 4 số đầu (ngày/tháng đổi mỗi ngày) — VD SubID2 "1707AB06" thì mã là "AB". 1 tài khoản có thể gõ nhiều mã, cách nhau dấu phẩy.
          <br />
          Tài khoản QC: chọn thủ công tài khoản quảng cáo thuộc về tài khoản này (không cần khớp mã SubID2 nữa). Nếu không chọn, tài khoản này sẽ tự nhận tất cả tài khoản QC nào chưa bị tài khoản AFF khác chọn.
        </div>

        <div className="tbl-wrap" style={{ padding: '0 18px' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Tên tài khoản</th>
                <th>Mã SubID2 (VD: AB,AC)</th>
                <th>Tài khoản QC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id}>
                  <td>
                    <input
                      className="shopee-social-input"
                      style={{ width: '100%' }}
                      value={r.name}
                      onChange={e => updateRow(r._id, 'name', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="shopee-social-input"
                      style={{ width: '100%' }}
                      placeholder="VD: AB,AC,AD"
                      value={r.subIdPrefix || ''}
                      onChange={e => updateRow(r._id, 'subIdPrefix', e.target.value)}
                    />
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <AdAccountPicker
                      selectedIds={r.adAccountIds || []}
                      onToggle={accId => updateRow(r._id, 'adAccountIds', (r.adAccountIds || []).includes(accId)
                        ? r.adAccountIds.filter(x => x !== accId)
                        : [...(r.adAccountIds || []), accId])}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleSaveRow(r._id)}
                        disabled={savingId === r._id}
                        title="Lưu"
                      >
                        <Save size={13} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleDeleteRow(r._id, r.name)}
                        title="Xóa"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--muted2)' }}>
                    Chưa có tài khoản nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="shopee-social-receipts-form" style={{ padding: '14px 18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="shopee-social-input"
              placeholder="Tên tài khoản mới, VD: AFF 05"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
            <input
              className="shopee-social-input"
              placeholder="Mã SubID2, VD: AB,AC (cách nhau dấu phẩy)"
              value={newPrefix}
              onChange={e => setNewPrefix(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <div style={{ maxWidth: 260 }}>
            <AdAccountPicker
              selectedIds={newAdAccountIds}
              onToggle={accId => toggleAdAccountId(newAdAccountIds, setNewAdAccountIds, accId)}
            />
          </div>
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={handleAdd} disabled={adding}>
            <Plus size={14} strokeWidth={2} /> Thêm tài khoản
          </button>
        </div>
      </div>
    </div>
  );
}
