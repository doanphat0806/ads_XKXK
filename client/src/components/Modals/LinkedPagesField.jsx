import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function LinkedPagesField({ selectedPageIds, onChange }) {
  const [pages, setPages] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);

  useEffect(() => {
    const fetchPages = async () => {
      setLoadingPages(true);
      try {
        const res = await api('GET', '/pages');
        setPages(res.pages || []);
      } catch (error) {
        console.error('Lỗi tải Pages:', error);
      } finally {
        setLoadingPages(false);
      }
    };

    fetchPages();
  }, []);

  const togglePageSelection = (pageId) => {
    const current = selectedPageIds || [];
    if (current.includes(pageId)) {
      onChange(current.filter(id => id !== pageId));
      return;
    }

    onChange([...current, pageId]);
  };

  return (
    <div className="form-group">
      <label>Fanpage liên kết (Dùng để lấy bài viết chạy Affiliate)</label>
      <div style={{
        maxHeight: '150px',
        overflowY: 'auto',
        background: 'var(--s2)',
        borderRadius: '8px',
        padding: '8px',
        border: '1px solid var(--border)'
      }}>
        {loadingPages ? (
          <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px' }}>Đang tải danh sách Page...</div>
        ) : pages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px', color: 'var(--muted)' }}>Không tìm thấy Page nào. Hãy lưu Token dùng chung trước.</div>
        ) : (
          pages.map(page => (
            <label key={page.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={(selectedPageIds || []).includes(page.id)}
                onChange={() => togglePageSelection(page.id)}
                style={{ width: '14px', height: '14px' }}
              />
              <span>{page.name}</span>
            </label>
          ))
        )}
      </div>
      <div className="inline-note">Chọn các Page bạn muốn dùng bài viết để lên camp cho tài khoản Shopee này.</div>
    </div>
  );
}
