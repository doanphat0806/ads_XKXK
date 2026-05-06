import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api, dateTimeString } from '../lib/api';

export default function GoogleSheets() {
  const [status, setStatus] = useState({ connected: false });
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const loadStatus = async () => {
    try {
      const data = await api('GET', '/google/status');
      setStatus(data);
      return data;
    } catch (error) {
      toast.error(`Loi kiem tra Google: ${error.message}`);
      return { connected: false };
    }
  };

  const loadSheets = async (nextSearch = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '200' });
      if (nextSearch.trim()) params.set('search', nextSearch.trim());
      const data = await api('GET', `/google/sheets?${params.toString()}`);
      setFiles(data.files || []);
    } catch (error) {
      toast.error(`Loi tai file Sheets: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') {
      toast.success('Da dang nhap Google');
      window.history.replaceState({}, '', '/google-sheets');
    }
    if (params.get('google') === 'error') {
      toast.error(params.get('message') || 'Dang nhap Google loi');
      window.history.replaceState({}, '', '/google-sheets');
    }

    loadStatus().then(data => {
      if (data.connected) loadSheets('');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectGoogle = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const data = await api('GET', '/google/oauth/start');
      window.location.href = data.url;
    } catch (error) {
      toast.error(`Khong mo duoc dang nhap Google: ${error.message}`);
      setConnecting(false);
    }
  };

  return (
    <div id="page-google-sheets">
      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Google Sheets</div>
          <button className="btn btn-g btn-sm" onClick={connectGoogle} disabled={connecting}>
            {status.connected ? 'Dang nhap lai Google' : 'Dang nhap Google'}
          </button>
        </div>
        <div className="google-sheet-status">
          <div>
            <div className={`badge ${status.connected ? 'active' : 'paused'}`}>
              {status.connected ? 'Da ket noi' : 'Chua ket noi'}
            </div>
            <div className="google-sheet-account">
              {status.connected ? `${status.name || 'Google'} ${status.email ? `- ${status.email}` : ''}` : 'Can dang nhap Google de xem cac file Sheet'}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">File Sheet trong Google Drive</div>
          <div className="inventory-search">
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') loadSheets(search);
              }}
              placeholder="Tim ten file"
            />
            <button className="btn btn-ghost btn-sm" onClick={() => loadSheets(search)} disabled={loading || !status.connected}>
              Tim
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => loadSheets('')} disabled={loading || !status.connected}>
              Tai lai
            </button>
          </div>
        </div>

        <div className="tbl-wrap">
          {loading ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai file Sheet...</p></div>
          ) : !status.connected ? (
            <div className="empty"><div className="ei">G</div><p>Dang nhap Google de xem file Sheet</p></div>
          ) : files.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Khong tim thay file Google Sheet</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ten file</th>
                  <th>Chu so huu</th>
                  <th>Cap nhat</th>
                  <th style={{ textAlign: 'right' }}>Mo file</th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => (
                  <tr key={file.id}>
                    <td>
                      <div className="google-sheet-name">{file.name}</div>
                      <div className="camp-sub">{file.id}</div>
                    </td>
                    <td>{file.owners?.[0]?.emailAddress || file.owners?.[0]?.displayName || '-'}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted2)', whiteSpace: 'nowrap' }}>
                      {dateTimeString(file.modifiedTime)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <a className="btn btn-ghost btn-sm" href={file.webViewLink} target="_blank" rel="noreferrer">
                        Mo
                      </a>
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
