import React from 'react';

export default function ColumnToggle({ columns, visibility, onToggle }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="deal-dropdown">
      <button type="button" className="deal-btn deal-btn-ghost" onClick={() => setOpen(value => !value)}>
        👁 Hiện/Ẩn Cột ▼
      </button>
      {open ? (
        <div className="deal-dropdown-menu">
          {columns.map(column => (
            <label key={column.id} className="deal-dropdown-item">
              <input
                type="checkbox"
                checked={visibility[column.id] !== false}
                onChange={() => onToggle(column.id)}
              />
              <span>{column.header}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
