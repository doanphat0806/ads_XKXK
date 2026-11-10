// Tim ma SKU trong ten camp de dem don.
// Ten camp co the chua nhieu ma (vd "GS0711377 GS0711436 08/11 TEST ...") -> dem don cua tat ca cac ma.

const CODE_TOKEN_RE = /^[A-Z]{1,3}\d{5,}$/;

export const getCampaignSkuCandidates = (campaignName) => {
  const rawName = String(campaignName || '').toUpperCase().trim();
  const compactName = rawName.replace(/\s+/g, '');
  const firstNineChars = rawName.slice(0, 9).replace(/\s+/g, '');
  const firstToken = rawName.split(/\s+/)[0]?.replace(/\s+/g, '') || '';

  return [...new Set([firstNineChars, firstToken, compactName].filter(Boolean))]
    .map(code => `MS${code}`);
};

// Cac ma rieng biet trong ten camp (chi tra ve khi co >= 2 ma, con lai dung logic cu)
export const getCampaignMultiSkuCodes = (campaignName) => {
  const tokens = String(campaignName || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const codes = [...new Set(tokens
    .map(token => (token.startsWith('MS') && CODE_TOKEN_RE.test(token.slice(2)) ? token.slice(2) : token))
    .filter(token => CODE_TOKEN_RE.test(token)))];
  return codes.length >= 2 ? codes : [];
};

const codeKeys = (code) => [`MS${code}`, code];

// Tra ve danh sach key trong `source` khop voi camp: nhieu ma -> moi ma 1 key, 1 ma -> key dau tien khop
export const findCampaignSkuKeys = (campaignName, hasKey) => {
  const multiCodes = getCampaignMultiSkuCodes(campaignName);
  if (multiCodes.length) {
    return multiCodes
      .map(code => codeKeys(code).find(hasKey))
      .filter(Boolean);
  }
  const key = getCampaignSkuCandidates(campaignName).find(hasKey);
  return key ? [key] : [];
};

export const getCampaignOrderCount = (campaignName, skuCounts) => {
  if (!campaignName || !skuCounts) return 0;
  return findCampaignSkuKeys(campaignName, key => Number(skuCounts[key] || 0) > 0)
    .reduce((sum, key) => sum + Number(skuCounts[key] || 0), 0);
};
