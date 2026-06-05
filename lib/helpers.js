/**
 * Request-related helper utilities
 * Handles user/inventory filters, MongoDB utilities
 */

// User-scoped filtering
function getUserFilter(req) {
  return req.currentUser?._id ? { ownerUserId: req.currentUser._id } : {};
}

function withUserFilter(req, filter = {}) {
  return { ...filter, ...getUserFilter(req) };
}

// Inventory owner filtering
function withInventoryOwnerFilter(ownerUserId, filter = {}) {
  return ownerUserId ? { ...filter, ownerUserId } : { ...filter };
}

// Fetch user-related configurations
async function getAdminDataOwnerUser(User) {
  const admin = await User.findOne({ username: 'admin', active: true }).select('_id').lean();
  if (!admin?._id) {
    throw new Error('Khong tim thay tai khoan admin de lay du lieu kho');
  }
  return admin;
}

async function getInventoryOwnerUserId(req, User) {
  const { normalizeProvider } = require('./normalizers');
  if (normalizeProvider(req.currentUser?.provider) !== 'kho') {
    return req.currentUser?._id;
  }

  const admin = await getAdminDataOwnerUser(User);
  return admin._id;
}

async function getInventoryFilter(req, User, filter = {}) {
  const ownerUserId = await getInventoryOwnerUserId(req, User);
  return withInventoryOwnerFilter(ownerUserId, filter);
}

// Common sleep utility for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  getUserFilter,
  withUserFilter,
  withInventoryOwnerFilter,
  getAdminDataOwnerUser,
  getInventoryOwnerUserId,
  getInventoryFilter,
  sleep
};
