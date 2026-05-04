import React, { useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { toast } from 'react-toastify';

const DEFAULT_THEME = {
  bg: '#eef8ff',
  primary: '#1976f3'
};

export default function ThemeModal() {
  const { closeModal, theme, setTheme } = useAppContext();
  const [draft, setDraft] = useState({ ...DEFAULT_THEME, ...(theme || {}) });

  const save = () => {
    setTheme(draft);
    toast.success('Da luu mau giao dien');
    closeModal();
  };

  const reset = () => {
    setDraft(DEFAULT_THEME);
    setTheme(DEFAULT_THEME);
    toast.success('Da dat lai mau mac dinh');
  };

  return (
    <div className="card" style={{ border: 'none', margin: 0, width: '420px', maxWidth: '95vw' }}>
      <div className="card-header">
        <div className="card-title">Tuy chinh mau</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>x</button>
      </div>
      <div style={{ padding: '20px' }}>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-group">
            <label>Mau nen</label>
            <input
              type="color"
              value={draft.bg}
              onChange={e => setDraft({ ...draft, bg: e.target.value })}
              style={{ height: '42px', padding: '4px' }}
            />
          </div>
          <div className="form-group">
            <label>Mau chinh</label>
            <input
              type="color"
              value={draft.primary}
              onChange={e => setDraft({ ...draft, primary: e.target.value })}
              style={{ height: '42px', padding: '4px' }}
            />
          </div>
        </div>
        <div
          style={{
            marginTop: '18px',
            height: '74px',
            borderRadius: '14px',
            border: '1px solid var(--border)',
            background: draft.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: draft.primary,
            fontWeight: 800
          }}
        >
          Xem truoc mau
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Mac dinh</button>
          <button className="btn btn-g btn-sm" onClick={save}>Luu mau</button>
        </div>
      </div>
    </div>
  );
}
