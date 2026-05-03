import React from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import { toast } from 'react-toastify';

export default function Topbar({ title }) {
  const { provider, logout, refreshAll, loadAccounts, openModal } = useAppContext();
  const [discovering, setDiscovering] = React.useState(false);

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
        <button className="btn btn-ghost btn-sm" onClick={() => openModal('CONFIG')}>Token / API key</button>
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
        <button className="btn btn-g btn-sm" onClick={() => openModal('ACCOUNT')}>+ Them Tai Khoan</button>
        <button className="btn btn-danger btn-sm" onClick={logout}>Dang Xuat</button>
      </div>
    </div>
  );
}
