import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, cachedApi, readResponseCache, todayString } from '../lib/api';
import { setGeminiKeyStatus } from '../lib/gemini';
import { notify } from '../lib/notify';

const AppContext = createContext();

export const useAppContext = () => useContext(AppContext);

const AUTO_REFRESH_MS = 60000;

export const AppProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem('adsctrl-token')));
  const [provider, setProvider] = useState(() => localStorage.getItem('adsctrl-provider') || 'facebook');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('adsctrl-user') || 'null') || null;
    } catch {
      return null;
    }
  });
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

  useEffect(() => {
    if (isAuthenticated && currentUser) {
      setGeminiKeyStatus(Boolean(currentUser.hasGeminiKey));
    }
  }, [isAuthenticated, currentUser]);

  const login = async (username, password, type = 'facebook') => {
    try {
      const result = await api('POST', '/auth/login', { username, password, provider: type });
      localStorage.setItem('adsctrl-token', result.token);
      localStorage.setItem('adsctrl-provider', result.user?.provider || type);
      localStorage.setItem('adsctrl-user', JSON.stringify(result.user || null));
      setGeminiKeyStatus(Boolean(result.user?.hasGeminiKey));
      setCurrentUser(result.user || null);
      setIsAuthenticated(true);
      setProvider(result.user?.provider || type);
      notify.success('Dang nhap thanh cong');
      return true;
    } catch (error) {
      notify.error(error.message || 'Sai tai khoan hoac mat khau');
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('adsctrl-token');
    localStorage.removeItem('adsctrl-auth');
    localStorage.removeItem('adsctrl-provider');
    localStorage.removeItem('adsctrl-user');
    setGeminiKeyStatus(false);
    sessionStorage.clear();
    setCurrentUser(null);
    setStats({});
    setAllAccounts([]);
    setAllTodayCampaigns([]);
    setTodayOrderSkuCounts({});
    setIsAuthenticated(false);
    setProvider('facebook');
  };

  const loadConfig = useCallback(async () => {
    try {
      const config = await api('GET', '/config');
      setAppConfig(config);
    } catch (e) {
      console.warn('Failed to load config', e);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const today = todayString();
      const url = `/stats?provider=${provider}&fromDate=${today}&toDate=${today}&includeOrders=false`;
      const cached = readResponseCache(`GET:${url}`);
      if (cached) setStats(cached);
      const data = await cachedApi('GET', url);
      setStats(data);
    } catch (e) {
      if (e.status === 401) logout();
    }
  }, [provider]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await api('GET', `/accounts?provider=${provider}`);
      setAllAccounts(data);
    } catch (e) {
      if (e.status === 401) logout();
    }
  }, [provider]);

  const loadTodayCampaigns = useCallback(async () => {
    try {
      const today = todayString();
      const url = `/campaigns/today?provider=${provider}&fromDate=${today}&toDate=${today}`;
      const cached = readResponseCache(`GET:${url}`);
      if (cached) setAllTodayCampaigns(cached);
      const data = await cachedApi('GET', url, null, { timeoutMs: 5 * 60 * 1000 });
      setAllTodayCampaigns(data);
    } catch (e) {
      if (e.status === 401) logout();
    }
  }, [provider]);

  const loadTodayOrderSkuCounts = useCallback(async () => {
    try {
      const today = todayString();
      const url = `/orders/sku-counts?fromDate=${today}&toDate=${today}`;
      const cached = readResponseCache(`GET:${url}`);
      if (cached) setTodayOrderSkuCounts(cached.counts || {});
      const data = await cachedApi('GET', url);
      setTodayOrderSkuCounts(data.counts || {});
    } catch (e) {
      if (e.status === 401) logout();
    }
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
      if (isManual) notify.info('Dang lam moi du lieu...');
      const accounts = await api('GET', '/accounts');
      let skippedCount = 0;
      let failedCount = 0;
      for (const acc of accounts) {
        try {
          const result = await api('POST', `/accounts/${acc._id}/refresh`);
          if (result?.skipped) skippedCount += 1;
        } catch (err) {
          failedCount += 1;
          console.warn(`Khong the refresh tai khoan ${acc.name}:`, err);
        }
      }
      await loadAll();
      if (isManual && (failedCount || skippedCount)) {
        notify.warn(`Da tai xong, bo qua ${failedCount + skippedCount} tai khoan dang loi tam thoi`);
        return;
      }
      if (isManual) notify.success('Da tai du lieu moi nhat');
    } catch (e) {
      if (isManual) notify.error('Loi lam moi: ' + e.message);
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
      provider, isAuthenticated, currentUser, login, logout,
      appConfig, setAppConfig, loadConfig,
      stats, allAccounts, allTodayCampaigns, todayOrderSkuCounts,
      loading, loadAll, refreshAll, loadAccounts, loadTodayCampaigns, loadTodayOrderSkuCounts,
      modalState, openModal, closeModal
    }}>
      {children}
    </AppContext.Provider>
  );
};
