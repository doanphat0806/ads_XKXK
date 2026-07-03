export function parseSubId2Codes(text) {
  return String(text || '').split(',')
    .map(part => part.trim().toUpperCase().replace(/[^A-Z]/g, ''))
    .filter(Boolean);
}
