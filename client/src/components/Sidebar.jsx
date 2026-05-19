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
  Users,
  UserCog
} from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';

export default function Sidebar() {
  const { stats, allAccounts, openModal, provider, currentUser } = useAppContext();
  const location = useLocation();
  const isOder = provider === 'oder';
  const isKho = provider === 'kho';
  const showAdMenu = !isOder && !isKho;
  const showOrders = provider !== 'shopee';
  const showInventory = provider !== 'shopee' && !isOder;
  const isAdmin = currentUser?.username === 'admin';
  const dataPaths = ['/data-purchase-orders', '/inventory', '/orders', '/google-sheets'];
  const dataRouteActive = dataPaths.some(path => location.pathname === path);
  const [dataOpen, setDataOpen] = React.useState(dataRouteActive);
  const [isTouchExpanded, setIsTouchExpanded] = React.useState(false);

  React.useEffect(() => {
    if (dataRouteActive) setDataOpen(true);
  }, [dataRouteActive]);

  return (
    <nav className={`sidebar ${isTouchExpanded ? 'is-touch-expanded' : ''}`} id="sidebar" aria-label="Main menu">
      <div className="sidebar-logo">
        <button
          type="button"
          className="sidebar-logo-btn"
          onClick={() => setIsTouchExpanded(value => !value)}
          aria-label={isTouchExpanded ? 'Thu gon menu' : 'Mo menu'}
          aria-expanded={isTouchExpanded}
          title="Mo menu"
        >
          <img className="logo-mark" src="/logo.jpg" alt="XekoXuka Shop" />
          <span className="text">XekoXuka Shop</span>
        </button>
      </div>

      {isOder && (
        <NavLink to="/oder-dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Dashboard">
          <span className="icon"><LayoutDashboard size={16} strokeWidth={2} /></span><span>Dashboard</span>
        </NavLink>
      )}

      {showAdMenu && (
        <>
          <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Dashboard" end>
            <span className="icon"><LayoutDashboard size={16} strokeWidth={2} /></span><span>Dashboard</span>
          </NavLink>

          <NavLink to="/accounts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Tai khoan">
            <span className="icon"><Users size={16} strokeWidth={2} /></span><span>Tai khoan</span>
            {allAccounts.length > 0 && (
              <span className="badge-mini" id="navAccBadge">{allAccounts.length}</span>
            )}
          </NavLink>

          <NavLink to="/create-campaign" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Len Camp">
            <span className="icon"><Megaphone size={16} strokeWidth={2} /></span><span>Len Camp</span>
          </NavLink>

          <NavLink to="/creater-page" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Dang bai">
            <span className="icon"><PenSquare size={16} strokeWidth={2} /></span><span>Dang bai</span>
          </NavLink>

          <NavLink to="/campaigns" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Chien dich">
            <span className="icon"><BarChart3 size={16} strokeWidth={2} /></span><span>Chien dich</span>
          </NavLink>

          <NavLink to="/clone-campaigns" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Nhan Camp">
            <span className="icon"><CopyPlus size={16} strokeWidth={2} /></span><span>Nhan Camp</span>
          </NavLink>
        </>
      )}

      {showOrders && (
        <>
          <NavLink to="/purchase-orders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Dat Hang">
            <span className="icon"><ShoppingCart size={16} strokeWidth={2} /></span><span>Đặt Hàng</span>
          </NavLink>
          <NavLink to="/oder-dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Dashboard Dat Hang">
            <span className="icon"><BarChart3 size={16} strokeWidth={2} /></span><span>Dashboard Đặt Hàng</span>
          </NavLink>
        </>
      )}

      {showInventory && (
        <NavLink to="/inventory-summary" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Thong ke kho">
          <span className="icon"><BookText size={16} strokeWidth={2} /></span><span>Thong ke kho</span>
        </NavLink>
      )}

      {provider === 'shopee' && (
        <NavLink to="/shopee-commission" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Hoa hong">
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
            title="DATA"
          >
            <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span>
            <span>DATA</span>
            <ChevronDown className="nav-group-chevron" size={15} strokeWidth={2} />
          </button>

          {dataOpen && (
            <div className="nav-subitems">
              {showOrders && (
                <NavLink to="/data-purchase-orders" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`} title="DATA Dat Hang">
                  <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span><span>DATA ĐẶT HÀNG</span>
                </NavLink>
              )}

              {showInventory && (
                <NavLink to="/inventory" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`} title="Kho">
                  <span className="icon"><Boxes size={16} strokeWidth={2} /></span><span>Kho</span>
                </NavLink>
              )}

              {showOrders && showAdMenu && (
                <NavLink to="/orders" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`} title="Don hang">
                  <span className="icon"><Package size={16} strokeWidth={2} /></span><span>Don hang</span>
                </NavLink>
              )}

              {!isOder && (
                <NavLink to="/google-sheets" className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`} title="Google Sheet">
                  <span className="icon"><FileSpreadsheet size={16} strokeWidth={2} /></span><span>Google Sheet</span>
                </NavLink>
              )}
            </div>
          )}
        </div>
      )}

      {showAdMenu && (
        <>
          <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Nhat ky">
            <span className="icon"><BookText size={16} strokeWidth={2} /></span><span>Nhat ky</span>
          </NavLink>

          {isAdmin && (
            <NavLink to="/user-management" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Quan ly users">
              <span className="icon"><UserCog size={16} strokeWidth={2} /></span><span>Quan ly users</span>
            </NavLink>
          )}

          <div className="nav-item" style={{ cursor: 'pointer' }} onClick={() => openModal('ACCOUNT')} title="Them tai khoan">
            <span className="icon"><CirclePlus size={16} strokeWidth={2} /></span><span>Them tai khoan</span>
          </div>

          <div className="nav-item" style={{ cursor: 'pointer' }} onClick={() => openModal('CONFIG')} title="Cau hinh API">
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
