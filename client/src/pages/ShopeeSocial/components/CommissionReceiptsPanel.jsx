import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { formatVND } from '../../../lib/api';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CommissionReceiptsPanel({ accounts, receipts, onAdd, onDelete }) {
  const [date, setDate] = useState(todayStr());
  const [accountName, setAccountName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [showList, setShowList] = useState(false);

  async function handleAdd() {
    const acc = accountName || accounts[0]?.name || '';
    const amountNum = Number(amount);
    if (!acc) { toast.error('Vui lòng tạo tài khoản Shopee AFF trước'); return; }
    if (!amountNum || amountNum <= 0) { toast.error('Số tiền thực nhận không hợp lệ'); return; }
    setSaving(true);
    const receipt = await onAdd({ accountName: acc, date, amount: amountNum, note });
    setSaving(false);
    if (receipt) {
      setAmount('');
      setNote('');
      toast.success(`Đã ghi ${formatVND(amountNum)} hoa hồng thực nhận cho ${acc}`);
    }
  }

  return (
    <div className="card shopee-social-receipts-card">
      <div className="card-header">
        <div className="card-title">Hoa Hồng Thực Nhận (ghi tay)</div>
        {receipts.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowList(v => !v)}>
            {showList ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
            {showList ? 'Thu gọn' : `Xem lịch sử (${receipts.length})`}
          </button>
        )}
      </div>

      <div className="shopee-social-receipts-form">
        <input
          type="date"
          className="shopee-social-input"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <select
          className="shopee-social-input"
          value={accountName || accounts[0]?.name || ''}
          onChange={e => setAccountName(e.target.value)}
        >
          {!accounts.length && <option value="">-- Chưa có tài khoản --</option>}
          {accounts.map(a => <option key={a._id} value={a.name}>{a.name}</option>)}
        </select>
        <input
          type="number"
          min="0"
          className="shopee-social-input"
          placeholder="Số tiền thực nhận"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />
        <input
          type="text"
          className="shopee-social-input"
          placeholder="Ghi chú (tùy chọn)"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <button type="button" className="btn btn-sm" onClick={handleAdd} disabled={saving || !accounts.length}>
          <Plus size={14} strokeWidth={2} /> Thêm
        </button>
      </div>

      {showList && receipts.length > 0 && (
        <div className="tbl-wrap shopee-social-receipts-list">
          <table className="tbl">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Tài khoản</th>
                <th className="text-right">Số tiền</th>
                <th>Ghi chú</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <tr key={r.id}>
                  <td className="mono-sm">{r.date ? r.date.toLocaleDateString('vi-VN') : '-'}</td>
                  <td>{r.accountName}</td>
                  <td className="text-right mono-sm" style={{ color: 'var(--g)', fontWeight: 600 }}>{formatVND(r.amount)}</td>
                  <td>{r.note}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDelete(r.id)} title="Xóa">
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
