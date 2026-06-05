'use strict';

const express = require('express');
const { getGoogleOAuthConfig, requireGoogleOAuthConfig, getGoogleAccessToken } = require('../utils/googleOAuth');
const { createSignedState, parseSignedState } = require('../utils/authUtils');
const User = require('../models/User');
const axios = require('axios');

const GOOGLE_OAUTH_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

const router = express.Router();

/**
 * GET /api/google/oauth/start
 */
router.get('/oauth/start', async (req, res) => {
  try {
    const { clientId, redirectUri } = requireGoogleOAuthConfig(req);
    const state = createSignedState('google-oauth', { userId: String(req.currentUser._id) });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    });

    res.json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/google/oauth/callback
 */
router.get('/oauth/callback', async (req, res) => {
  const htmlEscape = (value) => String(value || '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  try {
    const { code, state, error } = req.query;
    if (error) throw new Error(String(error));
    if (!code) throw new Error('Google khong tra ve code');

    const stateData = parseSignedState('google-oauth', state);
    const mongoose = require('mongoose');
    if (!stateData?.userId || !mongoose.Types.ObjectId.isValid(stateData.userId)) {
      throw new Error('Google OAuth state khong hop le hoac da het han');
    }

    const { clientId, clientSecret, redirectUri } = requireGoogleOAuthConfig(req);
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code: String(code),
      grant_type: 'authorization_code'
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = tokenResponse.data || {};
    if (!tokenData.access_token) throw new Error('Google khong tra ve access token');

    let profile = {};
    try {
      const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      profile = profileResponse.data || {};
    } catch (profileError) {
      console.warn(`Google profile fetch failed: ${profileError.message}`);
    }

    const update = {
      googleAccessToken: tokenData.access_token,
      googleTokenExpiresAt: new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000),
      googleEmail: profile.email || '',
      googleName: profile.name || '',
      googleTokenScope: tokenData.scope || '',
      updatedAt: new Date()
    };
    if (tokenData.refresh_token) update.googleRefreshToken = tokenData.refresh_token;

    await User.findByIdAndUpdate(stateData.userId, update);

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Google connected</title></head>
<body><script>window.location.href='/google-sheets?google=connected';</script></body></html>`);
  } catch (callbackError) {
    res.type('html').status(400).send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Google error</title></head>
<body>
  <p>Google login error: ${htmlEscape(callbackError.message)}</p>
  <script>
    setTimeout(function () {
      window.location.href='/google-sheets?google=error&message=' + encodeURIComponent(${JSON.stringify(callbackError.message)});
    }, 1200);
  </script>
</body></html>`);
  }
});

/**
 * GET /api/google/status
 */
router.get('/status', async (req, res) => {
  try {
    const user = await User.findById(req.currentUser._id)
      .select('googleAccessToken googleRefreshToken googleTokenExpiresAt googleEmail googleName')
      .lean();

    res.json({
      ok: true,
      connected: Boolean(user?.googleAccessToken || user?.googleRefreshToken),
      email: user?.googleEmail || '',
      name: user?.googleName || '',
      expiresAt: user?.googleTokenExpiresAt || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/google/sheets
 */
router.get('/sheets', async (req, res) => {
  try {
    const { parseBoundedInt } = require('../utils/number');
    const accessToken = await getGoogleAccessToken(req);
    const pageSize = parseBoundedInt(req.query.pageSize, 100, 1, 1000);
    const search = String(req.query.search || '').trim();
    const qParts = [
      "mimeType='application/vnd.google-apps.spreadsheet'",
      'trashed=false'
    ];
    if (search) {
      qParts.push(`name contains '${search.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
    }

    const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: qParts.join(' and '),
        pageSize,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      }
    });

    res.json({ ok: true, files: response.data?.files || [] });
  } catch (error) {
    const status = error.response?.status || 500;
    const detail = error.response?.data?.error?.message || error.message;
    res.status(status === 401 ? 401 : 500).json({ error: detail });
  }
});

module.exports = router;
