import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import { toast } from 'react-toastify';

export default function ConfigModal() {
  const { closeModal, appConfig, loadConfig, provider } = useAppContext();
  const isShopee = provider === 'shopee';

  const [fbToken, setFbToken] = useState('');
  const [fbApp, setFbApp] = useState({ id: '', secret: '' });
  const [fbOAuthLoading, setFbOAuthLoading] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [pancake, setPancake] = useState({ apiKey: '', shopId: '' });
  const [autoRules, setAutoRules] = useState({ start: '00:00', end: '09:00' });
  const [scheduledPauseTime, setScheduledPauseTime] = useState('21:00');
  const [autoLimits, setAutoLimits] = useState({
    dailyZero: 25000, dailyOne: 25000, dailyFewThreshold: 0, dailyFewSpend: 0, dailyCheapCost: 0, dailyCheapSpend: 0, dailyHighCost: 20000, dailyHighSpend: 50000,
    lifetimeZero: 25000, lifetimeOne: 25000, lifetimeFewThreshold: 0, lifetimeFewSpend: 0, lifetimeCheapCost: 0, lifetimeCheapSpend: 0, lifetimeHighCost: 20000, lifetimeHighSpend: 50000,
    dailyClickLimit: 0, lifetimeClickLimit: 0,
    dailyCpcLimit: 600, lifetimeCpcLimit: 600,
    autoPauseCpoLimit: 100000,
    autoPauseCpoLimitLifetime: 100000,
    autoPauseZeroOrderSpendLimit: 60000,
    autoPauseZeroOrderSpendLimitLifetime: 60000,
    autoPauseShopeeMinSpendLimit: 50000
  });

  useEffect(() => {
    if (appConfig) {
      setFbApp({ id: appConfig.fbAppId || '', secret: '' });
      setPancake({ apiKey: '', shopId: appConfig.pancakeShopId || '' });
      setAutoRules({
        start: isShopee ? (appConfig.shopeeAutoRuleStartTime || '00:00') : (appConfig.autoRuleStartTime || '00:00'),
        end: isShopee ? (appConfig.shopeeAutoRuleEndTime || '09:00') : (appConfig.autoRuleEndTime || '09:00')
      });
      setScheduledPauseTime(appConfig.scheduledDuplicatePauseTime || '21:00');
      setAutoLimits({
        dailyZero: appConfig.dailyZeroMessageSpendLimit || 25000,
        dailyOne: appConfig.dailyOneMessageSpendLimit || 25000,
        dailyFewThreshold: appConfig.dailyFewMessageThreshold || 0,
        dailyFewSpend: appConfig.dailyFewMessageSpendLimit || 0,
        dailyCheapCost: appConfig.dailyCheapMessageCostLimit || 0,
        dailyCheapSpend: appConfig.dailyCheapMessageSpendLimit || 0,
        dailyHighCost: appConfig.dailyHighCostPerMessageLimit || 20000,
        dailyHighSpend: appConfig.dailyHighCostSpendLimit || 50000,
        lifetimeZero: appConfig.lifetimeZeroMessageSpendLimit || 25000,
        lifetimeOne: appConfig.lifetimeOneMessageSpendLimit || 25000,
        lifetimeFewThreshold: appConfig.lifetimeFewMessageThreshold || 0,
        lifetimeFewSpend: appConfig.lifetimeFewMessageSpendLimit || 0,
        lifetimeCheapCost: appConfig.lifetimeCheapMessageCostLimit || 0,
        lifetimeCheapSpend: appConfig.lifetimeCheapMessageSpendLimit || 0,
        lifetimeHighCost: appConfig.lifetimeHighCostPerMessageLimit || 20000,
        lifetimeHighSpend: appConfig.lifetimeHighCostSpendLimit || 50000,
        dailyClickLimit: appConfig.dailyClickLimit || 0,
        lifetimeClickLimit: appConfig.lifetimeClickLimit || 0,
        dailyCpcLimit: appConfig.dailyCpcLimit || 600,
        lifetimeCpcLimit: appConfig.lifetimeCpcLimit || 600,
        autoPauseCpoLimit: appConfig.autoPauseCpoLimit ?? 100000,
        autoPauseCpoLimitLifetime: appConfig.autoPauseCpoLimitLifetime ?? 100000,
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
    } catch (e) {
      toast.error('Lỗi: ' + e.message);
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
      toast.success('Đã đăng nhập Facebook và lưu token đủ quyền');
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

  return (
    <div className="card" style={{ border: 'none', margin: 0, width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }}>
      <div className="card-header">
        <div className="card-title">⚙️ Cấu hình hệ thống</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>
      <div style={{ padding: '20px' }}>

        {/* Section: Facebook Token */}
        <section className="section-gap">
          <div className="section-title">1. Facebook Access Token (Dùng chung)</div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
            <button className="btn btn-g btn-sm" onClick={loginFacebookOAuth} disabled={fbOAuthLoading}>
              {fbOAuthLoading ? 'Đang đợi Facebook...' : 'Đăng nhập Facebook cấp full quyền'}
            </button>
            <span style={{ fontSize: '12px', color: 'var(--muted2)' }}>
              Yêu cầu quyền ads_read, ads_management, business_management, pages_show_list, pages_manage_metadata và pages_read_engagement.
            </span>
          </div>
          <div className="form-group">
            <input
              type="password"
              placeholder={appConfig.hasFbToken ? "Đã lưu token (Nhập mới để ghi đè)" : "EAAxxxxxxxxxx..."}
              value={fbToken}
              onChange={e => setFbToken(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/config', { fbToken }, 'Đã lưu FB Token')}>Lưu Token</button>
          </div>
        </section>

        {/* Section: FB App ID & Secret */}
        <section className="section-gap">
          <div className="section-title">2. Facebook App Credentials</div>
          <div className="form-grid">
            <div className="form-group">
              <label>App ID</label>
              <input type="text" value={fbApp.id} onChange={e => setFbApp({ ...fbApp, id: e.target.value })} />
            </div>
            <div className="form-group">
              <label>App Secret</label>
              <input type="password" placeholder="••••••••" value={fbApp.secret} onChange={e => setFbApp({ ...fbApp, secret: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/config', { fbAppId: fbApp.id, fbAppSecret: fbApp.secret }, 'Đã lưu App ID & Secret')}>Lưu App</button>
          </div>
        </section>

        {/* Section: Gemini AI */}
        <section className="section-gap">
          <div className="section-title">3. Gemini AI API Key (Dùng chung)</div>
          <div className="form-group">
            <input
              type="password"
              placeholder={appConfig.hasGeminiKey ? "Đã lưu key (Nhập mới để ghi đè)" : "AIzaSy..."}
              value={geminiKey}
              onChange={e => setGeminiKey(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/config', { geminiKey }, 'Đã lưu Gemini Key')}>Lưu API Key</button>
          </div>
        </section>

        {/* Section: Pancake */}
        <section className="section-gap">
          <div className="section-title">4. Pancake POS Integration</div>
          <div className="form-grid">
            <div className="form-group">
              <label>Shop ID</label>
              <input type="text" value={pancake.shopId} onChange={e => setPancake({ ...pancake, shopId: e.target.value })} />
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input type="password" placeholder="Nhập API Key mới" value={pancake.apiKey} onChange={e => setPancake({ ...pancake, apiKey: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/config', { pancakeApiKey: pancake.apiKey, pancakeShopId: pancake.shopId }, 'Đã lưu cấu hình Pancake')}>Lưu Pancake</button>
          </div>
        </section>

        {/* Section: Auto Rules Time */}
        <section className="section-gap">
          <div className="section-title">5. Khung giờ chạy Auto Rules</div>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-group">
              <label>Bắt đầu</label>
              <input type="text" inputMode="numeric" pattern="\d{2}:\d{2}" placeholder="HH:mm" value={autoRules.start} onChange={e => setAutoRules({ ...autoRules, start: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Kết thúc</label>
              <input type="text" inputMode="numeric" pattern="\d{2}:\d{2}" placeholder="HH:mm" value={autoRules.end} onChange={e => setAutoRules({ ...autoRules, end: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/auto-rules', { provider, startTime: autoRules.start, endTime: autoRules.end }, 'Đã lưu khung giờ')}>Lưu khung giờ</button>
          </div>
        </section>

        <section className="section-gap">
          <div className="section-title">6. Giờ tắt camp đã lên lịch bị trùng</div>
          <div style={{ marginBottom: '12px', color: 'var(--muted2)' }}>
            Khi nhiều camp cùng mã/tên đang chạy, hệ thống sẽ kiểm tra từ mốc giờ này và tự tắt bớt, ưu tiên giữ camp trọn đời.
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="form-group">
              <label>Giờ kiểm tra camp trùng</label>
              <input type="text" inputMode="numeric" pattern="\d{2}:\d{2}" placeholder="HH:mm" value={scheduledPauseTime} onChange={e => setScheduledPauseTime(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/scheduled-duplicate-pause-time', { pauseTime: scheduledPauseTime }, 'Đã lưu giờ tắt camp trùng')}>Lưu giờ tắt</button>
          </div>
        </section>

        {/* Section: Auto Limits */}
        <section className="section-gap">
          <div className="section-title">6. Điều kiện tắt Campaign Tự động {isShopee ? '(Shopee)' : '(Facebook)'}</div>
          <div style={{ marginBottom: '12px', color: 'var(--muted2)' }}>
            {isShopee
              ? 'Shopee sẽ tắt chiến dịch dựa trên chi phí trên mỗi lượt click. Ngưỡng có thể điều chỉnh được.'
              : 'Facebook có 4 điều kiện tắt camp: 0 tin nhắn, 1 tin nhắn, tin nhắn đắt, 0 đơn, và CPO cao.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '10px' }}>THEO NGÀY</div>
              {isShopee ? (
                <>
                  <div className="form-group">
                    <label>Chi tiêu tối thiểu để xét tắt</label>
                    <input type="number" min="1" placeholder="50000" value={autoLimits.autoPauseShopeeMinSpendLimit} onChange={e => setAutoLimits({ ...autoLimits, autoPauseShopeeMinSpendLimit: e.target.value })} />
                    <div className="inline-note">Camp chưa tiêu đủ mức này sẽ không bị xét tắt dù CPC cao.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi phí tối đa / click (ngày)</label>
                    <input type="number" min="0" placeholder="600" value={autoLimits.dailyCpcLimit} onChange={e => setAutoLimits({ ...autoLimits, dailyCpcLimit: e.target.value })} />
                    <div className="inline-note">Tắt nếu CPC ngày vượt mức này. Đặt 0 để bỏ qua.</div>
                  </div>
                  <div className="form-group">
                    <label>Số click tối đa / ngày</label>
                    <input type="number" min="0" placeholder="0" value={autoLimits.dailyClickLimit} onChange={e => setAutoLimits({ ...autoLimits, dailyClickLimit: e.target.value })} />
                    <div className="inline-note">Tắt nếu số click ngày vượt mức này. Đặt 0 để bỏ qua.</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Chi tiêu tối đa khi 0 TN</label>
                    <input type="number" min="0" placeholder="25000" value={autoLimits.dailyZero} onChange={e => setAutoLimits({ ...autoLimits, dailyZero: e.target.value })} />
                    <div className="inline-note">Camp không có tin nhắn nào chỉ được chi tiêu đến mức này — vượt quá sẽ bị tắt.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi tiêu tối đa khi 1 TN</label>
                    <input type="number" min="0" placeholder="25000" value={autoLimits.dailyOne} onChange={e => setAutoLimits({ ...autoLimits, dailyOne: e.target.value })} />
                    <div className="inline-note">Tắt nếu camp chỉ có đúng 1 tin nhắn mà đã tiêu quá mức này.</div>
                  </div>
                  <div className="form-group">
                    <label>TN rẻ dưới giá (ngày)</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input type="number" min="0" placeholder="0" value={autoLimits.dailyCheapCost} onChange={e => setAutoLimits({ ...autoLimits, dailyCheapCost: e.target.value })} style={{ flex: 1 }} />
                      <span style={{ fontSize: '12px', color: 'var(--muted2)', whiteSpace: 'nowrap' }}>đ/TN, chi tiêu đến</span>
                      <input type="number" min="0" placeholder="0" value={autoLimits.dailyCheapSpend} onChange={e => setAutoLimits({ ...autoLimits, dailyCheapSpend: e.target.value })} style={{ flex: 1 }} />
                    </div>
                    <div className="inline-note">Nếu giá TN thấp hơn ngưỡng này nhưng không có đơn, tắt khi đã tiêu đủ. Đặt 0 để bỏ qua.</div>
                  </div>
                  <div className="form-group">
                    <label>Giá TN tối đa</label>
                    <input type="number" min="0" placeholder="20000" value={autoLimits.dailyHighCost} onChange={e => setAutoLimits({ ...autoLimits, dailyHighCost: e.target.value })} />
                    <div className="inline-note">Ngưỡng giá mỗi tin nhắn để xét "TN đắt" — dùng kết hợp với chi tiêu tối đa bên dưới.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi tiêu tối đa khi TN đắt</label>
                    <input type="number" min="0" placeholder="50000" value={autoLimits.dailyHighSpend} onChange={e => setAutoLimits({ ...autoLimits, dailyHighSpend: e.target.value })} />
                    <div className="inline-note">Tắt nếu giá/TN vượt ngưỡng trên VÀ tổng chi tiêu đã vượt mức này.</div>
                  </div>
                  <div className="form-group">
                    <label>CPO tối đa để giữ camp có đơn (ngày)</label>
                    <input type="number" min="0" placeholder="100000" value={autoLimits.autoPauseCpoLimit} onChange={e => setAutoLimits({ ...autoLimits, autoPauseCpoLimit: e.target.value })} />
                    <div className="inline-note">Camp có đơn nhưng CPO vượt mức này vẫn bị tắt. Đặt 0 để bỏ qua.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi tiêu tắt camp 0 đơn (ngày)</label>
                    <input type="number" min="0" placeholder="60000" value={autoLimits.autoPauseZeroOrderSpendLimit} onChange={e => setAutoLimits({ ...autoLimits, autoPauseZeroOrderSpendLimit: e.target.value })} />
                    <div className="inline-note">Tắt nếu camp chưa có đơn nào mà đã tiêu quá mức này.</div>
                  </div>
                </>
              )}
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '10px' }}>TRỌN ĐỜI</div>
              {isShopee ? (
                <>
                  <div className="form-group">
                    <label>Chi phí tối đa / click (trọn đời)</label>
                    <input type="number" min="0" placeholder="600" value={autoLimits.lifetimeCpcLimit} onChange={e => setAutoLimits({ ...autoLimits, lifetimeCpcLimit: e.target.value })} />
                    <div className="inline-note">Tắt nếu CPC trọn đời vượt mức này. Đặt 0 để bỏ qua.</div>
                  </div>
                  <div className="form-group">
                    <label>Số click tối đa trọn đời</label>
                    <input type="number" min="0" placeholder="0" value={autoLimits.lifetimeClickLimit} onChange={e => setAutoLimits({ ...autoLimits, lifetimeClickLimit: e.target.value })} />
                    <div className="inline-note">Tắt nếu tổng click trọn đời vượt mức này. Đặt 0 để bỏ qua.</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Chi tiêu tối đa trọn đời khi 0 TN</label>
                    <input type="number" min="0" placeholder="25000" value={autoLimits.lifetimeZero} onChange={e => setAutoLimits({ ...autoLimits, lifetimeZero: e.target.value })} />
                    <div className="inline-note">Camp trọn đời không có tin nhắn nào chỉ được chi tiêu đến mức này — vượt quá sẽ bị tắt.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi tiêu tối đa trọn đời khi 1 TN</label>
                    <input type="number" min="0" placeholder="25000" value={autoLimits.lifetimeOne} onChange={e => setAutoLimits({ ...autoLimits, lifetimeOne: e.target.value })} />
                    <div className="inline-note">Áp dụng cho camp ngân sách trọn đời — tắt nếu chỉ có 1 TN mà đã tiêu quá mức này.</div>
                  </div>
                  <div className="form-group">
                    <label>TN rẻ dưới giá (trọn đời)</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input type="number" min="0" placeholder="0" value={autoLimits.lifetimeCheapCost} onChange={e => setAutoLimits({ ...autoLimits, lifetimeCheapCost: e.target.value })} style={{ flex: 1 }} />
                      <span style={{ fontSize: '12px', color: 'var(--muted2)', whiteSpace: 'nowrap' }}>đ/TN, chi tiêu đến</span>
                      <input type="number" min="0" placeholder="0" value={autoLimits.lifetimeCheapSpend} onChange={e => setAutoLimits({ ...autoLimits, lifetimeCheapSpend: e.target.value })} style={{ flex: 1 }} />
                    </div>
                    <div className="inline-note">Nếu giá TN thấp hơn ngưỡng này nhưng không có đơn, tắt khi đã tiêu đủ. Đặt 0 để bỏ qua.</div>
                  </div>
                  <div className="form-group">
                    <label>Giá TN tối đa trọn đời</label>
                    <input type="number" min="0" placeholder="20000" value={autoLimits.lifetimeHighCost} onChange={e => setAutoLimits({ ...autoLimits, lifetimeHighCost: e.target.value })} />
                    <div className="inline-note">Ngưỡng giá TN để xét "đắt" cho camp trọn đời.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi tiêu tối đa trọn đời khi TN đắt</label>
                    <input type="number" min="0" placeholder="50000" value={autoLimits.lifetimeHighSpend} onChange={e => setAutoLimits({ ...autoLimits, lifetimeHighSpend: e.target.value })} />
                    <div className="inline-note">Tắt nếu giá/TN đắt VÀ tổng chi tiêu trọn đời vượt mức này.</div>
                  </div>
                  <div className="form-group">
                    <label>CPO tối đa để giữ camp có đơn (trọn đời)</label>
                    <input type="number" min="0" placeholder="100000" value={autoLimits.autoPauseCpoLimitLifetime} onChange={e => setAutoLimits({ ...autoLimits, autoPauseCpoLimitLifetime: e.target.value })} />
                    <div className="inline-note">Camp trọn đời có đơn nhưng CPO vượt mức này vẫn bị tắt.</div>
                  </div>
                  <div className="form-group">
                    <label>Chi tiêu tắt camp 0 đơn (trọn đời)</label>
                    <input type="number" min="0" placeholder="60000" value={autoLimits.autoPauseZeroOrderSpendLimitLifetime} onChange={e => setAutoLimits({ ...autoLimits, autoPauseZeroOrderSpendLimitLifetime: e.target.value })} />
                    <div className="inline-note">Tắt nếu camp trọn đời chưa có đơn mà đã tiêu quá mức này.</div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-p btn-sm" onClick={() => save('/auto-limits', {
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
              autoPauseZeroOrderSpendLimit: Number(autoLimits.autoPauseZeroOrderSpendLimit || 0),
              autoPauseZeroOrderSpendLimitLifetime: Number(autoLimits.autoPauseZeroOrderSpendLimitLifetime || 0),
              autoPauseShopeeMinSpendLimit: Number(autoLimits.autoPauseShopeeMinSpendLimit || 0)
            }, 'Đã lưu giới hạn tự động')}>Lưu giới hạn</button>
          </div>
        </section>

      </div>
    </div>
  );
}
