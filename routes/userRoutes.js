'use strict';

const express = require('express');
const User = require('../models/User');
const {
  hashPassword,
  normalizeUsername,
  requireAdminUser,
  serializeAdminUser,
  normalizeProvider
} = require('../utils/authUtils');

const router = express.Router();

/**
 * GET /api/users
 */
router.get('/users', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const users = await User.find({ active: true })
      .select('username displayName provider createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, users: users.map(serializeAdminUser) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/users
 */
router.post('/users', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const { username, password, displayName, provider } = req.body;
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      return res.status(400).json({ error: 'Username va password la bat buoc' });
    }
    if (!/^[a-z0-9._-]+$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Username chi duoc dung chu thuong, so, dau cham, gach ngang hoac gach duoi' });
    }

    const existing = await User.findOne({ username: normalizedUsername });
    if (existing?.active) {
      return res.status(400).json({ error: 'Username da ton tai' });
    }
    const payload = {
      username: normalizedUsername,
      displayName: String(displayName || normalizedUsername).trim(),
      passwordHash: hashPassword(password),
      provider: normalizeProvider(provider),
      active: true,
      updatedAt: new Date()
    };
    const user = existing
      ? await User.findByIdAndUpdate(existing._id, { $set: payload }, { new: true })
      : await User.create({ ...payload, createdAt: new Date() });

    res.json({ ok: true, user: serializeAdminUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/users/:username
 */
router.patch('/users/:username', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const username = normalizeUsername(req.params.username);
    const { password, displayName, provider } = req.body;
    const update = { updatedAt: new Date() };
    if (password) update.passwordHash = hashPassword(password);
    if (Object.prototype.hasOwnProperty.call(req.body, 'displayName')) {
      update.displayName = String(displayName || '').trim();
    }
    if (provider) {
      const nextProvider = normalizeProvider(provider);
      if (username === 'admin' && nextProvider !== 'facebook') {
        return res.status(400).json({ error: 'Khong the doi provider cua tai khoan admin' });
      }
      update.provider = nextProvider;
    }

    const user = await User.findOneAndUpdate(
      { username, active: true },
      { $set: update },
      { new: true }
    ).select('username displayName provider createdAt updatedAt');

    if (!user) return res.status(404).json({ error: 'User khong ton tai' });
    res.json({ ok: true, user: serializeAdminUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/users/:username
 */
router.delete('/users/:username', async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    const username = normalizeUsername(req.params.username);
    if (username === 'admin') {
      return res.status(400).json({ error: 'Khong the xoa tai khoan admin' });
    }
    const user = await User.findOneAndUpdate(
      { username, active: true },
      { $set: { active: false, updatedAt: new Date() } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User khong ton tai' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
