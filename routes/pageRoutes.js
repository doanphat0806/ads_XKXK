const { mapInBatches } = require('../utils/async');
const { parseBoundedInt } = require('../utils/number');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

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

const POST_CACHE_TTL_MS = 15 * 60 * 1000;
const PAGES_CACHE_TTL_MS = 15 * 60 * 1000;
const pagesCache = new Map(); // key: tokenHash -> { pages, fetchedAt }
const PAGE_VIDEO_MAX_MB = 200;
const PAGE_VIDEO_MAX_BYTES = PAGE_VIDEO_MAX_MB * 1024 * 1024;
const PAGE_VIDEO_CHUNK_MAX_BYTES = 768 * 1024;
const PAGE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_MAX_IMAGE_FILES = 10;
const POST_CALL_TO_ACTION_TYPES = new Set(['MESSAGE_PAGE']);
const REEL_STATUS_POLL_ATTEMPTS = 12;
const REEL_STATUS_POLL_DELAY_MS = 5000;
const REEL_UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
const reelUploadSessions = new Map();
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
  const isStale = Date.now() - cached.createdAt > POST_CACHE_TTL_MS;
  return { value: cached.value, isStale };
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

function normalizePostCallToActionType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return POST_CALL_TO_ACTION_TYPES.has(normalized) ? normalized : '';
}

function buildPostCallToActionPayload(callToActionType) {
  if (!callToActionType) return '';
  if (callToActionType === 'MESSAGE_PAGE') {
    return JSON.stringify({ type: 'MESSAGE_PAGE', value: {} });
  }
  return '';
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

function buildFallbackMappedPost(page = {}, postId = '', message = '', raw = {}) {
  return {
    id: String(postId || '').trim(),
    message: raw.message || raw.description || raw.name || message || '',
    createdTime: raw.created_time || new Date().toISOString(),
    permalink: raw.permalink_url || '',
    picture: raw.full_picture || raw.picture || '',
    shares: raw.shares?.count || 0,
    likes: raw.likes?.summary?.total_count || 0,
    comments: raw.comments?.summary?.total_count || 0,
    pageName: page.name || '',
    pageId: page.id || '',
    pageAvatar: page.picture?.data?.url || ''
  };
}

async function resolvePublishedPostForSave({ pageToken, page, result, fallbackObjectId, message }) {
  const directId = String(result?.post_id || result?.id || '').trim();
  const objectId = String(fallbackObjectId || directId || '').trim();
  let storyId = String(result?.post_id || '').trim();
  let rawData = result || {};

  if (!storyId && directId.includes('_')) {
    storyId = directId;
  }

  if (!storyId && objectId) {
    for (let attempt = 0; attempt < 4 && !storyId; attempt += 1) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
      }
      try {
        const objectInfo = await fbGet(pageToken, objectId, {
          fields: 'id,post_id,message,description,name,created_time,permalink_url,full_picture,picture,shares,likes.summary(true),comments.summary(true)'
        });
        rawData = objectInfo || rawData;
        storyId = String(objectInfo?.post_id || '').trim();
        if (!storyId && String(objectInfo?.id || '').includes('_')) {
          storyId = String(objectInfo.id);
        }
      } catch {
        // Some media nodes do not expose post_id immediately after publish.
      }
    }
  }

  if (storyId) {
    try {
      const postInfo = await fbGet(pageToken, storyId, {
        fields: 'id,message,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)'
      });
      rawData = postInfo || rawData;
      return mapFacebookPost(postInfo, page);
    } catch {
      return buildFallbackMappedPost(page, storyId, message, rawData);
    }
  }

  if (!objectId) return null;
  return buildFallbackMappedPost(page, objectId, message, rawData);
}

async function assertPostIsPublished(pageToken, postId) {
  const id = String(postId || '').trim();
  if (!id) return;
  try {
    const postInfo = await fbGet(pageToken, id, { fields: 'id,is_published,status_type,permalink_url' });
    if (postInfo?.is_published === false) {
      throw new Error('Bai viet dang o trang thai chua public, tai khoan khac se khong xem duoc.');
    }
  } catch (error) {
    if (error.message.includes('chua public')) throw error;
    // Some Page post fields are unavailable on specific post types; publishing still succeeded.
  }
}

