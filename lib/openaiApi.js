'use strict';

const OpenAI = require('openai');

const OPENAI_MODEL = 'gpt-5.5';

async function requestOpenAiMessage({ apiKey, system, messages = [], maxTokens = 1500 }) {
  const client = new OpenAI({ apiKey });
  const chatMessages = [];
  if (system) chatMessages.push({ role: 'developer', content: system });
  chatMessages.push(...messages.map(message => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: message?.content
  })));

  return client.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: maxTokens,
    messages: chatMessages
  });
}

function extractOpenAiError(error) {
  return error?.error?.message || error?.message || 'OpenAI API loi';
}

module.exports = { OPENAI_MODEL, requestOpenAiMessage, extractOpenAiError };
