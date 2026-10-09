import React from 'react';
import { LogOut, Settings } from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';

export default function Topbar({ title }) {
  const { provider, openModal, logout } = useAppContext();
  const showAdActions = provider !== 'oder' && provider !== 'kho';

  return (
    <div className="topbar">
      <div className="topbar-title">
        <button
          type="button"
          className="topbar-menu-btn"
          onClick={() => window.dispatchEvent(new Event('app:toggle-sidebar'))}
          aria-label="Mo menu"
        >
          ☰
        </button>
        <span id="pageTitle">{title}</span>
      </div>
      <div className="topbar-actions">
        <span id="dateLabel" style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted2)' }}>
          {new Date().toLocaleDateString('vi-VN')}
        </span>
        {showAdActions && (
          <button className="btn btn-ghost btn-sm topbar-icon-btn" onClick={() => openModal('CONFIG')} title="Cấu hình">
            <Settings size={15} strokeWidth={2} /> <span>Cấu hình</span>
          </button>
        )}
        <button className="btn btn-danger btn-sm topbar-icon-btn" onClick={logout} title="Đăng xuất">
          <LogOut size={15} strokeWidth={2} /> <span>Đăng xuất</span>
        </button>
      </div>
    </div>
  );
}