function buildReelTitle(message = '', fileName = '') {
  const firstLine = String(message || '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return (firstLine || String(fileName || '').trim() || 'Reel').slice(0, 255);
}

async function removeReelUploadSession(sessionId) {
  const session = reelUploadSessions.get(sessionId);
  if (!session) return;
  reelUploadSessions.delete(sessionId);
  try {
    await fs.rm(session.dir, { recursive: true, force: true });
  } catch {
    // Temp cleanup should never block request handling.
  }
}

function cleanupExpiredReelUploadSessions() {
  const now = Date.now();
  for (const [sessionId, session] of reelUploadSessions.entries()) {
    if (now - Number(session.createdAt || 0) > REEL_UPLOAD_SESSION_TTL_MS) {
      removeReelUploadSession(sessionId);
    }
  }
}

async function createReelUploadSession({ fileName, fileSize, mimeType }) {
  cleanupExpiredReelUploadSessions();
  const size = Number(fileSize || 0);
  if (!size || size > PAGE_VIDEO_MAX_BYTES) {
    throw new Error(`File video vuot gioi han ${PAGE_VIDEO_MAX_MB}MB`);
  }

  const sessionId = crypto.randomUUID();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adsctrl-reel-'));
  const filePath = path.join(dir, 'video.bin');
  await fs.writeFile(filePath, Buffer.alloc(0));

  const session = {
    id: sessionId,
    dir,
    filePath,
    fileName: String(fileName || 'video.mp4').slice(0, 255),
    fileSize: size,
    mimeType: String(mimeType || 'video/mp4').slice(0, 100),
    receivedBytes: 0,
    createdAt: Date.now()
  };
  reelUploadSessions.set(sessionId, session);
  return session;
}

async function appendReelUploadChunk({ sessionId, offset, chunk }) {
  cleanupExpiredReelUploadSessions();
  const session = reelUploadSessions.get(String(sessionId || ''));
  if (!session) {
    const error = new Error('Phien upload video da het han hoac khong ton tai');
    error.status = 404;
    throw error;
  }

  const expectedOffset = Number(session.receivedBytes || 0);
  const nextOffset = Number(offset || 0);
  if (nextOffset !== expectedOffset) {
    const error = new Error(`Sai offset upload video. Server dang doi ${expectedOffset}, nhan ${nextOffset}`);
    error.status = 409;
    throw error;
  }

  if (!Buffer.isBuffer(chunk) || chunk.length <= 0) {
    throw new Error('Chunk video rong');
  }
  if (chunk.length > PAGE_VIDEO_CHUNK_MAX_BYTES) {
    const error = new Error('Moi chunk video toi da 768KB');
    error.status = 413;
    throw error;
  }
  if (expectedOffset + chunk.length > session.fileSize) {
    throw new Error('Chunk video vuot qua kich thuoc file khai bao');
  }

  await fs.appendFile(session.filePath, chunk);
  session.receivedBytes += chunk.length;
  session.updatedAt = Date.now();
  return session;
}

function getCompletedReelUploadSession(sessionId) {
  const session = reelUploadSessions.get(String(sessionId || ''));
  if (!session) {
    const error = new Error('Phien upload video da het han hoac khong ton tai');
    error.status = 404;
    throw error;
  }
  if (session.receivedBytes !== session.fileSize) {
    throw new Error(`Video upload chua du: ${session.receivedBytes}/${session.fileSize} bytes`);
  }
  return session;
}

function isVideoStatusReady(status = {}) {
  const state = String(status.video_status || status.status || '').toLowerCase();
  const processing = String(status.processing_phase?.status || '').toLowerCase();
  const publishing = String(status.publishing_phase?.status || '').toLowerCase();
  return ['ready', 'published'].includes(state) ||
    (['complete', 'completed'].includes(processing) && ['complete', 'completed'].includes(publishing));
}

function getVideoStatusError(status = {}) {
  const errors = [
    status.error?.message,
    status.processing_phase?.error?.message,
    status.publishing_phase?.error?.message,
    status.copyright_check_status?.error?.message
  ].filter(Boolean);
  return errors.join('; ');
}

async function waitForReelPublished(pageToken, videoId) {
  let lastStatus = null;
  for (let attempt = 0; attempt < REEL_STATUS_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, REEL_STATUS_POLL_DELAY_MS));
    }

    const videoInfo = await fbGet(pageToken, videoId, {
      fields: 'id,status,post_id,permalink_url'
    });
    lastStatus = videoInfo?.status || {};

    const statusError = getVideoStatusError(lastStatus);
    if (statusError) {
      throw new Error(`Reel bi Meta tu choi xu ly: ${statusError}`);
    }
    if (isVideoStatusReady(lastStatus) || videoInfo?.post_id) {
      return videoInfo;
    }
  }

  throw new Error(`Reel chua publish xong sau ${Math.round((REEL_STATUS_POLL_ATTEMPTS * REEL_STATUS_POLL_DELAY_MS) / 1000)}s. Trang thai Meta: ${JSON.stringify(lastStatus || {})}`);
}

