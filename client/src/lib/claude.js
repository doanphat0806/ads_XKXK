import { api } from './api';

const CLAUDE_API_KEY_CHANGE_EVENT = 'claude-api-key-change';
let cachedClaudeKeyStatus = false;

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

export function setClaudeKeyStatus(hasKey) {
  cachedClaudeKeyStatus = Boolean(hasKey);
  notifyClaudeApiKeyChange();
}

export function hasClaudeApiKey() {
  return cachedClaudeKeyStatus;
}

export async function loadClaudeApiKeyStatus() {
  const result = await api('GET', '/ai/claude/key-status');
  cachedClaudeKeyStatus = Boolean(result?.hasClaudeKey);
  notifyClaudeApiKeyChange();
  return cachedClaudeKeyStatus;
}

export async function saveClaudeApiKey(apiKey) {
  const cleanedKey = String(apiKey || '').trim();
  if (!cleanedKey) return false;

  const result = await api('PUT', '/ai/claude/key', { apiKey: cleanedKey }, { timeoutMs: 35000 });
  cachedClaudeKeyStatus = Boolean(result?.hasClaudeKey);
  notifyClaudeApiKeyChange();
  return cachedClaudeKeyStatus;
}

export async function removeClaudeApiKey() {
  const result = await api('DELETE', '/ai/claude/key');
  cachedClaudeKeyStatus = Boolean(result?.hasClaudeKey);
  notifyClaudeApiKeyChange();
  return cachedClaudeKeyStatus;
}
