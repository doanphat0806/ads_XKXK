'use strict';

const User = require('../models/User');
const { hashPassword, normalizeUsername, normalizeProvider } = require('../utils/authUtils');
const { parseBoundedInt } = require('../utils/number');

const FALLBACK_LOGIN_USERS = [
  { username: 'admin', password: process.env.USER_ADMIN_PASSWORD || 'admin', displayName: 'Admin', provider: 'facebook' },
  { username: 'admin1', password: process.env.USER_ADMIN1_PASSWORD || 'admin', displayName: 'Shopee Admin', provider: 'shopee' },
  { username: 'phat', password: process.env.USER_PHAT_PASSWORD || 'phat', displayName: 'Phat', provider: 'shopee' },
  { username: 'user2', password: process.env.USER2_PASSWORD || 'admin', displayName: 'User 2', provider: 'facebook' },
  { username: 'user3', password: process.env.USER3_PASSWORD || 'admin', displayName: 'User 3', provider: 'facebook' },
  { username: 'user4', password: process.env.USER4_PASSWORD || 'admin', displayName: 'User 4', provider: 'facebook' },
  { username: 'oder', password: process.env.USER_ODER_PASSWORD || 'oder', displayName: 'Order Staff', provider: 'oder' },
  { username: 'kho', password: process.env.USER_KHO_PASSWORD || 'kho', displayName: 'Kho Staff', provider: 'kho' }
];

const DEFAULT_LOGIN_USERS = (() => {
  try {
    const raw = String(process.env.DEFAULT_LOGIN_USERS || '');
    if (!raw) return FALLBACK_LOGIN_USERS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : FALLBACK_LOGIN_USERS;
  } catch {
    return FALLBACK_LOGIN_USERS;
  }
})();

/**
 * Đảm bảo các user mặc định đã tồn tại trong DB.
 */
async function ensureDefaultUsers() {
  for (const item of DEFAULT_LOGIN_USERS) {
    const username = normalizeUsername(item.username);
    if (!username || !item.password) continue;

    const existing = await User.findOne({ username }).select('_id username active passwordHash').lean();
    if (existing?.active) continue;

    await User.findOneAndUpdate(
      { username },
      {
        $set: {
          username,
          displayName: item.displayName || username,
          passwordHash: hashPassword(item.password),
          provider: normalizeProvider(item.provider),
          active: true,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true, new: true }
    );
  }
}

/**
 * Migrate tài khoản cũ (không có ownerUserId) sang user mặc định.
 */
async function migrateLegacyAccountsToDefaultUser() {
  const Account = require('../models/Account');
  const defaultUser = await User.findOne({ username: 'admin' }).select('_id').lean();
  if (!defaultUser) return;

  const result = await Account.updateMany(
    { $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: null }] },
    { $set: { ownerUserId: defaultUser._id } }
  );

  if (result.modifiedCount) {
    console.log(`Migrated ${result.modifiedCount} legacy accounts to admin user`);
  }
}

/**
 * Lấy auto config của user.
 * @param {string} userId
 */
async function getUserAutoConfig(userId) {
  const user = await User.findById(userId).select(
    'autoRuleStartTime autoRuleEndTime shopeeAutoRuleStartTime shopeeAutoRuleEndTime ' +
    'scheduledDuplicatePauseTime dailyZeroMessageSpendLimit dailyOneMessageSpendLimit ' +
    'dailyFewMessageThreshold dailyFewMessageSpendLimit dailyCheapMessageCostLimit ' +
    'dailyCheapMessageSpendLimit dailyHighCostPerMessageLimit dailyHighCostSpendLimit ' +
    'dailyClickLimit dailyCpcLimit lifetimeZeroMessageSpendLimit lifetimeOneMessageSpendLimit ' +
    'lifetimeFewMessageThreshold lifetimeFewMessageSpendLimit lifetimeCheapMessageCostLimit ' +
    'lifetimeCheapMessageSpendLimit lifetimeHighCostPerMessageLimit lifetimeHighCostSpendLimit ' +
    'lifetimeClickLimit lifetimeCpcLimit autoPauseCpoLimit autoPauseCpoLimitLifetime ' +
    'autoPauseZeroOrderSpendLimit autoPauseZeroOrderSpendLimitLifetime autoPauseShopeeMinSpendLimit autoPauseShopeeHhAdsPercent'
  ).lean();
  return user || {};
}

/**
 * Tạo filter theo owner user.
 * @param {import('express').Request} req
 * @param {object} baseFilter
 * @returns {object}
 */
function withUserFilter(req, baseFilter = {}) {
  if (!req.currentUser?._id) return baseFilter;
  return { ...baseFilter, ownerUserId: req.currentUser._id };
}

module.exports = {
  DEFAULT_LOGIN_USERS,
  ensureDefaultUsers,
  migrateLegacyAccountsToDefaultUser,
  getUserAutoConfig,
  withUserFilter
};