async function uploadLocalReel({ pageToken, pageId, videoFile, message }) {
  const startResult = await fbPost(pageToken, `${pageId}/video_reels`, {
    upload_phase: 'start'
  });
  const videoId = String(startResult?.video_id || '').trim();
  const uploadUrl = String(startResult?.upload_url || '').trim();
  if (!videoId || !uploadUrl) {
    throw new Error('Facebook khong tra ve upload session cho Reel');
  }

  const buffer = Buffer.from(await videoFile.arrayBuffer());
  const uploadResponse = await axios.post(uploadUrl, buffer, {
    headers: {
      Authorization: `OAuth ${pageToken}`,
      offset: '0',
      file_size: String(buffer.length),
      'Content-Type': 'application/octet-stream'
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 15 * 60 * 1000
  });

  if (uploadResponse.data?.success === false) {
    throw new Error(`Upload Reel that bai: ${JSON.stringify(uploadResponse.data)}`);
  }

  const finishPayload = {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    title: buildReelTitle(message, videoFile.name)
  };
  if (message) finishPayload.description = message;

  const finishResult = await fbPost(pageToken, `${pageId}/video_reels`, finishPayload);
  if (finishResult?.success === false) {
    throw new Error(`Publish Reel that bai: ${JSON.stringify(finishResult)}`);
  }

  const publishedInfo = await waitForReelPublished(pageToken, videoId);
  return {
    ...finishResult,
    ...publishedInfo,
    id: publishedInfo?.id || videoId,
    video_id: videoId
  };
}

async function uploadStoredReel({ pageToken, pageId, session, message }) {
  const startResult = await fbPost(pageToken, `${pageId}/video_reels`, {
    upload_phase: 'start'
  });
  const videoId = String(startResult?.video_id || '').trim();
  const uploadUrl = String(startResult?.upload_url || '').trim();
  if (!videoId || !uploadUrl) {
    throw new Error('Facebook khong tra ve upload session cho Reel');
  }

  const buffer = await fs.readFile(session.filePath);
  const uploadResponse = await axios.post(uploadUrl, buffer, {
    headers: {
      Authorization: `OAuth ${pageToken}`,
      offset: '0',
      file_size: String(buffer.length),
      'Content-Type': 'application/octet-stream'
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 15 * 60 * 1000
  });

  if (uploadResponse.data?.success === false) {
    throw new Error(`Upload Reel that bai: ${JSON.stringify(uploadResponse.data)}`);
  }

  const finishPayload = {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    title: buildReelTitle(message, session.fileName)
  };
  if (message) finishPayload.description = message;

  const finishResult = await fbPost(pageToken, `${pageId}/video_reels`, finishPayload);
  if (finishResult?.success === false) {
    throw new Error(`Publish Reel that bai: ${JSON.stringify(finishResult)}`);
  }

  const publishedInfo = await waitForReelPublished(pageToken, videoId);
  return {
    ...finishResult,
    ...publishedInfo,
    id: publishedInfo?.id || videoId,
    video_id: videoId
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
  const fbGetOptions = options.fbGetOptions || {};
  const fields = 'id,message,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)';
  let posts = [];

  const first = await fbGet(token, `${page.id}/posts`, { fields, limit: requestLimit }, fbGetOptions);
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

async function doFetchAndCachePosts(pageId, fbToken, options, cacheKey) {
  const { limit, maxPages, postLimit, fbGetOptions = {} } = options;
  let pageToken = fbToken;
  let pageInfo = { id: pageId };
  try {
    pageInfo = await fbGet(fbToken, pageId, { fields: 'name,id,access_token,picture{url}' }, { retries: 1, rateLimitRetries: 0, ...fbGetOptions });
    if (pageInfo.access_token) pageToken = pageInfo.access_token;
  } catch {}

  const posts = await fetchRecentPostsForPage(
    { ...pageInfo, id: pageId, access_token: pageToken },
    fbToken,
    { limit, maxPages, maxLimit: postLimit, fbGetOptions }
  );
  const payload = { ok: true, posts, total: posts.length, limit, maxPages };
  setPostCache(cacheKey, payload);
  return payload;
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

async function fetchPagesFromFacebook(fbToken, axios) {
  let allPages = [];
  const url = 'me/accounts';
  const params = { fields: 'name,id,access_token,category,picture{url},fan_count', limit: 100 };

  const first = await fbGet(fbToken, url, params, { retries: 0, rateLimitRetries: 0 });
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

app.get('/api/pages', async (req, res) => {
  const fbToken = await resolvePagesToken(req, getAppConfig).catch(() => '');
  if (!fbToken) return res.status(400).json({ error: 'Chưa cấu hình Facebook Token dùng chung' });

  const tokenHash = crypto.createHash('md5').update(fbToken).digest('hex');
  const forceRefresh = req.query.refresh === '1';

  try {
    const cached = pagesCache.get(tokenHash);
    const now = Date.now();
    const isStale = !cached || (now - cached.fetchedAt) > PAGES_CACHE_TTL_MS;

    // Return cached data immediately (stale-while-revalidate)
    if (cached && !forceRefresh) {
      res.json({ ok: true, pages: cached.pages, total: cached.pages.length, cached: true });
      if (isStale) {
        fetchPagesFromFacebook(fbToken, axios)
          .then(pages => pagesCache.set(tokenHash, { pages, fetchedAt: Date.now() }))
          .catch(() => {});
      }
      return;
    }

    // No cache yet or force refresh — fetch and wait
    const allPages = await fetchPagesFromFacebook(fbToken, axios);
    pagesCache.set(tokenHash, { pages: allPages, fetchedAt: now });
    res.json({ ok: true, pages: allPages, total: allPages.length });
  } catch (error) {
    // Fetch failed — return stale cache rather than error if available
    const cached = pagesCache.get(tokenHash);
    if (cached) {
      return res.json({ ok: true, pages: cached.pages, total: cached.pages.length, cached: true, stale: true });
    }
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
    const cacheResult = getPostCache(cacheKey, refresh);
    if (cacheResult) {
      return res.json({ ...cacheResult.value, cached: true });
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

    // Stale-while-revalidate: trả cache ngay (dù stale), refresh background
    const cacheResult = getPostCache(cacheKey, refresh);
    if (cacheResult) {
      res.json({ ...cacheResult.value, cached: true });
      if (cacheResult.isStale) {
        doFetchAndCachePosts(pageId, fbToken, { limit, maxPages, postLimit }, cacheKey).catch(() => {});
      }
      return;
    }

    // Không có cache: fetch từ Facebook, retry ít hơn để không block proxy
    try {
      const payload = await doFetchAndCachePosts(
        pageId, fbToken,
        { limit, maxPages, postLimit, fbGetOptions: { retries: 1, rateLimitRetries: 0 } },
        cacheKey
      );
      res.json(payload);
    } catch (error) {
      // Fallback: trả posts đã lưu trong DB nếu Facebook API lỗi
      const savedPosts = await FacebookPost.find({ pageId: String(pageId) })
        .sort({ createdTime: -1 })
        .limit(limit)
        .lean()
        .then(posts => posts.map(mapSavedFacebookPost));
      if (savedPosts.length > 0) {
        return res.json({ ok: true, posts: savedPosts, total: savedPosts.length, limit, maxPages, fromSaved: true });
      }
      res.status(400).json({ error: error.message });
    }
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
    let callToActionType = '';
    let videoFile = null;
    let imageFiles = [];

    if (isMultipart) {
      const contentLength = Number(req.headers['content-length'] || 0);
      if (contentLength > PAGE_VIDEO_MAX_BYTES + (2 * 1024 * 1024)) {
        return res.status(413).json({ error: `File video vuot gioi han ${PAGE_VIDEO_MAX_MB}MB` });
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
      callToActionType = normalizePostCallToActionType(formData.get('callToActionType'));
      for (const mediaFile of formData.getAll('media')) {
        if (!mediaFile || typeof mediaFile.arrayBuffer !== 'function' || Number(mediaFile.size || 0) <= 0) continue;
        const fileType = String(mediaFile.type || '').toLowerCase();
        if (fileType.startsWith('video/')) {
          if (videoFile) return res.status(400).json({ error: 'Chi ho tro 1 video moi lan dang' });
          if (Number(mediaFile.size || 0) > PAGE_VIDEO_MAX_BYTES) {
            return res.status(413).json({ error: `File video vuot gioi han ${PAGE_VIDEO_MAX_MB}MB` });
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
            return res.status(413).json({ error: `File video vuot gioi han ${PAGE_VIDEO_MAX_MB}MB` });
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
      callToActionType = normalizePostCallToActionType(req.body?.callToActionType);
    }

    if (!pageId) return res.status(400).json({ error: 'Thieu Page ID' });
    if (!message && !link && !videoFile && imageFiles.length === 0) return res.status(400).json({ error: 'Nhap noi dung, link hoac chon file truoc khi dang bai' });
    if (videoFile && callToActionType === 'MESSAGE_PAGE') {
      return res.status(400).json({ error: 'Nut "Gui tin nhan" hien chua ho tro khi dang reels video' });
    }

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
    const callToActionPayload = buildPostCallToActionPayload(callToActionType);
    let result;
    let mode = 'feed';
    let uploadedObjectId = '';

    if (videoFile) {
      mode = 'video';
      result = await uploadLocalReel({ pageToken, pageId, videoFile, message });
      uploadedObjectId = String(result?.video_id || result?.id || '').trim();
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

      const payload = { published: true };
      if (message) payload.message = message;
      if (link) payload.link = link;
      if (callToActionPayload) payload.call_to_action = callToActionPayload;
      uploadedPhotoIds.forEach((id, index) => {
        payload[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
      });
      result = await fbPost(pageToken, `${pageId}/feed`, payload);
    } else {
      const payload = { published: true };
      if (message) payload.message = message;
      if (link) payload.link = link;
      if (callToActionPayload) payload.call_to_action = callToActionPayload;
      result = await fbPost(pageToken, `${pageId}/feed`, payload);
    }

    postCache.clear();

    const post = await resolvePublishedPostForSave({
      pageToken,
      page,
      result,
      fallbackObjectId: uploadedObjectId,
      message
    });
    if (post) {
      await assertPostIsPublished(pageToken, post.id);
      await saveFacebookPosts([post], [result || {}]);
    }

    res.json({
      ok: true,
      mode,
      postId: post?.id || result?.id || '',
      link: link || '',
      fileName: videoFile?.name || '',
      fileNames: imageFiles.map(file => file.name || 'image.jpg'),
      callToActionType,
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

app.post('/api/pages/:pageId/reels/upload-session', async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || 'video.mp4').trim();
    const fileSize = Number(req.body?.fileSize || 0);
    const mimeType = String(req.body?.mimeType || 'video/mp4').trim();
    const session = await createReelUploadSession({ fileName, fileSize, mimeType });
    res.json({
      ok: true,
      sessionId: session.id,
      chunkSize: PAGE_VIDEO_CHUNK_MAX_BYTES,
      receivedBytes: session.receivedBytes,
      fileSize: session.fileSize
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.post('/api/pages/:pageId/reels/upload-session/:sessionId/chunk', express.raw({
  type: '*/*',
  limit: '1mb'
}), async (req, res) => {
  try {
    const session = await appendReelUploadChunk({
      sessionId: req.params.sessionId,
      offset: req.headers['x-upload-offset'],
      chunk: req.body
    });
    res.json({
      ok: true,
      receivedBytes: session.receivedBytes,
      fileSize: session.fileSize,
      done: session.receivedBytes === session.fileSize
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.post('/api/pages/:pageId/reels/upload-session/:sessionId/publish', async (req, res) => {
  let session = null;
  try {
    const fbToken = await resolvePagesToken(req, getAppConfig);
    if (!fbToken) return res.status(400).json({ error: 'Chua cau hinh Facebook Token dung chung' });

    const { pageId, sessionId } = req.params;
    const message = String(req.body?.message || '').trim();
    if (!pageId) return res.status(400).json({ error: 'Thieu Page ID' });

    session = getCompletedReelUploadSession(sessionId);

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
    const result = await uploadStoredReel({ pageToken, pageId, session, message });
    const uploadedObjectId = String(result?.video_id || result?.id || '').trim();

    postCache.clear();
    const post = await resolvePublishedPostForSave({
      pageToken,
      page,
      result,
      fallbackObjectId: uploadedObjectId,
      message
    });
    if (post) {
      await assertPostIsPublished(pageToken, post.id);
      await saveFacebookPosts([post], [result || {}]);
    }

    await removeReelUploadSession(sessionId);

    res.json({
      ok: true,
      mode: 'video',
      postId: post?.id || result?.id || '',
      link: '',
      fileName: session.fileName || '',
      fileNames: [],
      callToActionType: '',
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

    res.status(error.status || 400).json({ error: error.message });
  } finally {
    if (session) {
      await removeReelUploadSession(req.params.sessionId);
    }
  }
});
}

module.exports = registerPageRoutes;
