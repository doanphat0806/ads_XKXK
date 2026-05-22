import React from 'react';

export default function ExportButton({ loading, done, onClick }) {
  let label = '📥 Xuất Excel';
  if (loading) label = '⏳ Đang xuất...';
  if (done) label = '✅ Xong!';

  return (
    <button type="button" className="deal-btn deal-btn-primary" onClick={onClick} disabled={loading}>
      {label}
    </button>
  );
}
