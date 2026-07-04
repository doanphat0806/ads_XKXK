'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const CLAUDE_MODEL = 'claude-opus-4-8';

async function requestClaudeMessage({ apiKey, system, messages, maxTokens = 1500 }) {
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    ...(system ? { system } : {}),
    messages
  });
  return stream.finalMessage();
}

function extractClaudeError(error) {
  return error?.error?.message || error?.message || 'Claude API loi';
}

module.exports = { CLAUDE_MODEL, requestClaudeMessage, extractClaudeError };
