import React from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AppProvider, useAppContext } from './contexts/AppContext';
import AuthScreen from './components/AuthScreen';
import ModalContainer from './components/ModalContainer';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Accounts from './pages/Accounts';
import Campaigns from './pages/Campaigns';
import CloneCampaigns from './pages/CloneCampaigns';
import CreaterPage from './pages/CreaterPage';
import Dashboard from './pages/Dashboard';
import DataPurchaseOrders from './pages/DataPurchaseOrders';
import DealStopOrders from './pages/DealStopOrders';
import GoogleSheets from './pages/GoogleSheets';
import Inventory from './pages/Inventory';
import InventorySummary from './pages/InventorySummary';
import Logs from './pages/Logs';
import OderDashboard from './pages/OderDashboard';
import Orders from './pages/Orders';
import CreateCampaign from './pages/Pages';
import PurchaseOrders from './pages/PurchaseOrders';
import ReturnSummary from './pages/ReturnSummary';
import ShopeeCommission from './pages/ShopeeCommission';
import ReportDashboard from './pages/ReportDashboard';
import UserManagement from './pages/UserManagement';

function AppContent() {
  const { isAuthenticated, provider, currentUser } = useAppContext();
  const isOder = provider === 'oder';
  const isKho = provider === 'kho';
  const isFacebook = provider === 'facebook';
  const isAdmin = currentUser?.username === 'admin';
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
      case '/return-summary':
        return 'Tổng hoàn';
      case '/user-management':
        return isAdmin ? 'Quản lý tài khoản' : 'Dashboard';
      case '/accounts':
        return 'Tài khoản';
      case '/campaigns':
        return 'Chiến dịch';
      case '/clone-campaigns':
        return 'Nhân Camp';
      case '/orders':
        return 'Đơn hàng';
      case '/purchase-orders':
        return 'Đặt Hàng';
      case '/deal-stop-orders':
        return 'Đóng Deal Dừng Order';
      case '/data-purchase-orders':
        return 'DATA ĐẶT HÀNG';
      case '/logs':
        return 'Nhật ký';
      case '/inventory':
        return 'Kho';
      case '/inventory-summary':
        return 'Thống kê kho';
      case '/shopee-commission':
        return 'Hoa hồng Shopee';
      case '/report-dashboard':
        return 'Báo Cáo Giám Sát';
      case '/google-sheets':
        return 'Google Sheets';
      case '/creater-page':
        return 'Đăng bài';
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
                <Route path="/deal-stop-orders" element={<DealStopOrders />} />
                <Route path="/data-purchase-orders" element={<DataPurchaseOrders />} />
                <Route path="/return-summary" element={<Navigate to="/oder-dashboard" replace />} />
                <Route path="*" element={<Navigate to="/oder-dashboard" replace />} />
              </>
            ) : isKho ? (
              <>
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/deal-stop-orders" element={<DealStopOrders />} />
                <Route path="/data-purchase-orders" element={<DataPurchaseOrders />} />
                <Route path="/oder-dashboard" element={<OderDashboard />} />
                <Route path="/return-summary" element={<Navigate to="/inventory" replace />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/inventory-summary" element={<InventorySummary />} />
                <Route path="/google-sheets" element={<GoogleSheets />} />
                <Route path="*" element={<Navigate to="/inventory" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/oder-dashboard" element={<OderDashboard />} />
                <Route path="/return-summary" element={isFacebook ? <ReturnSummary /> : <Navigate to="/" replace />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/clone-campaigns" element={<CloneCampaigns />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/deal-stop-orders" element={<DealStopOrders />} />
                <Route path="/data-purchase-orders" element={<DataPurchaseOrders />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/inventory-summary" element={<InventorySummary />} />
                <Route path="/shopee-commission" element={<ShopeeCommission />} />
                <Route path="/report-dashboard" element={<ReportDashboard />} />
                <Route path="/google-sheets" element={<GoogleSheets />} />
                <Route path="/creater-page" element={<CreaterPage />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/create-campaign" element={<CreateCampaign />} />
                <Route path="/user-management" element={isAdmin ? <UserManagement /> : <Navigate to="/" replace />} />
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
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </AppProvider>
  );
}
