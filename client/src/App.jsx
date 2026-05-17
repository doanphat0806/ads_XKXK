import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AppProvider, useAppContext } from './contexts/AppContext';
import AuthScreen from './components/AuthScreen';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Campaigns from './pages/Campaigns';
import CloneCampaigns from './pages/CloneCampaigns';
import Orders from './pages/Orders';
import PurchaseOrders from './pages/PurchaseOrders';
import DataPurchaseOrders from './pages/DataPurchaseOrders';
import Logs from './pages/Logs';
import Inventory from './pages/Inventory';
import InventorySummary from './pages/InventorySummary';
import GoogleSheets from './pages/GoogleSheets';
import CreaterPage from './pages/CreaterPage';
import CreateCampaign from './pages/Pages';
import ShopeeCommission from './pages/ShopeeCommission';
import OderDashboard from './pages/OderDashboard';
import ModalContainer from './components/ModalContainer';

function AppContent() {
  const { isAuthenticated, provider } = useAppContext();
  const isOder = provider === 'oder';
  const location = useLocation();

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/':
        return 'Dashboard';
      case '/oder-dashboard':
        return 'Dashboard Đơn Hàng';
      case '/accounts':
        return 'Tai khoan';
      case '/campaigns':
        return 'Chien dich';
      case '/clone-campaigns':
        return 'Nhan Camp';
      case '/orders':
        return 'Don hang';
      case '/purchase-orders':
        return 'Đặt Hàng';
      case '/data-purchase-orders':
        return 'DATA ĐẶT HÀNG';
      case '/logs':
        return 'Nhat ky';
      case '/inventory':
        return 'Kho';
      case '/inventory-summary':
        return 'Thong ke kho';
      case '/shopee-commission':
        return 'Hoa hong Shopee';
      case '/google-sheets':
        return 'Google Sheets';
      case '/creater-page':
        return 'Dang bai';
      case '/create-campaign':
        return 'Page';
      default:
        return 'Dashboard';
    }
  };

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <Topbar title={getPageTitle()} />
        <div className="content">
          <Routes>
            {isOder ? (
              <>
                <Route path="/oder-dashboard" element={<OderDashboard />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/data-purchase-orders" element={<DataPurchaseOrders />} />
                <Route path="*" element={<Navigate to="/oder-dashboard" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/oder-dashboard" element={<OderDashboard />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/clone-campaigns" element={<CloneCampaigns />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/data-purchase-orders" element={<DataPurchaseOrders />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/inventory-summary" element={<InventorySummary />} />
                <Route path="/shopee-commission" element={<ShopeeCommission />} />
                <Route path="/google-sheets" element={<GoogleSheets />} />
                <Route path="/creater-page" element={<CreaterPage />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/create-campaign" element={<CreateCampaign />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </div>
      </div>
      <ModalContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router>
        <AppContent />
      </Router>
      <ToastContainer position="bottom-right" autoClose={3000} hideProgressBar theme="dark" />
    </AppProvider>
  );
}
