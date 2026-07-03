import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { toast } from 'react-toastify';
import { parseSubId2Codes } from '../../utils/shopeeCodes';
import { useAppContext } from '../../contexts/AppContext';

const emptyFormData = {
  name: '',
  codesText: ''
};

export default function ShopeeAffAccountModal({ data }) {
  const { closeModal } = useAppContext();
  const [formData, setFormData] = useState(emptyFormData);
  const isEdit = !!data;

  useEffect(() => {
    if (data) {
      setFormData({
        name: data.name || '',
        codesText: (data.shopeeSubId2Codes || []).join(', ')
      });
    } else {
      setFormData(emptyFormData);
    }
  }, [data]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = formData.name.trim();
    if (!name) {
      toast.error('Tên tài khoản AFF không được để trống');
      return;
    }
    const payload = {
      name,
      shopeeSubId2Codes: parseSubId2Codes(formData.codesText)
    };
    try {
      if (isEdit) {
        await api('PUT', `/shopee-aff-accounts/${data._id}`, payload);
        toast.success('Đã cập nhật tài khoản AFF');
      } else {
        await api('POST', '/shopee-aff-accounts', payload);
        toast.success('Đã thêm tài khoản AFF');
      }
      closeModal();
    } catch (error) {
      toast.error('Lỗi: ' + error.message);
    }
  };

  return (
    <div className="card" style={{ border: 'none', margin: 0 }}>
      <div className="card-header">
        <div className="card-title">{isEdit ? '✏️ Sửa tài khoản AFF' : '➕ Thêm tài khoản AFF'}</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>
      <form onSubmit={handleSubmit} autoComplete="off" style={{ padding: '20px' }}>
        <div className="form-group">
          <label>Tên tài khoản AFF</label>
          <input
            type="text"
            autoComplete="off"
            required
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            placeholder="Ví dụ: Phat AFF"
          />
        </div>
        <div className="form-group">
          <label>Mã Sub_id2 (cách nhau bởi dấu phẩy)</label>
          <input
            type="text"
            autoComplete="off"
            value={formData.codesText}
            onChange={e => setFormData({ ...formData, codesText: e.target.value })}
            placeholder="Ví dụ: PH, PP, PF, PHAT, PAT"
          />
          <div className="inline-note">
            Hoa hồng có sub_id2 mang mã này (vd: 1102PH01 → PH) sẽ được tính cho tài khoản AFF này.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Hủy</button>
          <button type="submit" className="btn btn-p">{isEdit ? 'Lưu thay đổi' : 'Thêm tài khoản'}</button>
        </div>
      </form>
    </div>
  );
}
