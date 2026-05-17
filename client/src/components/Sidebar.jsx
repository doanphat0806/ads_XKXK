import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookText,
  Boxes,
  ChevronDown,
  CirclePlus,
  Coins,
  CopyPlus,
  FileSpreadsheet,
  LayoutDashboard,
  Megaphone,
  Package,
  PenSquare,
  ShoppingCart,
  Settings,
  Users
} from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';

export default function Sidebar() {
  const { stats, allAccounts, openModal, provider } = useAppContext();
  const location = useLocation();
  const showOrders = provider !== 'shopee';
  const showInventory = provider !== 'shopee';
  const dataPaths = ['/data-purchase-orders', '/inventory', '/orders', '/google-sheets'];
  const dataRouteActive = dataPaths.some(path => location.pathname === path);
  const [dataOpen, setDataOpen] = React.useState(dataRouteActive);

  React.useEffect(() => {
    if (dataRouteActive) setDataOpen(true);
  }, [dataRouteActive]);

  return (
    <nav className="sidebar" id="sidebar">
      <div className="sidebar-logo">
        <h1><span className="text">XekoXuka Shop</span></h1>
      </div>

      <div className="nav-section">Menu</div>

      {provider !== 'oder' && (
        <>
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
        </>
      )}

      {showOrders && (
        <NavLink to="/purchase-orders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon"><ShoppingCart size={16} strokeWidth={2} /></span><span>Đặt Hàng</span>
        </NavLink>
      )}

      {showInventory && provider !== 'oder' && (
        <NavLink to="/inventory-summary" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon"><BookText size={16} strokeWidth={2} /></span><span>Thong ke kho</span>
        </NavLink>
      )}

      {provider === 'shopee' && provider !== 'oder' && (
        <NavLink to="/shopee-commission" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon"><Coins size={16} strokeWidth={2} /></span><span>Hoa hong</span>
        </NavLink>
      )}

      {(showOrders || showInventory) && (
        <div className={`nav-group ${dataOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`nav-item nav-group-trigger ${dataRouteActive ? 'active' : ''}`}
            onClick={() => setDataOpen(open => !open)}
            aria-expanded={dataOpen}
          >
            <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span>
            <span>DATA</span>
            <ChevronDown className="nav-group-chevron" size={15} strokeWidth={2} />
          </button>

          {dataOpen && (
            <div className="nav-subitems">
              {showOrders && (
                <NavLink to="/data-purchase-orders" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`}>
                  <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span><span>DATA ĐẶT HÀNG</span>
                </NavLink>
              )}

              {showInventory && provider !== 'oder' && (
                <NavLink to="/inventory" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`}>
                  <span className="icon"><Boxes size={16} strokeWidth={2} /></span><span>Kho</span>
                </NavLink>
              )}

              {showOrders && provider !== 'oder' && (
                <NavLink to="/orders" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`}>
                  <span className="icon"><Package size={16} strokeWidth={2} /></span><span>Don hang</span>
                </NavLink>
              )}

              {provider !== 'oder' && (
                <NavLink to="/google-sheets" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`}>
                  <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span><span>Google Sheet</span>
                </NavLink>
              )}
            </div>
          )}
        </div>
      )}

      {provider !== 'oder' && (
        <>
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
        </>
      )}

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
