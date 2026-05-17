import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import { api, formatNumber } from '../lib/api';

const emptyFormData = {
  username: '',
  password: '',
  displayName: '',
  provider: 'facebook'
};

const providerLabels = {
  facebook: 'Facebook',
  shopee: 'Shopee',
  oder: 'Oder'
};

const usernamePattern = /^[a-z0-9._-]+$/;

function userApiPath(username) {
  return `/users/${encodeURIComponent(username)}`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('vi-VN');
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState(emptyFormData);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await api('GET', '/users');
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      toast.error(`Loi tai danh sach users: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenModal = (user = null) => {
    setEditingUser(user);
    setFormData(user ? {
      username: user.username || '',
      password: '',
      displayName: user.displayName || '',
      provider: user.provider || 'facebook'
    } : emptyFormData);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    resetModal();
  };

  const resetModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData(emptyFormData);
  };

  const validateForm = () => {
    const username = formData.username.trim().toLowerCase();
    if (!username) {
      toast.error('Username la bat buoc');
      return null;
    }
    if (!usernamePattern.test(username)) {
      toast.error('Username chi duoc dung chu thuong, so, dau cham, gach ngang hoac gach duoi');
      return null;
    }
    if (!editingUser && !formData.password) {
      toast.error('Mat khau la bat buoc khi tao user moi');
      return null;
    }
    return {
      username,
      password: formData.password,
      displayName: formData.displayName.trim(),
      provider: formData.provider
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = validateForm();
    if (!payload) return;

    setSaving(true);
    try {
      if (editingUser) {
        const updateData = { displayName: payload.displayName };
        if (editingUser.username !== 'admin') updateData.provider = payload.provider;
        if (payload.password) updateData.password = payload.password;
        await api('PATCH', userApiPath(editingUser.username), updateData);
        toast.success('Da cap nhat tai khoan');
      } else {
        await api('POST', '/users', payload);
        toast.success('Da tao tai khoan moi');
      }
      resetModal();
      await loadUsers();
    } catch (error) {
      toast.error(`Loi: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (username) => {
    if (!window.confirm(`Xac nhan xoa tai khoan "${username}"?`)) return;
    try {
      await api('DELETE', userApiPath(username));
      toast.success('Da xoa tai khoan');
      await loadUsers();
    } catch (error) {
      toast.error(`Loi xoa tai khoan: ${error.message}`);
    }
  };

  return (
    <div id="page-user-management">
      <div className="card">
        <div className="card-header">
          <div className="card-title">Quan ly tai khoan ({formatNumber(users.length)})</div>
          <button type="button" className="btn btn-g btn-sm" onClick={() => handleOpenModal()}>
            <Plus size={14} />
            Them tai khoan
          </button>
        </div>

        <div className="tbl-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : users.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co tai khoan</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Ten hien thi</th>
                  <th>Provider</th>
                  <th>Ngay tao</th>
                  <th>Cap nhat</th>
                  <th className="text-right">Thao tac</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.username}>
                    <td className="mono-sm">{user.username}</td>
                    <td>{user.displayName || '-'}</td>
                    <td>{providerLabels[user.provider] || user.provider || '-'}</td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>{formatDate(user.updatedAt)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        onClick={() => handleOpenModal(user)}
                        title="Sua"
                      >
                        <Edit2 size={14} />
                      </button>
                      {user.username !== 'admin' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          onClick={() => handleDelete(user.username)}
                          title="Xoa"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay open" onClick={handleCloseModal}>
          <div className="modal-content" style={{ width: 'min(520px, 95vw)' }} onClick={event => event.stopPropagation()}>
            <div className="card" style={{ border: 'none', margin: 0 }}>
              <div className="card-header">
                <div className="card-title">{editingUser ? 'Sua tai khoan' : 'Them tai khoan moi'}</div>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={handleCloseModal} disabled={saving}>
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'grid', gap: '14px' }}>
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={event => setFormData({ ...formData, username: event.target.value })}
                    disabled={!!editingUser || saving}
                    autoComplete="off"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Mat khau {editingUser ? '(de trong neu khong doi)' : ''}</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={event => setFormData({ ...formData, password: event.target.value })}
                    disabled={saving}
                    autoComplete="new-password"
                    required={!editingUser}
                  />
                </div>

                <div className="form-group">
                  <label>Ten hien thi</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={event => setFormData({ ...formData, displayName: event.target.value })}
                    disabled={saving}
                  />
                </div>

                <div className="form-group">
                  <label>Provider</label>
                  <select
                    value={formData.provider}
                    onChange={event => setFormData({ ...formData, provider: event.target.value })}
                    disabled={saving || editingUser?.username === 'admin'}
                  >
                    <option value="facebook">Facebook</option>
                    <option value="shopee">Shopee</option>
                    <option value="oder">Oder</option>
                  </select>
                  {editingUser?.username === 'admin' && (
                    <div className="inline-note">Tai khoan admin mac dinh khong duoc doi provider.</div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                  <button type="button" className="btn btn-ghost" onClick={handleCloseModal} disabled={saving}>
                    Huy
                  </button>
                  <button type="submit" className="btn btn-g" disabled={saving}>
                    {saving ? 'Dang luu...' : editingUser ? 'Cap nhat' : 'Tao moi'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
