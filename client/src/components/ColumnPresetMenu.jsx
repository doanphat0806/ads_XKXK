import React, { useEffect, useRef, useState } from 'react';

// Menu tha xuong: danh sach phuong an cot da luu (bam de ap dung, x de xoa) + nut mo cua so tuy chinh.
export default function ColumnPresetMenu({ label, presets, activePreset, onSelect, onDelete, onCustomize }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const handleKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="colpreset" ref={rootRef}>
      <button type="button" className={`btn btn-ghost btn-sm${open ? ' is-open' : ''}`} onClick={() => setOpen(value => !value)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="colpreset-menu" role="menu">
          <div className="colpreset-title">Phương án</div>
          {presets.length === 0 && <div className="colpreset-empty">TAO TÊN CHEN JIN.</div>}
          {presets.map(preset => (
            <div key={preset.name} className={`colpreset-item${preset.name === activePreset ? ' is-active' : ''}`}>
              <button type="button" className="colpreset-apply" role="menuitem" onClick={() => { onSelect(preset); setOpen(false); }}>
                {preset.name}
              </button>
              <button
                type="button"
                className="colpreset-remove"
                onClick={() => { if (window.confirm(`Xóa phương án "${preset.name}"?`)) onDelete(preset.name); }}
                aria-label={`Xóa phương án ${preset.name}`}
              >×</button>
            </div>
          ))}
          <button type="button" className="colpreset-customize" onClick={() => { setOpen(false); onCustomize(); }}>
            Tùy chỉnh...
          </button>
        </div>
      )}
    </div>
  );
}
