import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { todayString } from '../lib/api';
import { hasGeminiApiKey, loadGeminiApiKeyStatus, onGeminiApiKeyChange, removeGeminiApiKey, saveGeminiApiKey } from '../lib/gemini';
import { hasClaudeApiKey, loadClaudeApiKeyStatus, onClaudeApiKeyChange, removeClaudeApiKey, saveClaudeApiKey } from '../lib/claude';
import { hasOpenaiApiKey, loadOpenaiApiKeyStatus, onOpenaiApiKeyChange, removeOpenaiApiKey, saveOpenaiApiKey } from '../lib/openai';
import { requestFacebookAiChat, loadFacebookAiChatHistory, clearFacebookAiChatHistory } from '../lib/facebookAi';

const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    hasKey: hasGeminiApiKey,
    onKeyChange: onGeminiApiKeyChange,
    loadKeyStatus: loadGeminiApiKeyStatus,
    saveKey: saveGeminiApiKey,
    removeKey: removeGeminiApiKey
  },
  claude: {
    label: 'Claude',
    hasKey: hasClaudeApiKey,
    onKeyChange: onClaudeApiKeyChange,
    loadKeyStatus: loadClaudeApiKeyStatus,
    saveKey: saveClaudeApiKey,
    removeKey: removeClaudeApiKey
  },
  openai: {
    label: 'ChatGPT',
    hasKey: hasOpenaiApiKey,
    onKeyChange: onOpenaiApiKeyChange,
    loadKeyStatus: loadOpenaiApiKeyStatus,
    saveKey: saveOpenaiApiKey,
    removeKey: removeOpenaiApiKey
  }
};

