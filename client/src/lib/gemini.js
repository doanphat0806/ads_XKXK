import { api } from './api';

const GEMINI_API_KEY_CHANGE_EVENT = 'gemini-api-key-change';
let cachedGeminiKeyStatus = false;

export function notifyGeminiApiKeyChange() {
  window.dispatchEvent(new Event(GEMINI_API_KEY_CHANGE_EVENT));
}

export function onGeminiApiKeyChange(handler) {
  window.addEventListener(GEMINI_API_KEY_CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(GEMINI_API_KEY_CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function setGeminiKeyStatus(hasKey) {
  cachedGeminiKeyStatus = Boolean(hasKey);
  notifyGeminiApiKeyChange();
}

export function hasGeminiApiKey() {
  return cachedGeminiKeyStatus;
}

export async function loadGeminiApiKeyStatus() {
  const result = await api('GET', '/ai/gemini/key-status');
  cachedGeminiKeyStatus = Boolean(result?.hasGeminiKey);
  notifyGeminiApiKeyChange();
  return cachedGeminiKeyStatus;
}

export async function saveGeminiApiKey(apiKey) {
  const cleanedKey = String(apiKey || '').trim();
  if (!cleanedKey) return false;

  const result = await api('PUT', '/ai/gemini/key', { apiKey: cleanedKey }, { timeoutMs: 35000 });
  cachedGeminiKeyStatus = Boolean(result?.hasGeminiKey);
  notifyGeminiApiKeyChange();
  return cachedGeminiKeyStatus;
}

export async function removeGeminiApiKey() {
  const result = await api('DELETE', '/ai/gemini/key');
  cachedGeminiKeyStatus = Boolean(result?.hasGeminiKey);
  notifyGeminiApiKeyChange();
  return cachedGeminiKeyStatus;
}

export async function requestGeminiMessage({ system = '', messages = [], maxTokens = 1500, timeoutMs = 30000 }) {
  return api('POST', '/ai/gemini', {
    system,
    messages,
    max_tokens: maxTokens
  }, {
    timeoutMs: timeoutMs + 5000
  });
}
