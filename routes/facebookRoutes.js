'use strict';

const express = require('express');
const axios = require('axios');
const Account = require('../models/Account');
const User = require('../models/User');
const FbProfile = require('../models/FbProfile');
const { fbGet } = require('../utils/fbApi');
const { exchangeToken } = require('../utils/fbApi');
const { clearAllReadCache } = require('../utils/cacheManager');

const router = express.Router();

// Facebook OAuth state store (in-memory, có TTL 10 phút)
const facebookOAuthStates = new Map();

const FB_OAUTH_SCOPES = [
  'public_profile',
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_manage_metadata',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_manage_ads',
  'instagram_basic',
  'instagram_manage_insights'
];

/**
 * Lấy redirect URI cho Facebook OAuth
 */
function getFacebookOAuthRedirectUri(req) {
  const configured = String(process.env.FB_OAUTH_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const host = req.get('host');
  if (host && host.includes('localhost')) {
    const protocol = req.protocol || 'http';
    return `${protocol}://${host}/api/facebook/oauth/callback`;
  }
  return 'https://xekoxukashop.id.vn/api/facebook/oauth/callback';
}

/**
 * Tạo state ngẫu nhiên cho OAuth
 */
function getFacebookOAuthState(req) {
  const crypto = require('crypto');
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getFacebookOAuthRedirectUri(req);
  facebookOAuthStates.set(state, {
    userId: String(req.currentUser?._id || ''),
    // 'via': luu thanh VIA rieng (FbProfile), khong ghi de token cua user
    mode: req.query?.mode === 'via' ? 'via' : 'user',
    redirectUri,
    createdAt: Date.now()
  });
  // Dọn state cũ
  for (const [key, val] of facebookOAuthStates.entries()) {
    if (Date.now() - val.createdAt > 10 * 60 * 1000) {
      facebookOAuthStates.delete(key);
    }
  }
  return state;
}

/**
 * Render popup result HTML
 */
/**
 * Luu/cap nhat VIA tu token dai han, roi thay token moi cho moi tai khoan quang cao cua VIA do.
 */
async function saveFbProfileFromToken({ userId, token, appId, appSecret, graphVersion }) {
  const me = await axios.get(`https://graph.facebook.com/${graphVersion}/me`, {
    params: { fields: 'id,name,picture.type(large){url}', access_token: token },
    timeout: 15000
  }).then(response => response.data || {});
  if (!me.id) throw new Error('Khong lay duoc thong tin tai khoan Facebook');

  const expiresAt = await axios.get('https://graph.facebook.com/debug_token', {
    params: { input_token: token, access_token: `${appId}|${appSecret}` },
    timeout: 15000
  }).then(response => {
    const seconds = Number(response.data?.data?.expires_at || 0);
    return seconds > 0 ? new Date(seconds * 1000) : null;
  }).catch(() => null);

  const now = new Date();
  const profile = await FbProfile.findOneAndUpdate(
    { ownerUserId: userId, fbUserId: String(me.id) },
    {
      $set: {
        name: String(me.name || ''),
        pictureUrl: String(me.picture?.data?.url || ''),
        token,
        expiresAt,
        lastLoginAt: now,
        updatedAt: now
      },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true, new: true }
  ).lean();

  const updateResult = await Account.updateMany(
    { ownerUserId: userId, fbProfileId: profile._id, fbToken: { $ne: token } },
    { $set: { fbToken: token } }
  );
  return { profile, tokenUpdated: Number(updateResult?.modifiedCount || 0) };
}

function renderOAuthPopupResult({ ok, error, expires_at, scopes, fbName, profileId, tokenUpdated }) {
  const payload = JSON.stringify({ ok, error, expires_at, scopes, fbName, profileId, tokenUpdated }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Facebook Login</title></head>
  <body>
    <script>
      const payload = ${payload};
      if (window.opener) {
        window.opener.postMessage({ type: 'adsctrl:facebook-oauth', payload }, '*');
      }
      window.close();
    </script>
    <p>Facebook login finished. You can close this window.</p>
  </body>
</html>`;
}

/**
 * GET /api/facebook/oauth/start
 */
router.get('/oauth/start', async (req, res) => {
  try {
    const { getAppConfig } = require('../services/configService');
    const { FACEBOOK_GRAPH_API_VERSION } = require('../config/appConstants');
    const config = await getAppConfig();
    const appId = String(config?.fbAppId || process.env.FB_APP_ID || '').trim();
    const appSecret = String(config?.fbAppSecret || process.env.FB_APP_SECRET || '').trim();
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'Chua cau hinh Facebook App ID va App Secret' });
    }

    const state = getFacebookOAuthState(req);
    const redirectUri = getFacebookOAuthRedirectUri(req);
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: FB_OAUTH_SCOPES.join(','),
      auth_type: 'rerequest'
    });

    res.json({
      ok: true,
      authUrl: `https://www.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`,
      redirectUri,
      scopes: FB_OAUTH_SCOPES
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/facebook/oauth/callback
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const { getAppConfig } = require('../services/configService');
    const { FACEBOOK_GRAPH_API_VERSION } = require('../config/appConstants');
    const { configureFacebookToken } = require('../services/facebookTokenService');
    const { sendTokenAlert } = require('../services/facebookTokenService');
    const { code, state, error, error_description } = req.query;
    if (error) {
      return res.status(400).send(renderOAuthPopupResult({
        ok: false,
        error: String(error_description || error)
      }));
    }

    const stateRecord = facebookOAuthStates.get(String(state || ''));
    facebookOAuthStates.delete(String(state || ''));
    if (!code || !stateRecord || Date.now() - stateRecord.createdAt > 10 * 60 * 1000) {
      return res.status(400).send(renderOAuthPopupResult({
        ok: false,
        error: 'Phien dang nhap Facebook khong hop le hoac da het han'
      }));
    }

    const config = await getAppConfig();
    const appId = String(config?.fbAppId || process.env.FB_APP_ID || '').trim();
    const appSecret = String(config?.fbAppSecret || process.env.FB_APP_SECRET || '').trim();
    if (!appId || !appSecret) {
      throw new Error('Chua cau hinh Facebook App ID va App Secret');
    }

    const tokenResponse = await axios.get(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: stateRecord.redirectUri,
        code
      },
      timeout: 15000
    });
    const shortToken = tokenResponse.data?.access_token;
    if (!shortToken) throw new Error('Facebook khong tra ve access_token');

    const longLivedToken = await exchangeToken(shortToken, appId, appSecret);

    if (stateRecord.mode === 'via') {
      if (!stateRecord.userId) throw new Error('Thieu nguoi dung de luu VIA');
      const via = await saveFbProfileFromToken({
        userId: stateRecord.userId,
        token: longLivedToken,
        appId,
        appSecret,
        graphVersion: FACEBOOK_GRAPH_API_VERSION
      });
      clearAllReadCache();
      return res.send(renderOAuthPopupResult({
        ok: true,
        expires_at: via.profile.expiresAt || null,
        scopes: FB_OAUTH_SCOPES,
        fbName: via.profile.name,
        profileId: String(via.profile._id),
        tokenUpdated: via.tokenUpdated
      }));
    }

    const tokenState = stateRecord.userId
      ? await User.findByIdAndUpdate(stateRecord.userId, {
          fbToken: longLivedToken,
          fbTokenLastRefreshTime: new Date(),
          fbTokenLastRefreshError: '',
          updatedAt: new Date()
        }, { new: true }).lean().then(user => ({
          expires_at: user?.fbTokenExpiresAt || null
        }))
      : await configureFacebookToken({
          app_id: appId,
          app_secret: appSecret,
          long_lived_user_access_token: longLivedToken
        });
    clearAllReadCache();

    // Ten tai khoan Facebook vua dang nhap, de client hien thi khi tu dong bo
    const fbName = await axios.get(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/me`, {
      params: { fields: 'name', access_token: longLivedToken },
      timeout: 10000
    }).then(response => String(response.data?.name || '')).catch(() => '');

    res.send(renderOAuthPopupResult({
      ok: true,
      expires_at: tokenState.expires_at,
      scopes: FB_OAUTH_SCOPES,
      fbName
    }));
  } catch (callbackError) {
    const { sendTokenAlert } = require('../services/facebookTokenService');
    await sendTokenAlert('Facebook OAuth login failed', { error: callbackError.message }).catch(() => {});
    res.status(400).send(renderOAuthPopupResult({
      ok: false,
      error: callbackError.message
    }));
  }
});

module.exports = router;
module.exports.facebookOAuthStates = facebookOAuthStates;
