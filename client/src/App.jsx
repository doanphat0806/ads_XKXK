import React, { Suspense } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppProvider, useAppContext } from './contexts/AppContext';
import AuthScreen from './components/AuthScreen';

const ModalContainer = React.lazy(() => import('./components/ModalContainer'));
const Sidebar = React.lazy(() => import('./components/Sidebar'));
const Topbar = React.lazy(() => import('./components/Topbar'));
const ToastLayer = React.lazy(() => import('./components/ToastLayer'));
const Accounts = React.lazy(() => import('./pages/Accounts'));
const Campaigns = React.lazy(() => import('./pages/Campaigns'));
const CloneCampaigns = React.lazy(() => import('./pages/CloneCampaigns'));
const CreaterPage = React.lazy(() => import('./pages/CreaterPage'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const DataPurchaseOrders = React.lazy(() => import('./pages/DataPurchaseOrders'));
const DealStopOrders = React.lazy(() => import('./pages/DealStopOrders'));
const GoogleSheets = React.lazy(() => import('./pages/GoogleSheets'));
const Inventory = React.lazy(() => import('./pages/Inventory'));
const InventorySummary = React.lazy(() => import('./pages/InventorySummary'));
const Logs = React.lazy(() => import('./pages/Logs'));
const OderDashboard = React.lazy(() => import('./pages/OderDashboard'));
const Orders = React.lazy(() => import('./pages/Orders'));
const CreateCampaign = React.lazy(() => import('./pages/Pages'));
const PurchaseOrders = React.lazy(() => import('./pages/PurchaseOrders'));
const ReturnSummary = React.lazy(() => import('./pages/ReturnSummary'));
const ShopeeCommission = React.lazy(() => import('./pages/ShopeeCommission'));
const ReportDashboard = React.lazy(() => import('./pages/ReportDashboard'));
const ShopeeStats = React.lazy(() => import('./pages/ShopeeStats'));
const ShopeeAffAccounts = React.lazy(() => import('./pages/ShopeeAffAccounts'));
const UserManagement = React.lazy(() => import('./pages/UserManagement'));

function RouteLoading() {
  return (
    <div className="empty">
      <span className="spin">...</span>
      <p>Dang tai...</p>
    </div>
  );
}

function ShellLoading() {
  return <div className="empty"><span className="spin">...</span></div>;
}

function AppContent() {
  const { isAuthenticated, provider, currentUser, modalState } = useAppContext();
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
      case '/shopee-stats':
        return 'Thống kê Shopee';
      case '/shopee-aff-accounts':
        return 'Tài khoản AFF Shopee';
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
      <Suspense fallback={<ShellLoading />}>
        <Sidebar />
      </Suspense>
      <div className="main">
        <Suspense fallback={<ShellLoading />}>
          <Topbar title={getPageTitle()} />
        </Suspense>
        <div className="content">
          <Suspense fallback={<RouteLoading />}>
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
                  <Route path="/shopee-stats" element={<ShopeeStats />} />
                  <Route path="/shopee-aff-accounts" element={<ShopeeAffAccounts />} />
                  <Route path="/google-sheets" element={<GoogleSheets />} />
                  <Route path="/creater-page" element={<CreaterPage />} />
                  <Route path="/logs" element={<Logs />} />
                  <Route path="/create-campaign" element={<CreateCampaign />} />
                  <Route path="/user-management" element={isAdmin ? <UserManagement /> : <Navigate to="/" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
          </Suspense>
        </div>
      </div>
      {modalState.type && (
        <Suspense fallback={null}>
          <ModalContainer />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router>
        <AppContent />
      </Router>
      <Suspense fallback={null}>
        <ToastLayer />
      </Suspense>
    </AppProvider>
  );
}
