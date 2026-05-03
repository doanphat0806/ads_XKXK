const { mapInBatches } = require('../utils/async');
const { parseBoundedInt } = require('../utils/number');

function registerPageRoutes(app, deps) {
  const {
    axios,
    FacebookPost,
    getAppConfig,
    fbGet,
    escapeRegExp,
    normalizeProvider,
    POSTS_PER_PAGE_LIMIT,
    SHOPEE_POSTS_PER_PAGE_LIMIT,
    ALL_POSTS_MAX_LIMIT,
    META_POST_REQUEST_LIMIT
  } = deps;

const POST_CACHE_TTL_MS = 5 * 60 * 1000;
const postCache = new Map();

function getPostsPerPageLimit(provider) {
  return normalizeProvider(provider) === 'shopee'
    ? SHOPEE_POSTS_PER_PAGE_LIMIT
    : POSTS_PER_PAGE_LIMIT;
}

function getPostCache(key, refresh = false) {
  if (refresh) return null;
  const cached = postCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > POST_CACHE_TTL_MS) {
    postCache.delete(key);
    return null;
  }
  return cached.value;
}

function isPagePermissionError(error) {
  const apiError = error?.fbData?.error || error?.response?.data?.error || {};
  const message = String(apiError.message || error?.message || '');
  return Number(apiError.code) === 10 ||
    message.includes('pages_read_engagement') ||
    message.includes('Page Public Content Access');
}

function getPostFetchError(error) {
  if (isPagePermissionError(error)) {
    return {
      error: 'Token/App chua co quyen doc bai viet Page. Can pages_read_engagement hoac Page Public Content Access.',
      code: 'PAGE_POST_PERMISSION',
      permission: 'pages_read_engagement'
    };
  }
  return { error: error.message };
}

function setPostCache(key, value) {
  postCache.set(key, { value, createdAt: Date.now() });
  return value;
}

function mapFacebookPost(post, page = {}) {
  return {
    id: post.id,
    message: post.message || '',
    createdTime: post.created_time,
    permalink: post.permalink_url,
    picture: post.full_picture || '',
    shares: post.shares?.count || 0,
    likes: post.likes?.summary?.total_count || 0,
    comments: post.comments?.summary?.total_count || 0,
    pageName: page.name || '',
    pageId: page.id || '',
    pageAvatar: page.picture?.data?.url || ''
  };
}

function mapSavedFacebookPost(post = {}) {
  return {
    id: post.postId,
    message: post.message || '',
    createdTime: post.createdTime,
    permalink: post.permalink || '',
    picture: post.picture || '',
    shares: post.shares || 0,
    likes: post.likes || 0,
    comments: post.comments || 0,
    pageName: post.pageName || '',
    pageId: post.pageId || '',
    pageAvatar: post.pageAvatar || ''
  };
}

