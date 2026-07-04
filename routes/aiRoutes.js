'use strict';

const express = require('express');
const { requestGeminiGenerateContent, extractGeminiText, extractGeminiError } = require('../lib/geminiApi');
const { requestClaudeMessage, extractClaudeError } = require('../lib/claudeApi');
const { requestOpenAiMessage, extractOpenAiError } = require('../lib/openaiApi');
const User = require('../models/User');
const { parseBoundedInt } = require('../utils/number');

const router = express.Router();

/**
 * GET /api/ai/gemini/key-status
 */
router.get('/gemini/key-status', async (req, res) => {
  res.json({ ok: true, hasGeminiKey: Boolean(req.currentUser?.geminiKey) });
});

/**
 * PUT /api/ai/gemini/key
 */
router.put('/gemini/key', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap Gemini API Key' });

    await requestGeminiGenerateContent({
      apiKey,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
      timeout: 30000
    });

    await User.findByIdAndUpdate(req.currentUser._id, {
      geminiKey: apiKey,
      updatedAt: new Date()
    });

    res.json({ ok: true, hasGeminiKey: true });
  } catch (error) {
    const status = error.response?.status || (error.code === 'ECONNABORTED' ? 504 : 500);
    const geminiError = extractGeminiError(error);
    res.status(status).json({
      error: typeof geminiError === 'string' ? geminiError : 'Gemini API loi',
      type: error.response?.data?.error?.status || '',
      status
    });
  }
});

/**
 * DELETE /api/ai/gemini/key
 */
router.delete('/gemini/key', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.currentUser._id, {
      geminiKey: '',
      updatedAt: new Date()
    });
    res.json({ ok: true, hasGeminiKey: false });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/ai/gemini
 */
router.post('/gemini', async (req, res) => {
  try {
    const apiKey = String(req.currentUser?.geminiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap Gemini API Key' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'Thieu noi dung can phan tich' });

    const response = await requestGeminiGenerateContent({
      apiKey,
      system: req.body?.system,
      messages,
      maxTokens: req.body?.max_tokens,
      timeout: 30000,
      model: req.body?.model,
      responseMimeType: req.body?.response_mime_type
    });
    const text = extractGeminiText(response.data);

    res.json({
      content: text ? [{ type: 'text', text }] : [],
      raw: response.data,
      model: response.model
    });
  } catch (error) {
    const status = error.response?.status || (error.code === 'ECONNABORTED' ? 504 : 500);
    const geminiError = extractGeminiError(error);
    res.status(status).json({
      error: typeof geminiError === 'string' ? geminiError : 'Gemini API loi',
      type: error.response?.data?.error?.status || '',
      status
    });
  }
});

/**
 * GET /api/ai/claude/key-status
 */
router.get('/claude/key-status', async (req, res) => {
  res.json({ ok: true, hasClaudeKey: Boolean(req.currentUser?.claudeKey) });
});

/**
 * PUT /api/ai/claude/key
 */
router.put('/claude/key', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap Claude API Key' });

    await requestClaudeMessage({
      apiKey,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16
    });

    await User.findByIdAndUpdate(req.currentUser._id, {
      claudeKey: apiKey,
      updatedAt: new Date()
    });

    res.json({ ok: true, hasClaudeKey: true });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: extractClaudeError(error),
      type: error.error?.type || '',
      status
    });
  }
});

/**
 * DELETE /api/ai/claude/key
 */
router.delete('/claude/key', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.currentUser._id, {
      claudeKey: '',
      updatedAt: new Date()
    });
    res.json({ ok: true, hasClaudeKey: false });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/ai/claude
 */
router.post('/claude', async (req, res) => {
  try {
    const apiKey = String(req.currentUser?.claudeKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap Claude API Key' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'Thieu noi dung can phan tich' });

    const maxTokens = parseBoundedInt(req.body?.max_tokens, 1500, 1, 1500);
    const system = String(req.body?.system || '').trim();

    const response = await requestClaudeMessage({ apiKey, system, messages, maxTokens });
    res.json(response);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: extractClaudeError(error),
      type: error.error?.type || '',
      status
    });
  }
});

/**
 * GET /api/ai/openai/key-status
 */
router.get('/openai/key-status', async (req, res) => {
  res.json({ ok: true, hasOpenaiKey: Boolean(req.currentUser?.openaiKey) });
});

/**
 * PUT /api/ai/openai/key
 */
router.put('/openai/key', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap ChatGPT API Key' });

    await requestOpenAiMessage({
      apiKey,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16
    });

    await User.findByIdAndUpdate(req.currentUser._id, {
      openaiKey: apiKey,
      updatedAt: new Date()
    });

    res.json({ ok: true, hasOpenaiKey: true });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: extractOpenAiError(error),
      type: error.error?.type || '',
      status
    });
  }
});

/**
 * DELETE /api/ai/openai/key
 */
router.delete('/openai/key', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.currentUser._id, {
      openaiKey: '',
      updatedAt: new Date()
    });
    res.json({ ok: true, hasOpenaiKey: false });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/ai/openai
 */
router.post('/openai', async (req, res) => {
  try {
    const apiKey = String(req.currentUser?.openaiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap ChatGPT API Key' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'Thieu noi dung can phan tich' });

    const maxTokens = parseBoundedInt(req.body?.max_tokens, 1500, 1, 1500);
    const system = String(req.body?.system || '').trim();

    const response = await requestOpenAiMessage({ apiKey, system, messages, maxTokens });
    res.json(response);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: extractOpenAiError(error),
      type: error.error?.type || '',
      status
    });
  }
});

module.exports = router;
