'use strict';

function parseDelimitedRows(text = '', delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function detectCsvDelimiter(text = '') {
  const firstLine = String(text || '').split(/\r?\n/).find(line => line.trim()) || '';
  const counts = [
    { delimiter: ',', count: parseDelimitedRows(firstLine, ',')[0]?.length || 0 },
    { delimiter: ';', count: parseDelimitedRows(firstLine, ';')[0]?.length || 0 },
    { delimiter: '\t', count: parseDelimitedRows(firstLine, '\t')[0]?.length || 0 }
  ];
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function parseCsvRows(text = '') {
  return parseDelimitedRows(text, detectCsvDelimiter(text))
    .filter(row => row.some(cell => String(cell || '').trim()));
}

function normalizeCsvHeader(value = '') {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getCsvColumnIndex(headers = [], candidates = []) {
  const normalizedCandidates = candidates.map(normalizeCsvHeader).filter(Boolean);
  return headers.findIndex(header => {
    const normalizedHeader = normalizeCsvHeader(header);
    return normalizedCandidates.some(candidate =>
      normalizedHeader === candidate ||
      normalizedHeader.startsWith(candidate) ||
      candidate.startsWith(normalizedHeader)
    );
  });
}

function getCsvCell(row = [], indexes = [], fallback = '') {
  for (const index of indexes) {
    if (index < 0) continue;
    const value = row[index];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

function parseCsvNumber(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return 0;
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;

  let normalized = cleaned;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    normalized = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const parts = cleaned.split(',');
    normalized = parts.length === 2 && parts[1].length <= 2
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (hasDot) {
    const parts = cleaned.split('.');
    normalized = parts.length > 1 && parts.slice(1).every(part => part.length === 3)
      ? cleaned.replace(/\./g, '')
      : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsvInteger(value) {
  return Math.round(parseCsvNumber(value));
}

function formatCsvDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCsvCampaignDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoMatch = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) return formatCsvDate(isoMatch[1], isoMatch[2], isoMatch[3]);

  const slashMatch = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    if (first <= 12 && second > 12) return formatCsvDate(slashMatch[3], first, second);
    return formatCsvDate(slashMatch[3], second, first);
  }

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString().split('T')[0];
  return '';
}

module.exports = {
  parseDelimitedRows,
  detectCsvDelimiter,
  parseCsvRows,
  normalizeCsvHeader,
  getCsvColumnIndex,
  getCsvCell,
  parseCsvNumber,
  parseCsvInteger,
  formatCsvDate,
  parseCsvCampaignDate
};
