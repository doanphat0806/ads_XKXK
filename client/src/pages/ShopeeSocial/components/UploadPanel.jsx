import React, { useRef, useState } from 'react';
import { UploadCloud, FileSpreadsheet, Sparkles, MousePointerClick, Trash2, CloudCheck } from 'lucide-react';

export default function UploadPanel({ fileName, orderCount, onFile, onClickReportFile, onLoadDemo, onClear, loading }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const clickInputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="card shopee-social-upload">
      <div className="card-header">
        <div className="card-title">Tải Báo Cáo Shopee Affiliate</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={onLoadDemo} disabled={loading}>
            <Sparkles size={14} strokeWidth={2} /> Xem thử dữ liệu mẫu
          </button>
          {orderCount > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
              <Trash2 size={14} strokeWidth={2} /> Xóa dữ liệu
            </button>
          )}
        </div>
      </div>

      <div
        className={`shopee-social-dropzone ${dragOver ? 'is-dragover' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <UploadCloud size={30} strokeWidth={1.6} />
        <div className="shopee-social-dropzone-text">
          <strong>Kéo thả file .csv / .xlsx</strong> vào đây, hoặc bấm để chọn file
        </div>
        <div className="shopee-social-dropzone-hint">Hỗ trợ báo cáo đơn hàng Shopee Affiliate (tiếng Việt hoặc tiếng Anh)</div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
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
    </div>
  );
}
