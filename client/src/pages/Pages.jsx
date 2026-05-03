import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import { useAppContext } from '../contexts/AppContext';
import { toast } from 'react-toastify';

const SAVED_POSTS_LIMIT = 5000;
const FB_REFRESH_POSTS_LIMIT = 5000;
const FACEBOOK_POSTS_PER_PAGE_LIMIT = 500;
const SHOPEE_POSTS_PER_PAGE_LIMIT = 500;
const POSTS_AUTO_REFRESH_MS = 5 * 60 * 1000;
const FACEBOOK_DEFAULT_DAILY_BUDGET = 300000;
const FACEBOOK_DEFAULT_AGE_MIN = 18;
const FACEBOOK_DEFAULT_AGE_MAX = 50;
const SHOPEE_DEFAULT_DAILY_BUDGET = 50000;
const SHOPEE_DEFAULT_BID_AMOUNT = 500;
const SHOPEE_DEFAULT_AGE_MIN = 20;
const SHOPEE_DEFAULT_AGE_MAX = 44;
const AD_NAME_PREFIX_OPTIONS = ['PHAT', 'BINH', 'HIEU'];
const AD_STATUS_OPTIONS = ['Sale', 'Sẵn', 'Win', 'Test'];

function getDefaultCampaignStartTime() {
  const start = new Date(Date.now() + 7 * 60 * 60 * 1000);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(6, 0, 0, 0);
  const yyyy = start.getUTCFullYear();
  const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(start.getUTCDate()).padStart(2, '0');
  const hh = String(start.getUTCHours()).padStart(2, '0');
  const mi = String(start.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function normalizeAccountQuery(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getAccountLabel(account) {
  if (!account) return '';
  return `${account.name} - ${account.adAccountId}`;
}

function accountMatchesQuery(account, query) {
  const normalizedQuery = normalizeAccountQuery(query);
  if (!normalizedQuery) return true;

  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const haystack = normalizeAccountQuery(`${account.name} ${account.adAccountId}`);
  return haystack.includes(normalizedQuery) || haystack.replace(/\s+/g, '').includes(compactQuery);
}

function getPostPageId(post = {}) {
  const pageId = String(post.pageId || '').trim();
  if (pageId) return pageId;

  const postId = String(post.id || post.postId || '').trim();
  if (postId.includes('_')) return postId.split('_')[0];
  return '';
}

function formatCampaignCreateError(item) {
  const details = [
    item.objective,
    item.destinationType,
    item.optimizationGoal
  ].filter(Boolean).join(' / ');

  return details ? `${item.error} (${details})` : item.error;
}

function splitNonEmptyLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isPagePostPermissionError(error) {
  return error?.code === 'PAGE_POST_PERMISSION' ||
    String(error?.message || '').includes('pages_read_engagement') ||
    String(error?.message || '').includes('Page Public Content Access');
}

function mergePostsById(currentPosts, incomingPosts) {
  const byId = new Map();
  for (const post of currentPosts || []) {
    const id = post.id || post.postId;
    if (id) byId.set(String(id), post);
  }
  for (const post of incomingPosts || []) {
    const id = post.id || post.postId;
    if (id) byId.set(String(id), post);
  }
  return [...byId.values()].sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
}

export default function CreateCampaign() {
  const { provider, allAccounts, loadTodayCampaigns } = useAppContext();
  const isInitialShopeeProvider = provider === 'shopee';
  const [pages, setPages] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);

  const [selectedPage, setSelectedPage] = useState(null); // null = show all
  const [allPosts, setAllPosts] = useState([]); // all posts from all pages
  const [pagePosts, setPagePosts] = useState([]); // posts of selected page
  const [pagePostCache, setPagePostCache] = useState({});
  const [loadingAllPosts, setLoadingAllPosts] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [visiblePostCount, setVisiblePostCount] = useState(FACEBOOK_POSTS_PER_PAGE_LIMIT);

  const [searchPage, setSearchPage] = useState('');
  const [searchPost, setSearchPost] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [adNamePrefix, setAdNamePrefix] = useState(AD_NAME_PREFIX_OPTIONS[0]);
  const [adNameStatus, setAdNameStatus] = useState('Test');
  const [campaignCodes, setCampaignCodes] = useState('');
  const [campaignLinks, setCampaignLinks] = useState('');
  const [dailyBudget, setDailyBudget] = useState(
    isInitialShopeeProvider ? SHOPEE_DEFAULT_DAILY_BUDGET : FACEBOOK_DEFAULT_DAILY_BUDGET
  );
  const [bidAmount, setBidAmount] = useState(SHOPEE_DEFAULT_BID_AMOUNT);
  const [campaignStartTime, setCampaignStartTime] = useState(getDefaultCampaignStartTime);
  const [ageMin, setAgeMin] = useState(
    isInitialShopeeProvider ? SHOPEE_DEFAULT_AGE_MIN : FACEBOOK_DEFAULT_AGE_MIN
  );
  const [ageMax, setAgeMax] = useState(
    isInitialShopeeProvider ? SHOPEE_DEFAULT_AGE_MAX : FACEBOOK_DEFAULT_AGE_MAX
  );
  const [creatingCampaigns, setCreatingCampaigns] = useState(false);
  const [campaignCreateResult, setCampaignCreateResult] = useState(null);
  const allPostsLoadingRef = useRef(false);

  const quickAccountOptions = useMemo(() => {
    return [...allAccounts].sort((a, b) => {
      const statusA = a.status === 'connected' ? 0 : 1;
      const statusB = b.status === 'connected' ? 0 : 1;
      return statusA - statusB || a.name.localeCompare(b.name);
    });
  }, [allAccounts]);

  const selectedAccount = useMemo(() => {
    return allAccounts.find(account => account._id === selectedAccountId) || null;
  }, [allAccounts, selectedAccountId]);
  const selectedProvider = selectedAccount?.provider || provider || 'facebook';
  const shopeeLinkedPageIds = useMemo(() => {
    if (selectedProvider !== 'shopee') return [];
    return [...new Set(
      allAccounts
        .filter(account => account.provider === 'shopee')
        .flatMap(account => account.linkedPageIds || [])
        .map(String)
        .filter(Boolean)
    )];
  }, [allAccounts, selectedProvider]);
  const shopeeLinkedPageIdSet = useMemo(
    () => new Set(shopeeLinkedPageIds),
    [shopeeLinkedPageIds]
  );
  const hasShopeePageScope = selectedProvider === 'shopee' && shopeeLinkedPageIds.length > 0;
  const postsPerPageLimit = selectedProvider === 'shopee'
    ? SHOPEE_POSTS_PER_PAGE_LIMIT
    : FACEBOOK_POSTS_PER_PAGE_LIMIT;

  useEffect(() => {
    if (selectedProvider === 'shopee') {
      setDailyBudget(SHOPEE_DEFAULT_DAILY_BUDGET);
      setBidAmount(SHOPEE_DEFAULT_BID_AMOUNT);
      setAgeMin(SHOPEE_DEFAULT_AGE_MIN);
      setAgeMax(SHOPEE_DEFAULT_AGE_MAX);
      return;
    }

    setDailyBudget(FACEBOOK_DEFAULT_DAILY_BUDGET);
    setAgeMin(FACEBOOK_DEFAULT_AGE_MIN);
    setAgeMax(FACEBOOK_DEFAULT_AGE_MAX);
  }, [selectedProvider]);

  const filteredAccountOptions = useMemo(() => {
    const query = normalizeAccountQuery(accountQuery);
    if (!query) return quickAccountOptions.slice(0, 50);

    return quickAccountOptions
      .filter(account => accountMatchesQuery(account, query))
      .slice(0, 50);
  }, [accountQuery, quickAccountOptions]);

  const selectAccount = useCallback((account) => {
    setSelectedAccountId(account._id);
    setAccountQuery(getAccountLabel(account));
    setIsAccountMenuOpen(false);
  }, []);

  const handleAccountInputChange = (event) => {
    const nextQuery = event.target.value;
    setAccountQuery(nextQuery);
    setIsAccountMenuOpen(true);

    const query = normalizeAccountQuery(nextQuery);
    if (!query) {
      setSelectedAccountId('');
      return;
    }

    const firstMatch = quickAccountOptions.find(account => accountMatchesQuery(account, query));
    setSelectedAccountId(firstMatch?._id || '');
  };

  const handleAccountInputKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsAccountMenuOpen(false);
      setAccountQuery(selectedAccount ? getAccountLabel(selectedAccount) : '');
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (filteredAccountOptions[0]) {
        selectAccount(filteredAccountOptions[0]);
      }
    }
  };

  // â”€â”€ Load Pages â”€â”€
  const loadPages = useCallback(async () => {
    setLoadingPages(true);
    try {
      const data = await api('GET', '/pages');
      setPages(data.pages || []);
    } catch (e) {
      toast.error('Loi tai Pages: ' + e.message);
    } finally {
      setLoadingPages(false);
    }
  }, []);

  // â”€â”€ Load ALL posts from ALL pages â”€â”€
  const loadSavedPosts = useCallback(async (options = {}) => {
    const { silent = false } = options;
    if (allPostsLoadingRef.current) return;
    allPostsLoadingRef.current = true;
    if (!silent) setLoadingAllPosts(true);
    try {
      const params = new URLSearchParams({
        limit: String(SAVED_POSTS_LIMIT)
      });
      const data = await api('GET', `/posts/saved?${params.toString()}`);
      setAllPosts(data.posts || []);
      setVisiblePostCount(postsPerPageLimit);
    } catch (e) {
      if (!silent) toast.error('Loi tai bai viet da luu: ' + e.message);
    } finally {
      allPostsLoadingRef.current = false;
      if (!silent) setLoadingAllPosts(false);
    }
  }, [postsPerPageLimit]);

  const loadAllPosts = useCallback(async (refresh = false, options = {}) => {
    const { silent = false } = options;
    if (allPostsLoadingRef.current) return;
    allPostsLoadingRef.current = true;
    if (!silent) setLoadingAllPosts(true);
    try {
      const params = new URLSearchParams({
        limit: String(FB_REFRESH_POSTS_LIMIT),
        perPage: String(postsPerPageLimit),
        provider: selectedProvider,
        maxPages: '5'
      });
      if (refresh) params.set('refresh', '1');
      const path = `/pages/all-posts?${params.toString()}`;
      const data = await api('GET', path);
      setAllPosts(data.posts || []);
      setVisiblePostCount(postsPerPageLimit);
      if (!silent) toast.success(`Da tai ${data.total} bai viet tu ${data.pageCount} Pages`);
    } catch (e) {
      if (!silent) {
        if (isPagePostPermissionError(e)) {
          toast.info('Token/App chua co quyen doc bai viet Page. Dang hien bai viet da luu.');
          loadSavedPosts({ silent: true });
        } else {
          toast.error('Loi tai bai viet: ' + e.message);
        }
      }
    } finally {
      allPostsLoadingRef.current = false;
      if (!silent) setLoadingAllPosts(false);
    }
  }, [loadSavedPosts, postsPerPageLimit, selectedProvider]);

  useEffect(() => {
    loadPages();
    loadSavedPosts();
    const interval = setInterval(() => {
      loadSavedPosts({ silent: true });
    }, POSTS_AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadPages, loadSavedPosts]);

  // â”€â”€ Load Posts for a specific Page â”€â”€
  const selectPage = async (page) => {
    if (selectedPage?.id === page.id) {
      // Deselect â†’ show all
      setSelectedPage(null);
      setPagePosts([]);
      setVisiblePostCount(postsPerPageLimit);
      return;
    }
    setSelectedPage(page);
    const pageCacheKey = `${selectedProvider}:${page.id}:${postsPerPageLimit}`;
    if (pagePostCache[pageCacheKey]) {
      setPagePosts(pagePostCache[pageCacheKey]);
      setVisiblePostCount(postsPerPageLimit);
      return;
    }

    setPagePosts([]);
    setLoadingPosts(true);
    try {
      const params = new URLSearchParams({
        limit: String(postsPerPageLimit),
        provider: selectedProvider
      });
      const data = await api('GET', `/pages/${page.id}/posts?${params.toString()}`);
      const posts = data.posts || [];
      setPagePosts(posts);
      setAllPosts(prev => mergePostsById(prev, posts));
      setVisiblePostCount(postsPerPageLimit);
      setPagePostCache(prev => ({ ...prev, [pageCacheKey]: posts }));
    } catch (e) {
      if (isPagePostPermissionError(e)) {
        toast.info('Token/App chua co quyen doc bai viet Page. Hay dung bai viet da luu hoac cap quyen pages_read_engagement.');
      } else {
        toast.error('Loi tai bai viet: ' + e.message);
      }
    } finally {
      setLoadingPosts(false);
    }
  };

  const showAllPages = () => {
    setSelectedPage(null);
    setPagePosts([]);
    setVisiblePostCount(postsPerPageLimit);
  };

  useEffect(() => {
    if (selectedProvider !== 'shopee' || !selectedPage) return;
    if (!hasShopeePageScope || !shopeeLinkedPageIdSet.has(String(selectedPage.id))) {
      setSelectedPage(null);
      setPagePosts([]);
      setVisiblePostCount(postsPerPageLimit);
    }
  }, [hasShopeePageScope, postsPerPageLimit, selectedPage, selectedProvider, shopeeLinkedPageIdSet]);

  const createCampaignsFromCodes = async () => {
    const campaignNameLines = splitNonEmptyLines(campaignCodes);
    const productLinkLines = splitNonEmptyLines(campaignLinks);
    const hasLegacyShopeeRows = selectedProvider === 'shopee'
      && productLinkLines.length === 0
      && campaignNameLines.some(line => line.includes('|'));
    const codesPayload = selectedProvider === 'shopee' && productLinkLines.length > 0
      ? campaignNameLines.map((name, index) => `${name} | ${productLinkLines[index]}`).join('\n')
      : campaignCodes;
    const codes = splitNonEmptyLines(codesPayload);

    if (!selectedAccountId) {
      toast.error('Chon tai khoan quang cao truoc');
      return;
    }
    if (selectedProvider === 'shopee' && !hasLegacyShopeeRows) {
      if (!campaignNameLines.length) {
        toast.error('Nhap ten camp');
        return;
      }
      if (!productLinkLines.length) {
        toast.error('Nhap link san pham Shopee');
        return;
      }
      if (campaignNameLines.length !== productLinkLines.length) {
        toast.error('So dong ten camp phai bang so dong link san pham');
        return;
      }
    }
    if (!codes.length) {
      toast.error('Nhap it nhat mot ma san pham');
      return;
    }

    setCreatingCampaigns(true);
    setCampaignCreateResult(null);
    try {
      const result = await api('POST', '/campaigns/create-from-posts', {
        accountId: selectedAccountId,
        codes: codesPayload,
        dailyBudget,
        startTime: campaignStartTime,
        ageMin,
        ageMax,
        ...(selectedProvider === 'shopee' ? { bidAmount } : { adNamePrefix, adNameStatus }),
        pageId: selectedPage?.id || ''
      }, {
        timeoutMs: 15 * 60 * 1000
      });
      setCampaignCreateResult(result);
      if (result.created?.length) {
        toast.success(`Da tao ${result.created.length} camp active, bat dau ${result.startTimeDisplay || '06:00 ngay mai'}`);
        loadTodayCampaigns();
      }
      if (result.errors?.length) {
        const firstError = result.errors[0]?.error || '';
        if (!result.created?.length && firstError) {
          toast.error(`Loi tao camp: ${firstError}`);
        } else {
          toast.warn(`${result.errors.length} ma chua tao duoc`);
        }
      }
    } catch (e) {
      toast.error('Loi tao camp: ' + e.message);
    } finally {
      setCreatingCampaigns(false);
    }
  };

  const scopedAllPosts = useMemo(() => {
    if (selectedProvider !== 'shopee') return allPosts;
    if (!hasShopeePageScope) return [];
    return allPosts.filter(post => shopeeLinkedPageIdSet.has(getPostPageId(post)));
  }, [allPosts, hasShopeePageScope, selectedProvider, shopeeLinkedPageIdSet]);

  // Determine which posts to display
  const rawPosts = selectedPage ? pagePosts : scopedAllPosts;
  const isLoadingDisplay = selectedPage ? loadingPosts : loadingAllPosts;

  // Filter posts by search
  const displayPosts = useMemo(() => {
    if (!searchPost.trim()) return rawPosts;
    return rawPosts.filter(p => {
        const q = searchPost.toLowerCase();
        return (
          (p.message || '').toLowerCase().includes(q) ||
          (p.pageName || '').toLowerCase().includes(q) ||
          (p.id || '').toLowerCase().includes(q)
        );
      });
  }, [rawPosts, searchPost]);

  const visiblePosts = useMemo(
    () => displayPosts.slice(0, visiblePostCount),
    [displayPosts, visiblePostCount]
  );

  useEffect(() => {
    setVisiblePostCount(postsPerPageLimit);
  }, [postsPerPageLimit, selectedPage, searchPost]);

  // Filter pages by search
  const filteredPages = useMemo(() => {
    let result = pages;
    if (selectedProvider === 'shopee') {
      result = hasShopeePageScope
        ? result.filter(p => shopeeLinkedPageIdSet.has(String(p.id)))
        : [];
    }
    return result.filter(p => p.name.toLowerCase().includes(searchPage.toLowerCase()));
  }, [hasShopeePageScope, pages, searchPage, selectedProvider, shopeeLinkedPageIdSet]);

  const truncateText = (text, max = 120) => {
    if (!text) return 'Khong co noi dung';
    return text.length > max ? text.substring(0, max) + '...' : text;
  };

  const formatDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  };

  const campaignFormColumns = selectedProvider === 'shopee'
    ? 'minmax(240px, 0.9fr) minmax(300px, 1.15fr) minmax(340px, 1.35fr) 140px 110px 180px 80px 80px'
    : 'minmax(260px, 1fr) 120px minmax(340px, 1.4fr) 150px 190px 90px 90px';

  return (
    <div id="page-create-campaign">
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '16px', minHeight: 'calc(100vh - 140px)' }}>
        <div className="card" style={{ gridColumn: '1 / -1', overflow: 'visible' }}>
          <div className="card-header">
            <div className="card-title">Tao camp tu ma san pham</div>
            <button className="btn btn-g btn-sm" onClick={createCampaignsFromCodes} disabled={creatingCampaigns}>
              {creatingCampaigns ? 'Dang tao...' : 'Tao camp'}
            </button>
          </div>
          <div
            className={`campaign-create-controls ${selectedProvider === 'shopee' ? 'shopee' : 'facebook'}`}
            style={{ gridTemplateColumns: campaignFormColumns }}
          >
            <div className="form-group campaign-codes-field" style={{ marginBottom: 0 }}>
              <label>Tai khoan quang cao</label>
              <div className="account-combobox">
                <input
                  type="text"
                  value={accountQuery}
                  onChange={handleAccountInputChange}
                  onFocus={event => {
                    setIsAccountMenuOpen(true);
                    event.target.select();
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setIsAccountMenuOpen(false);
                      setAccountQuery(selectedAccount ? getAccountLabel(selectedAccount) : accountQuery);
                    }, 120);
                  }}
                  onKeyDown={handleAccountInputKeyDown}
                  placeholder="Go ten, vi du: XK 2 57"
                  autoComplete="off"
                />
                {isAccountMenuOpen && (
                  <div className="account-combobox-menu">
                    {filteredAccountOptions.length > 0 ? (
                      filteredAccountOptions.map(account => (
                        <button
                          key={account._id}
                          type="button"
                          className={`account-combobox-option ${selectedAccountId === account._id ? 'active' : ''}`}
                          onMouseDown={event => {
                            event.preventDefault();
                            selectAccount(account);
                          }}
                        >
                          <span>{account.name}</span>
                          <small>{account.adAccountId}</small>
                        </button>
                      ))
                    ) : (
                      <div className="account-combobox-empty">Khong tim thay tai khoan</div>
                    )}
                  </div>
                )}
              </div>
              {selectedAccount && (
                <div className="selected-account-pill">
                  Dang chon: {selectedAccount.name}
                </div>
              )}
              <select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
                style={{ display: 'none' }}
                title="Focus vao o nay roi go ten tai khoan, vi du XK 2 57"
              >
                <option value="">Chon tai khoan</option>
                {allAccounts.map(account => (
                  <option key={account._id} value={account._id}>{account.name} - {account.adAccountId}</option>
                ))}
              </select>
              {quickAccountOptions.length > 0 && (
                <div className="quick-account-row" aria-label="Chon nhanh tai khoan">
                  {quickAccountOptions.map(account => (
                    <button
                      key={account._id}
                      type="button"
                      className={`quick-account-btn ${selectedAccountId === account._id ? 'active' : ''}`}
                      title={`${account.name} - ${account.adAccountId}`}
                      onClick={() => selectAccount(account)}
                    >
                      {account.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedProvider !== 'shopee' && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Ma nhan vien</label>
                <select value={adNamePrefix} onChange={e => setAdNamePrefix(e.target.value)}>
                  {AD_NAME_PREFIX_OPTIONS.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group campaign-codes-field" style={{ marginBottom: 0 }}>
              <label>{selectedProvider === 'shopee' ? 'Ten camp' : 'List ma san pham'}</label>
              <textarea
                rows="3"
                value={campaignCodes}
                onChange={e => setCampaignCodes(e.target.value)}
                placeholder={selectedProvider === 'shopee'
                  ? 'Moi dong mot ten camp, vi du: Vay xep ly'
                  : 'Moi dong mot ma, vi du: XK01'}
              />
            </div>
            {selectedProvider === 'shopee' && (
              <div className="form-group campaign-codes-field" style={{ marginBottom: 0 }}>
                <label>Link san pham</label>
                <textarea
                  rows="3"
                  value={campaignLinks}
                  onChange={e => setCampaignLinks(e.target.value)}
                  placeholder="Moi dong mot link, vi du: https://s.shopee.vn/5AmboEuNpt"
                />
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Ngan sach/ngay</label>
              <input
                type="number"
                min="1000"
                step="1000"
                value={dailyBudget}
                onChange={e => setDailyBudget(Number(e.target.value || 0))}
              />
              {selectedProvider !== 'shopee' && (
                <>
                  <label style={{ marginTop: '8px' }}>Trạng thái</label>
                  <select value={adNameStatus} onChange={e => setAdNameStatus(e.target.value)}>
                    {AD_STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            {selectedProvider === 'shopee' && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>So bid</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={bidAmount}
                  onChange={e => setBidAmount(Number(e.target.value || 0))}
                />
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Thoi gian bat dau (gio VN)</label>
              <input
                type="datetime-local"
                value={campaignStartTime}
                onChange={e => setCampaignStartTime(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tuoi tu</label>
              <input
                type="number"
                min="13"
                max="65"
                value={ageMin}
                onChange={e => setAgeMin(Number(e.target.value || 0))}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tuoi den</label>
              <input
                type="number"
                min="13"
                max="65"
                value={ageMax}
                onChange={e => setAgeMax(Number(e.target.value || 0))}
              />
            </div>
          </div>
          {campaignCreateResult && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--g)', marginBottom: '6px' }}>
                  Da tao: {campaignCreateResult.created?.length || 0}
                </div>
                {(campaignCreateResult.created || []).map(item => (
                  <div key={`${item.code}-${item.campaignId}`} style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)', marginBottom: '4px' }}>
                    {item.code} - {item.campaignId} - {item.startTimeDisplay || campaignCreateResult.startTimeDisplay}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--r)', marginBottom: '6px' }}>
                  Loi: {campaignCreateResult.errors?.length || 0}
                </div>
                {(campaignCreateResult.errors || []).map(item => (
                  <div key={`${item.code}-${item.error}`} style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'var(--mono)', marginBottom: '4px' }}>
                    {item.code}: {formatCampaignCreateError(item)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* â”€â”€ Left: Pages List â”€â”€ */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 140px)' }}>
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div className="card-title">Pages ({filteredPages.length})</div>
            <button className="btn btn-ghost btn-sm" onClick={loadPages} disabled={loadingPages}>
              {loadingPages ? '...' : 'Lam moi'}
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              type="text"
              placeholder="Tim ten Page..."
              value={searchPage}
              onChange={e => setSearchPage(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--s3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: 'var(--txt)',
                fontSize: '12px',
                outline: 'none'
              }}
            />
          </div>

          {/* "All" button */}
          <div style={{ padding: '4px 8px', flexShrink: 0 }}>
            <div
              onClick={showAllPages}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                background: !selectedPage ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                border: !selectedPage ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                transition: 'all 0.15s'
              }}
            >
              <span style={{ fontSize: '14px' }}>ALL</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: !selectedPage ? 'var(--b)' : 'var(--txt)' }}>
                  {selectedProvider === 'shopee' ? 'Pages da chon' : 'Tat ca Pages'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
                  {scopedAllPosts.length} bai viet
                </div>
              </div>
            </div>
          </div>

          {/* Pages list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {loadingPages ? (
              <div className="empty">
                <span className="spin">...</span>
                <p style={{ marginTop: '10px' }}>Dang tai Pages...</p>
              </div>
            ) : filteredPages.length === 0 ? (
              <div className="empty">
                <div className="ei">PAGE</div>
                <p>
                  {selectedProvider === 'shopee' && !hasShopeePageScope
                    ? 'Chua chon Fanpage cho tai khoan Shopee'
                    : 'Khong tim thay Page nao'}
                </p>
              </div>
            ) : (
              filteredPages.map(page => (
                <div
                  key={page.id}
                  onClick={() => selectPage(page)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    marginBottom: '4px',
                    background: selectedPage?.id === page.id ? 'rgba(34, 209, 122, 0.1)' : 'transparent',
                    border: selectedPage?.id === page.id ? '1px solid rgba(34, 209, 122, 0.3)' : '1px solid transparent',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => {
                    if (selectedPage?.id !== page.id) {
                      e.currentTarget.style.background = 'var(--s3)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (selectedPage?.id !== page.id) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {/* Page avatar */}
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'var(--s3)',
                    overflow: 'hidden',
                    flexShrink: 0,
                    border: '2px solid var(--border2)'
                  }}>
                    {page.picture?.data?.url ? (
                      <img src={page.picture.data.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>PAGE</div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: selectedPage?.id === page.id ? 'var(--g)' : 'var(--txt)'
                    }}>
                      {page.name}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
                      {page.category || 'Page'} {page.fan_count ? `Â· ${Number(page.fan_count).toLocaleString()} likes` : ''}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* â”€â”€ Right: Posts â”€â”€ */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 140px)' }}>
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div className="card-title" style={{ gap: '12px' }}>
              <span>{selectedPage ? `Bai viet - ${selectedPage.name}` : 'Tat ca bai viet'}</span>
              <span style={{
                background: 'var(--s3)',
                padding: '2px 8px',
                borderRadius: '6px',
                fontFamily: 'var(--mono)',
                fontSize: '10px',
                color: 'var(--muted2)'
              }}>
                {displayPosts.length} bai
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!selectedPage && (
                <button className="btn btn-ghost btn-sm" onClick={() => loadAllPosts(true)} disabled={loadingAllPosts}>
                  {loadingAllPosts ? '... Dang tai...' : 'Cap nhat FB'}
                </button>
              )}
              {selectedPage && (
                <button className="btn btn-ghost btn-sm" onClick={showAllPages}>
                  Xem tat ca
                </button>
              )}
            </div>
          </div>

          {/* Search posts */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              type="text"
              placeholder="Tim bai viet theo noi dung, ten page, ID..."
              value={searchPost}
              onChange={e => setSearchPost(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--s3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: 'var(--txt)',
                fontSize: '12px',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {isLoadingDisplay ? (
              <div className="empty">
                <span className="spin">...</span>
                <p style={{ marginTop: '10px' }}>Dang tai bai viet...</p>
              </div>
            ) : displayPosts.length === 0 ? (
              <div className="empty">
                <div className="ei">POST</div>
                <p>Khong co bai viet nao</p>
              </div>
            ) : (
              <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                {visiblePosts.map(post => (
                  <div
                    key={post.id}
                    style={{
                      background: 'var(--s2)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      transition: 'border-color 0.15s, transform 0.15s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--border2)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {/* Post image */}
                    {post.picture && (
                      <div style={{
                        width: '100%',
                        height: '160px',
                        background: 'var(--s3)',
                        overflow: 'hidden'
                      }}>
                        <img
                          src={post.picture}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      </div>
                    )}

                    {/* Post content */}
                    <div style={{ padding: '12px 14px' }}>
                      {/* Page name badge (only in "all" mode) */}
                      {!selectedPage && post.pageName && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '8px',
                          paddingBottom: '6px',
                          borderBottom: '1px solid var(--border)'
                        }}>
                          {post.pageAvatar && (
                            <img
                              src={post.pageAvatar}
                              alt=""
                              loading="lazy"
                              style={{ width: '20px', height: '20px', borderRadius: '50%' }}
                            />
                          )}
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'var(--b)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {post.pageName}
                          </span>
                        </div>
                      )}

                      <div style={{
                        fontSize: '12px',
                        lineHeight: '1.5',
                        color: 'var(--txt)',
                        marginBottom: '10px',
                        wordBreak: 'break-word'
                      }}>
                        {truncateText(post.message)}
                      </div>

                      {/* Engagement stats */}
                      <div style={{
                        display: 'flex',
                        gap: '12px',
                        fontSize: '11px',
                        color: 'var(--muted2)',
                        marginBottom: '8px'
                      }}>
                        <span>Like {post.likes}</span>
                        <span>Comment {post.comments}</span>
                        <span>Share {post.shares}</span>
                      </div>

                      {/* Date & link */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderTop: '1px solid var(--border)',
                        paddingTop: '8px',
                        marginTop: '4px'
                      }}>
                        <span style={{
                          fontSize: '10px',
                          color: 'var(--muted)',
                          fontFamily: 'var(--mono)'
                        }}>
                          {formatDate(post.createdTime)}
                        </span>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '10px',
                              color: 'var(--b)',
                              textDecoration: 'none',
                              fontWeight: 600
                            }}
                            onClick={e => e.stopPropagation()}
                          >
                            Xem tren FB
                          </a>
                        )}
                      </div>

                      {/* Post ID */}
                      <div style={{
                        marginTop: '6px',
                        fontSize: '10px',
                        fontFamily: 'var(--mono)',
                        color: 'var(--muted)',
                        background: 'var(--s3)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        userSelect: 'all'
                      }}>
                        ID: {post.id}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {visiblePosts.length < displayPosts.length && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setVisiblePostCount(count => count + postsPerPageLimit)}
                  >
                    Xem them {Math.min(postsPerPageLimit, displayPosts.length - visiblePosts.length)} bai
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
