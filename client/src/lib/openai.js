import { api } from './api';

const OPENAI_API_KEY_CHANGE_EVENT = 'openai-api-key-change';
let cachedOpenaiKeyStatus = false;

export function notifyOpenaiApiKeyChange() {
  window.dispatchEvent(new Event(OPENAI_API_KEY_CHANGE_EVENT));
}

export function onOpenaiApiKeyChange(handler) {
  window.addEventListener(OPENAI_API_KEY_CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(OPENAI_API_KEY_CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function setOpenaiKeyStatus(hasKey) {
  cachedOpenaiKeyStatus = Boolean(hasKey);
  notifyOpenaiApiKeyChange();
}

export function hasOpenaiApiKey() {
  return cachedOpenaiKeyStatus;
}

export async function loadOpenaiApiKeyStatus() {
  const result = await api('GET', '/ai/openai/key-status');
  cachedOpenaiKeyStatus = Boolean(result?.hasOpenaiKey);
  notifyOpenaiApiKeyChange();
  return cachedOpenaiKeyStatus;
}

export async function saveOpenaiApiKey(apiKey) {
  const cleanedKey = String(apiKey || '').trim();
  if (!cleanedKey) return false;

  const result = await api('PUT', '/ai/openai/key', { apiKey: cleanedKey }, { timeoutMs: 35000 });
  cachedOpenaiKeyStatus = Boolean(result?.hasOpenaiKey);
  notifyOpenaiApiKeyChange();
  return cachedOpenaiKeyStatus;
}

export async function removeOpenaiApiKey() {
  const result = await api('DELETE', '/ai/openai/key');
  cachedOpenaiKeyStatus = Boolean(result?.hasOpenaiKey);
  notifyOpenaiApiKeyChange();
  return cachedOpenaiKeyStatus;
}
