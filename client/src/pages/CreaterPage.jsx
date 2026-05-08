import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, apiUrl, dateTimeString, formatNumber, getAuthToken } from '../lib/api';

const RECENT_POSTS_LIMIT = 12;
const VIDEO_FILE_MAX_BYTES = 100 * 1024 * 1024;
const IMAGE_FILE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_FILES = 10;
const BATCH_PUBLISH_DELAY_MS = 1200;

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function truncateText(text, max = 220) {
  const value = String(text || '').trim();
  if (!value) return 'Khong co noi dung';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function buildPublishMessage(caption, link) {
  const cleanCaption = String(caption || '').trim();
  const cleanLink = String(link || '').trim();
  if (cleanLink && cleanCaption) return `Mua ngay : ${cleanLink} 👉 ${cleanCaption}`;
  if (cleanLink) return `Mua ngay : ${cleanLink}`;
  return cleanCaption;
}

function parseBatchRows(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const normalizedLine = line.replace(/\s+/g, ' ').trim();
      const urlMatches = [...normalizedLine.matchAll(/https?:\/\/\S+/gi)];
      const link = urlMatches.length ? urlMatches[urlMatches.length - 1][0].trim() : '';
      const caption = link
        ? normalizedLine.replace(link, '').replace(/\s+/g, ' ').trim()
        : normalizedLine;
      return {
        index,
        raw: line,
        caption,
        link,
        message: buildPublishMessage(caption, link)
      };
    })
    .filter(item => item.message);
}

