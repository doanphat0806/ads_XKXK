import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import LinkedPagesField from './LinkedPagesField';

export default function ShopeePagesModal() {
  const { allAccounts, closeModal, loadAccounts } = useAppContext();
  const [selectedPageIds, setSelectedPageIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const shopeeAccounts = useMemo(
    () => allAccounts.filter(account => account.provider === 'shopee'),
    [allAccounts]
  );

  const shopeeRolePageIds = useMemo(
    () => [...new Set(
      shopeeAccounts
        .flatMap(account => account.linkedPageIds || [])
        .map(String)
        .filter(Boolean)
    )],
    [shopeeAccounts]
  );

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    setSelectedPageIds(shopeeRolePageIds);
  }, [shopeeRolePageIds]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!shopeeAccounts.length) {
      toast.error('Chưa có tài khoản Shopee');
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        shopeeAccounts.map(account => api('PUT', `/accounts/${account._id}`, {
          linkedPageIds: selectedPageIds
        }))
      );
      await loadAccounts();
      toast.success(`Đã cập nhật Page cho ${shopeeAccounts.length} tài khoản Shopee`);
      closeModal();
    } catch (error) {
      toast.error('Lỗi: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ border: 'none', margin: 0, width: '520px' }}>
      <div className="card-header">
        <div className="card-title">+ Thêm page Shopee</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
        <div className="form-group">
          <label>Phạm vi áp dụng</label>
          <input
            type="text"
            disabled
            value={`${shopeeAccounts.length} tài khoản Shopee`}
            style={{ background: 'var(--s2)', cursor: 'not-allowed' }}
          />
          <div className="inline-note">
            Page được chọn sẽ dùng chung cho tất cả tài khoản của role Shopee.
          </div>
        </div>

        {shopeeAccounts.length > 0 ? (
          <LinkedPagesField
            selectedPageIds={selectedPageIds}
            onChange={setSelectedPageIds}
          />
        ) : (
          <div className="empty" style={{ minHeight: '120px' }}>
            <p>Thêm tài khoản Shopee trước khi liên kết Page.</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Hủy</button>
          <button type="submit" className="btn btn-p" disabled={saving || !shopeeAccounts.length}>
            {saving ? 'Đang lưu...' : 'Lưu cho tất cả'}
          </button>
        </div>
      </form>
    </div>
  );
}
