import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, cachedApi, readResponseCache, todayString } from '../lib/api';
import { toast } from 'react-toastify';

const AppContext = createContext();

export const useAppContext = () => useContext(AppContext);

const AUTO_REFRESH_MS = 60000;

export const AppProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('adsctrl-auth') === '1');
  const [provider, setProvider] = useState(() => localStorage.getItem('adsctrl-provider') || 'facebook');
  const [appConfig, setAppConfig] = useState({});
  const [stats, setStats] = useState({});
  const [allAccounts, setAllAccounts] = useState([]);
  const [allTodayCampaigns, setAllTodayCampaigns] = useState([]);
  const [todayOrderSkuCounts, setTodayOrderSkuCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [modalState, setModalState] = useState({ type: null, data: null });
  const liveLoadInFlight = useRef(false);

  const openModal = (type, data = null) => setModalState({ type, data });
  const closeModal = () => setModalState({ type: null, data: null });

  const loginFacebook = async (username, password) => {
    if (username === 'admin' && password === 'admin') {
      localStorage.setItem('adsctrl-auth', '1');
      localStorage.setItem('adsctrl-provider', 'facebook');
      setIsAuthenticated(true);
      setProvider('facebook');
      toast.success('Đăng nhập Facebook thành công');
      return true;
    }
    toast.error('Sai tài khoản hoặc mật khẩu Facebook');
    return false;
  };

  const loginShopee = async (username, password) => {
    if (username === 'admin1' && password === 'admin') {
      localStorage.setItem('adsctrl-auth', '1');
      localStorage.setItem('adsctrl-provider', 'shopee');
      setIsAuthenticated(true);
      setProvider('shopee');
      toast.success('Đăng nhập Shopee thành công');
      return true;
    }
    toast.error('Sai tài khoản hoặc mật khẩu Shopee');
    return false;
  };

  const login = async (username, password, type = 'facebook') => {
    if (type === 'facebook') {
      return loginFacebook(username, password);
    }
    if (type === 'shopee') {
      return loginShopee(username, password);
    }
    toast.error('Nhà cung cấp không hợp lệ');
    return false;
  };

  const logout = () => {
    localStorage.removeItem('adsctrl-auth');
    localStorage.removeItem('adsctrl-provider');
    setIsAuthenticated(false);
    setProvider('facebook');
  };

  const loadConfig = useCallback(async () => {
    try {
      const config = await api('GET', '/config');
      setAppConfig(config);
    } catch (e) {
      console.warn("Failed to load config", e);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const url = `/stats?provider=${provider}`;
      const cached = readResponseCache(`GET:${url}`);
      if (cached) setStats(cached);
      const data = await cachedApi('GET', url);
      setStats(data);
    } catch (e) {}
  }, [provider]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await api('GET', `/accounts?provider=${provider}`);
      setAllAccounts(data);
    } catch (e) {}
  }, [provider]);

  const loadTodayCampaigns = useCallback(async () => {
    try {
      const url = `/campaigns/today?provider=${provider}`;
      const cached = readResponseCache(`GET:${url}`);
      if (cached) setAllTodayCampaigns(cached);
      const data = await cachedApi('GET', url, null, { timeoutMs: 5 * 60 * 1000 });
      setAllTodayCampaigns(data);
    } catch (e) {}
  }, [provider]);

  const loadTodayOrderSkuCounts = useCallback(async () => {
    try {
      const today = todayString();
      const data = await api('GET', `/orders/sku-counts?fromDate=${today}`);
      setTodayOrderSkuCounts(data.counts || {});
    } catch (e) {}
  }, []);

  const loadLiveData = useCallback(async (options = {}) => {
    const { includeConfig = false, showLoading = false } = options;
    if (liveLoadInFlight.current && !showLoading) return;
    liveLoadInFlight.current = true;
    if (showLoading) setLoading(true);
    try {
      await Promise.all([
        loadStats(),
        loadAccounts(),
        loadTodayCampaigns(),
        includeConfig ? loadConfig() : Promise.resolve()
      ]);
      if (provider !== 'shopee') {
        loadTodayOrderSkuCounts();
      }
    } finally {
      liveLoadInFlight.current = false;
      if (showLoading) setLoading(false);
    }
  }, [loadStats, loadAccounts, loadTodayCampaigns, loadTodayOrderSkuCounts, loadConfig, provider]);

  const loadAll = useCallback(async () => {
    await loadLiveData({ includeConfig: true, showLoading: true });
  }, [loadLiveData]);

  const refreshAll = useCallback(async (isManual = true) => {
    try {
      if (isManual) toast.info('Đang làm mới dữ liệu...');
      // Phải lặp qua từng tài khoản vì backend không có endpoint refresh all
      const accounts = await api('GET', '/accounts');
      let skippedCount = 0;
      let failedCount = 0;
      for (const acc of accounts) {
        try {
          const result = await api('POST', `/accounts/${acc._id}/refresh`);
          if (result?.skipped) skippedCount += 1;
        } catch (err) {
          failedCount += 1;
          console.warn(`Không thể refresh tài khoản ${acc.name}:`, err);
        }
      }
      await loadAll();
      if (isManual && (failedCount || skippedCount)) {
        toast.warn(`Da tai xong, bo qua ${failedCount + skippedCount} tai khoan dang loi tam thoi`);
        return;
      }
      if (isManual) toast.success('Đã tải dữ liệu mới nhất');
    } catch (e) {
      if (isManual) toast.error('Lỗi làm mới: ' + e.message);
    }
  }, [loadAll]);

  useEffect(() => {
    if (isAuthenticated) {
      loadAll();
      const interval = setInterval(() => {
        loadLiveData();
      }, AUTO_REFRESH_MS);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, loadAll, loadLiveData]);

  return (
    <AppContext.Provider value={{
      provider, isAuthenticated, login, logout,
      appConfig, setAppConfig, loadConfig,
      stats, allAccounts, allTodayCampaigns, todayOrderSkuCounts,
      loading, loadAll, refreshAll, loadAccounts, loadTodayCampaigns, loadTodayOrderSkuCounts,
      modalState, openModal, closeModal
    }}>
      {children}
    </AppContext.Provider>
  );
};
