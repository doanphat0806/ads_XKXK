import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { getStaffByMa } from '../../types/order.types';
import { recalculateRow } from '../../utils/calculations';
import { formatCompactInt, formatCurrency, formatPercent } from '../../utils/formatters';

function createInitialDraft() {
  return {
    ma: '',
    orderSizeS: '',
    orderSizeM: '',
    orderSizeL: '',
    orderSizeXL: '',
    orderSizeFZ: ''
  };
}

export default function AddOrderModal({ open, staffList, config, orderLookupByCode = {}, onClose, onAdd }) {
  const [draft, setDraft] = useState(createInitialDraft);

  React.useEffect(() => {
    if (open) {
      setDraft(createInitialDraft());
    }
  }, [open]);

  const normalizedCode = useMemo(
    () => String(draft.ma || '').trim().toUpperCase().replace(/\s+/g, ''),
    [draft.ma]
  );

  const detectedStaff = useMemo(
    () => getStaffByMa(normalizedCode, staffList),
    [normalizedCode, staffList]
  );

  const matchedOrderRow = useMemo(
    () => orderLookupByCode[normalizedCode] || null,
    [normalizedCode, orderLookupByCode]
  );

  const handleChange = (field, value) => {
    setDraft(current => ({ ...current, [field]: value }));
  };

  const handleSubmit = () => {
    if (!normalizedCode) {
      toast.error('Mã sản phẩm không được trống');
      return;
    }

    if (!detectedStaff) {
      toast.error(`Chưa có nhân viên cho ký tự đầu "${normalizedCode.charAt(0)}"`);
      return;
    }

    if (!matchedOrderRow) {
      toast.error('Không tìm thấy mã trong Đơn Hàng');
      return;
    }

    const nextRow = recalculateRow({
      ...matchedOrderRow,
      id: `manual-${Date.now()}`,
      ma: normalizedCode,
      ghiChu: '',
      slThucDat: Number(matchedOrderRow.slThucDat || 0),
      orderSizeS: String(draft.orderSizeS || '').trim(),
      orderSizeM: String(draft.orderSizeM || '').trim(),
      orderSizeL: String(draft.orderSizeL || '').trim(),
      orderSizeXL: String(draft.orderSizeXL || '').trim(),
      orderSizeFZ: String(draft.orderSizeFZ || '').trim()
    }, config);

    onAdd(nextRow);
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
      <div className="deal-add-order-grid deal-add-order-grid-compact">
        <label className="deal-form-field deal-form-field-full">
          <span>Mã</span>
          <input
            type="text"
            value={draft.ma}
            onChange={event => handleChange('ma', event.target.value.toUpperCase())}
            placeholder="VD: PQ9999999"
          />
        </label>

        {detectedStaff ? (
          <div className="deal-inline-note">Nhân viên: {detectedStaff.name}</div>
        ) : (
          <div className="deal-inline-note">Ký tự đầu sẽ tự nhận diện theo danh sách nhân viên</div>
        )}

        {matchedOrderRow ? (
          <>
            <div className="deal-order-preview">
              <div className="deal-order-preview-item">SL Khách Đặt: {formatCompactInt(matchedOrderRow.slKhachDat)}</div>
              <div className="deal-order-preview-item">Tỉ Lệ Hoàn: {formatPercent(matchedOrderRow.tiLeHoan)}</div>
              <div className="deal-order-preview-item">Đang Gửi: {formatCompactInt(matchedOrderRow.dangGuiHang)}</div>
              <div className="deal-order-preview-item">Đã Ship: {formatCompactInt(matchedOrderRow.tongDaShip)}</div>
              <div className="deal-order-preview-item">CPO: {formatCurrency(matchedOrderRow.cpo)}</div>
            </div>

            <div className="deal-size-section">
              <div className="deal-size-section-title">Size từ Đơn Hàng</div>
              <div className="deal-size-grid">
                <div className="deal-size-readonly">S: {matchedOrderRow.sizeS || '-'}</div>
                <div className="deal-size-readonly">M: {matchedOrderRow.sizeM || '-'}</div>
                <div className="deal-size-readonly">L: {matchedOrderRow.sizeL || '-'}</div>
                <div className="deal-size-readonly">XL: {matchedOrderRow.sizeXL || '-'}</div>
              </div>
            </div>

            <div className="deal-size-section">
              <div className="deal-size-section-title">Size từ Đặt Hàng</div>
              <div className="deal-size-grid">
                <label className="deal-form-field">
                  <span>ĐH S</span>
                  <input type="text" value={draft.orderSizeS} onChange={event => handleChange('orderSizeS', event.target.value)} />
                </label>
                <label className="deal-form-field">
                  <span>ĐH M</span>
                  <input type="text" value={draft.orderSizeM} onChange={event => handleChange('orderSizeM', event.target.value)} />
                </label>
                <label className="deal-form-field">
                  <span>ĐH L</span>
                  <input type="text" value={draft.orderSizeL} onChange={event => handleChange('orderSizeL', event.target.value)} />
                </label>
                <label className="deal-form-field">
                  <span>ĐH XL</span>
                  <input type="text" value={draft.orderSizeXL} onChange={event => handleChange('orderSizeXL', event.target.value)} />
                </label>
                <label className="deal-form-field">
                  <span>ĐH FZ</span>
                  <input type="text" value={draft.orderSizeFZ} onChange={event => handleChange('orderSizeFZ', event.target.value)} />
                </label>
              </div>
              <div className="deal-inline-note">SL Thực Đặt lấy từ Đặt Hàng: {formatCompactInt(matchedOrderRow.slThucDat || 0)}. Size chỉ để ghi tay.</div>
            </div>
          </>
        ) : normalizedCode ? (
          <div className="deal-inline-note">Mã này chưa có trong Đơn Hàng</div>
        ) : null}
      </div>
    </Modal>
  );
}
