import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import { notify } from '../../lib/notify';

const STEPS = ['Kết nối Facebook', 'Chọn tài khoản quảng cáo', 'Hoàn tất'];

const GUIDE = [
  {
    title: 'Chọn Doanh nghiệp (BM)',
    body: 'Khi Facebook hỏi, chọn "Áp dụng cho tất cả Doanh nghiệp ở hiện tại và tương lai" để không bị thiếu tài khoản.'
  },
  {
    title: 'Chọn tài khoản quảng cáo',
    body: 'Chọn "Tất cả tài khoản quảng cáo hiện tại và tương lai". Chỉ những TKQC được chọn mới hiện ở bước sau.'
  },
  {
    title: 'Chọn Fanpage',
    body: 'Chọn tất cả Fanpage hiện tại và tương lai để lên camp và đăng bài không lỗi quyền.'
  },
  {
    title: 'Giữ nguyên các quyền',
    body: 'Không tắt quyền nào trong danh sách (ads_management, ads_read, business_management, pages_...).'
  },
  {
    title: 'Đổi sang Facebook khác',
    body: 'Cửa sổ Facebook nhớ tài khoản đang đăng nhập trên trình duyệt. Muốn thêm VIA khác: bấm "Không phải bạn?" hoặc đăng xuất facebook.com trước.'
  }
];