async function saveFacebookPosts(mappedPosts, rawPosts = []) {
  const posts = (mappedPosts || []).filter(post => post.id);
  if (!posts.length) return;

  const now = new Date();
  const operations = posts.map((post, index) => ({
    updateOne: {
      filter: { postId: post.id },
      update: {
        $set: {
          pageId: post.pageId || '',
          pageName: post.pageName || '',
          pageAvatar: post.pageAvatar || '',
          message: post.message || '',
          createdTime: post.createdTime ? new Date(post.createdTime) : null,
          permalink: post.permalink || '',
          picture: post.picture || '',
          shares: Number(post.shares || 0),
          likes: Number(post.likes || 0),
          comments: Number(post.comments || 0),
          rawData: rawPosts[index] || {},
          fetchedAt: now,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      upsert: true
    }
  }));

  try {
    await FacebookPost.bulkWrite(operations, { ordered: false });
  } catch (error) {
    console.error('Save Facebook posts failed:', error.message);
  }
}

async function fetchRecentPostsForPage(page, fallbackToken, options = {}) {
  const token = page.access_token || fallbackToken;
  const maxLimit = options.maxLimit || POSTS_PER_PAGE_LIMIT;
  const limit = parseBoundedInt(options.limit, maxLimit, 1, maxLimit);
  const maxPages = parseBoundedInt(options.maxPages, 4, 1, 5);
  const requestLimit = Math.min(limit, META_POST_REQUEST_LIMIT);
  const fields = 'id,message,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)';
  let posts = [];

  const first = await fbGet(token, `${page.id}/posts`, { fields, limit: requestLimit });
  if (first.data) posts = posts.concat(first.data);

  let fetchedPages = 1;
  let nextUrl = first.paging?.next;
  while (nextUrl && fetchedPages < maxPages && posts.length < limit) {
    const resp = await axios.get(nextUrl, { timeout: 30000 });
    if (resp.data?.data) posts = posts.concat(resp.data.data);
    nextUrl = resp.data?.paging?.next || null;
    fetchedPages += 1;
  }

  const limitedPosts = posts.slice(0, limit);
  const mappedPosts = limitedPosts.map(post => mapFacebookPost(post, page));
  await saveFacebookPosts(mappedPosts, limitedPosts);
  return mappedPosts;
}

app.get('/api/pages', async (req, res) => {
  try {
    const config = await getAppConfig();
    const fbToken = config?.fbToken;
    if (!fbToken) return res.status(400).json({ error: 'Chưa cấu hình Facebook Token dùng chung' });

    let allPages = [];
    let url = 'me/accounts';
    let params = { fields: 'name,id,access_token,category,picture{url},fan_count', limit: 100 };

    // First page
    const first = await fbGet(fbToken, url, params);
    if (first.data) allPages = allPages.concat(first.data);

    // Paginate
    let nextUrl = first.paging?.next;
    while (nextUrl) {
      try {
        const resp = await axios.get(nextUrl, { timeout: 30000 });
        if (resp.data?.data) allPages = allPages.concat(resp.data.data);
        nextUrl = resp.data?.paging?.next || null;
      } catch {
        break;
      }
    }

    res.json({ ok: true, pages: allPages, total: allPages.length });
  } catch (error) {
    res.status(400).json(getPostFetchError(error));
  }
});

app.get('/api/posts/saved', async (req, res) => {
  try {
    const limit = parseBoundedInt(req.query.limit, 1000, 1, 5000);
    const q = String(req.query.q || '').trim();
    const pageId = String(req.query.pageId || '').trim();
    const query = {};

    if (pageId) query.pageId = pageId;
    if (q) {
      const pattern = new RegExp(escapeRegExp(q), 'i');
      query.$or = [
        { message: pattern },
        { pageName: pattern },
        { postId: pattern }
      ];
    }

    const posts = await FacebookPost.find(query)
      .sort({ createdTime: -1, fetchedAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      ok: true,
      posts: posts.map(mapSavedFacebookPost),
      total: posts.length,
      source: 'saved'
    });
  } catch (error) {
    res.status(400).json(getPostFetchError(error));
  }
});

app.get('/api/pages/all-posts', async (req, res) => {
  try {
    const config = await getAppConfig();
    const fbToken = config?.fbToken;
    if (!fbToken) return res.status(400).json({ error: 'Missing shared Facebook Token' });
    const postLimit = getPostsPerPageLimit(req.query.provider);
    const perPage = parseBoundedInt(req.query.perPage, postLimit, 1, postLimit);
    const requestedTotalLimit = req.query.limit === undefined
      ? null
      : parseBoundedInt(req.query.limit, ALL_POSTS_MAX_LIMIT, 10, ALL_POSTS_MAX_LIMIT);
    const maxPages = parseBoundedInt(req.query.maxPages, 4, 1, 5);
    const refresh = req.query.refresh === '1';
    const cacheKey = `all-posts:${normalizeProvider(req.query.provider)}:${perPage}:${requestedTotalLimit || 'auto'}:${maxPages}`;
    const cached = getPostCache(cacheKey, refresh);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }
    if (!fbToken) return res.status(400).json({ error: 'Chưa cấu hình Facebook Token dùng chung' });

    // 1. Get all pages
    let allPages = [];
    const first = await fbGet(fbToken, 'me/accounts', {
      fields: 'name,id,access_token,picture{url}',
      limit: 100
    });
    if (first.data) allPages = allPages.concat(first.data);
    let nextPageUrl = first.paging?.next;
    while (nextPageUrl) {
      try {
        const resp = await axios.get(nextPageUrl, { timeout: 30000 });
        if (resp.data?.data) allPages = allPages.concat(resp.data.data);
        nextPageUrl = resp.data?.paging?.next || null;
      } catch { break; }
    }

    const totalLimit = Math.min(
      requestedTotalLimit || allPages.length * perPage,
      ALL_POSTS_MAX_LIMIT
    );

    const pagesToFetch = allPages;

    const results = await mapInBatches(
      pagesToFetch,
      6,
      page => fetchRecentPostsForPage(page, fbToken, { limit: perPage, maxPages, maxLimit: postLimit })
    );

    let allPosts = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allPosts = allPosts.concat(r.value);
    }
    // Sort by date descending
    allPosts.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    allPosts = allPosts.slice(0, totalLimit);

    const payload = {
      ok: true,
      posts: allPosts,
      total: allPosts.length,
      pageCount: allPages.length,
      fetchedPageCount: pagesToFetch.length,
      perPage,
      totalLimit,
      maxPages
    };

    res.json(setPostCache(cacheKey, payload));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/pages/:pageId/posts', async (req, res) => {
  try {
    const config = await getAppConfig();
    const fbToken = config?.fbToken;
    if (!fbToken) return res.status(400).json({ error: 'Chưa cấu hình Facebook Token dùng chung' });

    const { pageId } = req.params;
    const postLimit = getPostsPerPageLimit(req.query.provider);
    const limit = parseBoundedInt(req.query.limit, postLimit, 1, postLimit);
    const maxPages = parseBoundedInt(req.query.maxPages, 4, 1, 5);
    const refresh = req.query.refresh === '1';
    const cacheKey = `page-posts:${normalizeProvider(req.query.provider)}:${pageId}:${limit}:${maxPages}`;
    const cached = getPostCache(cacheKey, refresh);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // First get the page access token
    let pageToken = fbToken;
    let pageInfo = { id: pageId };
    try {
      pageInfo = await fbGet(fbToken, pageId, { fields: 'name,id,access_token,picture{url}' });
      if (pageInfo.access_token) pageToken = pageInfo.access_token;
    } catch {}

    const posts = await fetchRecentPostsForPage(
      { ...pageInfo, id: pageId, access_token: pageToken },
      fbToken,
      { limit, maxPages, maxLimit: postLimit }
    );
    const payload = { ok: true, posts, total: posts.length, limit, maxPages };

    res.json(setPostCache(cacheKey, payload));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
}

module.exports = registerPageRoutes;
