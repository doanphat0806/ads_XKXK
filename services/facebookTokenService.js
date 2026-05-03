const axios = require('axios');
const cron = require('node-cron');

const Config = require('../models/Config');
const FacebookToken = require('../models/FacebookToken');

const FACEBOOK_TOKEN_KEY = 'facebook_user';
const FACEBOOK_TOKEN_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const FACEBOOK_TOKEN_MAX_ATTEMPTS = 3;
const FACEBOOK_TOKEN_CRON = process.env.FACEBOOK_TOKEN_CRON || '0 */6 * * *';
const TOKEN_ALERT_WEBHOOK_URL = process.env.TOKEN_ALERT_WEBHOOK_URL || '';

function maskToken(token = '') {
  const value = String(token || '');
  if (value.length <= 14) return value ? `${value.slice(0, 3)}...` : '';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function parseFacebookExpiresAt(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function getDaysUntil(date) {
  if (!date) return null;
  return (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

async function retryOperation(label, operation, attempts = FACEBOOK_TOKEN_MAX_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const status = Number(error.response?.status || error.status || 0);
      const retryable = error.retryable !== false && (!status || status === 429 || status >= 500);
      const waitMs = 1000 * attempt;
      console.warn(`${label} failed (${attempt}/${attempts}): ${error.message}`);
      if (!retryable || attempt >= attempts) break;
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function getAxiosApiErrorMessage(error) {
  const status = error.response?.status || error.status || 'ERR';
  const apiError = error.response?.data?.error;
  if (apiError) {
    const parts = [
      apiError.message,
      apiError.code ? `code=${apiError.code}` : '',
      apiError.error_subcode ? `subcode=${apiError.error_subcode}` : '',
      apiError.fbtrace_id ? `fbtrace_id=${apiError.fbtrace_id}` : ''
    ].filter(Boolean);
    return `${status}: ${parts.join(', ')}`;
  }
  return `${status}: ${error.message}`;
}

function createFacebookApiError(action, error) {
  const apiError = new Error(`${action} failed: ${getAxiosApiErrorMessage(error)}`);
  const status = Number(error.response?.status || error.status || 0);
  apiError.status = status;
  apiError.retryable = status === 429 || status >= 500 || !status;
  return apiError;
}

async function sendTokenAlert(message, meta = {}) {
  console.error(`TOKEN ALERT: ${message}`, meta);
  if (!TOKEN_ALERT_WEBHOOK_URL) return;

  try {
    await axios.post(TOKEN_ALERT_WEBHOOK_URL, {
      text: message,
      meta,
      time: new Date().toISOString()
    }, { timeout: 10000 });
  } catch (error) {
    console.error(`Token alert webhook failed: ${error.message}`);
  }
}

async function debugFacebookToken(appId, appSecret, token) {
  let response;
  try {
    response = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: token,
        access_token: `${appId}|${appSecret}`
      },
      timeout: 15000
    });
  } catch (error) {
    throw createFacebookApiError('Facebook debug_token', error);
  }

  const data = response.data?.data || {};
  if (!data.is_valid) {
    const error = new Error(`Facebook token invalid: ${data.error?.message || data.error?.code || 'unknown reason'}`);
    error.retryable = false;
    throw error;
  }
  return data;
}

async function exchangeFacebookUserToken(appId, appSecret, currentToken) {
  let response;
  try {
    response = await axios.get('https://graph.facebook.com/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken
      },
      timeout: 15000
    });
  } catch (error) {
    throw createFacebookApiError('Facebook token exchange', error);
  }

  if (!response.data?.access_token) {
    const error = new Error('Facebook exchange response missing access_token');
    error.retryable = false;
    throw error;
  }
  return response.data;
}

async function saveFacebookTokenState({ appId, appSecret, token, expiresAt, refreshedAt = null, lastError = '' }) {
  const now = new Date();
  const update = {
    appId,
    appSecret,
    token,
    expires_at: expiresAt || null,
    last_debug_time: now,
    last_error: lastError,
    updatedAt: now
  };
  if (refreshedAt) update.last_refresh_time = refreshedAt;

  const tokenState = await FacebookToken.findOneAndUpdate(
    { key: FACEBOOK_TOKEN_KEY },
    { $set: update, $setOnInsert: { key: FACEBOOK_TOKEN_KEY, createdAt: now } },
    { upsert: true, new: true }
  );

  const configUpdate = {
    fbAppId: appId,
    fbAppSecret: appSecret,
    fbToken: token,
    fbTokenExpiresAt: expiresAt || null,
    fbTokenLastDebugTime: now,
    fbTokenLastRefreshError: lastError,
    updatedAt: now
  };
  if (refreshedAt) configUpdate.fbTokenLastRefreshTime = refreshedAt;

  await Config.findOneAndUpdate(
    { key: 'app' },
    { $set: configUpdate, $setOnInsert: { key: 'app' } },
    { upsert: true }
  );

  return tokenState;
}

async function resolveFacebookTokenInput() {
  const [tokenState, config] = await Promise.all([
    FacebookToken.findOne({ key: FACEBOOK_TOKEN_KEY }),
    getAppConfig()
  ]);

  return {
    tokenState,
    appId: String(tokenState?.appId || config?.fbAppId || process.env.FB_APP_ID || '').trim(),
    appSecret: String(tokenState?.appSecret || config?.fbAppSecret || process.env.FB_APP_SECRET || '').trim(),
    token: String(tokenState?.token || config?.fbToken || process.env.FB_LONG_LIVED_USER_ACCESS_TOKEN || '').trim()
  };
}

