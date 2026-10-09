import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import { toast } from 'react-toastify';
import {
  hasGeminiApiKey,
  loadGeminiApiKeyStatus,
  onGeminiApiKeyChange,
  removeGeminiApiKey,
  saveGeminiApiKey
} from '../../lib/gemini';
import { notify } from '../../lib/notify';

export default function ConfigModal() {
  const { closeModal, appConfig, loadConfig, provider, currentUser, refreshAll, loadAccounts, openModal } = useAppContext();
  const isShopee = provider === 'shopee';
  const showAdActions = provider !== 'oder' && provider !== 'kho';

  const [discovering, setDiscovering] = useState(false);
  const [userGeminiKey, setUserGeminiKey] = useState('');
  const [userGeminiReady, setUserGeminiReady] = useState(() => hasGeminiApiKey());
  const [testingUserGeminiKey, setTestingUserGeminiKey] = useState(false);

  useEffect(() => {
    const syncGeminiStatus = () => setUserGeminiReady(hasGeminiApiKey());
    syncGeminiStatus();
    return onGeminiApiKeyChange(syncGeminiStatus);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadGeminiApiKeyStatus()
      .then(hasKey => setUserGeminiReady(hasKey))
      .catch(error => console.warn('Failed to load Gemini key status', error));
  }, [currentUser]);

  const saveUserGeminiKey = async () => {
    if (!userGeminiKey.trim()) {
      notify.error('Vui long nhap Gemini API Key');
      return;
    }
    setTestingUserGeminiKey(true);
    try {
      await saveGeminiApiKey(userGeminiKey);
      setUserGeminiKey('');
      setUserGeminiReady(true);
      notify.success('Gemini API Key hop le va da luu vao database');
    } catch (error) {
      console.error('Gemini key save failed:', error);
      if (error?.status === 401) {
        setUserGeminiReady(false);
        notify.error('API Key khong hop le hoac khong dung duoc voi Gemini API');
        return;
      }
      if (error?.status === 429) {
        notify.error('Da vuot rate limit, thu lai sau 60 giay');
        return;
      }
      notify.error(`Luu Gemini key loi: ${error.message}`);
    } finally {
      setTestingUserGeminiKey(false);
    }
  };

  const removeUserGeminiKey = async () => {
    if (!window.confirm('Bạn chắc chắn muốn xóa Gemini API Key của tài khoản này?')) return;
    try {
      await removeGeminiApiKey();
      setUserGeminiKey('');
      setUserGeminiReady(false);
      notify.success('Da xoa Gemini API Key khoi database');
    } catch (error) {
      notify.error(`Xoa Gemini key loi: ${error.message}`);
    }
  };

  const handleAutoDiscover = async () => {
    if (discovering) return;
    setDiscovering(true);
    try {
      notify.info('Dang dong bo tai khoan duoc gan trong BM...');
      const result = await api('POST', '/accounts/auto-discover', {
        provider,
        fast: true,
        maxPages: 5
      }, {
        timeoutMs: 90000
      });
      await loadAccounts();
      notify.success(result.message || 'Da dong bo tai khoan duoc gan trong BM');
    } catch (e) {
      if (e.rateLimited || e.status === 429) {
        notify.info('Facebook dang gioi han Auto Discover. Doi vai phut roi bam lai.');
        return;
      }
      notify.error('Loi: ' + e.message);
    } finally {
      setDiscovering(false);
    }
  };

  const [fbToken, setFbToken] = useState('');
  const [fbApp, setFbApp] = useState({ id: '', secret: '' });
  const [fbOAuthLoading, setFbOAuthLoading] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [pancake, setPancake] = useState({ apiKey: '', shopId: '' });
  const [scheduledPauseTime, setScheduledPauseTime] = useState('21:00');
  const [tab, setTab] = useState('general');
  const [viaProfiles, setViaProfiles] = useState([]);
  const [viaLoading, setViaLoading] = useState(false);

  const loadViaProfiles = async () => {
    setViaLoading(true);
    try {
      setViaProfiles(await api('GET', '/fb-profiles'));
    } catch (e) {
      toast.error('Không tải được danh sách VIA: ' + e.message);
    } finally {
      setViaLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'connect' && showAdActions) loadViaProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const removeVia = async (via) => {
    if (!window.confirm(`Xóa VIA "${via.name}"? ${via.accountCount} TKQC vẫn giữ token hiện tại cho đến khi hết hạn.`)) return;
    try {
      await api('DELETE', `/fb-profiles/${via._id}`);
      toast.success('Đã xóa VIA');
      loadViaProfiles();
    } catch (e) {
      toast.error('Lỗi: ' + e.message);
    }
  };
  const [autoLimits, setAutoLimits] = useState({
    dailyZero: 25000, dailyOne: 25000, dailyFewThreshold: 0, dailyFewSpend: 0, dailyCheapCost: 0, dailyCheapSpend: 0, dailyHighCost: 20000, dailyHighSpend: 50000,
    lifetimeZero: 25000, lifetimeOne: 25000, lifetimeFewThreshold: 0, lifetimeFewSpend: 0, lifetimeCheapCost: 0, lifetimeCheapSpend: 0, lifetimeHighCost: 20000, lifetimeHighSpend: 50000,
    dailyClickLimit: 0, lifetimeClickLimit: 0,
    dailyCpcLimit: 600, lifetimeCpcLimit: 600,
    autoPauseCpoLimit: 100000,
    autoPauseCpoLimitLifetime: 100000,
    autoPauseMultiOrderThreshold: 2,
    autoPauseMultiOrderThresholdLifetime: 2,
    autoPauseMultiOrderCpoLimit: 0,
    autoPauseMultiOrderCpoLimitLifetime: 0,
    autoPauseZeroOrderSpendLimit: 60000,
    autoPauseZeroOrderSpendLimitLifetime: 60000,
    autoPauseShopeeMinSpendLimit: 50000
  });

  useEffect(() => {
    if (appConfig) {
      setFbApp({ id: appConfig.fbAppId || '', secret: '' });
      setPancake({ apiKey: '', shopId: appConfig.pancakeShopId || '' });
      setScheduledPauseTime(appConfig.scheduledDuplicatePauseTime || '21:00');
      setAutoLimits({
        dailyZero: appConfig.dailyZeroMessageSpendLimit || 25000,
        dailyOne: appConfig.dailyOneMessageSpendLimit || 25000,
        dailyFewThreshold: appConfig.dailyFewMessageThreshold || 0,
        dailyFewSpend: appConfig.dailyFewMessageSpendLimit || 0,
        dailyCheapCost: appConfig.dailyCheapMessageCostLimit || 0,
        dailyCheapSpend: appConfig.dailyCheapMessageSpendLimit || 0,
        dailyHighCost: appConfig.dailyHighCostPerMessageLimit ?? 20000,
        dailyHighSpend: appConfig.dailyHighCostSpendLimit ?? 50000,
        lifetimeZero: appConfig.lifetimeZeroMessageSpendLimit || 25000,
        lifetimeOne: appConfig.lifetimeOneMessageSpendLimit || 25000,
        lifetimeFewThreshold: appConfig.lifetimeFewMessageThreshold || 0,
        lifetimeFewSpend: appConfig.lifetimeFewMessageSpendLimit || 0,
        lifetimeCheapCost: appConfig.lifetimeCheapMessageCostLimit || 0,
        lifetimeCheapSpend: appConfig.lifetimeCheapMessageSpendLimit || 0,
        lifetimeHighCost: appConfig.lifetimeHighCostPerMessageLimit ?? 20000,
        lifetimeHighSpend: appConfig.lifetimeHighCostSpendLimit ?? 50000,
        dailyClickLimit: appConfig.dailyClickLimit || 0,
        lifetimeClickLimit: appConfig.lifetimeClickLimit || 0,
        dailyCpcLimit: appConfig.dailyCpcLimit || 600,
        lifetimeCpcLimit: appConfig.lifetimeCpcLimit || 600,
        autoPauseCpoLimit: appConfig.autoPauseCpoLimit ?? 100000,
        autoPauseCpoLimitLifetime: appConfig.autoPauseCpoLimitLifetime ?? 100000,
        autoPauseMultiOrderThreshold: appConfig.autoPauseMultiOrderThreshold ?? 2,
        autoPauseMultiOrderThresholdLifetime: appConfig.autoPauseMultiOrderThresholdLifetime ?? 2,
        autoPauseMultiOrderCpoLimit: appConfig.autoPauseMultiOrderCpoLimit ?? 0,
        autoPauseMultiOrderCpoLimitLifetime: appConfig.autoPauseMultiOrderCpoLimitLifetime ?? 0,
        autoPauseZeroOrderSpendLimit: appConfig.autoPauseZeroOrderSpendLimit ?? 60000,
        autoPauseZeroOrderSpendLimitLifetime: appConfig.autoPauseZeroOrderSpendLimitLifetime ?? 60000,
        autoPauseShopeeMinSpendLimit: appConfig.autoPauseShopeeMinSpendLimit ?? 50000
      });
    }
  }, [appConfig, isShopee]);

  const save = async (path, body, successMsg) => {
    try {
      await api('PUT', path, body);
      await loadConfig();
      toast.success(successMsg);
      return true;
    } catch (e) {
      toast.error('Lỗi: ' + e.message);
      return false;
    }
  };

  const loginFacebookOAuth = async () => {
    if (fbOAuthLoading) return;
    setFbOAuthLoading(true);

    const handleMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'adsctrl:facebook-oauth') return;

      window.removeEventListener('message', handleMessage);
      setFbOAuthLoading(false);

      const payload = event.data.payload || {};
      if (!payload.ok) {
        toast.error('Facebook login lỗi: ' + (payload.error || 'Không xác định'));
        return;
      }

      await loadConfig();
      setFbToken('');
      toast.success(payload.fbName
        ? `Đã đăng nhập Facebook: ${payload.fbName}. Đang tự đồng bộ tài khoản quảng cáo...`
        : 'Đã đăng nhập Facebook. Đang tự đồng bộ tài khoản quảng cáo...');
      // Tu lay tai khoan quang cao cua Facebook vua dang nhap + thay token moi cho tai khoan da co
      await handleAutoDiscover();
    };

    try {
      if (fbApp.id || fbApp.secret) {
        await api('PUT', '/config', { fbAppId: fbApp.id, fbAppSecret: fbApp.secret });
      }
      const result = await api('GET', '/facebook/oauth/start');
      window.addEventListener('message', handleMessage);
      const popup = window.open(result.authUrl, 'facebook-oauth', 'width=720,height=760');
      if (!popup) {
        window.removeEventListener('message', handleMessage);
        setFbOAuthLoading(false);
        toast.error('Trình duyệt đã chặn popup. Hãy cho phép popup rồi thử lại.');
        return;
      }

      const checkTimer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(checkTimer);
          if (fbOAuthLoading) {
            window.removeEventListener('message', handleMessage);
            setFbOAuthLoading(false);
          }
        }
      }, 500);

    } catch (e) {
      window.removeEventListener('message', handleMessage);
      setFbOAuthLoading(false);
      toast.error('Lỗi Facebook login: ' + e.message);
    }
  };

  const setLimit = (key) => (e) => setAutoLimits(prev => ({ ...prev, [key]: e.target.value }));
  const numInput = (key, placeholder = '0') => (
    <input type="number" inputMode="numeric" min="0" placeholder={placeholder} value={autoLimits[key]} onChange={setLimit(key)} />
  );

  const fbLimitGroups = [
    {
      title: 'Theo tin nhắn',
      rows: [
        { label: '0 tin nhắn', hint: 'Tắt khi tiêu tới mức này', daily: 'dailyZero', lifetime: 'lifetimeZero', placeholder: '25000' },
        { label: '1 tin nhắn', hint: 'Tắt khi tiêu tới mức này', daily: 'dailyOne', lifetime: 'lifetimeOne', placeholder: '25000' },
        { label: 'TN đắt — giá TN trên', hint: 'Ngưỡng giá để coi là TN đắt', daily: 'dailyHighCost', lifetime: 'lifetimeHighCost', placeholder: '20000' },
        { label: 'TN đắt — tiêu tới', hint: 'Tắt khi TN đắt và tiêu tới mức này', daily: 'dailyHighSpend', lifetime: 'lifetimeHighSpend', placeholder: '50000' },
        { label: 'TN rẻ — giá TN dưới', hint: 'Ngưỡng giá để coi là TN rẻ', daily: 'dailyCheapCost', lifetime: 'lifetimeCheapCost' },
        { label: 'TN rẻ, 0 đơn — tiêu tới', hint: 'Tắt khi TN rẻ mà chưa có đơn', daily: 'dailyCheapSpend', lifetime: 'lifetimeCheapSpend' }
      ]
    },
    {
      title: 'Theo đơn hàng',
      rows: [
        { label: '0 đơn — tiêu tới', hint: 'Tắt khi chưa có đơn mà tiêu tới mức này', daily: 'autoPauseZeroOrderSpendLimit', lifetime: 'autoPauseZeroOrderSpendLimitLifetime', placeholder: '60000' },
        { label: 'Có đơn — CPO tối đa', hint: 'Tắt khi CPO vượt mức này', daily: 'autoPauseCpoLimit', lifetime: 'autoPauseCpoLimitLifetime', placeholder: '100000' },
        { label: 'Nhiều đơn — trên số đơn', hint: 'Camp vượt số đơn này dùng CPO riêng bên dưới', daily: 'autoPauseMultiOrderThreshold', lifetime: 'autoPauseMultiOrderThresholdLifetime', placeholder: '2' },
        { label: 'Nhiều đơn — CPO tối đa', hint: 'Thay cho CPO ở trên; 0 = dùng CPO chung', daily: 'autoPauseMultiOrderCpoLimit', lifetime: 'autoPauseMultiOrderCpoLimitLifetime' }
      ]
    }
  ];

  const shopeeLimitRows = [
    { label: 'CPC tối đa', hint: 'Tắt khi chi phí / click vượt mức này', daily: 'dailyCpcLimit', lifetime: 'lifetimeCpcLimit', placeholder: '600' },
    { label: 'Số click tối đa', hint: 'Tắt khi số click vượt mức này', daily: 'dailyClickLimit', lifetime: 'lifetimeClickLimit' }
  ];

  const renderLimitRow = (row) => (
    <tr key={row.daily}>
      <td>
        <div className="cfg-cond">{row.label}</div>
        <div className="cfg-hint">{row.hint}</div>
      </td>
      <td data-label="Ngày">{numInput(row.daily, row.placeholder)}</td>
      <td data-label="Trọn đời">{numInput(row.lifetime, row.placeholder)}</td>
    </tr>
  );

  const saveAutoLimits = () => save('/auto-limits', {
    dailyZeroMessageSpendLimit: Number(autoLimits.dailyZero),
    dailyOneMessageSpendLimit: Number(autoLimits.dailyOne),
    dailyFewMessageThreshold: 0,
    dailyFewMessageSpendLimit: 0,
    dailyCheapMessageCostLimit: Number(autoLimits.dailyCheapCost || 0),
    dailyCheapMessageSpendLimit: Number(autoLimits.dailyCheapSpend || 0),
    dailyHighCostPerMessageLimit: Number(autoLimits.dailyHighCost),
    dailyHighCostSpendLimit: Number(autoLimits.dailyHighSpend),
    dailyClickLimit: Number(autoLimits.dailyClickLimit || 0),
    dailyCpcLimit: Number(autoLimits.dailyCpcLimit || 0),
    lifetimeZeroMessageSpendLimit: Number(autoLimits.lifetimeZero),
    lifetimeOneMessageSpendLimit: Number(autoLimits.lifetimeOne),
    lifetimeFewMessageThreshold: Number(autoLimits.lifetimeFewThreshold || 0),
    lifetimeFewMessageSpendLimit: Number(autoLimits.lifetimeFewSpend || 0),
    lifetimeCheapMessageCostLimit: Number(autoLimits.lifetimeCheapCost || 0),
    lifetimeCheapMessageSpendLimit: Number(autoLimits.lifetimeCheapSpend || 0),
    lifetimeHighCostPerMessageLimit: Number(autoLimits.lifetimeHighCost),
    lifetimeHighCostSpendLimit: Number(autoLimits.lifetimeHighSpend),
    lifetimeClickLimit: Number(autoLimits.lifetimeClickLimit || 0),
    lifetimeCpcLimit: Number(autoLimits.lifetimeCpcLimit || 0),
    autoPauseCpoLimit: Number(autoLimits.autoPauseCpoLimit || 0),
    autoPauseCpoLimitLifetime: Number(autoLimits.autoPauseCpoLimitLifetime || 0),
    autoPauseMultiOrderThreshold: Number(autoLimits.autoPauseMultiOrderThreshold || 0),
    autoPauseMultiOrderThresholdLifetime: Number(autoLimits.autoPauseMultiOrderThresholdLifetime || 0),
    autoPauseMultiOrderCpoLimit: Number(autoLimits.autoPauseMultiOrderCpoLimit || 0),
    autoPauseMultiOrderCpoLimitLifetime: Number(autoLimits.autoPauseMultiOrderCpoLimitLifetime || 0),
    autoPauseZeroOrderSpendLimit: Number(autoLimits.autoPauseZeroOrderSpendLimit || 0),
    autoPauseZeroOrderSpendLimitLifetime: Number(autoLimits.autoPauseZeroOrderSpendLimitLifetime || 0),
    autoPauseShopeeMinSpendLimit: Number(autoLimits.autoPauseShopeeMinSpendLimit || 0)
  }, 'Đã lưu giới hạn tự động');

  const statusPill = (ok, okText = 'Đã lưu', noText = 'Chưa có') => (
    <span className={`cfg-pill ${ok ? 'is-ok' : ''}`}>{ok ? okText : noText}</span>
  );

  return (
    <div className="card cfg-modal">
      <div className="card-header">
        <div className="card-title">⚙️ Cấu hình hệ thống</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>

      {showAdActions && (
        <div className="cfg-tabs">
          <button className={`cfg-tab ${tab === 'general' ? 'is-active' : ''}`} onClick={() => setTab('general')}>
            Chung
          </button>
          <button className={`cfg-tab ${tab === 'auto' ? 'is-active' : ''}`} onClick={() => setTab('auto')}>
            Tắt camp tự động <span className="cfg-tab-sub">{isShopee ? '(Shopee)' : '(Facebook)'}</span>
          </button>
          <button className={`cfg-tab ${tab === 'connect' ? 'is-active' : ''}`} onClick={() => setTab('connect')}>
            Kết nối API
          </button>
        </div>
      )}

      <div className="cfg-body">
        {(tab === 'general' || !showAdActions) ? (
          <>
            {showAdActions && (
              <div className="cfg-block">
                <div className="cfg-block-title">Tài khoản quảng cáo</div>
                <div className="cfg-actions">
                  <button className="btn btn-g btn-sm" onClick={() => openModal('ADD_VIA')}>+ Thêm VIA</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openModal('ACCOUNT')}>+ Thêm tài khoản</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openModal('BULK_ADD')}>+ Thêm nhiều</button>
                  {isShopee && (
                    <button className="btn btn-ghost btn-sm" onClick={() => openModal('SHOPEE_PAGES')}>+ Thêm Page</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={handleAutoDiscover} disabled={discovering}>
                    {discovering ? 'Đang đồng bộ...' : 'Auto Discover'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { refreshAll(); toast.success('Đang làm mới dữ liệu'); }}>Làm mới dữ liệu</button>
                </div>
                <div className="cfg-hint">Auto Discover: đồng bộ các tài khoản quảng cáo được gán trong BM.</div>
              </div>
            )}

            {showAdActions && (
              <div className="cfg-block">
                <div className="cfg-block-title">
                  Gemini AI của bạn {statusPill(userGeminiReady, 'AI sẵn sàng', 'Chưa có')}
                </div>
                <div className="cfg-inline">
                  <input
                    type="password"
                    placeholder={userGeminiReady ? 'Đã lưu — nhập mới để ghi đè' : 'AIzaSy...'}
                    value={userGeminiKey}
                    onChange={e => setUserGeminiKey(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveUserGeminiKey(); }}
                  />
                  <button className="btn btn-p btn-sm" onClick={saveUserGeminiKey} disabled={testingUserGeminiKey}>
                    {testingUserGeminiKey ? 'Đang lưu...' : 'Lưu'}
                  </button>
                  {userGeminiReady && (
                    <button className="btn btn-danger btn-sm" onClick={removeUserGeminiKey}>Xóa</button>
                  )}
                </div>
                <div className="cfg-hint">Key riêng cho tài khoản đăng nhập này, dùng cho AI chat và AI Insights.</div>
              </div>
            )}
          </>
        ) : tab === 'auto' ? (
          <>
            <div className="cfg-block">
              <div className="cfg-block-head">
                <div>
                  <div className="cfg-block-title">Giờ tắt camp trùng</div>
                  <div className="cfg-hint">Từ giờ này, camp cùng mã/tên đang chạy sẽ bị tắt bớt (ưu tiên giữ camp trọn đời).</div>
                </div>
                <div className="cfg-inline">
                  <input type="text" inputMode="numeric" pattern="\d{2}:\d{2}" placeholder="HH:mm" value={scheduledPauseTime} onChange={e => setScheduledPauseTime(e.target.value)} style={{ width: '80px', textAlign: 'center' }} />
                  <button className="btn btn-p btn-sm" onClick={() => save('/scheduled-duplicate-pause-time', { pauseTime: scheduledPauseTime }, 'Đã lưu giờ tắt camp trùng')}>Lưu</button>
                </div>
              </div>
            </div>

            <div className="cfg-block">
              <div className="cfg-block-title">Điều kiện tắt camp</div>
              <div className="cfg-hint" style={{ marginBottom: '10px' }}>
                Camp bị tắt khi chạm một trong các mức dưới đây. Để <b>0</b> = bỏ qua điều kiện đó. Đơn vị: đ (trừ số đơn, số click).
              </div>

              {isShopee && (
                <div className="cfg-block-head" style={{ marginBottom: '10px' }}>
                  <div>
                    <div className="cfg-cond">Chi tiêu tối thiểu để xét tắt</div>
                    <div className="cfg-hint">Camp chưa tiêu đủ mức này sẽ không bị xét tắt.</div>
                  </div>
                  <div className="cfg-inline">
                    <input type="number" min="1" placeholder="50000" value={autoLimits.autoPauseShopeeMinSpendLimit} onChange={setLimit('autoPauseShopeeMinSpendLimit')} style={{ width: '120px' }} />
                  </div>
                </div>
              )}

              <table className="cfg-table">
                <thead>
                  <tr>
                    <th>Điều kiện</th>
                    <th>Ngân sách ngày</th>
                    <th>Trọn đời</th>
                  </tr>
                </thead>
                {isShopee ? (
                  <tbody>{shopeeLimitRows.map(renderLimitRow)}</tbody>
                ) : (
                  fbLimitGroups.map(group => (
                    <tbody key={group.title}>
                      <tr className="cfg-group-row"><td colSpan={3}>{group.title}</td></tr>
                      {group.rows.map(renderLimitRow)}
                    </tbody>
                  ))
                )}
              </table>
            </div>

            <div className="cfg-footer">
              <button className="btn btn-p btn-sm" onClick={saveAutoLimits}>Lưu điều kiện</button>
            </div>
          </>
        ) : (
          <>
            <div className="cfg-block">
              <div className="cfg-block-head">
                <div className="cfg-block-title">VIA Facebook <span className="cfg-pill is-ok">{viaProfiles.length}</span></div>
                <button className="btn btn-g btn-sm" onClick={() => openModal('ADD_VIA')}>+ Thêm VIA</button>
              </div>
              <div className="cfg-hint">Mỗi VIA giữ token riêng; TKQC nhập từ VIA nào dùng token của VIA đó. Đăng nhập lại VIA sẽ tự cập nhật token cho các TKQC của nó.</div>
              {viaLoading ? (
                <div className="cfg-hint">Đang tải...</div>
              ) : viaProfiles.length === 0 ? (
                <div className="cfg-hint">Chưa có VIA nào.</div>
              ) : (
                <div className="cfg-via-list">
                  {viaProfiles.map(via => (
                    <div key={via._id} className="cfg-via-row">
                      {via.pictureUrl
                        ? <img src={via.pictureUrl} alt="" className="cfg-via-avatar" />
                        : <span className="cfg-via-avatar">{(via.name || '?').charAt(0)}</span>}
                      <div className="cfg-via-info">
                        <div className="cfg-cond">{via.name || via.fbUserId}</div>
                        <div className="cfg-hint">
                          {via.accountCount} TKQC
                          {via.expiresAt && ` · token ${via.expired ? 'đã hết hạn' : `hết hạn ${new Date(via.expiresAt).toLocaleDateString('vi-VN')}`}`}
                        </div>
                      </div>
                      {via.expired && <span className="cfg-pill">Hết hạn</span>}
                      <div className="cfg-via-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openModal('ADD_VIA', { profileId: via._id, profileName: via.name })}>Chọn TKQC</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openModal('ADD_VIA')} title="Đăng nhập lại để làm mới token">Đăng nhập lại</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeVia(via)}>Xóa</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cfg-block">
              <div className="cfg-block-head">
                <div className="cfg-block-title">Token Facebook chính {statusPill(appConfig.hasFbToken, 'Đã có token', 'Chưa có token')}</div>
                <button className="btn btn-g btn-sm" onClick={loginFacebookOAuth} disabled={fbOAuthLoading}>
                  {fbOAuthLoading ? 'Đang đợi Facebook...' : discovering ? 'Đang đồng bộ...' : 'Đăng nhập / đổi Facebook'}
                </button>
              </div>
              <div className="cfg-field">
                <label>Access token (nhập tay)</label>
                <div className="cfg-inline">
                  <input type="password" placeholder={appConfig.hasFbToken ? 'Đã lưu — nhập mới để ghi đè' : 'EAAxxxxxxxxxx...'} value={fbToken} onChange={e => setFbToken(e.target.value)} />
                  <button className="btn btn-p btn-sm" onClick={async () => { if (await save('/config', { fbToken }, 'Đã lưu FB Token')) { setFbToken(''); await handleAutoDiscover(); } }}>Lưu</button>
                </div>
              </div>
              <div className="cfg-field">
                <label>App ID / App Secret</label>
                <div className="cfg-inline">
                  <input type="text" placeholder="App ID" value={fbApp.id} onChange={e => setFbApp({ ...fbApp, id: e.target.value })} />
                  <input type="password" placeholder={appConfig.hasFbAppSecret ? 'Secret đã lưu' : 'App Secret'} value={fbApp.secret} onChange={e => setFbApp({ ...fbApp, secret: e.target.value })} />
                  <button className="btn btn-p btn-sm" onClick={() => save('/config', { fbAppId: fbApp.id, fbAppSecret: fbApp.secret }, 'Đã lưu App ID & Secret')}>Lưu</button>
                </div>
              </div>
              <div className="cfg-hint">Đăng nhập xong sẽ <b>tự đồng bộ</b>: thêm tài khoản quảng cáo mới của Facebook đó và cập nhật token cho tài khoản đã có. Muốn đổi sang Facebook khác: trong cửa sổ đăng nhập bấm "Không phải bạn?" / đăng nhập tài khoản khác (hoặc đăng xuất facebook.com trước).</div>
            </div>

            <div className="cfg-block">
              <div className="cfg-block-title">Gemini AI dùng chung {statusPill(appConfig.hasGeminiKey)}</div>
              <div className="cfg-inline">
                <input type="password" placeholder={appConfig.hasGeminiKey ? 'Đã lưu — nhập mới để ghi đè' : 'AIzaSy...'} value={geminiKey} onChange={e => setGeminiKey(e.target.value)} />
                <button className="btn btn-p btn-sm" onClick={() => save('/config', { geminiKey }, 'Đã lưu Gemini Key')}>Lưu</button>
              </div>
              <div className="cfg-hint">Key dự phòng khi tài khoản chưa có key Gemini riêng.</div>
            </div>

            <div className="cfg-block">
              <div className="cfg-block-title">Pancake POS {statusPill(appConfig.hasPancakeApiKey)}</div>
              <div className="cfg-inline">
                <input type="text" placeholder="Shop ID" value={pancake.shopId} onChange={e => setPancake({ ...pancake, shopId: e.target.value })} />
                <input type="password" placeholder={appConfig.hasPancakeApiKey ? 'API Key đã lưu' : 'API Key'} value={pancake.apiKey} onChange={e => setPancake({ ...pancake, apiKey: e.target.value })} />
                <button className="btn btn-p btn-sm" onClick={() => save('/config', { pancakeApiKey: pancake.apiKey, pancakeShopId: pancake.shopId }, 'Đã lưu cấu hình Pancake')}>Lưu</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
