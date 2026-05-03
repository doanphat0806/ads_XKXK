import React, { useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import { isValidAdAccountId } from '../../lib/validators';
import { toast } from 'react-toastify';

export default function BulkAddModal() {
  const { closeModal, loadAccounts } = useAppContext();
  const [bulkText, setBulkText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const lines = bulkText.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    setLoading(true);
    const items = lines.map(line => {
      const [name, adAccountId, spendThreshold, checkInterval] = line.split('|').map(p => p.trim());
      return {
        name: name || '',
        adAccountId: adAccountId || '',
        spendThreshold: parseInt(spendThreshold) || 20000,
        checkInterval: parseInt(checkInterval) || 60
      };
    });

    const invalidItem = items.find(item => !isValidAdAccountId(item.adAccountId));
    if (invalidItem) {
      toast.error(`Ad Account ID không hợp lệ: ${invalidItem.adAccountId || '(trống)'}`);
      setLoading(false);
      return;
    }

    try {
      const res = await api('POST', '/accounts/bulk', { accounts: items });
      const createdCount = res.created?.length || 0;
      const errorCount = res.errors?.length || 0;
      
      toast.success(`Đã thêm ${createdCount} tài khoản. Lỗi: ${errorCount}`);
      loadAccounts();
      closeModal();
    } catch (error) {
      toast.error('Lỗi: ' + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="card" style={{ border: 'none', margin: 0, width: '500px' }}>
      <div className="card-header">
        <div className="card-title">➕ Thêm tài khoản hàng loạt</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
        <div className="form-group">
          <label>Danh sách tài khoản (định dạng bên dưới)</label>
          <textarea 
            rows="10" 
            placeholder="Tên TK | act_12345 | 25000 | 60"
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}
          ></textarea>
          <div className="inline-note">
            Định dạng: <code>Tên | ID | Ngưỡng | Chu kỳ (s)</code>
            <br />Ví dụ: <code>TK 01 | act_12345 | 25000 | 60</code>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Hủy</button>
          <button type="submit" className="btn btn-p" disabled={loading}>
            {loading ? 'Đang xử lý...' : 'Bắt đầu thêm'}
          </button>
        </div>
      </form>
    </div>
  );
}