export default function AddViaModal({ data }) {
  const { closeModal, provider, loadAccounts } = useAppContext();
  const [step, setStep] = useState(data?.profileId ? 1 : 0);
  const [profileId, setProfileId] = useState(data?.profileId || '');
  const [profileName, setProfileName] = useState(data?.profileName || '');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [adAccounts, setAdAccounts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [openGuide, setOpenGuide] = useState(0);
  const messageHandlerRef = useRef(null);

  useEffect(() => () => {
    if (messageHandlerRef.current) window.removeEventListener('message', messageHandlerRef.current);
  }, []);

  const loadAdAccounts = async (id = profileId) => {
    if (!id) return;
    setLoadingAccounts(true);
    try {
      const res = await api('GET', `/fb-profiles/${id}/adaccounts?provider=${encodeURIComponent(provider)}`, null, { timeoutMs: 90000 });
      setProfileName(res.profile?.name || profileName);
      setAdAccounts(res.adAccounts || []);
      // Mac dinh chon cac TKQC moi dang hoat dong
      setSelected(new Set((res.adAccounts || []).filter(a => !a.exists && a.status === 1).map(a => a.adAccountId)));
    } catch (error) {
      notify.error('Không lấy được TKQC: ' + error.message);
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    if (step === 1 && profileId) loadAdAccounts(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, profileId]);

  const loginFacebook = async () => {
    if (loggingIn) return;
    // Mo popup ngay trong click de trinh duyet khong chan
    const popup = window.open('', 'facebook-oauth', 'width=720,height=760');
    if (!popup) {
      notify.error('Trình duyệt đã chặn popup. Hãy cho phép popup rồi thử lại.');
      return;
    }
    setLoggingIn(true);

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'adsctrl:facebook-oauth') return;
      window.removeEventListener('message', handleMessage);
      messageHandlerRef.current = null;
      setLoggingIn(false);

      const payload = event.data.payload || {};
      if (!payload.ok || !payload.profileId) {
        notify.error('Đăng nhập Facebook lỗi: ' + (payload.error || 'Không xác định'));
        return;
      }
      notify.success(`Đã kết nối VIA: ${payload.fbName || 'Facebook'}${payload.tokenUpdated ? ` (cập nhật token cho ${payload.tokenUpdated} TKQC)` : ''}`);
      setProfileId(payload.profileId);
      setProfileName(payload.fbName || '');
      setStep(1);
    };

    try {
      const res = await api('GET', '/facebook/oauth/start?mode=via');
      messageHandlerRef.current = handleMessage;
      window.addEventListener('message', handleMessage);
      popup.location.href = res.authUrl;
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          // Popup dong ma chua nhan ket qua -> nguoi dung huy
          setTimeout(() => {
            if (messageHandlerRef.current === handleMessage) {
              window.removeEventListener('message', handleMessage);
              messageHandlerRef.current = null;
              setLoggingIn(false);
            }
          }, 800);
        }
      }, 500);
    } catch (error) {
      popup.close();
      setLoggingIn(false);
      notify.error('Lỗi Facebook login: ' + error.message);
    }
  };

  const visibleAccounts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return adAccounts.filter(a => {
      if (onlyNew && a.usesThisVia) return false;
      if (!keyword) return true;
      return a.name.toLowerCase().includes(keyword) || a.adAccountId.includes(keyword) || a.businessName.toLowerCase().includes(keyword);
    });
  }, [adAccounts, search, onlyNew]);

  const allVisibleSelected = visibleAccounts.length > 0 && visibleAccounts.every(a => selected.has(a.adAccountId));

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllVisible = () => setSelected(prev => {
    const next = new Set(prev);
    visibleAccounts.forEach(a => (allVisibleSelected ? next.delete(a.adAccountId) : next.add(a.adAccountId)));
    return next;
  });

  const importSelected = async () => {
    if (!selected.size || importing) return;
    setImporting(true);
    try {
      const res = await api('POST', `/fb-profiles/${profileId}/import`, {
        provider,
        adAccountIds: [...selected]
      }, { timeoutMs: 120000 });
      setResult(res);
      await loadAccounts();
      setStep(2);
    } catch (error) {
      notify.error('Nhập TKQC lỗi: ' + error.message);
    } finally {
      setImporting(false);
    }
  };

  const restart = () => {
    setProfileId('');
    setProfileName('');
    setAdAccounts([]);
    setSelected(new Set());
    setResult(null);
    setStep(0);
  };

  const selectedNewCount = adAccounts.filter(a => selected.has(a.adAccountId) && !a.exists).length;
  const selectedSwitchCount = selected.size - selectedNewCount;

  return (
    <div className="card via-modal">
      <div className="via-main">
        <div className="via-head">
          <div className="via-title"><span className="via-fb-dot">f</span> Thêm VIA</div>
          <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
        </div>
        <div className="via-step-label">Bước {step + 1}/{STEPS.length} · {STEPS[step]}</div>
        <div className="via-progress">
          {STEPS.map((label, index) => <span key={label} className={index <= step ? 'is-done' : ''} />)}
        </div>

        {step === 0 && (
          <div className="via-body">
            <h3 className="via-h">Kết nối tài khoản Facebook (VIA)</h3>
            <p className="via-p">
              Mỗi VIA giữ <b>token riêng</b>. Tài khoản quảng cáo nhập từ VIA nào sẽ dùng token của VIA đó,
              không phụ thuộc token đang đăng nhập hiện tại.
            </p>
            <div className="via-callout">
              <div className="via-callout-title">Khi màn Facebook hiện ra, hãy chọn:</div>
              <label className="via-option is-required">
                <span className="via-radio is-on" />
                <span>
                  <b>Áp dụng cho tất cả Doanh nghiệp ở hiện tại và tương lai</b>
                  <small>Cấp quyền cho mọi BM hiện có và BM tạo sau này.</small>
                  <em className="ok">Bắt buộc chọn</em>
                </span>
              </label>
              <label className="via-option is-off">
                <span className="via-radio" />
                <span>
                  <b>Chỉ áp dụng cho Doanh nghiệp hiện tại</b>
                  <small>Dễ thiếu TKQC/Page khi BM thay đổi.</small>
                  <em className="no">Không chọn</em>
                </span>
              </label>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="via-body">
            <div className="via-list-head">
              <div>
                <h3 className="via-h">Chọn tài khoản quảng cáo</h3>
                <p className="via-p">VIA: <b>{profileName || '—'}</b> · {adAccounts.length} TKQC truy cập được</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => loadAdAccounts()} disabled={loadingAccounts}>Tải lại</button>
            </div>
            <div className="via-toolbar">
              <input type="search" placeholder="Tìm tên, ID, BM..." value={search} onChange={e => setSearch(e.target.value)} />
              <label className="via-check-inline">
                <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} />
                Ẩn TKQC đã dùng VIA này
              </label>
            </div>

            {loadingAccounts ? (
              <div className="via-empty">Đang lấy danh sách TKQC từ Facebook...</div>
            ) : visibleAccounts.length === 0 ? (
              <div className="via-empty">Không có TKQC nào. Kiểm tra lại quyền đã cấp cho VIA này.</div>
            ) : (
              <div className="via-list">
                <label className="via-row via-row-all">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                  <span>Chọn tất cả ({visibleAccounts.length})</span>
                </label>
                {visibleAccounts.map(account => (
                  <label key={account.adAccountId} className={`via-row ${selected.has(account.adAccountId) ? 'is-selected' : ''}`}>
                    <input type="checkbox" checked={selected.has(account.adAccountId)} onChange={() => toggle(account.adAccountId)} />
                    <span className="via-row-main">
                      <span className="via-row-name">{account.name}</span>
                      <span className="via-row-meta">
                        {account.adAccountId.replace('act_', '')}
                        {account.businessName ? ` · ${account.businessName}` : ''}
                        {account.currency ? ` · ${account.currency}` : ''}
                      </span>
                    </span>
                    <span className="via-row-tags">
                      <span className={`via-tag ${account.status === 1 ? 'ok' : 'warn'}`}>{account.statusLabel}</span>
                      {account.usesThisVia
                        ? <span className="via-tag info">Đang dùng VIA này</span>
                        : account.exists && <span className="via-tag muted">Đã có · chuyển VIA</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && result && (
          <div className="via-body">
            <h3 className="via-h">Đã nhập xong</h3>
            <div className="via-result">
              <div><b>{result.created?.length || 0}</b><span>TKQC thêm mới</span></div>
              <div><b>{result.switched?.length || 0}</b><span>Chuyển sang VIA này</span></div>
              <div><b>{result.skipped?.length || 0}</b><span>Bỏ qua</span></div>
            </div>
            {result.skipped?.length > 0 && (
              <ul className="via-skip-list">
                {result.skipped.map(item => <li key={item.adAccountId}>{item.adAccountId}: {item.error}</li>)}
              </ul>
            )}
            <p className="via-p">Các TKQC này dùng token của VIA <b>{profileName}</b>. Khi đăng nhập lại VIA này, token của chúng sẽ tự được cập nhật.</p>
          </div>
        )}

        <div className="via-footer">
          {step === 0 && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>Hủy</button>
              <button className="btn via-fb-btn" onClick={loginFacebook} disabled={loggingIn}>
                {loggingIn ? 'Đang đợi Facebook...' : 'Đăng nhập với Facebook'}
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={restart}>Đổi VIA</button>
              <button className="btn btn-g via-primary" onClick={importSelected} disabled={!selected.size || importing}>
                {importing
                  ? 'Đang nhập...'
                  : `Nhập ${selected.size} TKQC${selectedSwitchCount ? ` (${selectedNewCount} mới, ${selectedSwitchCount} chuyển VIA)` : ''}`}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={restart}>Thêm VIA khác</button>
              <button className="btn btn-g via-primary" onClick={closeModal}>Xong</button>
            </>
          )}
        </div>
      </div>

      <aside className="via-guide">
        <div className="via-guide-title">Hướng dẫn</div>
        {GUIDE.map((item, index) => (
          <div key={item.title} className={`via-guide-item ${openGuide === index ? 'is-open' : ''}`}>
            <button type="button" onClick={() => setOpenGuide(openGuide === index ? -1 : index)}>
              <span>{index + 1}. {item.title}</span>
              <span className="via-chevron">⌄</span>
            </button>
            {openGuide === index && <p>{item.body}</p>}
          </div>
        ))}
      </aside>
    </div>
  );
}
