import React from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import { toast } from 'react-toastify';
import {
  getClaudeApiKey,
  hasClaudeApiKey,
  onClaudeApiKeyChange,
  removeClaudeApiKeyForUser,
  saveClaudeApiKeyForUser
} from '../lib/claude';

export default function Topbar({ title }) {
  const { provider, currentUser, logout, refreshAll, loadAccounts, openModal } = useAppContext();
  const [discovering, setDiscovering] = React.useState(false);
  const [claudeKeyInput, setClaudeKeyInput] = React.useState('');
  const [claudeReady, setClaudeReady] = React.useState(() => hasClaudeApiKey(currentUser));
  const showAdActions = provider !== 'oder' && provider !== 'kho';

  React.useEffect(() => {
    const syncClaudeStatus = () => setClaudeReady(hasClaudeApiKey(currentUser));
    syncClaudeStatus();
    return onClaudeApiKeyChange(syncClaudeStatus);
  }, [currentUser]);

  const saveClaudeKey = () => {
    if (!saveClaudeApiKeyForUser(currentUser, claudeKeyInput)) {
      toast.error('Vui lòng nhập Claude API Key');
      return;
    }
    setClaudeKeyInput('');
    setClaudeReady(Boolean(getClaudeApiKey(currentUser)));
    toast.success('Đã lưu Claude API Key');
  };

  const removeClaudeKey = () => {
    if (!window.confirm('Bạn chắc chắn muốn xóa Claude API Key của tài khoản này?')) return;
    removeClaudeApiKeyForUser(currentUser);
    setClaudeKeyInput('');
    setClaudeReady(false);
    toast.success('Đã xóa Claude API Key');
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
            <div className="topbar-claude-key">
              <input
                type="password"
                placeholder="Claude API Key..."
                value={claudeKeyInput}
                onChange={event => setClaudeKeyInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') saveClaudeKey();
                }}
                aria-label="Claude API Key"
              />
              <button className="btn btn-ghost btn-sm" onClick={saveClaudeKey}>Lưu</button>
              {claudeReady && (
                <>
                  <span className="ai-ready-badge">🤖 AI sẵn sàng</span>
                  <button className="btn btn-ghost btn-sm topbar-claude-remove" onClick={removeClaudeKey}>Xóa key</button>
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
