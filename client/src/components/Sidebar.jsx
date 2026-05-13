import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  BookText,
  Boxes,
  CirclePlus,
  CopyPlus,
  FileSpreadsheet,
  LayoutDashboard,
  Megaphone,
  Package,
  PenSquare,
  Settings,
  Users
} from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';

export default function Sidebar() {
  const { stats, allAccounts, openModal, provider } = useAppContext();
  const showOrders = provider !== 'shopee';

  return (
    <nav className="sidebar" id="sidebar">
      <div className="sidebar-logo">
        <h1><span className="text">XekoXuka Shop</span></h1>
      </div>

      <div className="nav-section">Menu</div>

      <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
        <span className="icon"><LayoutDashboard size={16} strokeWidth={2} /></span><span>Dashboard</span>
      </NavLink>

      <NavLink to="/accounts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><Users size={16} strokeWidth={2} /></span><span>Tai khoan</span>
        {allAccounts.length > 0 && (
          <span className="badge-mini" id="navAccBadge">{allAccounts.length}</span>
        )}
      </NavLink>

      <NavLink to="/create-campaign" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><Megaphone size={16} strokeWidth={2} /></span><span>Len Camp</span>
      </NavLink>

      <NavLink to="/creater-page" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><PenSquare size={16} strokeWidth={2} /></span><span>Dang bai</span>
      </NavLink>

      <NavLink to="/campaigns" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><BarChart3 size={16} strokeWidth={2} /></span><span>Chien dich</span>
      </NavLink>

      <NavLink to="/clone-campaigns" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><CopyPlus size={16} strokeWidth={2} /></span><span>Nhan Camp</span>
      </NavLink>

      {showOrders && (
        <NavLink to="/orders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon"><Package size={16} strokeWidth={2} /></span><span>Don hang</span>
        </NavLink>
      )}

      <NavLink to="/inventory" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><Boxes size={16} strokeWidth={2} /></span><span>Kho</span>
      </NavLink>

      <NavLink to="/inventory-summary" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><BookText size={16} strokeWidth={2} /></span><span>Thong ke kho</span>
      </NavLink>

      <NavLink to="/google-sheets" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span><span>Google Sheet</span>
      </NavLink>

      <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon"><BookText size={16} strokeWidth={2} /></span><span>Nhat ky</span>
      </NavLink>

      <div className="nav-section">He thong</div>

      <div className="nav-item" style={{ cursor: 'pointer' }} onClick={() => openModal('ACCOUNT')}>
        <span className="icon"><CirclePlus size={16} strokeWidth={2} /></span><span>Them tai khoan</span>
      </div>

      <div className="nav-item" style={{ cursor: 'pointer' }} onClick={() => openModal('CONFIG')}>
        <span className="icon"><Settings size={16} strokeWidth={2} /></span><span>Cau hinh API</span>
      </div>

      <div className="sidebar-footer">
        <div className="global-status">
          <div className={`dot ${stats.connectedAccounts > 0 ? 'on' : ''}`} id="globalDot"></div>
          <span id="globalStatusTxt" style={{ fontSize: '11px', color: 'var(--muted2)' }}>
            {stats.connectedAccounts > 0 ? `${stats.connectedAccounts} online` : 'Offline'}
          </span>
        </div>
      </div>
    </nav>
  );
}
