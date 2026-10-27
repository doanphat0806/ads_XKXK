'use strict';

// Xu ly ma san pham (thuan, khong phu thuoc DB) dung chung cho auto rule, kho va deal stop.

function normalizeInventoryProductCode(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function extractInventoryProductCode(value) {
  const raw = String(value || '')
    .replace(/["']/g, ' ')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';

  let tokens = raw.split(' ').filter(Boolean);
  if (tokens[0] && String(tokens[0]).toUpperCase() === 'MS' && tokens[1] && /[A-Z]*\d/i.test(tokens[1])) {
    tokens = tokens.slice(1);
  }

  return normalizeInventoryProductCode(tokens[0] || '');
}

// Cac ma SKU co the co trong ten camp/ad (kem ca dang "MS<ma>" va "<ma>")
function getCampaignSkuCandidates(campaignName) {
  const rawName = String(campaignName || '').toUpperCase().trim();
  const compactName = rawName.replace(/\s+/g, '');
  const firstNineChars = rawName.slice(0, 9).replace(/\s+/g, '');
  const firstToken = rawName.split(/\s+/)[0]?.replace(/\s+/g, '') || '';
  const tokenMatches = rawName.match(/[A-Z]{1,3}\d{5,}/g) || [];
  const compactMatches = compactName.match(/[A-Z]{1,3}\d{5,}/g) || [];

  return [...new Set([
    firstNineChars,
    firstToken,
    compactName,
    ...tokenMatches,
    ...compactMatches
  ].filter(Boolean))]
    .flatMap(code => {
      const normalized = String(code).replace(/\s+/g, '');
      if (!normalized) return [];
      if (normalized.startsWith('MS')) {
        return [normalized, normalized.slice(2)].filter(Boolean);
      }
      return [`MS${normalized}`, normalized];
    });
}

module.exports = {
  normalizeInventoryProductCode,
  extractInventoryProductCode,
  getCampaignSkuCandidates
};
