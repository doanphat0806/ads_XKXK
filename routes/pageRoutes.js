const { mapInBatches } = require('../utils/async');
const { parseBoundedInt } = require('../utils/number');

function registerPageRoutes(app, deps) {
  const {
    axios,
    FacebookPost,
    User,
    getAppConfig,
    fbGet,
    fbPost,
    FACEBOOK_GRAPH_API_VERSION,
    escapeRegExp,
    normalizeProvider,
    POSTS_PER_PAGE_LIMIT,
    SHOPEE_POSTS_PER_PAGE_LIMIT,
    ALL_POSTS_MAX_LIMIT,
    META_POST_REQUEST_LIMIT
  } = deps;

const POST_CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const PAGE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_MAX_IMAGE_FILES = 10;
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

function isPagePublishPermissionError(error) {
  const apiError = error?.fbData?.error || error?.response?.data?.error || {};
  const message = String(apiError.message || error?.message || '');
  return Number(apiError.code) === 10 ||
    message.includes('pages_manage_posts') ||
    message.includes('requires the pages_manage_posts permission') ||
    message.includes('No permission to operate on the page') ||
    message.includes('does not have permission');
}

function getPagePublishError(error) {
  if (isPagePublishPermissionError(error)) {
    return {
      error: 'Token/App chua co quyen dang bai len Page. Can pages_manage_posts va quyen thao tac tren fanpage.',
      code: 'PAGE_PUBLISH_PERMISSION',
      permission: 'pages_manage_posts'
    };
  }
  return { error: error.message };
}

function setPostCache(key, value) {
  postCache.set(key, { value, createdAt: Date.now() });
  return value;
}

async function fetchManagedPages(fbToken, fields = 'name,id,access_token,category,picture{url},fan_count') {
  let allPages = [];
  const first = await fbGet(fbToken, 'me/accounts', { fields, limit: 100 });
  if (first.data) allPages = allPages.concat(first.data);

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

  return allPages;
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

async function resolvePagesToken(req, getAppConfig) {
  const [config, user] = await Promise.all([
    getAppConfig(),
    req.currentUser?._id && User
      ? User.findById(req.currentUser._id).select('fbToken').lean()
      : Promise.resolve(null)
  ]);

  return String(user?.fbToken || config?.fbToken || '').trim();
}

app.get('/api/pages', async (req, res) => {
  try {
    const fbToken = await resolvePagesToken(req, getAppConfig);
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
    const fbToken = await resolvePagesToken(req, getAppConfig);
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
    // Sort by date descending: newest first
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
    const fbToken = await resolvePagesToken(req, getAppConfig);
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

app.post('/api/pages/:pageId/publish', async (req, res) => {
  try {
    const fbToken = await resolvePagesToken(req, getAppConfig);
    if (!fbToken) return res.status(400).json({ error: 'Chua cau hinh Facebook Token dung chung' });

    const { pageId } = req.params;
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const isMultipart = contentType.includes('multipart/form-data');

    let message = '';
    let link = '';
    let videoFile = null;
    let imageFiles = [];

    if (isMultipart) {
      const contentLength = Number(req.headers['content-length'] || 0);
      if (contentLength > PAGE_VIDEO_MAX_BYTES + (2 * 1024 * 1024)) {
        return res.status(413).json({ error: 'File video vuot gioi han 100MB' });
      }

      const request = new Request(`http://localhost${req.originalUrl || req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half'
      });
      const formData = await request.formData();
      message = String(formData.get('message') || '').trim();
      link = String(formData.get('link') || '').trim();
      for (const mediaFile of formData.getAll('media')) {
        if (!mediaFile || typeof mediaFile.arrayBuffer !== 'function' || Number(mediaFile.size || 0) <= 0) continue;
        const fileType = String(mediaFile.type || '').toLowerCase();
        if (fileType.startsWith('video/')) {
          if (videoFile) return res.status(400).json({ error: 'Chi ho tro 1 video moi lan dang' });
          if (Number(mediaFile.size || 0) > PAGE_VIDEO_MAX_BYTES) {
            return res.status(413).json({ error: 'File video vuot gioi han 100MB' });
          }
          videoFile = mediaFile;
          continue;
        }
        if (fileType.startsWith('image/')) {
          if (Number(mediaFile.size || 0) > PAGE_IMAGE_MAX_BYTES) {
            return res.status(413).json({ error: 'Moi file anh toi da 20MB' });
          }
          imageFiles.push(mediaFile);
        }
      }

      if (!videoFile) {
        const incomingVideo = formData.get('video');
        if (incomingVideo && typeof incomingVideo.arrayBuffer === 'function' && Number(incomingVideo.size || 0) > 0) {
          if (Number(incomingVideo.size || 0) > PAGE_VIDEO_MAX_BYTES) {
            return res.status(413).json({ error: 'File video vuot gioi han 100MB' });
          }
          videoFile = incomingVideo;
        }
      }

      if (videoFile && imageFiles.length > 0) {
        return res.status(400).json({ error: 'Khong ho tro dang cung luc anh va video. Hay chon mot loai file.' });
      }
      if (imageFiles.length > PAGE_MAX_IMAGE_FILES) {
        return res.status(400).json({ error: `Toi da ${PAGE_MAX_IMAGE_FILES} anh moi lan dang` });
      }
    } else {
      message = String(req.body?.message || '').trim();
      link = String(req.body?.link || '').trim();
    }

    if (!pageId) return res.status(400).json({ error: 'Thieu Page ID' });
    if (!message && !link && !videoFile && imageFiles.length === 0) return res.status(400).json({ error: 'Nhap noi dung, link hoac chon file truoc khi dang bai' });

    const pagesResp = await fbGet(fbToken, 'me/accounts', {
      fields: 'name,id,access_token,picture{url}',
      limit: 100
    });
    const managedPages = Array.isArray(pagesResp?.data) ? pagesResp.data : [];
    const page = managedPages.find(item => String(item.id) === String(pageId));

    if (!page) {
      return res.status(404).json({ error: 'Khong tim thay fanpage trong danh sach co quyen quan ly' });
    }

    const pageToken = String(page.access_token || '').trim() || fbToken;
    let result;
    let mode = 'feed';

    if (videoFile) {
      mode = 'video';
      const uploadForm = new FormData();
      uploadForm.set('access_token', pageToken);
      if (message) uploadForm.set('description', message);
      uploadForm.set('source', videoFile, videoFile.name || 'video.mp4');

      const response = await fetch(`https://graph-video.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${pageId}/videos`, {
        method: 'POST',
        body: uploadForm
      });
      const responseText = await response.text();
      let responseData = null;
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = { error: { message: responseText || `FB VIDEO POST ${response.status}` } };
      }
      if (!response.ok) {
        const uploadError = new Error(responseData?.error?.message || `FB VIDEO POST ${response.status}`);
        uploadError.status = response.status;
        uploadError.fbData = responseData;
        uploadError.response = { data: responseData };
        throw uploadError;
      }
      result = responseData;
    } else if (imageFiles.length > 0) {
      mode = imageFiles.length > 1 ? 'photos' : 'photo';
      const uploadedPhotoIds = [];

      for (const imageFile of imageFiles) {
        const uploadForm = new FormData();
        uploadForm.set('access_token', pageToken);
        uploadForm.set('published', 'false');
        uploadForm.set('source', imageFile, imageFile.name || 'image.jpg');
        const response = await fetch(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${pageId}/photos`, {
          method: 'POST',
          body: uploadForm
        });
        const responseText = await response.text();
        let responseData = null;
        try {
          responseData = responseText ? JSON.parse(responseText) : {};
        } catch {
          responseData = { error: { message: responseText || `FB PHOTO POST ${response.status}` } };
        }
        if (!response.ok) {
          const uploadError = new Error(responseData?.error?.message || `FB PHOTO POST ${response.status}`);
          uploadError.status = response.status;
          uploadError.fbData = responseData;
          uploadError.response = { data: responseData };
          throw uploadError;
        }
        if (responseData?.id) uploadedPhotoIds.push(responseData.id);
      }

      if (!uploadedPhotoIds.length) {
        return res.status(400).json({ error: 'Khong tai duoc anh len Facebook' });
      }

      if (uploadedPhotoIds.length === 1 && !link) {
        const payload = { published: true };
        if (message) payload.message = message;
        result = await fbPost(pageToken, uploadedPhotoIds[0], payload);
      } else {
        const payload = {};
        if (message) payload.message = message;
        if (link) payload.link = link;
        uploadedPhotoIds.forEach((id, index) => {
          payload[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
        });
        result = await fbPost(pageToken, `${pageId}/feed`, payload);
      }
    } else {
      const payload = {};
      if (message) payload.message = message;
      if (link) payload.link = link;
      result = await fbPost(pageToken, `${pageId}/feed`, payload);
    }

    postCache.clear();

    const post = result?.id ? {
      id: result.id,
      message,
      createdTime: new Date().toISOString(),
      permalink: '',
      picture: '',
      shares: 0,
      likes: 0,
      comments: 0,
      pageName: page.name || '',
      pageId: page.id || '',
      pageAvatar: page.picture?.data?.url || ''
    } : null;

    res.json({
      ok: true,
      mode,
      postId: result?.id || '',
      link: link || '',
      fileName: videoFile?.name || '',
      fileNames: imageFiles.map(file => file.name || 'image.jpg'),
      page: {
        id: page.id,
        name: page.name || '',
        picture: page.picture?.data?.url || ''
      },
      post
    });
  } catch (error) {
    const apiError = error?.fbData?.error || error?.response?.data?.error || {};
    const rawMessage = String(apiError.message || error?.message || '');
    const needsPublishPermission = Number(apiError.code) === 10 ||
      rawMessage.includes('pages_manage_posts') ||
      rawMessage.includes('No permission to operate on the page') ||
      rawMessage.includes('does not have permission');

    if (needsPublishPermission) {
      return res.status(400).json({
        error: 'Token/App chua co quyen dang bai len Page. Can pages_manage_posts va quyen thao tac tren fanpage.',
        code: 'PAGE_PUBLISH_PERMISSION',
        permission: 'pages_manage_posts'
      });
    }

    res.status(400).json({ error: error.message });
  }
});
}

module.exports = registerPageRoutes;
