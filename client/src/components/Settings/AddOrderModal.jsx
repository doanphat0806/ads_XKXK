import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { getStaffByMa } from '../../types/order.types';
import { parsePercentInput, recalculateRow, toSafeNumber } from '../../utils/calculations';

function createInitialDraft() {
  return {
    ma: '',
    ghiChu: '',
    slKhachDat: '',
    slThucDat: '',
    tiLeHoan: '0',
    sizeS: '',
    sizeM: '',
    sizeL: '',
    sizeXL: '',
    dangGuiHang: '0',
    tongDaShip: '0'
  };
}

function validateDraft(draft, staffList) {
  const ma = String(draft.ma || '').trim().toUpperCase();
  if (!ma) return 'Mã sản phẩm không được trống';

  const staff = getStaffByMa(ma, staffList);
  if (!staff) {
    return `Chưa có nhân viên cho ký tự đầu "${ma.charAt(0)}". Hãy thêm trong mục Nhân viên`;
  }

  if (toSafeNumber(draft.slKhachDat) <= 0) return 'SL Khách Đặt phải lớn hơn 0';
  if (toSafeNumber(draft.slThucDat) < 0) return 'SL Thực Đặt không hợp lệ';
  return '';
}

export default function AddOrderModal({ open, staffList, config, onClose, onAdd }) {
  const [draft, setDraft] = useState(createInitialDraft);

  React.useEffect(() => {
    if (open) {
      setDraft(createInitialDraft());
    }
  }, [open]);

  const detectedStaff = useMemo(
    () => getStaffByMa(draft.ma, staffList),
    [draft.ma, staffList]
  );

  const handleChange = (field, value) => {
    setDraft(current => ({ ...current, [field]: value }));
  };

  const handleSubmit = () => {
    const error = validateDraft(draft, staffList);
    if (error) {
      toast.error(error);
      return;
    }

    const baseRow = {
      id: `manual-${Date.now()}`,
      ma: String(draft.ma || '').trim().toUpperCase(),
      ngayKetThuc: 0,
      cpo: 0,
      ghiChu: String(draft.ghiChu || '').trim(),
      slKhachDat: toSafeNumber(draft.slKhachDat),
      slThucDat: toSafeNumber(draft.slThucDat),
      tiLeHoan: parsePercentInput(draft.tiLeHoan),
      sizeS: String(draft.sizeS || '').trim(),
      sizeM: String(draft.sizeM || '').trim(),
      sizeL: String(draft.sizeL || '').trim(),
      sizeXL: String(draft.sizeXL || '').trim(),
      daNhan: 0,
      dangHoan: 0,
      daHoan: 0,
      dangGuiHang: toSafeNumber(draft.dangGuiHang),
      tongDaShip: toSafeNumber(draft.tongDaShip)
    };

    onAdd(recalculateRow(baseRow, config));
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Thêm mã mới"
      onClose={onClose}
      className="deal-add-order-modal"
      footer={(
        <>
          <button type="button" className="deal-btn deal-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="deal-btn deal-btn-primary" onClick={handleSubmit}>
            Lưu mã mới
          </button>
        </>
      )}
    >
      <div className="deal-add-order-grid">
        <label className="deal-form-field deal-form-field-full">
          <span>Mã</span>
          <input
            type="text"
            value={draft.ma}
            onChange={event => handleChange('ma', event.target.value.toUpperCase())}
            placeholder="VD: PQ9999999"
          />
          <small>{detectedStaff ? `Nhân viên: ${detectedStaff.name}` : 'Ký tự đầu sẽ tự nhận diện theo danh sách nhân viên'}</small>
        </label>

        <label className="deal-form-field">
          <span>SL Khách Đặt</span>
          <input type="number" value={draft.slKhachDat} onChange={event => handleChange('slKhachDat', event.target.value)} />
        </label>
        <label className="deal-form-field">
          <span>SL Thực Đặt</span>
          <input type="number" value={draft.slThucDat} onChange={event => handleChange('slThucDat', event.target.value)} />
        </label>
        <label className="deal-form-field">
          <span>Tỉ Lệ Hoàn (%)</span>
          <input type="number" value={draft.tiLeHoan} onChange={event => handleChange('tiLeHoan', event.target.value)} />
        </label>

        <label className="deal-form-field deal-form-field-full">
          <span>Ghi chú</span>
          <input type="text" value={draft.ghiChu} onChange={event => handleChange('ghiChu', event.target.value)} placeholder="Ghi chú thêm nếu cần" />
        </label>

        <label className="deal-form-field">
          <span>SIZE S</span>
          <input type="text" value={draft.sizeS} onChange={event => handleChange('sizeS', event.target.value)} />
        </label>
        <label className="deal-form-field">
          <span>SIZE M</span>
          <input type="text" value={draft.sizeM} onChange={event => handleChange('sizeM', event.target.value)} />
        </label>
        <label className="deal-form-field">
          <span>SIZE L</span>
          <input type="text" value={draft.sizeL} onChange={event => handleChange('sizeL', event.target.value)} />
        </label>
        <label className="deal-form-field">
          <span>SIZE XL</span>
          <input type="text" value={draft.sizeXL} onChange={event => handleChange('sizeXL', event.target.value)} />
        </label>

        <label className="deal-form-field">
          <span>Đang Gửi Hàng</span>
          <input type="number" value={draft.dangGuiHang} onChange={event => handleChange('dangGuiHang', event.target.value)} />
        </label>
        <label className="deal-form-field">
          <span>Tổng Đã Ship</span>
          <input type="number" value={draft.tongDaShip} onChange={event => handleChange('tongDaShip', event.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
