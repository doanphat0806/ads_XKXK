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

  // Express 4 khong bat loi tu async middleware: neu truy van nay reject (Mongo
  // mat ket noi trong giay lat) thi thanh unhandled rejection - Node >= 15 mac dinh
  // kill process, tuc la ca server sap chi vi mot request. Bat loi tai day va tra
  // 503 de request do hong mot minh no.
  let user;
  try {
    user = await User.findOne({ _id: tokenData.userId, active: true }).select('-passwordHash').lean();
  } catch (error) {
    console.error(`Auth lookup failed: ${error.message}`);
    return res.status(503).json({ error: 'May chu tam thoi khong truy van duoc tai khoan, vui long thu lai' });
  }

  if (!user) return res.status(401).json({ error: 'Tai khoan khong hop le' });
  req.currentUser = user;
  next();
}

module.exports = { authenticateApiRequest };
