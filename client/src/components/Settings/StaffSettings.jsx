import React, { useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { STAFF_COLOR_OPTIONS } from '../../types/order.types';

function normalizePrefix(value) {
  return String(value || '').trim().charAt(0).toUpperCase();
}

function validateStaffList(staffList) {
  const errors = [];
  const prefixSet = new Set();

  staffList.forEach((staff, index) => {
    const prefix = normalizePrefix(staff.prefix);
    if (!staff.name.trim()) {
      errors.push(`Tên nhân viên dòng ${index + 1} không được trống`);
      return;
    }
    if (!prefix) {
      errors.push(`Ký tự đầu dòng ${index + 1} không hợp lệ`);
      return;
    }
    if (prefixSet.has(prefix)) {
      errors.push(`Ký tự đầu ${prefix} đang bị trùng`);
      return;
    }
    prefixSet.add(prefix);
  });

  return errors;
}

export default function StaffSettings({ open, staffList, onClose, onSave }) {
  const [draft, setDraft] = useState(staffList);
  const [errors, setErrors] = useState([]);

  React.useEffect(() => {
    if (open) {
      setDraft(staffList);
      setErrors([]);
    }
  }, [open, staffList]);

  const handleChange = (id, field, value) => {
    setDraft(current => current.map(staff => (
      staff.id === id
        ? { ...staff, [field]: field === 'prefix' ? normalizePrefix(value) : value }
        : staff
    )));
  };

  const handleDelete = (id) => {
    setDraft(current => current.filter(staff => staff.id !== id));
  };

  const handleAdd = () => {
    setDraft(current => [
      ...current,
      {
        id: `staff-${Date.now()}`,
        name: '',
        prefix: '',
        color: STAFF_COLOR_OPTIONS[current.length % STAFF_COLOR_OPTIONS.length]
      }
    ]);
  };

  const handleSave = () => {
    const normalized = draft.map(staff => ({
      ...staff,
      name: String(staff.name || '').trim(),
      prefix: normalizePrefix(staff.prefix),
      color: staff.color || 'slate'
    }));
    const nextErrors = validateStaffList(normalized);
    setErrors(nextErrors);
    if (nextErrors.length) {
      toast.error(nextErrors[0]);
      return;
    }
    onSave(normalized);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="👥 Nhân viên & ký tự đầu mã"
      onClose={onClose}
      className="deal-staff-modal"
      footer={(
        <>
          <button type="button" className="deal-btn deal-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="deal-btn deal-btn-primary" onClick={handleSave}>
            Lưu danh sách
          </button>
        </>
      )}
    >
      <div className="deal-staff-editor">
        <table className="deal-staff-table">
          <thead>
            <tr>
              <th>Tên nhân viên</th>
              <th>Ký tự đầu mã</th>
              <th>Màu</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.map(staff => (
              <tr key={staff.id}>
                <td>
                  <input
                    type="text"
                    value={staff.name}
                    onChange={event => handleChange(staff.id, 'name', event.target.value)}
                    placeholder="Tên nhân viên"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    maxLength="1"
                    value={staff.prefix}
                    onChange={event => handleChange(staff.id, 'prefix', event.target.value)}
                    placeholder="P"
                  />
                </td>
                <td>
                  <select
                    value={staff.color}
                    onChange={event => handleChange(staff.id, 'color', event.target.value)}
                  >
                    {STAFF_COLOR_OPTIONS.map(color => (
                      <option key={color} value={color}>{color}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="deal-icon-btn" onClick={() => handleDelete(staff.id)} aria-label="Xóa nhân viên">
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors.length ? (
          <div className="deal-form-errors">
            {errors.map(error => <div key={error}>{error}</div>)}
          </div>
        ) : null}
        <button type="button" className="deal-btn deal-btn-ghost" onClick={handleAdd}>
          + Thêm nhân viên
        </button>
      </div>
    </Modal>
  );
}