async function configureFacebookToken({ app_id, app_secret, long_lived_user_access_token }) {
  const appId = String(app_id || '').trim();
  const appSecret = String(app_secret || '').trim();
  const token = String(long_lived_user_access_token || '').trim();

  if (!appId || !appSecret || !token) {
    throw new Error('Missing app_id, app_secret, or long_lived_user_access_token');
  }

  const debugData = await retryOperation('debug Facebook token', () => debugFacebookToken(appId, appSecret, token));
  const expiresAt = parseFacebookExpiresAt(debugData.expires_at);
  return saveFacebookTokenState({ appId, appSecret, token, expiresAt });
}

async function checkAndRefreshFacebookToken({ force = false, source = 'manual' } = {}) {
  const { appId, appSecret, token } = await resolveFacebookTokenInput();
  if (!appId || !appSecret || !token) {
    return { ok: false, skipped: true, reason: 'missing_config' };
  }

  try {
    const debugData = await retryOperation('debug Facebook token', () => debugFacebookToken(appId, appSecret, token));
    const expiresAt = parseFacebookExpiresAt(debugData.expires_at);
    await saveFacebookTokenState({ appId, appSecret, token, expiresAt });

    const msLeft = expiresAt ? expiresAt.getTime() - Date.now() : Number.POSITIVE_INFINITY;
    if (!force && msLeft >= FACEBOOK_TOKEN_REFRESH_THRESHOLD_MS) {
      return {
        ok: true,
        refreshed: false,
        source,
        expires_at: expiresAt,
        days_left: getDaysUntil(expiresAt)
      };
    }

    const oldToken = token;
    const exchangeData = await retryOperation('exchange Facebook token', () =>
      exchangeFacebookUserToken(appId, appSecret, oldToken)
    );
    const newToken = exchangeData.access_token;

    let newExpiresAt = exchangeData.expires_in
      ? new Date(Date.now() + Number(exchangeData.expires_in) * 1000)
      : null;
    try {
      const newDebugData = await retryOperation('debug refreshed Facebook token', () =>
        debugFacebookToken(appId, appSecret, newToken)
      );
      newExpiresAt = parseFacebookExpiresAt(newDebugData.expires_at) || newExpiresAt;
    } catch (error) {
      await sendTokenAlert('Refreshed Facebook token but debug_token failed', { source, error: error.message });
    }

    const refreshedAt = new Date();
    await saveFacebookTokenState({ appId, appSecret, token: newToken, expiresAt: newExpiresAt, refreshedAt });

    console.log(
      `[${refreshedAt.toISOString()}] Facebook token refreshed (${source}): ${maskToken(oldToken)} -> ${maskToken(newToken)}; expires_at=${newExpiresAt?.toISOString() || 'unknown'}`
    );

    return {
      ok: true,
      refreshed: true,
      source,
      old_token: maskToken(oldToken),
      new_token: maskToken(newToken),
      expires_at: newExpiresAt,
      last_refresh_time: refreshedAt
    };
  } catch (error) {
    await FacebookToken.findOneAndUpdate(
      { key: FACEBOOK_TOKEN_KEY },
      { $set: { last_error: error.message, updatedAt: new Date() } }
    );
    await Config.findOneAndUpdate(
      { key: 'app' },
      { $set: { fbTokenLastRefreshError: error.message, updatedAt: new Date() } }
    );
    await sendTokenAlert('Facebook token refresh failed', { source, error: error.message });
    throw error;
  }
}

async function bootstrapFacebookTokenFromEnv() {
  const envInput = {
    app_id: process.env.FB_APP_ID,
    app_secret: process.env.FB_APP_SECRET,
    long_lived_user_access_token: process.env.FB_LONG_LIVED_USER_ACCESS_TOKEN
  };
  if (!envInput.app_id || !envInput.app_secret || !envInput.long_lived_user_access_token) return;

  const existing = await FacebookToken.findOne({ key: FACEBOOK_TOKEN_KEY });
  if (existing?.token) return;

  await configureFacebookToken(envInput);
  console.log(`Facebook token configured from environment: ${maskToken(envInput.long_lived_user_access_token)}`);
}

function startFacebookTokenCron() {
  if (!cron.validate(FACEBOOK_TOKEN_CRON)) {
    console.warn(`Invalid FACEBOOK_TOKEN_CRON "${FACEBOOK_TOKEN_CRON}", token cron disabled`);
    return null;
  }

  const task = cron.schedule(FACEBOOK_TOKEN_CRON, async () => {
    try {
      const result = await checkAndRefreshFacebookToken({ source: 'cron' });
      if (result.skipped) {
        console.warn(`Facebook token cron skipped: ${result.reason}`);
      }
    } catch (error) {
      console.error(`Facebook token cron failed: ${error.message}`);
    }
  });

  console.log(`Facebook token cron scheduled: ${FACEBOOK_TOKEN_CRON}`);
  return task;
}

module.exports = {
  configureFacebookToken,
  checkAndRefreshFacebookToken,
  bootstrapFacebookTokenFromEnv,
  sendTokenAlert,
  startFacebookTokenCron,
  FACEBOOK_TOKEN_KEY
};
