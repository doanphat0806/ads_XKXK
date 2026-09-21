import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Trash2, Save } from 'lucide-react';

export default function ShopeeAffAccountsModal({ accounts, onCreate, onUpdate, onDelete, onClose }) {
  const [rows, setRows] = useState(() => accounts.map(a => ({ ...a })));
  const [newName, setNewName] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
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
    const account = await onUpdate(id, { name, subIdPrefix: (row.subIdPrefix || '').trim() });
    setSavingId(null);
    if (account) toast.success(`Đã lưu "${account.name}"`);
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
    const account = await onCreate(name, newPrefix.trim());
    setAdding(false);
    if (account) {
      setRows(prev => (prev.some(r => r._id === account._id) ? prev : [...prev, account]));
      setNewName('');
      setNewPrefix('');
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        className="card"
        style={{ border: 'none', margin: 0, width: 560, maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="card-header">
          <div className="card-title">Danh Sách Tài Khoản Shopee AFF</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 18px 10px', fontSize: 11.5, color: 'var(--muted2)' }}>
          Mã SubID2 là phần chữ ngay sau 4 số đầu (ngày/tháng đổi mỗi ngày) — VD SubID2 "1707AB06" thì mã là "AB". 1 tài khoản có thể gõ nhiều mã, cách nhau dấu phẩy.
        </div>

        <div className="tbl-wrap" style={{ padding: '0 18px' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Tên tài khoản</th>
                <th>Mã SubID2 (VD: AB,AC)</th>
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
                  <td colSpan={3} style={{ textAlign: 'center', padding: 16, color: 'var(--muted2)' }}>
                    Chưa có tài khoản nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="shopee-social-receipts-form" style={{ padding: '14px 18px 20px' }}>
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
          <button type="button" className="btn btn-sm" onClick={handleAdd} disabled={adding}>
            <Plus size={14} strokeWidth={2} /> Thêm tài khoản
          </button>
        </div>
      </div>
    </div>
  );
}
