'use strict';

const axios = require('axios');
const User = require('../models/User');

const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

/**
 * Lấy Google OAuth config từ env và request.
 * @param {import('express').Request} req
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string }}
 */
function getGoogleOAuthConfig(req) {
  const runtimeRedirectUri = `${req.protocol}://${req.get('host')}/api/google/oauth/callback`;
  const configuredRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  let redirectUri = runtimeRedirectUri;

  if (configuredRedirectUri) {
    try {
      const configuredUrl = new URL(configuredRedirectUri);
      const runtimeUrl = new URL(runtimeRedirectUri);
      const configuredHost = configuredUrl.host.toLowerCase();
      const runtimeHost = runtimeUrl.host.toLowerCase();
      const configuredIsLocalhost = ['localhost', '127.0.0.1'].includes(configuredUrl.hostname.toLowerCase());
      const runtimeIsLocalhost = ['localhost', '127.0.0.1'].includes(runtimeUrl.hostname.toLowerCase());

      if (
        configuredHost === runtimeHost ||
        (configuredIsLocalhost && runtimeIsLocalhost)
      ) {
        redirectUri = configuredRedirectUri;
      }
    } catch {
      redirectUri = runtimeRedirectUri;
    }
  }

  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUri
  };
}

/**
 * Lấy config Google OAuth, ném lỗi nếu chưa cấu hình.
 * @param {import('express').Request} req
 */
function requireGoogleOAuthConfig(req) {
  const config = getGoogleOAuthConfig(req);
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Chua cau hinh GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET trong .env');
  }
  return config;
}

/**
 * Làm mới Google Access Token bằng refresh_token.
 * @param {object} user
 * @param {object} config
 * @returns {Promise<string>}
 */
async function refreshGoogleAccessTokenWithConfig(user, config = {}) {
  if (!user?.googleRefreshToken) {
    throw new Error('Chua dang nhap Google hoac thieu refresh token');
  }

  const clientId = String(config.clientId || '').trim();
  const clientSecret = String(config.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Chua cau hinh GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET trong .env');
  }

  const response = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: user.googleRefreshToken,
    grant_type: 'refresh_token'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000
  });

  const tokenData = response.data || {};
  const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000);
  await User.findByIdAndUpdate(user._id, {
    googleAccessToken: tokenData.access_token || '',
    googleTokenExpiresAt: expiresAt,
    googleTokenScope: tokenData.scope || user.googleTokenScope || '',
    updatedAt: new Date()
  });

  return tokenData.access_token;
}

/**
 * Làm mới Google Access Token từ request.
 * @param {object} user
 * @param {import('express').Request} req
 * @returns {Promise<string>}
 */
async function refreshGoogleAccessToken(user, req) {
  return refreshGoogleAccessTokenWithConfig(user, requireGoogleOAuthConfig(req));
}

/**
 * Lấy Google Access Token (tự refresh nếu hết hạn).
 * @param {string} userId
 * @param {object} config
 * @returns {Promise<string>}
 */
async function getGoogleAccessTokenForUser(userId, config = {}) {
  const user = await User.findById(userId)
    .select('googleAccessToken googleRefreshToken googleTokenExpiresAt googleTokenScope')
    .lean();
  if (!user) throw new Error('Tai khoan khong hop le');

  const expiresAt = user.googleTokenExpiresAt ? new Date(user.googleTokenExpiresAt).getTime() : 0;
  if (user.googleAccessToken && expiresAt - Date.now() > 60 * 1000) {
    return user.googleAccessToken;
  }

  return refreshGoogleAccessTokenWithConfig(user, config);
}

/**
 * Lấy Google Access Token cho user hiện tại trong request.
 * @param {import('express').Request} req
 * @returns {Promise<string>}
 */
async function getGoogleAccessToken(req) {
  return getGoogleAccessTokenForUser(req.currentUser._id, requireGoogleOAuthConfig(req));
}

module.exports = {
  GOOGLE_OAUTH_SCOPES,
  getGoogleOAuthConfig,
  requireGoogleOAuthConfig,
  refreshGoogleAccessTokenWithConfig,
  refreshGoogleAccessToken,
  getGoogleAccessTokenForUser,
  getGoogleAccessToken
};
