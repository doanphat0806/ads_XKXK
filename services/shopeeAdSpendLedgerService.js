'use strict';

// Chep chi phi ads cua cac TKQC role Shopee tu Campaign (theo ngay) sang so cai ShopeeAdSpend.
// - Dinh ky (moi 2 phut): chep cac dong Campaign vua cap nhat.
// - Khoi dong: chep bu toan bo (lan dau tao so cai tu du lieu hien co).
// - Truoc khi xoa TKQC: chep lai day du TK do, roi moi xoa Campaign.
// Bao cao Shopee Social doc tu so cai -> xoa TK khong mat chi phi cu.

const mongoose = require('mongoose');
const Account = require('../models/Account');
const Campaign = require('../models/Campaign');
const ShopeeAffAccount = require('../models/ShopeeAffAccount');
const ShopeeAdSpend = require('../models/ShopeeAdSpend');
const { buildAccountProviderFilter, normalizeAdAccountId } = require('../lib/normalizers');

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000; // chep lui them 5 phut de khong sot dong ghi dong thoi
const BULK_CHUNK = 500;

let lastIncrementalAt = null; // Date: moc updatedAt da chep toi
let running = null; // Promise dang chay (tranh chay chong)
let timer = null;

// Giong extractSubId2 trong legacyRuntimeService: ten camp = `{sub_id2}{18 ky tu}`
function extractSubId2(name) {
  const n = String(name || '').trim();
  return n.length <= 18 ? n : n.slice(0, n.length - 18);
}

// Giong client accountTrend.js subIdMatchesAccountCodes: bo 4 so ma dot ngay, phan sau bat dau bang ma acc
function subIdMatchesAccountCodes(subId2, codesCsv) {
  const codes = String(codesCsv || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!codes.length) return false;
  const value = String(subId2 || '');
  if (value.length <= 4) return false;
  const rest = value.slice(4);
  return codes.some(code => rest.startsWith(code));
}

/**
 * Gan acc Shopee AFF cho 1 dong chi phi (cung quy tac voi client resolveAdAccountScope):
 *  1. acc AFF nao chon TKQC nay trong adAccountIds -> acc do.
 *  2. khong ai chon -> acc AFF (khong chon TKQC cu the) co ma SubID khop.
 */
function resolveAffAccount(affAccounts, accountId, subId2) {
  const id = String(accountId || '');
  const explicit = affAccounts.find(aff => (aff.adAccountIds || []).some(item => String(item) === id));
  if (explicit) return explicit;
  return affAccounts.find(aff => !(aff.adAccountIds || []).length && subIdMatchesAccountCodes(subId2, aff.subIdPrefix)) || null;
}

