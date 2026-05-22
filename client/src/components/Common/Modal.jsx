import React from 'react';

export default function Modal({ open, title, onClose, children, footer, className = '' }) {
  if (!open) return null;

  return (
    <div className="deal-modal-backdrop" onClick={onClose}>
      <div
        className={`deal-modal ${className}`.trim()}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="deal-modal-header">
          <div className="deal-modal-title">{title}</div>
          <button type="button" className="deal-modal-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="deal-modal-body">{children}</div>
        {footer ? <div className="deal-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
