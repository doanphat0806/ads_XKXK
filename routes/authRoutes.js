'use strict';

const express = require('express');
const User = require('../models/User');
const { verifyPassword, normalizeUsername, createAuthToken } = require('../utils/authUtils');
const { ensureDefaultUsers } = require('../services/userService');

const router = express.Router();

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    await ensureDefaultUsers();
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    let user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ error: 'Sai tai khoan hoac mat khau' });
    }

    const passwordOk = user && user.active ? verifyPassword(password, user.passwordHash) : false;
    if (!passwordOk) {
      return res.status(401).json({ error: 'Sai tai khoan hoac mat khau' });
    }

    const token = createAuthToken(user);
    res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName || user.username,
        provider: user.provider,
        hasGeminiKey: Boolean(user.geminiKey)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', async (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.currentUser._id,
      username: req.currentUser.username,
      displayName: req.currentUser.displayName || req.currentUser.username,
      provider: req.currentUser.provider,
      hasGeminiKey: Boolean(req.currentUser.geminiKey)
    }
  });
});

module.exports = router;
