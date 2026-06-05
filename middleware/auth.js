'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const { parseAuthToken, getBearerToken } = require('../utils/authUtils');

/**
 * Middleware xác thực API request.
 * Bỏ qua một số route public.
 */
async function authenticateApiRequest(req, res, next) {
  if (
    req.path === '/auth/login' ||
    req.path === '/facebook/oauth/callback' ||
    req.path === '/google/oauth/callback' ||
    req.path === '/webhooks/pancake'
  ) {
    return next();
  }

  const tokenData = parseAuthToken(getBearerToken(req));
  if (!tokenData || !mongoose.Types.ObjectId.isValid(tokenData.userId)) {
    return res.status(401).json({ error: 'Chua dang nhap hoac phien da het han' });
  }

  const user = await User.findOne({ _id: tokenData.userId, active: true }).select('-passwordHash').lean();
  if (!user) return res.status(401).json({ error: 'Tai khoan khong hop le' });
  req.currentUser = user;
  next();
}

module.exports = { authenticateApiRequest };
