import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

// Dong trang thai so cai chi phi ads Shopee (luu rieng de xoa TKQC khong mat chi phi cu)
export default function AdsSpendLedgerStatus({ ledger }) {
  if (!ledger) return null;

  if (!ledger.ready) {
    return (
      <div className="shopee-ledger-status pending">
        <Loader2 size={14} className="shopee-social-spin" />
        <span>
          Đang lưu chi phí ads vào database lần đầu
          {ledger.progressRows ? ` (${Number(ledger.progressRows).toLocaleString('vi-VN')} dòng)` : ''}…
          Trong lúc chờ, chi phí đang đọc trực tiếp từ dữ liệu chiến dịch.
        </span>
      </div>
    );
  }

  if (ledger.lastError) {
    return (
      <div className="shopee-ledger-status error" title={ledger.lastError}>
        <AlertTriangle size={14} />
        <span>Lần lưu chi phí ads gần nhất bị lỗi: {ledger.lastError}</span>
      </div>
    );
  }

  return (
    <div className="shopee-ledger-status ok">
      <CheckCircle2 size={14} />
      <span>
        Chi phí ads đã lưu vào database
        {ledger.lastSyncAt ? ` · cập nhật lúc ${formatTime(ledger.lastSyncAt)}` : ''}
        {ledger.running || ledger.syncing ? ' · đang cập nhật…' : ''}
      </span>
    </div>
  );
}
