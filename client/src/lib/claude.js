import { api } from './api';

export const CLAUDE_API_KEY_STORAGE_KEY = 'claude_api_key';
const CLAUDE_API_KEY_OWNER_STORAGE_KEY = 'claude_api_key_owner';
const CLAUDE_API_KEY_CHANGE_EVENT = 'claude-api-key-change';

function getUserKey(user) {
  return String(user?.id || user?._id || user?.username || '').trim();
}

function getScopedStorageKey(user) {
  const userKey = getUserKey(user);
  return userKey ? `${CLAUDE_API_KEY_STORAGE_KEY}_${userKey}` : '';
}

export function notifyClaudeApiKeyChange() {
  window.dispatchEvent(new Event(CLAUDE_API_KEY_CHANGE_EVENT));
}

export function onClaudeApiKeyChange(handler) {
  window.addEventListener(CLAUDE_API_KEY_CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CLAUDE_API_KEY_CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function activateClaudeApiKeyForUser(user) {
  const scopedStorageKey = getScopedStorageKey(user);
  const userKey = getUserKey(user);
  const scopedKey = scopedStorageKey ? localStorage.getItem(scopedStorageKey) : '';
  const activeKey = localStorage.getItem(CLAUDE_API_KEY_STORAGE_KEY) || '';
  const activeOwner = localStorage.getItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY) || '';

  if (scopedKey) {
    localStorage.setItem(CLAUDE_API_KEY_STORAGE_KEY, scopedKey);
    localStorage.setItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY, userKey);
  } else if (activeKey && (!activeOwner || activeOwner === userKey)) {
    if (scopedStorageKey) localStorage.setItem(scopedStorageKey, activeKey);
    if (userKey) localStorage.setItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY, userKey);
  } else {
    localStorage.removeItem(CLAUDE_API_KEY_STORAGE_KEY);
    localStorage.removeItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY);
  }

  notifyClaudeApiKeyChange();
}

export function clearActiveClaudeApiKey() {
  localStorage.removeItem(CLAUDE_API_KEY_STORAGE_KEY);
  localStorage.removeItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY);
  notifyClaudeApiKeyChange();
}

export function getClaudeApiKey(user) {
  const userKey = getUserKey(user);
  const owner = localStorage.getItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY) || '';
  const activeKey = localStorage.getItem(CLAUDE_API_KEY_STORAGE_KEY) || '';

  if (activeKey && (!owner || !userKey || owner === userKey)) return activeKey;

  const scopedStorageKey = getScopedStorageKey(user);
  return scopedStorageKey ? (localStorage.getItem(scopedStorageKey) || '') : '';
}

export function hasClaudeApiKey(user) {
  return Boolean(getClaudeApiKey(user));
}

export function saveClaudeApiKeyForUser(user, apiKey) {
  const cleanedKey = String(apiKey || '').trim();
  if (!cleanedKey) return false;

  const userKey = getUserKey(user);
  const scopedStorageKey = getScopedStorageKey(user);
  localStorage.setItem(CLAUDE_API_KEY_STORAGE_KEY, cleanedKey);
  if (userKey) localStorage.setItem(CLAUDE_API_KEY_OWNER_STORAGE_KEY, userKey);
  if (scopedStorageKey) localStorage.setItem(scopedStorageKey, cleanedKey);
  notifyClaudeApiKeyChange();
  return true;
}

export async function requestClaudeMessage({ apiKey, system = '', messages = [], maxTokens = 1500, timeoutMs = 30000 }) {
  return api('POST', '/ai/claude', {
    apiKey,
    system,
    messages,
    max_tokens: maxTokens
  }, {
    timeoutMs: timeoutMs + 5000
  });
}
