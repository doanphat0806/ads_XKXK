'use strict';

const axios = require('axios');
const { parseBoundedInt } = require('../utils/number');

/**
 * Convert message content sang Gemini parts.
 * @param {string|Array} content
 * @returns {Array<{text: string}>}
 */
function toGeminiTextParts(content) {
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item;
        return typeof item?.text === 'string' ? item.text : '';
      })
      .filter(Boolean)
      .map(text => ({ text }));
  }

  const text = String(content || '').trim();
  return text ? [{ text }] : [];
}

/**
 * Convert messages array sang Gemini contents format.
 * @param {Array} messages
 * @returns {Array}
 */
function toGeminiContents(messages = []) {
  return messages
    .map(message => {
      const role = message?.role === 'assistant' ? 'model' : 'user';
      const parts = toGeminiTextParts(message?.content);
      return parts.length ? { role, parts } : null;
    })
    .filter(Boolean);
}

/**
 * Extract error message từ Gemini error response.
 * @param {Error} error
 * @returns {string|object}
 */
function extractGeminiError(error) {
  const data = error.response?.data;
  return data?.error?.message || data?.error || error.message;
}

/**
 * Extract text từ Gemini response.
 * @param {object} data
 * @returns {string}
 */
function extractGeminiText(data = {}) {
  return (data?.candidates || [])
    .flatMap(candidate => candidate?.content?.parts || [])
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Gọi Gemini generateContent API.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.system]
 * @param {Array} options.messages
 * @param {number} [options.maxTokens]
 * @param {number} [options.timeout]
 * @param {string} [options.model]
 * @param {string} [options.responseMimeType]
 * @returns {Promise<{data: object, model: string}>}
 */
async function requestGeminiGenerateContent({
  apiKey,
  system = '',
  messages = [],
  maxTokens = 1500,
  timeout = 30000,
  model = '',
  responseMimeType = ''
}) {
  const contents = toGeminiContents(messages);
  if (!contents.length) throw new Error('Noi dung AI khong hop le');

  const mimeType = String(responseMimeType || '').trim();
  const payload = {
    contents,
    generationConfig: {
      maxOutputTokens: parseBoundedInt(maxTokens, 1500, 1, 1500),
      temperature: mimeType === 'application/json' ? 0 : 0.2
    }
  };
  if (mimeType) payload.generationConfig.responseMimeType = mimeType;
  const systemText = String(system || '').trim();
  if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };

  const activeModel = String(model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent`,
    payload,
    {
      timeout,
      params: { key: apiKey },
      headers: { 'content-type': 'application/json' }
    }
  );

  return { data: response.data, model: activeModel };
}

module.exports = {
  toGeminiTextParts,
  toGeminiContents,
  extractGeminiError,
  extractGeminiText,
  requestGeminiGenerateContent
};
