import React from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import { toast } from 'react-toastify';
import {
  getGeminiApiKey,
  hasGeminiApiKey,
  onGeminiApiKeyChange,
  removeGeminiApiKeyForUser,
  saveGeminiApiKeyForUser,
  testGeminiApiKey
} from '../lib/gemini';

export default function Topbar({ title }) {
  const { provider, currentUser, logout, refreshAll, loadAccounts, openModal } = useAppContext();
  const [discovering, setDiscovering] = React.useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = React.useState('');
  const [geminiReady, setGeminiReady] = React.useState(() => hasGeminiApiKey(currentUser));
  const [testingGeminiKey, setTestingGeminiKey] = React.useState(false);
  const showAdActions = provider !== 'oder' && provider !== 'kho';

  React.useEffect(() => {
    const syncGeminiStatus = () => setGeminiReady(hasGeminiApiKey(currentUser));
    syncGeminiStatus();
    return onGeminiApiKeyChange(syncGeminiStatus);
  }, [currentUser]);

  const saveGeminiKey = () => {
    if (!saveGeminiApiKeyForUser(currentUser, geminiKeyInput)) {
      toast.error('Vui lòng nhập Gemini API Key');
      return;
    }
    setGeminiKeyInput('');
    setGeminiReady(Boolean(getGeminiApiKey(currentUser)));
    toast.success('Đã lưu Gemini API Key');
  };

  const removeGeminiKey = () => {
    if (!window.confirm('Bạn chắc chắn muốn xóa Gemini API Key của tài khoản này?')) return;
    removeGeminiApiKeyForUser(currentUser);
    setGeminiKeyInput('');
    setGeminiReady(false);
    toast.success('Đã xóa Gemini API Key');
  };

  const testCurrentGeminiKey = async () => {
    const apiKey = geminiKeyInput.trim() || getGeminiApiKey(currentUser);
    if (!apiKey) {
      toast.error('Vui lòng nhập Gemini API Key');
      return;
    }

    setTestingGeminiKey(true);
    try {
      await testGeminiApiKey(apiKey);
      if (geminiKeyInput.trim()) {
        saveGeminiApiKeyForUser(currentUser, geminiKeyInput);
        setGeminiKeyInput('');
      }
      setGeminiReady(true);
      toast.success('Gemini API Key hợp lệ');
    } catch (error) {
      console.error('Gemini key test failed:', error);
      if (error?.status === 401) {
        removeGeminiApiKeyForUser(currentUser);
        setGeminiReady(false);
        toast.error('API Key không hợp lệ hoặc không dùng được với Gemini API');
        return;
      }
      if (error?.status === 429) {
        toast.error('Đã vượt rate limit, thử lại sau 60 giây');
        return;
      }
      toast.error(`Test Gemini key lỗi: ${error.message}`);
    } finally {
      setTestingGeminiKey(false);
    }
  };

  const handleAutoDiscover = async () => {
    if (discovering) return;
    setDiscovering(true);

    try {
      toast.info('Dang dong bo tai khoan duoc gan trong BM...');
      const result = await api('POST', '/accounts/auto-discover', {
        provider,
        fast: true,
        maxPages: 5
      }, {
        timeoutMs: 90000
      });
      await loadAccounts();
      toast.success(result.message || 'Da dong bo tai khoan duoc gan trong BM');
    } catch (e) {
      if (e.rateLimited || e.status === 429) {
        toast.info('Facebook dang gioi han Auto Discover. Doi vai phut roi bam lai.');
        return;
      }
      toast.error('Loi: ' + e.message);
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
              <button className="btn btn-ghost btn-sm" onClick={saveGeminiKey}>Lưu</button>
              <button className="btn btn-ghost btn-sm" onClick={testCurrentGeminiKey} disabled={testingGeminiKey}>
                {testingGeminiKey ? 'Đang test...' : 'Test key'}
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