const PROVIDER_ORDER = ['gemini', 'claude', 'openai'];

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractAiText(response) {
  const content = Array.isArray(response?.content) ? response.content : [];
  return content
    .map(item => (typeof item?.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function detectProviderFromKey(key) {
  const trimmed = String(key || '').trim();
  if (/^sk-ant-/i.test(trimmed)) return 'claude';
  if (/^AIza/.test(trimmed)) return 'gemini';
  if (/^sk-/.test(trimmed)) return 'openai';
  return null;
}

function getAiErrorMessage(error) {
  if (error?.status === 401) return 'API Key không hợp lệ, vui lòng kiểm tra lại';
  if (error?.status === 429) return 'Đã vượt rate limit, thử lại sau 60 giây';
  if (error?.status === 504 || /timeout|request qua lau|quá lâu|chậm/i.test(String(error?.message || ''))) {
    return 'AI phản hồi chậm, thử lại';
  }
  return error?.message ? `Lỗi AI: ${error.message}` : 'Lỗi AI không xác định';
}

export default function FacebookAiChatWidget() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('gemini');
  const [keyStatus, setKeyStatus] = useState({ gemini: hasGeminiApiKey(), claude: hasClaudeApiKey(), openai: hasOpenaiApiKey() });
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const unsubscribes = PROVIDER_ORDER.map(key => PROVIDERS[key].onKeyChange(
      () => setKeyStatus(current => ({ ...current, [key]: PROVIDERS[key].hasKey() }))
    ));
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  }, []);

  useEffect(() => {
    Promise.all(PROVIDER_ORDER.map(key => PROVIDERS[key].loadKeyStatus()
      .then(hasKey => ({ key, hasKey }))
      .catch(() => ({ key, hasKey: false }))))
      .then(results => {
        const nextStatus = {};
        results.forEach(({ key, hasKey }) => { nextStatus[key] = hasKey; });
        setKeyStatus(current => ({ ...current, ...nextStatus }));
        const readyProvider = results.find(({ hasKey }) => hasKey);
        if (readyProvider) setProvider(readyProvider.key);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setChatError('');
    loadFacebookAiChatHistory(provider)
      .then(messages => {
        if (!cancelled) setChatMessages(messages.map(m => ({ role: m.role, content: m.content })));
      })
      .catch(() => {
        if (!cancelled) setChatMessages([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [provider]);

  const activeProvider = PROVIDERS[provider];
  const providerReady = keyStatus[provider];

  const switchProvider = (nextProvider) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider);
    setKeyInput('');
    setChatError('');
  };

  const saveKey = async () => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      toast.error('Vui lòng nhập API Key');
      return;
    }
    const detected = detectProviderFromKey(trimmedKey);
    if (!detected) {
      toast.error('Không nhận dạng được API Key này thuộc Gemini, Claude hay ChatGPT');
      return;
    }
    setSavingKey(true);
    try {
      await PROVIDERS[detected].saveKey(trimmedKey);
      setKeyInput('');
      setProvider(detected);
      toast.success(`Đã nhận dạng ${PROVIDERS[detected].label} API Key và lưu vào database`);
    } catch (error) {
      toast.error(getAiErrorMessage(error));
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async () => {
    if (!window.confirm(`Bạn chắc chắn muốn xóa ${activeProvider.label} API Key của tài khoản này?`)) return;
    try {
      await activeProvider.removeKey();
      toast.success(`Đã xóa ${activeProvider.label} API Key khỏi database`);
    } catch (error) {
      toast.error(`Xóa ${activeProvider.label} key lỗi: ${error.message}`);
    }
  };

  const clearChatHistory = async () => {
    if (!window.confirm(`Xóa toàn bộ lịch sử chat với ${activeProvider.label}?`)) return;
    try {
      await clearFacebookAiChatHistory(provider);
      setChatMessages([]);
      toast.success('Đã xóa lịch sử chat');
    } catch (error) {
      toast.error(`Xóa lịch sử lỗi: ${error.message}`);
    }
  };

  const runChat = async (message, displayMessages) => {
    setChatLoading(true);
    setChatError('');
    try {
      const response = await requestFacebookAiChat({ message, from: defaultFromDate(), to: todayString(), provider });
      const answer = extractAiText(response) || 'AI chưa có phản hồi.';
      setChatMessages([...displayMessages, { role: 'assistant', content: answer }]);
    } catch (error) {
      setChatError(getAiErrorMessage(error));
    } finally {
      setChatLoading(false);
    }
  };

  const sendChatMessage = (event) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content || chatLoading) return;
    const nextDisplayMessages = [...chatMessages, { role: 'user', content }];
    setChatInput('');
    setChatMessages(nextDisplayMessages);
    runChat(content, nextDisplayMessages);
  };

  return (
    <div className="fbai-widget">
      {open && (
        <div className="fbai-widget-panel">
          <div className="fbai-widget-header">
            <div className="fbai-widget-tabs">
              {PROVIDER_ORDER.map(key => (
                <button
                  type="button"
                  key={key}
                  className={`fbai-widget-tab ${provider === key ? 'active' : ''}`}
                  onClick={() => switchProvider(key)}
                >
                  {PROVIDERS[key].label}{keyStatus[key] ? ' ✓' : ''}
                </button>
              ))}
            </div>
            <button type="button" className="fbai-widget-close" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
          </div>

          {!providerReady ? (
            <div className="fbai-key-row">
              <input
                type="password"
                placeholder="Dán API Key (Gemini / Claude / ChatGPT)..."
                value={keyInput}
                onChange={event => setKeyInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') saveKey();
                }}
                aria-label="API Key"
              />
              <button className="btn btn-ghost btn-sm" onClick={saveKey} disabled={savingKey}>
                {savingKey ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          ) : (
            <>
              <div className="fbai-widget-key-row">
                <span className="ai-ready-badge">🤖 {activeProvider.label} sẵn sàng</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {chatMessages.length > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={clearChatHistory}>Xóa lịch sử</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={removeKey}>Xóa key</button>
                </div>
              </div>

              <div className="fbai-chat-messages fbai-widget-messages">
                {historyLoading && chatMessages.length === 0 && (
                  <div className="empty"><div className="ei">⏳</div><p>Đang tải lịch sử chat...</p></div>
                )}
                {!historyLoading && chatMessages.length === 0 && !chatLoading && (
                  <div className="empty"><div className="ei">💬</div><p>Hỏi về chi tiêu, chiến dịch hoặc bài đăng Facebook 7 ngày gần đây</p></div>
                )}
                {chatMessages.map((message, index) => (
                  <div className={`fbai-chat-message ${message.role}`} key={`${message.role}-${index}`}>
                    {message.content}
                  </div>
                ))}
                {chatLoading && <div className="fbai-chat-message assistant loading">AI đang phân tích...</div>}
                {chatError && (
                  <div className="fbai-error compact">
                    <span>{chatError}</span>
                  </div>
                )}
              </div>

              <form className="fbai-chat-input-row" onSubmit={sendChatMessage}>
                <input
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  placeholder="Hỏi về dữ liệu Facebook..."
                  disabled={chatLoading}
                />
                <button className="btn btn-primary btn-sm" type="submit" disabled={chatLoading || !chatInput.trim()}>
                  Gửi
                </button>
              </form>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="fbai-widget-bubble"
        onClick={() => setOpen(current => !current)}
        aria-label="AI Chat"
      >
        {open ? '×' : '💬'}
      </button>
    </div>
  );
}