function sortFilesNaturally(files) {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export default function CreaterPage() {
  const [pages, setPages] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pageQuery, setPageQuery] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [recentPosts, setRecentPosts] = useState([]);
  const [loadingRecentPosts, setLoadingRecentPosts] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchVideoFiles, setBatchVideoFiles] = useState([]);
  const [batchPublishing, setBatchPublishing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ total: 0, done: 0, success: 0, failed: 0 });
  const [batchResults, setBatchResults] = useState([]);

  const loadPages = useCallback(async () => {
    setLoadingPages(true);
    try {
      const data = await api('GET', '/pages');
      const nextPages = data.pages || [];
      setPages(nextPages);
      setSelectedPageId(currentId => {
        if (currentId && nextPages.some(page => String(page.id) === String(currentId))) return currentId;
        return nextPages[0]?.id ? String(nextPages[0].id) : '';
      });
    } catch (error) {
      toast.error('Loi tai danh sach page: ' + error.message);
    } finally {
      setLoadingPages(false);
    }
  }, []);

  const loadRecentPosts = useCallback(async (pageId, options = {}) => {
    const { silent = false } = options;
    if (!pageId) {
      setRecentPosts([]);
      return;
    }

    if (!silent) setLoadingRecentPosts(true);
    try {
      const data = await api('GET', `/pages/${pageId}/posts?limit=${RECENT_POSTS_LIMIT}`);
      setRecentPosts(data.posts || []);
    } catch (error) {
      if (!silent) toast.error('Loi tai bai viet gan day: ' + error.message);
    } finally {
      if (!silent) setLoadingRecentPosts(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  useEffect(() => {
    if (!selectedPageId) {
      setRecentPosts([]);
      return;
    }
    loadRecentPosts(selectedPageId);
  }, [loadRecentPosts, selectedPageId]);

  const filteredPages = useMemo(() => {
    const query = normalizeSearch(pageQuery);
    if (!query) return pages;
    return pages.filter(page => {
      const name = normalizeSearch(page.name);
      const category = normalizeSearch(page.category);
      const id = normalizeSearch(page.id);
      return name.includes(query) || category.includes(query) || id.includes(query);
    });
  }, [pageQuery, pages]);

  const selectedPage = useMemo(
    () => pages.find(page => String(page.id) === String(selectedPageId)) || null,
    [pages, selectedPageId]
  );

  const mediaSummary = useMemo(() => {
    const files = Array.from(mediaFiles || []);
    const videoFiles = files.filter(file => String(file.type || '').startsWith('video/'));
    const imageFiles = files.filter(file => String(file.type || '').startsWith('image/'));
    return {
      total: files.length,
      videoFiles,
      imageFiles,
      hasMixedMedia: videoFiles.length > 0 && imageFiles.length > 0
    };
  }, [mediaFiles]);

  const batchRows = useMemo(() => parseBatchRows(batchInput), [batchInput]);
  const sortedBatchVideoFiles = useMemo(
    () => sortFilesNaturally(batchVideoFiles.filter(file => String(file.type || '').startsWith('video/'))),
    [batchVideoFiles]
  );
  const batchPairCount = Math.min(batchRows.length, sortedBatchVideoFiles.length);

  const publishFormData = useCallback(async (pageId, formData, timeoutMs = 15 * 60 * 1000) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(apiUrl(`/pages/${pageId}/publish`), {
        method: 'POST',
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
        body: formData,
        signal: controller.signal
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const error = new Error(data?.error || 'Upload file that bai');
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Upload file qua lau, vui long thu file nho hon hoac thu lai');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  const handlePublishPost = async () => {
    const nextMessage = message.trim();
    const nextLink = link.trim();
    const publishMessage = buildPublishMessage(nextMessage, nextLink);

    if (!selectedPageId) {
      toast.error('Chon fanpage truoc khi dang bai');
      return;
    }
    if (!publishMessage && mediaSummary.total === 0) {
      toast.error('Nhap noi dung, link hoac chon file truoc khi dang bai');
      return;
    }
    if (mediaSummary.hasMixedMedia) {
      toast.error('Khong ho tro dang cung luc anh va video. Hay chon mot loai file.');
      return;
    }
    if (mediaSummary.videoFiles.length > 1) {
      toast.error('Chi ho tro 1 video moi lan dang');
      return;
    }
    if (mediaSummary.imageFiles.length > MAX_IMAGE_FILES) {
      toast.error(`Toi da ${MAX_IMAGE_FILES} anh moi lan dang`);
      return;
    }
    if (mediaSummary.videoFiles.some(file => file.size > VIDEO_FILE_MAX_BYTES)) {
      toast.error('File video vuot gioi han 100MB');
      return;
    }
    if (mediaSummary.imageFiles.some(file => file.size > IMAGE_FILE_MAX_BYTES)) {
      toast.error('Moi file anh toi da 20MB');
      return;
    }

    setPublishing(true);
    setPublishResult(null);
    try {
      let result;
      if (mediaSummary.total > 0) {
        const formData = new FormData();
        if (publishMessage) formData.append('message', publishMessage);
        Array.from(mediaFiles).forEach(file => {
          formData.append('media', file);
        });
        result = await publishFormData(selectedPageId, formData);
      } else {
        const payload = {};
        if (publishMessage) payload.message = publishMessage;
        result = await api('POST', `/pages/${selectedPageId}/publish`, payload, {
          timeoutMs: 2 * 60 * 1000
        });
      }

      setPublishResult(result);
      if (result.post) {
        setRecentPosts(items => {
          const nextItems = [result.post, ...items.filter(item => item.id !== result.post.id)];
          return nextItems.slice(0, RECENT_POSTS_LIMIT);
        });
      }
      setMessage('');
      setLink('');
      setMediaFiles([]);
      toast.success(
        result.mode === 'video'
          ? 'Da dang reels len page'
          : result.mode === 'photos'
            ? 'Da dang nhieu anh len page'
            : result.mode === 'photo'
              ? 'Da dang anh len page'
              : 'Da dang bai len page'
      );
    } catch (error) {
      toast.error('Loi dang bai: ' + error.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleBatchPublish = async () => {
    if (!selectedPageId) {
      toast.error('Chon fanpage truoc khi dang batch');
      return;
    }
    if (!batchRows.length) {
      toast.error('Dan list caption/link truoc khi dang batch');
      return;
    }
    if (!sortedBatchVideoFiles.length) {
      toast.error('Chon danh sach video truoc khi dang batch');
      return;
    }
    if (batchVideoFiles.length !== sortedBatchVideoFiles.length) {
      toast.error('Batch chi ho tro file video');
      return;
    }
    if (sortedBatchVideoFiles.some(file => file.size > VIDEO_FILE_MAX_BYTES)) {
      toast.error('Co video vuot gioi han 100MB');
      return;
    }
    if (batchPairCount === 0) {
      toast.error('Khong co cap du lieu nao de dang');
      return;
    }

    setBatchPublishing(true);
    setBatchResults([]);
    setBatchProgress({ total: batchPairCount, done: 0, success: 0, failed: 0 });

    const results = [];
    let success = 0;
    let failed = 0;

    for (let index = 0; index < batchPairCount; index += 1) {
      const row = batchRows[index];
      const videoFile = sortedBatchVideoFiles[index];

      try {
        const formData = new FormData();
        if (row.message) formData.append('message', row.message);
        formData.append('media', videoFile);

        const result = await publishFormData(selectedPageId, formData);
        success += 1;
        results.push({
          index: index + 1,
          status: 'success',
          caption: row.caption || '(khong co caption)',
          link: row.link || '',
          fileName: videoFile.name,
          postId: result.postId || result.post?.id || ''
        });
      } catch (error) {
        failed += 1;
        results.push({
          index: index + 1,
          status: 'error',
          caption: row.caption || '(khong co caption)',
          link: row.link || '',
          fileName: videoFile.name,
          error: error.message
        });
      }

      setBatchResults([...results]);
      setBatchProgress({ total: batchPairCount, done: index + 1, success, failed });

      if (index < batchPairCount - 1) {
        await sleep(BATCH_PUBLISH_DELAY_MS);
      }
    }

    setBatchPublishing(false);
    if (success > 0) loadRecentPosts(selectedPageId, { silent: true });
    if (failed > 0) {
      toast.warn(`Dang xong batch: ${success} thanh cong, ${failed} loi`);
    } else {
      toast.success(`Da dang ${success} bai reels`);
    }
  };

  return (
    <div id="page-creater">
      <div className="creater-page-layout">
        <div className="card creater-page-sidebar">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div className="card-title">Danh sach Page</div>
            <button className="btn btn-ghost btn-sm" onClick={loadPages} disabled={loadingPages}>
              {loadingPages ? '...' : 'Lam moi'}
            </button>
          </div>

          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <input
              type="search"
              value={pageQuery}
              onChange={e => setPageQuery(e.target.value)}
              placeholder="Tim page theo ten, ID..."
              style={{
                width: '100%',
                height: '38px',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '0 12px',
                color: 'var(--txt)',
                background: 'var(--s1)',
                outline: 'none'
              }}
            />
          </div>

          <div className="creater-page-page-list">
            {loadingPages ? (
              <div className="empty">
                <span className="spin">...</span>
                <p style={{ marginTop: '10px' }}>Dang tai page...</p>
              </div>
            ) : filteredPages.length === 0 ? (
              <div className="empty">
                <div className="ei">PAGE</div>
                <p>Khong tim thay page nao</p>
              </div>
            ) : (
              filteredPages.map(page => {
                const isActive = String(selectedPageId) === String(page.id);
                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => setSelectedPageId(String(page.id))}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      marginBottom: '6px',
                      borderRadius: '10px',
                      border: isActive ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid var(--border)',
                      background: isActive ? 'rgba(59, 130, 246, 0.08)' : 'var(--s2)',
                      cursor: 'pointer',
                      color: 'inherit',
                      textAlign: 'left'
                    }}
                  >
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        overflow: 'hidden',
                        background: 'var(--s3)',
                        border: '1px solid var(--border2)',
                        flexShrink: 0
                      }}
                    >
                      {page.picture?.data?.url ? (
                        <img
                          src={page.picture.data.url}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }}>
                          PAGE
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: isActive ? 'var(--b)' : 'var(--txt)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {page.name}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
                        {page.category || 'Page'}{page.fan_count ? ` - ${formatNumber(page.fan_count)} likes` : ''}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="creater-page-main">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Creater Page</div>
              <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>
                {selectedPage ? `Dang cho ${selectedPage.name}` : 'Chua chon fanpage'}
              </div>
            </div>

            <div className="creater-page-compose">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  background: 'var(--s2)'
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    background: 'var(--s3)',
                    border: '1px solid var(--border2)',
                    flexShrink: 0
                  }}
                >
                  {selectedPage?.picture?.data?.url ? (
                    <img
                      src={selectedPage.picture.data.url}
                      alt=""
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>
                      PAGE
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--txt)' }}>
                    {selectedPage?.name || 'Chon mot fanpage de dang bai'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted2)', lineHeight: 1.5 }}>
                    Video dang len Page se hien thi theo dang reels. Backend can token co quyen pages_manage_posts de publish thanh cong.
                  </div>
                </div>
              </div>

              <div className="creater-page-compose-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Noi dung bai viet</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Nhap noi dung bai viet..."
                    style={{
                      minHeight: '220px',
                      resize: 'vertical',
                      background: 'var(--s1)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      color: 'var(--txt)',
                      outline: 'none',
                      lineHeight: 1.55
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11px', color: 'var(--muted2)' }}>
                    <span>Co the de trong neu chi dang link.</span>
                    <span>{formatNumber(message.length)} ky tu</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '12px', alignContent: 'start' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Link dinh kem</label>
                    <input
                      type="url"
                      value={link}
                      onChange={e => setLink(e.target.value)}
                      placeholder="https://..."
                    />
                    <div className="inline-note">
                      Neu co link, bai dang se theo mau: Mua ngay : link 👉 caption
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>File media</label>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={e => setMediaFiles(Array.from(e.target.files || []))}
                    />
                    <div className="inline-note">
                      Ho tro nhieu anh hoac 1 video reels. Khong ho tro tron anh va video trong cung 1 lan dang.
                    </div>
                    {mediaSummary.total > 0 && (
                      <div style={{ display: 'grid', gap: '6px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--muted2)' }}>
                          {mediaSummary.imageFiles.length > 0 && `${mediaSummary.imageFiles.length} anh`}
                          {mediaSummary.imageFiles.length > 0 && mediaSummary.videoFiles.length > 0 && ' + '}
                          {mediaSummary.videoFiles.length > 0 && `${mediaSummary.videoFiles.length} video`}
                        </div>
                        {Array.from(mediaFiles).map(file => (
                          <div key={`${file.name}-${file.size}`} style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                            {file.name} - {formatNumber(Math.max(1, Math.round(file.size / 1024 / 1024)))} MB
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      background: 'var(--s2)',
                      padding: '14px'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted2)', marginBottom: '8px' }}>
                      XEM NHANH
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--txt)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {buildPublishMessage(message, link) || 'Noi dung bai viet se hien thi o day'}
                    </div>
                    {mediaSummary.total > 0 && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          background: 'var(--s3)',
                          border: '1px solid var(--border)'
                        }}
                      >
                        <div style={{ fontSize: '10px', color: 'var(--muted2)', marginBottom: '4px' }}>
                          {mediaSummary.videoFiles.length > 0 ? 'REELS VIDEO' : 'MEDIA'}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--txt)', wordBreak: 'break-all' }}>
                          {Array.from(mediaFiles).map(file => file.name).join(', ')}
                        </div>
                      </div>
                    )}
                    {link.trim() && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          background: 'var(--s3)',
                          border: '1px solid var(--border)'
                        }}
                      >
                        <div style={{ fontSize: '10px', color: 'var(--muted2)', marginBottom: '4px' }}>LINK</div>
                        <div style={{ fontSize: '12px', color: 'var(--b)', wordBreak: 'break-all' }}>{link.trim()}</div>
                      </div>
                    )}
                  </div>

                  <button className="btn btn-g" onClick={handlePublishPost} disabled={publishing || !selectedPageId}>
                    {publishing ? 'Dang dang bai...' : 'Dang bai ngay'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Dang batch reels</div>
              <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>
                Ghep dong 1 voi video 1 theo thu tu ten file
              </div>
            </div>

            <div style={{ padding: '16px', display: 'grid', gap: '14px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>List caption/link tu sheet</label>
                <textarea
                  value={batchInput}
                  onChange={e => setBatchInput(e.target.value)}
                  placeholder={'Dan du lieu tu sheet vao day.\nHo tro line text thuong hoac tab-separated tu Google Sheets.'}
                  style={{
                    minHeight: '180px',
                    resize: 'vertical',
                    background: 'var(--s1)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    color: 'var(--txt)',
                    outline: 'none',
                    lineHeight: 1.55
                  }}
                />
                <div className="inline-note">
                  Neu dong co link, he thong se ghep thanh caption + xuong dong + link.
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Danh sach video reels</label>
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  onChange={e => setBatchVideoFiles(Array.from(e.target.files || []))}
                />
                <div className="inline-note">
                  Chon nhieu video. He thong se sort theo ten file de ghep lan luot voi list va dang tung bai theo dang reels.
                </div>
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  background: 'var(--s2)',
                  padding: '14px',
                  display: 'grid',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--muted2)' }}>
                  <span>{batchRows.length} dong</span>
                  <span>{sortedBatchVideoFiles.length} video</span>
                  <span>{batchPairCount} cap se dang</span>
                </div>
                {(batchRows.length !== sortedBatchVideoFiles.length) && (
                  <div style={{ fontSize: '11px', color: 'var(--o)' }}>
                    So dong va so video dang lech nhau. He thong chi dang {batchPairCount} cap dau tien, phan du se bo qua.
                  </div>
                )}
                {sortedBatchVideoFiles.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                    {sortedBatchVideoFiles.slice(0, 5).map(file => file.name).join(', ')}
                    {sortedBatchVideoFiles.length > 5 ? ' ...' : ''}
                  </div>
                )}
              </div>

              <button className="btn btn-g" onClick={handleBatchPublish} disabled={batchPublishing || !selectedPageId}>
                {batchPublishing ? `Dang batch ${batchProgress.done}/${batchProgress.total}...` : 'Dang batch reels'}
              </button>
            </div>
          </div>

          {publishResult?.post && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Bai vua dang</div>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted2)', marginBottom: '6px' }}>
                  Page: {publishResult.page?.name || '-'}{publishResult.mode === 'video' ? ' - Reels' : publishResult.mode === 'photos' ? ' - Album anh' : publishResult.mode === 'photo' ? ' - Anh' : ''}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--txt)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {publishResult.post.message || 'Khong co noi dung text'}
                </div>
                {publishResult.fileName && (
                  <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                    File: {publishResult.fileName}
                  </div>
                )}
                {publishResult.fileNames?.length > 0 && (
                  <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                    Files: {publishResult.fileNames.join(', ')}
                  </div>
                )}
                <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
                  ID: {publishResult.post.id}
                </div>
              </div>
            </div>
          )}

          {(batchResults.length > 0 || batchPublishing) && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Ket qua batch</div>
                <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>
                  {batchProgress.done}/{batchProgress.total} - OK {batchProgress.success} - Loi {batchProgress.failed}
                </div>
              </div>
              <div style={{ padding: '14px 16px', display: 'grid', gap: '10px' }}>
                {batchResults.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>Dang chuan bi batch...</div>
                ) : (
                  batchResults.map(item => (
                    <div
                      key={`${item.index}-${item.fileName}`}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        background: item.status === 'success' ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.06)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px', marginBottom: '6px' }}>
                        <strong>#{item.index} - {item.fileName}</strong>
                        <span style={{ color: item.status === 'success' ? 'var(--g)' : 'var(--r)' }}>
                          {item.status === 'success' ? 'Thanh cong' : 'Loi'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--txt)', marginBottom: '4px', wordBreak: 'break-word' }}>
                        {item.caption}
                      </div>
                      {item.link && (
                        <div style={{ fontSize: '11px', color: 'var(--b)', wordBreak: 'break-all', marginBottom: '4px' }}>
                          {item.link}
                        </div>
                      )}
                      {item.postId && (
                        <div style={{ fontSize: '10px', color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
                          ID: {item.postId}
                        </div>
                      )}
                      {item.error && (
                        <div style={{ fontSize: '11px', color: 'var(--r)' }}>
                          {item.error}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <div className="card-title">Bai viet gan day</div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => loadRecentPosts(selectedPageId)}
                disabled={loadingRecentPosts || !selectedPageId}
              >
                {loadingRecentPosts ? '...' : 'Tai lai'}
              </button>
            </div>

            <div style={{ padding: '14px 16px' }}>
              {!selectedPageId ? (
                <div className="empty">
                  <div className="ei">POST</div>
                  <p>Chon page de xem bai viet gan day</p>
                </div>
              ) : loadingRecentPosts ? (
                <div className="empty">
                  <span className="spin">...</span>
                  <p style={{ marginTop: '10px' }}>Dang tai bai viet...</p>
                </div>
              ) : recentPosts.length === 0 ? (
                <div className="empty">
                  <div className="ei">POST</div>
                  <p>Chua co bai viet nao</p>
                </div>
              ) : (
                <div className="creater-page-post-grid">
                  {recentPosts.map(post => (
                    <div
                      key={post.id}
                      style={{
                        background: 'var(--s2)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        overflow: 'hidden'
                      }}
                    >
                      {post.picture && (
                        <div style={{ width: '100%', height: '160px', background: 'var(--s3)' }}>
                          <img
                            src={post.picture}
                            alt=""
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { e.currentTarget.style.display = 'none'; }}
                          />
                        </div>
                      )}
                      <div style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--txt)', lineHeight: 1.55, marginBottom: '10px', wordBreak: 'break-word' }}>
                          {truncateText(post.message)}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '10px', color: 'var(--muted2)', marginBottom: '8px' }}>
                          <span>{dateTimeString(post.createdTime)}</span>
                          <span>{formatNumber(post.likes || 0)} like</span>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--muted2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                          {post.id}
                        </div>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'inline-block', marginTop: '10px', fontSize: '11px', color: 'var(--b)', textDecoration: 'none', fontWeight: 700 }}
                          >
                            Xem tren Facebook
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
