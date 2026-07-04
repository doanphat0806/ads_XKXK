'use strict';

const express = require('express');
const { requestGeminiGenerateContent, extractGeminiText, extractGeminiError } = require('../lib/geminiApi');
const { requestClaudeMessage, extractClaudeError } = require('../lib/claudeApi');
const { requestOpenAiMessage, extractOpenAiError } = require('../lib/openaiApi');
const { buildFacebookContext, buildFacebookSystemPrompt } = require('../services/facebookAiContextService');
const { normalizeCampaignDate, todayStr } = require('../lib/normalizers');
const FacebookAiChatMessage = require('../models/FacebookAiChatMessage');

const router = express.Router();

const MAX_HISTORY_MESSAGES = 40;

const PROVIDERS = {
  gemini: {
    keyField: 'geminiKey',
    label: 'Gemini',
    async call({ apiKey, system, messages }) {
      const response = await requestGeminiGenerateContent({ apiKey, system, messages });
      return { text: extractGeminiText(response.data), model: response.model };
    },
    extractError: extractGeminiError,
    getStatus: error => error.response?.status || (error.code === 'ECONNABORTED' ? 504 : 500),
    getType: error => error.response?.data?.error?.status || ''
  },
  claude: {
    keyField: 'claudeKey',
    label: 'Claude',
    async call({ apiKey, system, messages }) {
      const response = await requestClaudeMessage({ apiKey, system, messages });
      const text = (response.content || [])
        .map(item => (typeof item?.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      return { text, model: response.model };
    },
    extractError: extractClaudeError,
    getStatus: error => error.status || 500,
    getType: error => error.error?.type || ''
  },
  openai: {
    keyField: 'openaiKey',
    label: 'ChatGPT',
    async call({ apiKey, system, messages }) {
      const response = await requestOpenAiMessage({ apiKey, system, messages });
      const text = response.choices?.[0]?.message?.content || '';
      return { text, model: response.model };
    },
    extractError: extractOpenAiError,
    getStatus: error => error.status || 500,
    getType: error => error.error?.type || ''
  }
};

function resolveProvider(body) {
  const key = String(body?.provider || '').trim().toLowerCase();
  return PROVIDERS[key] ? key : 'gemini';
}

function resolveRange(body) {
  const today = todayStr();
  const to = normalizeCampaignDate(body?.to) || today;
  const from = normalizeCampaignDate(body?.from) || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * GET /api/ai/facebook/chat/history
 */
router.get('/chat/history', async (req, res) => {
  const providerKey = resolveProvider(req.query);
  const history = await FacebookAiChatMessage.find({ ownerUserId: req.currentUser._id, provider: providerKey })
    .sort({ createdAt: 1 })
    .select('role content createdAt')
    .lean();
  res.json({ ok: true, provider: providerKey, messages: history });
});

/**
 * DELETE /api/ai/facebook/chat/history
 */
router.delete('/chat/history', async (req, res) => {
  const providerKey = resolveProvider(req.query);
  await FacebookAiChatMessage.deleteMany({ ownerUserId: req.currentUser._id, provider: providerKey });
  res.json({ ok: true, provider: providerKey });
});

/**
 * POST /api/ai/facebook/chat
 */
router.post('/chat', async (req, res) => {
  const providerKey = resolveProvider(req.body);
  const provider = PROVIDERS[providerKey];
  try {
    const apiKey = String(req.currentUser?.[provider.keyField] || '').trim();
    if (!apiKey) return res.status(400).json({ error: `Vui long nhap ${provider.label} API Key` });

    const userMessage = String(req.body?.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'Thieu noi dung chat' });

    const { from, to } = resolveRange(req.body);
    const context = await buildFacebookContext({ req, from, to });
    const system = buildFacebookSystemPrompt(context, 'chat');

    const history = await FacebookAiChatMessage.find({ ownerUserId: req.currentUser._id, provider: providerKey })
      .sort({ createdAt: -1 })
      .limit(MAX_HISTORY_MESSAGES)
      .select('role content')
      .lean();
    history.reverse();

    const messages = [...history.map(item => ({ role: item.role, content: item.content })), { role: 'user', content: userMessage }];

    const { text, model } = await provider.call({ apiKey, system, messages });

    await FacebookAiChatMessage.insertMany([
      { ownerUserId: req.currentUser._id, provider: providerKey, role: 'user', content: userMessage },
      { ownerUserId: req.currentUser._id, provider: providerKey, role: 'assistant', content: text }
    ]);

    res.json({ content: text ? [{ type: 'text', text }] : [], provider: providerKey, model });
  } catch (error) {
    const status = provider.getStatus(error);
    res.status(status).json({
      error: provider.extractError(error),
      type: provider.getType(error),
      status
    });
  }
});

/**
 * POST /api/ai/facebook/report
 */
router.post('/report', async (req, res) => {
  const providerKey = resolveProvider(req.body);
  const provider = PROVIDERS[providerKey];
  try {
    const apiKey = String(req.currentUser?.[provider.keyField] || '').trim();
    if (!apiKey) return res.status(400).json({ error: `Vui long nhap ${provider.label} API Key` });

    const { from, to } = resolveRange(req.body);
    const context = await buildFacebookContext({ req, from, to });
    const system = buildFacebookSystemPrompt(context, 'report');

    const { text, model } = await provider.call({
      apiKey,
      system,
      messages: [{ role: 'user', content: 'Hay tao bao cao theo huong dan tren.' }]
    });
    res.json({ content: text ? [{ type: 'text', text }] : [], provider: providerKey, model });
  } catch (error) {
    const status = provider.getStatus(error);
    res.status(status).json({
      error: provider.extractError(error),
      type: provider.getType(error),
      status
    });
  }
});

module.exports = router;
