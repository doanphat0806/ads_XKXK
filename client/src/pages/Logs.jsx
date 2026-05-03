import React, { useState, useEffect, useCallback } from 'react';
import { api, timeString } from '../lib/api';
import { toast } from 'react-toastify';
import { useAppContext } from '../contexts/AppContext';

export default function Logs() {
  const { provider } = useAppContext();
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const providerLabel = selectedProvider === 'shopee' ? 'Shopee' : 'Facebook';

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('GET', `/logs?provider=${encodeURIComponent(selectedProvider)}&limit=200`);
      setLogs(data);
    } catch {
      toast.error('Loi tai nhat ky');
    } finally {
      setLoading(false);
    }
  }, [selectedProvider]);

  const clearLogs = async () => {
    if (!confirm(`Xoa tat ca nhat ky ${providerLabel}?`)) return;
    try {
      await api('DELETE', `/logs?provider=${encodeURIComponent(selectedProvider)}`);
      setLogs([]);
      toast.success(`Da xoa nhat ky ${providerLabel}`);
    } catch (e) {
      toast.error('Loi: ' + e.message);
    }
  };

  useEffect(() => {
    setSelectedProvider(provider);
  }, [provider]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const getLevelClass = (level) => {
    switch (level) {
      case 'error': return 'text-danger';
      case 'warn': return 'text-warning';
      case 'success': return 'text-success';
      case 'ai': return 'text-primary';
      default: return '';
    }
  };

  return (
    <div id="page-logs">
      <div className="filter-row" style={{ display: 'flex', gap: '10px', marginBottom: '14px', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`btn btn-sm ${selectedProvider === 'facebook' ? 'btn-g' : 'btn-ghost'}`}
            onClick={() => setSelectedProvider('facebook')}
          >
            Facebook
          </button>
          <button
            className={`btn btn-sm ${selectedProvider === 'shopee' ? 'btn-g' : 'btn-ghost'}`}
            onClick={() => setSelectedProvider('shopee')}
          >
            Shopee
          </button>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchLogs}>Lam moi</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--r)' }} onClick={clearLogs}>Xoa {providerLabel}</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Nhat ky {providerLabel} ({logs.length})</div>
        </div>
        <div className="tbl-wrap">
          {loading && logs.length === 0 ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : logs.length === 0 ? (
            <div className="empty"><div className="ei">LOG</div><p>Chua co nhat ky nao</p></div>
          ) : (
            <table className="tbl" style={{ fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>Thoi gian</th>
                  <th style={{ width: '180px' }}>Tai khoan</th>
                  <th style={{ width: '80px' }}>Muc do</th>
                  <th>Noi dung</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id}>
                    <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{timeString(log.createdAt)}</td>
                    <td style={{ fontWeight: 600 }}>{log.accountName || 'System'}</td>
                    <td>
                      <span className={`badge-mini ${log.level}`}>
                        {String(log.level || '').toUpperCase()}
                      </span>
                    </td>
                    <td className={getLevelClass(log.level)} style={{ wordBreak: 'break-word' }}>
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
