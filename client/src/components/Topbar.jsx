import React from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import {
  hasGeminiApiKey,
  loadGeminiApiKeyStatus,
  onGeminiApiKeyChange,
  removeGeminiApiKey,
  saveGeminiApiKey
} from '../lib/gemini';
import { notify } from '../lib/notify';

export default function Topbar({ title }) {
  const { provider, currentUser, logout, refreshAll, loadAccounts, openModal } = useAppContext();
  const [discovering, setDiscovering] = React.useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = React.useState('');
  const [geminiReady, setGeminiReady] = React.useState(() => hasGeminiApiKey());
  const [testingGeminiKey, setTestingGeminiKey] = React.useState(false);
  const showAdActions = provider !== 'oder' && provider !== 'kho';

  React.useEffect(() => {
    const syncGeminiStatus = () => setGeminiReady(hasGeminiApiKey());
    syncGeminiStatus();
    return onGeminiApiKeyChange(syncGeminiStatus);
  }, []);

  React.useEffect(() => {
    if (!currentUser) return;
    loadGeminiApiKeyStatus()
      .then(hasKey => setGeminiReady(hasKey))
      .catch(error => console.warn('Failed to load Gemini key status', error));
  }, [currentUser]);

  const saveGeminiKey = async () => {
    if (!geminiKeyInput.trim()) {
      notify.error('Vui long nhap Gemini API Key');
      return;
    }

    setTestingGeminiKey(true);
    try {
      await saveGeminiApiKey(geminiKeyInput);
      setGeminiKeyInput('');
      setGeminiReady(true);
      notify.success('Gemini API Key hop le va da luu vao database');
    } catch (error) {
      console.error('Gemini key save failed:', error);
      if (error?.status === 401) {
        setGeminiReady(false);
        notify.error('API Key khong hop le hoac khong dung duoc voi Gemini API');
        return;
      }
      if (error?.status === 429) {
        notify.error('Da vuot rate limit, thu lai sau 60 giay');
        return;
      }
      notify.error(`Luu Gemini key loi: ${error.message}`);
    } finally {
      setTestingGeminiKey(false);
    }
  };

  const removeGeminiKey = async () => {
    if (!window.confirm('Bạn chắc chắn muốn xóa Gemini API Key của tài khoản này?')) return;
    try {
      await removeGeminiApiKey();
      setGeminiKeyInput('');
      setGeminiReady(false);
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

  return (
    <div className="topbar">
      <div className="topbar-title">
        <span id="pageTitle">{title}</span>
      </div>
      <div className="topbar-actions">
        <span id="dateLabel" style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted2)' }}>
          {new Date().toLocaleDateString('vi-VN')}
        </span>
        {showAdActions && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => openModal('CONFIG')}>Token / API key</button>
            <div className="topbar-ai-key">
              <input
                type="password"
                placeholder="Gemini API Key..."
                value={geminiKeyInput}
                onChange={event => setGeminiKeyInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') saveGeminiKey();
                }}
                aria-label="Gemini API Key"
              />
              <button className="btn btn-ghost btn-sm" onClick={saveGeminiKey} disabled={testingGeminiKey}>
                {testingGeminiKey ? 'Đang lưu...' : 'Lưu'}
              </button>
              {geminiReady && (
                <>
                  <span className="ai-ready-badge">🤖 AI sẵn sàng</span>
                  <button className="btn btn-ghost btn-sm topbar-ai-remove" onClick={removeGeminiKey}>Xóa key</button>
                </>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={refreshAll}>Lam moi</button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ borderColor: 'var(--b)', color: 'var(--b)' }}
              onClick={handleAutoDiscover}
              disabled={discovering}
            >
              {discovering ? 'Dang dong bo...' : 'Auto Discover'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => openModal('BULK_ADD')}>+ Them nhieu</button>
            {provider === 'shopee' && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ borderColor: 'var(--g)', color: 'var(--g)' }}
                onClick={() => openModal('SHOPEE_PAGES')}
              >
                + Them Page
              </button>
            )}
            <button className="btn btn-g btn-sm topbar-add-account-btn" onClick={() => openModal('ACCOUNT')}>+ Them Tai Khoan</button>
          </>
        )}
        <button className="btn btn-danger btn-sm" onClick={logout}>Dang Xuat</button>
      </div>
    </div>
  );
}
