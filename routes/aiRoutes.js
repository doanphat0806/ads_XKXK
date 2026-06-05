'use strict';

const express = require('express');
const { requestGeminiGenerateContent, extractGeminiText, extractGeminiError } = require('../lib/geminiApi');
const User = require('../models/User');
const axios = require('axios');
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
 * POST /api/ai/claude
 */
router.post('/claude', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Vui long nhap Claude API Key' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'Thieu noi dung can phan tich' });

    const maxTokens = parseBoundedInt(req.body?.max_tokens, 1500, 1, 1500);
    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages
    };
    const system = String(req.body?.system || '').trim();
    if (system) payload.system = system;

    const response = await axios.post('https://api.anthropic.com/v1/messages', payload, {
      timeout: 30000,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || (error.code === 'ECONNABORTED' ? 504 : 500);
    const anthropicError = error.response?.data?.error?.message || error.response?.data?.error || error.message;
    const anthropicType = error.response?.data?.error?.type || '';
    res.status(status).json({
      error: typeof anthropicError === 'string' ? anthropicError : 'Claude API loi',
      type: anthropicType,
      status
    });
  }
});

module.exports = router;
