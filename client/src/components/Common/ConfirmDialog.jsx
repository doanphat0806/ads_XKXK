import React from 'react';
import Modal from './Modal';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy',
  onConfirm,
  onCancel
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      className="deal-confirm-modal"
      footer={(
        <>
          <button type="button" className="deal-btn deal-btn-ghost" onClick={onCancel}>
            {cancelText}
          </button>
          <button type="button" className="deal-btn deal-btn-danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      )}
    >
      <p className="deal-confirm-message">{message}</p>
    </Modal>
  );
}