async function loadAffAccountsByOwner(ownerIds) {
  const ids = [...new Set(ownerIds.map(String))].filter(id => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return new Map();
  const rows = await ShopeeAffAccount.find({ ownerUserId: { $in: ids } })
    .select('_id ownerUserId name subIdPrefix adAccountIds createdAt')
    .sort({ createdAt: 1 })
    .lean();
  const byOwner = new Map();
  for (const row of rows) {
    const key = String(row.ownerUserId);
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(row);
  }
  return byOwner;
}

/**
 * Chep Campaign -> ShopeeAdSpend.
 * @param {{ accountIds?: any[], since?: Date|null }} options
 *   accountIds: chi chep cac TK nay (vd truoc khi xoa); bo trong = moi TK role Shopee
 *   since: chi chep dong Campaign co updatedAt >= since; null = chep toan bo
 */
async function copyCampaignsToLedger({ accountIds = null, since = null } = {}) {
  const accountFilter = { ...buildAccountProviderFilter('shopee') };
  if (Array.isArray(accountIds)) {
    const ids = accountIds.map(String).filter(id => mongoose.Types.ObjectId.isValid(id));
    if (!ids.length) return { written: 0 };
    accountFilter._id = { $in: ids };
  }
  const accounts = await Account.find(accountFilter).select('_id ownerUserId name adAccountId').lean();
  const ownedAccounts = accounts.filter(account => account.ownerUserId);
  if (!ownedAccounts.length) return { written: 0 };

  const accountById = new Map(ownedAccounts.map(account => [String(account._id), account]));
  const affByOwner = await loadAffAccountsByOwner(ownedAccounts.map(account => account.ownerUserId));

  const campaignFilter = { accountId: { $in: ownedAccounts.map(account => account._id) }, date: { $type: 'string' } };
  if (since) campaignFilter.updatedAt = { $gte: since };

  const cursor = Campaign.find(campaignFilter)
    .select('accountId campaignId name date spend clicks impressions updatedAt')
    .lean()
    .cursor({ batchSize: 1000 });

  let ops = [];
  let written = 0;
  const flush = async () => {
    if (!ops.length) return;
    const chunk = ops;
    ops = [];
    await ShopeeAdSpend.bulkWrite(chunk, { ordered: false });
    written += chunk.length;
  };

  for await (const camp of cursor) {
    const account = accountById.get(String(camp.accountId));
    if (!account || !camp.campaignId || !camp.date) continue;
    const subId2 = extractSubId2(camp.name);
    const aff = resolveAffAccount(affByOwner.get(String(account.ownerUserId)) || [], account._id, subId2);
    ops.push({
      updateOne: {
        filter: {
          ownerUserId: account.ownerUserId,
          adAccountId: normalizeAdAccountId(account.adAccountId),
          campaignId: String(camp.campaignId),
          date: camp.date
        },
        update: {
          $set: {
            accountId: account._id,
            accountName: account.name || '',
            shopeeAffAccountId: aff?._id || null,
            shopeeAffAccountName: aff?.name || '',
            campaignName: camp.name || '',
            subId2,
            spend: Number(camp.spend || 0),
            clicks: Number(camp.clicks || 0),
            impressions: Number(camp.impressions || 0),
            sourceUpdatedAt: camp.updatedAt || null,
            syncedAt: new Date()
          }
        },
        upsert: true
      }
    });
    if (ops.length >= BULK_CHUNK) await flush();
  }
  await flush();
  return { written };
}

function runExclusive(task) {
  const next = (running || Promise.resolve()).catch(() => {}).then(task);
  running = next.finally(() => {
    if (running === next) running = null;
  });
  return next;
}

/** Chep cac dong vua cap nhat ke tu lan truoc (lan dau = chep toan bo). */
function syncShopeeAdSpendLedger() {
  return runExclusive(async () => {
    const startedAt = new Date();
    const since = lastIncrementalAt ? new Date(lastIncrementalAt.getTime() - OVERLAP_MS) : null;
    const result = await copyCampaignsToLedger({ since });
    lastIncrementalAt = startedAt;
    if (!since || result.written > 0) {
      console.log(`[shopee-ad-spend] ${since ? 'cap nhat' : 'chep toan bo'}: ${result.written} dong (${Date.now() - startedAt.getTime()}ms)`);
    }
    return result;
  });
}

/** Chep day du cac TK (goi truoc khi xoa TK de khong mat chi phi). */
function snapshotAccountsToLedger(accountIds = []) {
  return runExclusive(() => copyCampaignsToLedger({ accountIds }));
}

/**
 * Gan lai acc Shopee AFF cho MOI dong so cai cua 1 user theo cau hinh acc AFF hien tai.
 * Goi sau khi them / sua / xoa acc AFF (doi ma SubID, chon TKQC...), de trang Shopee Social
 * (tinh chi phi tung acc theo shopeeAffAccountId) luon dung cau hinh moi. Chay ca dong cua TK da xoa.
 */
function reassignAffAccountsForOwner(ownerUserId) {
  return runExclusive(async () => {
    if (!mongoose.Types.ObjectId.isValid(String(ownerUserId || ''))) return { updated: 0 };
    const affAccounts = (await loadAffAccountsByOwner([ownerUserId])).get(String(ownerUserId)) || [];
    const cursor = ShopeeAdSpend.find({ ownerUserId })
      .select('_id accountId subId2 shopeeAffAccountId')
      .lean()
      .cursor({ batchSize: 1000 });

    let ops = [];
    let updated = 0;
    for await (const row of cursor) {
      const aff = resolveAffAccount(affAccounts, row.accountId, row.subId2);
      const nextId = aff?._id ? String(aff._id) : '';
      if (nextId === String(row.shopeeAffAccountId || '')) continue;
      ops.push({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { shopeeAffAccountId: aff?._id || null, shopeeAffAccountName: aff?.name || '' } }
        }
      });
      if (ops.length >= BULK_CHUNK) {
        await ShopeeAdSpend.bulkWrite(ops, { ordered: false });
        updated += ops.length;
        ops = [];
      }
    }
    if (ops.length) {
      await ShopeeAdSpend.bulkWrite(ops, { ordered: false });
      updated += ops.length;
    }
    // Doi ten acc AFF: cap nhat ten luu kem (id khong doi nen vong tren khong bat)
    for (const aff of affAccounts) {
      await ShopeeAdSpend.updateMany(
        { ownerUserId, shopeeAffAccountId: aff._id, shopeeAffAccountName: { $ne: aff.name } },
        { $set: { shopeeAffAccountName: aff.name } }
      );
    }
    if (updated) console.log(`[shopee-ad-spend] gan lai acc Shopee cho ${updated} dong (user ${ownerUserId})`);
    return { updated };
  });
}

async function ensureShopeeAdSpendIndexes() {
  try {
    await ShopeeAdSpend.createIndexes();
  } catch (error) {
    console.warn(`[shopee-ad-spend] tao index loi: ${error.message}`);
  }
}

function startShopeeAdSpendLedger() {
  if (timer) return timer;
  ensureShopeeAdSpendIndexes()
    .then(() => syncShopeeAdSpendLedger())
    .catch(error => console.error(`[shopee-ad-spend] chep toan bo loi: ${error.message}`));
  timer = setInterval(() => {
    if (mongoose.connection.readyState !== 1) return;
    syncShopeeAdSpendLedger().catch(error => console.error(`[shopee-ad-spend] cap nhat loi: ${error.message}`));
  }, SYNC_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function stopShopeeAdSpendLedger() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startShopeeAdSpendLedger,
  stopShopeeAdSpendLedger,
  syncShopeeAdSpendLedger,
  snapshotAccountsToLedger,
  reassignAffAccountsForOwner,
  resolveAffAccount,
  extractSubId2
};
