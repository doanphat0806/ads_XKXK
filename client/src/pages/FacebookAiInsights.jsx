import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { todayString } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { hasGeminiApiKey, loadGeminiApiKeyStatus, onGeminiApiKeyChange, removeGeminiApiKey, saveGeminiApiKey } from '../lib/gemini';
import { hasClaudeApiKey, loadClaudeApiKeyStatus, onClaudeApiKeyChange, removeClaudeApiKey, saveClaudeApiKey } from '../lib/claude';
import { hasOpenaiApiKey, loadOpenaiApiKeyStatus, onOpenaiApiKeyChange, removeOpenaiApiKey, saveOpenaiApiKey } from '../lib/openai';
import { requestFacebookAiReport } from '../lib/facebookAi';

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

function getAiErrorMessage(error) {
  if (error?.status === 401) return 'API Key không hợp lệ, vui lòng kiểm tra lại';
  if (error?.status === 429) return 'Đã vượt rate limit, thử lại sau 60 giây';
  if (error?.status === 504 || /timeout|request qua lau|quá lâu|chậm/i.test(String(error?.message || ''))) {
    return 'AI phản hồi chậm, thử lại';
  }
  return error?.message ? `Lỗi AI: ${error.message}` : 'Lỗi AI không xác định';
}

export default function FacebookAiInsights() {
  const [provider, setProvider] = useState('gemini');
  const [keyStatus, setKeyStatus] = useState({ gemini: hasGeminiApiKey(), claude: hasClaudeApiKey(), openai: hasOpenaiApiKey() });
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(() => todayString());
  const [report, setReport] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    const unsubscribes = PROVIDER_ORDER.map(key => PROVIDERS[key].onKeyChange(
      () => setKeyStatus(current => ({ ...current, [key]: PROVIDERS[key].hasKey() }))
    ));
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  }, []);

  useEffect(() => {
    Promise.all(PROVIDER_ORDER.map(key => PROVIDERS[key].loadKeyStatus()
      .then(hasKey => ({ key, hasKey }))
      .catch(error => {
        console.warn(`Failed to load ${key} key status`, error);
        return { key, hasKey: false };
      })))
      .then(results => {
        const nextStatus = {};
        results.forEach(({ key, hasKey }) => { nextStatus[key] = hasKey; });
        setKeyStatus(current => ({ ...current, ...nextStatus }));
        const readyProvider = results.find(({ hasKey }) => hasKey);
        if (readyProvider) setProvider(readyProvider.key);
      });
  }, []);

  const activeProvider = PROVIDERS[provider];
  const providerReady = keyStatus[provider];

  const switchProvider = (nextProvider) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider);
    setKeyInput('');
    setReport('');
    setReportError('');
  };

  const saveKey = async () => {
    if (!keyInput.trim()) {
      toast.error(`Vui lòng nhập ${activeProvider.label} API Key`);
      return;
    }
    setSavingKey(true);
    try {
      await activeProvider.saveKey(keyInput);
      setKeyInput('');
      toast.success(`${activeProvider.label} API Key hợp lệ và đã lưu vào database`);
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

  const generateReport = async () => {
    setReportLoading(true);
    setReportError('');
    try {
      const response = await requestFacebookAiReport({ from: fromDate, to: toDate, provider });
      setReport(extractAiText(response) || 'AI chưa có phản hồi.');
    } catch (error) {
      console.error('Facebook AI report error:', error);
      setReportError(getAiErrorMessage(error));
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div id="page-facebook-ai-insights">
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">AI Insights — Dữ liệu Facebook</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onChange={(nextFrom, nextTo) => {
                setFromDate(nextFrom);
                setToDate(nextTo);
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={generateReport} disabled={reportLoading || !providerReady}>
              {reportLoading ? 'Đang tạo báo cáo...' : 'Tạo báo cáo AI'}
            </button>
          </div>
        </div>

        <div className="tabs">
          {PROVIDER_ORDER.map(key => (
            <button
              type="button"
              key={key}
              className={`tab ${provider === key ? 'active' : ''}`}
              onClick={() => switchProvider(key)}
            >
              {PROVIDERS[key].label}{keyStatus[key] ? ' ✓' : ''}
            </button>
          ))}
        </div>

        {!providerReady && (
          <div className="fbai-key-row">
            <input
              type="password"
              placeholder={`${activeProvider.label} API Key...`}
              value={keyInput}
              onChange={event => setKeyInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') saveKey();
              }}
              aria-label={`${activeProvider.label} API Key`}
            />
            <button className="btn btn-ghost btn-sm" onClick={saveKey} disabled={savingKey}>
              {savingKey ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        )}

        {providerReady && (
          <div className="fbai-key-row">
            <span className="ai-ready-badge">🤖 {activeProvider.label} sẵn sàng</span>
            <button className="btn btn-ghost btn-sm" onClick={removeKey}>Xóa key</button>
          </div>
        )}
      </div>

      <div className="card fbai-report-card">
        <div className="card-header">
          <div className="card-title">Báo cáo AI</div>
        </div>
        {!providerReady && !report && (
          <div className="empty"><div className="ei">🔑</div><p>Nhập {activeProvider.label} API Key để bắt đầu</p></div>
        )}
        {providerReady && !report && !reportLoading && !reportError && (
          <div className="empty"><div className="ei">📊</div><p>Nhấn "Tạo báo cáo AI" để xem phân tích</p></div>
        )}
        {reportLoading && <div className="fbai-loading">AI đang phân tích dữ liệu...</div>}
        {reportError && (
          <div className="fbai-error">
            <span>{reportError}</span>
            <button className="btn btn-ghost btn-sm" onClick={generateReport}>Thử lại</button>
          </div>
        )}
        {report && !reportLoading && <div className="fbai-report-text">{report}</div>}
      </div>

      <div className="card">
        <div className="empty"><div className="ei">💬</div><p>Chat AI đã chuyển thành bong bóng chat ở góc màn hình — bấm vào icon 💬 để trò chuyện</p></div>
      </div>
    </div>
  );
}
