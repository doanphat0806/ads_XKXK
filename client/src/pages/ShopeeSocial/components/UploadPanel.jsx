import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { UploadCloud, FileSpreadsheet, MousePointerClick, Trash2, CloudCheck, Pencil } from 'lucide-react';
import ShopeeAffAccountsModal from './ShopeeAffAccountsModal';

export default function UploadPanel({
  fileName, orderCount, accounts = [], onFile, onClickReportFile, onClear,
  onCreateAccount, onUpdateAccount, onDeleteAccount
}) {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const inputRef = useRef(null);
  const clickInputRef = useRef(null);

  // Keep a valid selection as the account list loads/changes — default to whichever
  // account was used last time, falling back to the first one in the list.
  useEffect(() => {
    if (selectedAccountId && accounts.some(a => a._id === selectedAccountId)) return;
    if (!accounts.length) { setSelectedAccountId(''); return; }
    let lastName = '';
    try { lastName = localStorage.getItem('shopee_social_last_account') || ''; } catch { /* ignore */ }
    const match = accounts.find(a => a.name === lastName) || accounts[0];
    setSelectedAccountId(match._id);
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts.find(a => a._id === selectedAccountId);

  function submitFile(file) {
    if (!file) return;
    if (!selectedAccount) {
      toast.error('Vui lòng tạo và chọn tài khoản Shopee AFF trước khi tải báo cáo lên');
      return;
    }
    try { localStorage.setItem('shopee_social_last_account', selectedAccount.name); } catch { /* ignore */ }
    onFile(file, selectedAccount.name);
  }

  return (
    <div className="card shopee-social-upload">
      <div className="card-header">
        <div className="card-title">Tải Báo Cáo Shopee Affiliate</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {orderCount > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
              <Trash2 size={14} strokeWidth={2} /> Xóa dữ liệu
            </button>
          )}
        </div>
      </div>

      <div className="shopee-social-account-field" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          Tài khoản Shopee AFF:
          <select
            className="shopee-social-input"
            style={{ width: 180 }}
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
          >
            {!accounts.length && <option value="">-- Chưa có tài khoản --</option>}
            {accounts.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
          {selectedAccount && (
            <span className="mono-sm" style={{ color: 'var(--muted2)', fontSize: 11, whiteSpace: 'nowrap' }} title="Prefix SubID2 dùng để nhận diện campaign của tài khoản này">
              Prefix: {selectedAccount.subIdPrefix || '(chưa đặt)'}
            </span>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowAccountsModal(true)} title="Quản lý danh sách tài khoản">
            <Pencil size={14} strokeWidth={2} />
          </button>
        </label>

        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', flexShrink: 0 }} />

        <button type="button" className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => inputRef.current?.click()}>
          <UploadCloud size={14} strokeWidth={2} /> Chọn file .csv / .xlsx
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={e => { submitFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      <div className="shopee-social-upload-footer">
        <div className="shopee-social-file-status">
          <FileSpreadsheet size={15} strokeWidth={2} />
          {fileName ? <span>{fileName} — <strong>{orderCount}</strong> đơn hàng</span> : <span>Chưa có dữ liệu</span>}
          {orderCount > 0 && (
            <span className="shopee-social-sync-badge" title="Dữ liệu đã lưu vào tài khoản của bạn">
              <CloudCheck size={13} strokeWidth={2} /> Đã lưu
            </span>
          )}
        </div>
        <button type="button" className="shopee-social-linklike" onClick={() => clickInputRef.current?.click()}>
          <MousePointerClick size={14} strokeWidth={2} /> Tải thêm Báo cáo Click (tùy chọn, để tự động điền số click)
        </button>
        <input
          ref={clickInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) onClickReportFile(f); e.target.value = ''; }}
        />
      </div>

      {showAccountsModal && (
        <ShopeeAffAccountsModal
          accounts={accounts}
          onCreate={onCreateAccount}
          onUpdate={onUpdateAccount}
          onDelete={onDeleteAccount}
          onClose={() => setShowAccountsModal(false)}
        />
      )}
    </div>
  );
}
