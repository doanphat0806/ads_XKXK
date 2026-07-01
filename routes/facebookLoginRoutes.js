const axios = require('axios');
const Config = require('../models/Config');
const { exchangeToken } = require('../utils/fbApi');

const DEFAULT_FB_REDIRECT_URI = 'https://xekoxukashop.id.vn/auth/facebook/callback';

/**
 * Lấy redirect URI cho Facebook OAuth, ưu tiên cấu hình env nếu cùng host
 * (hoặc cả hai đều là localhost), ngược lại suy ra từ request hiện tại.
 */
function getFbRedirectUri(req) {
  const runtimeRedirectUri = `${req.protocol}://${req.get('host')}/auth/facebook/callback`;
  const configuredRedirectUri = String(process.env.FB_REDIRECT_URI || DEFAULT_FB_REDIRECT_URI).trim();

  try {
    const configuredUrl = new URL(configuredRedirectUri);
    const runtimeUrl = new URL(runtimeRedirectUri);
    const configuredIsLocalhost = ['localhost', '127.0.0.1'].includes(configuredUrl.hostname.toLowerCase());
    const runtimeIsLocalhost = ['localhost', '127.0.0.1'].includes(runtimeUrl.hostname.toLowerCase());

    if (configuredUrl.host.toLowerCase() === runtimeUrl.host.toLowerCase() || (configuredIsLocalhost && runtimeIsLocalhost)) {
      return configuredRedirectUri;
    }
  } catch {
    return configuredRedirectUri;
  }

  return runtimeRedirectUri;
}

function registerFacebookLoginRoutes(app) {
  app.get('/auth/facebook', (req, res) => {
    const redirectUri = getFbRedirectUri(req);
    const url = `https://www.facebook.com/v24.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email`;
    return res.redirect(url);
  });

  app.get('/auth/facebook/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
      return res.redirect('/');
    }

    if (!code) {
      return res.send('No code');
    }

    try {
      const redirectUri = getFbRedirectUri(req);
      const tokenRes = await axios.get(
        'https://graph.facebook.com/v24.0/oauth/access_token',
        {
          params: {
            client_id: process.env.FB_APP_ID,
            client_secret: process.env.FB_APP_SECRET,
            redirect_uri: redirectUri,
            code
          }
        }
      );

      const accessToken = tokenRes.data.access_token;
      const userRes = await axios.get('https://graph.facebook.com/me', {
        params: {
          access_token: accessToken,
          fields: 'id,name,email'
        }
      });

      console.log('FB USER:', userRes.data);

      let longLivedToken = accessToken;
      try {
        longLivedToken = await exchangeToken(accessToken, process.env.FB_APP_ID, process.env.FB_APP_SECRET);
      } catch (tokenError) {
        console.warn('Could not exchange for long lived token:', tokenError.message);
      }

      await Config.findOneAndUpdate(
        { key: 'app' },
        {
          $set: {
            fbToken: longLivedToken,
            fbTokenLastRefreshTime: new Date()
          }
        },
        { upsert: true }
      );

      return res.send(`
        <script>
          localStorage.setItem('adsctrl-auth', '1');
          localStorage.setItem('adsctrl-provider', 'facebook');
          window.location.href = '/';
        </script>
      `);
    } catch (err) {
      console.error('FB LOGIN ERROR:', err.response?.data || err.message);
      return res.send(`
        <script>
          alert("Loi dang nhap Facebook!");
          window.location.href = '/';
        </script>
      `);
    }
  });
}

module.exports = { registerFacebookLoginRoutes };
