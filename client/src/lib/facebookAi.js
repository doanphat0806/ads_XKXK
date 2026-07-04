import { api } from './api';

export async function requestFacebookAiChat({ message, from, to, provider = 'gemini', timeoutMs = 45000 }) {
  return api('POST', '/ai/facebook/chat', { message, from, to, provider }, { timeoutMs: timeoutMs + 5000 });
}

export async function requestFacebookAiReport({ from, to, provider = 'gemini', timeoutMs = 45000 }) {
  return api('POST', '/ai/facebook/report', { from, to, provider }, { timeoutMs: timeoutMs + 5000 });
}

export async function loadFacebookAiChatHistory(provider = 'gemini') {
  const result = await api('GET', `/ai/facebook/chat/history?provider=${encodeURIComponent(provider)}`);
  return Array.isArray(result?.messages) ? result.messages : [];
}

export async function clearFacebookAiChatHistory(provider = 'gemini') {
  return api('DELETE', `/ai/facebook/chat/history?provider=${encodeURIComponent(provider)}`);
}
