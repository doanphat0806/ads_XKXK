import React from 'react';

export default function InitialAutomationSettings({ checkInterval, autoEnabled, onChange }) {
  const handleIntervalChange = (event) => {
    onChange({ checkInterval: Number.parseInt(event.target.value, 10) });
  };

  const handleAutoEnabledChange = (event) => {
    onChange({ autoEnabled: event.target.checked });
  };

  return (
    <div style={{ padding: '12px', background: 'var(--s2)', borderRadius: 'var(--radius)', marginBottom: '15px' }}>
      <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '8px' }}>Cài đặt tự động ban đầu</div>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Thời gian check (s)</label>
          <input
            type="number"
            value={checkInterval}
            onChange={handleIntervalChange}
          />
        </div>
        <div className="toggle-wrap" style={{ marginTop: '25px' }}>
          <label className="tgl">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={handleAutoEnabledChange}
            />
            <div className="tgl-track"></div>
            <div className="tgl-thumb"></div>
          </label>
          <span>Bật tự động</span>
        </div>
      </div>
    </div>
  );
}
