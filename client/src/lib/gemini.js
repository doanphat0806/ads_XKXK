import { api } from './api';

export const GEMINI_API_KEY_STORAGE_KEY = 'gemini_api_key';
const GEMINI_API_KEY_OWNER_STORAGE_KEY = 'gemini_api_key_owner';
const GEMINI_API_KEY_CHANGE_EVENT = 'gemini-api-key-change';

function getUserKey(user) {
  return String(user?.id || user?._id || user?.username || '').trim();
}

function getScopedStorageKey(user) {
  const userKey = getUserKey(user);
  return userKey ? `${GEMINI_API_KEY_STORAGE_KEY}_${userKey}` : '';
}

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

export function activateGeminiApiKeyForUser(user) {
  const scopedStorageKey = getScopedStorageKey(user);
  const userKey = getUserKey(user);
  const scopedKey = scopedStorageKey ? localStorage.getItem(scopedStorageKey) : '';
  const activeKey = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || '';
  const activeOwner = localStorage.getItem(GEMINI_API_KEY_OWNER_STORAGE_KEY) || '';

  if (scopedKey) {
    localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, scopedKey);
    localStorage.setItem(GEMINI_API_KEY_OWNER_STORAGE_KEY, userKey);
  } else if (activeKey && (!activeOwner || activeOwner === userKey)) {
    if (scopedStorageKey) localStorage.setItem(scopedStorageKey, activeKey);
    if (userKey) localStorage.setItem(GEMINI_API_KEY_OWNER_STORAGE_KEY, userKey);
  } else {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    localStorage.removeItem(GEMINI_API_KEY_OWNER_STORAGE_KEY);
  }

  notifyGeminiApiKeyChange();
}

export function clearActiveGeminiApiKey() {
  localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  localStorage.removeItem(GEMINI_API_KEY_OWNER_STORAGE_KEY);
  notifyGeminiApiKeyChange();
}

export function getGeminiApiKey(user) {
  const userKey = getUserKey(user);
  const owner = localStorage.getItem(GEMINI_API_KEY_OWNER_STORAGE_KEY) || '';
  const activeKey = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || '';

  if (activeKey && (!owner || !userKey || owner === userKey)) return activeKey;

  const scopedStorageKey = getScopedStorageKey(user);
  return scopedStorageKey ? (localStorage.getItem(scopedStorageKey) || '') : '';
}

export function hasGeminiApiKey(user) {
  return Boolean(getGeminiApiKey(user));
}

export function saveGeminiApiKeyForUser(user, apiKey) {
  const cleanedKey = String(apiKey || '').trim();
  if (!cleanedKey) return false;

  const userKey = getUserKey(user);
  const scopedStorageKey = getScopedStorageKey(user);
  localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, cleanedKey);
  if (userKey) localStorage.setItem(GEMINI_API_KEY_OWNER_STORAGE_KEY, userKey);
  if (scopedStorageKey) localStorage.setItem(scopedStorageKey, cleanedKey);
  notifyGeminiApiKeyChange();
  return true;
}

export function removeGeminiApiKeyForUser(user) {
  const scopedStorageKey = getScopedStorageKey(user);
  if (scopedStorageKey) localStorage.removeItem(scopedStorageKey);
  localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  localStorage.removeItem(GEMINI_API_KEY_OWNER_STORAGE_KEY);
  notifyGeminiApiKeyChange();
}

export async function requestGeminiMessage({ apiKey, system = '', messages = [], maxTokens = 1500, timeoutMs = 30000 }) {
  return api('POST', '/ai/gemini', {
    apiKey,
    system,
    messages,
    max_tokens: maxTokens
  }, {
    timeoutMs: timeoutMs + 5000
  });
}

export async function testGeminiApiKey(apiKey, timeoutMs = 30000) {
  return requestGeminiMessage({
    apiKey,
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 16,
    timeoutMs
  });
}
