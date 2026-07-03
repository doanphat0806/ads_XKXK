import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api } from '../lib/api';
import { useAppContext } from '../contexts/AppContext';

export default function ShopeeAffAccounts() {
  const { modalState, openModal } = useAppContext();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const prevModalType = useRef(modalState.type);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('GET', '/shopee-aff-accounts');
      setItems(result || []);
    } catch (err) {
      toast.error(`Lỗi tải danh sách: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (prevModalType.current === 'SHOPEE_AFF_ACCOUNT' && modalState.type !== 'SHOPEE_AFF_ACCOUNT') {
      load();
    }
    prevModalType.current = modalState.type;
  }, [modalState.type, load]);

  const handleDelete = async (item) => {
    if (!confirm(`Xóa tài khoản AFF "${item.name}"?`)) return;
    try {
      await api('DELETE', `/shopee-aff-accounts/${item._id}`);
      toast.success('Đã xóa tài khoản AFF');
      load();
    } catch (err) {
      toast.error('Lỗi xóa: ' + err.message);
    }
  };

  return (
    <div id="page-shopee-aff-accounts">
      <div className="card">
        <div className="card-header">
          <div className="card-title">Tài khoản AFF Shopee</div>
          <button className="btn btn-primary btn-sm" onClick={() => openModal('SHOPEE_AFF_ACCOUNT')}>
            ➕ Thêm tài khoản AFF
          </button>
        </div>
      </div>

      <div className="accounts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px', marginTop: 14 }}>
        {loading && items.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1 / -1' }}><span className="spin">...</span><p>Đang tải...</p></div>
        ) : items.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1 / -1' }}>
            <div className="ei">🔍</div><p>Chưa có tài khoản AFF nào</p>
          </div>
        ) : (
          items.map(item => {
            return (
              <div key={item._id} className="acc-card">
                <div className="acc-card-top">
                  <div>
                    <div className="acc-name">{item.name}</div>
                    <div className="acc-id">
                      {item.shopeeSubId2Codes?.length > 0 ? `Mã: ${item.shopeeSubId2Codes.join(', ')}` : 'Chưa cấu hình mã'}
                    </div>
                  </div>
                </div>

                <div className="acc-footer" style={{ justifyContent: 'flex-end' }}>
                  <div className="acc-actions">
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Sửa tài khoản AFF"
                      onClick={() => openModal('SHOPEE_AFF_ACCOUNT', item)}
                    >✏️</button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      style={{ color: 'var(--r)', borderColor: 'rgba(244, 63, 94, 0.3)' }}
                      title="Xóa tài khoản AFF"
                      onClick={() => handleDelete(item)}
                    >🗑</button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
