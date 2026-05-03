import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import { toast } from 'react-toastify';

export default function AutomationModal({ data }) {
  const { closeModal, loadAccounts } = useAppContext();
  const [formData, setFormData] = useState({
    checkInterval: 60
  });

  useEffect(() => {
    if (data) {
      setFormData({
        checkInterval: data.checkInterval || 60
      });
    }
  }, [data]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', `/accounts/${data._id}`, {
        checkInterval: parseInt(formData.checkInterval, 10)
      });
      toast.success('Da cap nhat cau hinh tu dong');
      await loadAccounts();
      closeModal();
    } catch (error) {
      toast.error('Loi: ' + error.message);
    }
  };

  return (
    <div className="card" style={{ border: 'none', margin: 0 }}>
      <div className="card-header">
        <div className="card-title">Cai dat Automation: {data?.name}</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>x</button>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
        <div className="form-group">
          <label>Nguong chi tieu va tin nhan</label>
          <input
            type="text"
            disabled
            value="Cau hinh trong Token / API key"
            style={{ background: 'var(--s2)', cursor: 'not-allowed' }}
          />
          <div className="inline-note">Logic nguong dung cau hinh chung cua he thong.</div>
        </div>

        <div className="form-group">
          <label>Chu ky kiem tra (giay)</label>
          <input
            type="number"
            min="30"
            max="3600"
            required
            value={formData.checkInterval}
            onChange={e => setFormData({ ...formData, checkInterval: e.target.value })}
          />
          <div className="inline-note">Khoang cach giua moi lan quet du lieu (30s - 3600s).</div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Huy</button>
          <button type="submit" className="btn btn-p">Luu cai dat</button>
        </div>
      </form>
    </div>
  );
}
