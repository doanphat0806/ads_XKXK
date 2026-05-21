import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, formatVND, todayString, uploadForm } from '../lib/api';
import DateRangePicker from '../components/DateRangePicker';
import { useAppContext } from '../contexts/AppContext';
import { getClaudeApiKey, removeClaudeApiKeyForUser, requestClaudeMessage } from '../lib/claude';

const DEFAULT_FROM_DATE = '2026-04-27';
const EMPTY_ARRAY = [];
const ROI_BADGE_CLASS = {
  high: 'active',
  medium: 'warning',
  low: 'paused'
};
const EVALUATION_BADGE_CLASS = {
  'TẮT': 'paused',
  'CẢNH BÁO': 'warning',
  'TEST THÊM': 'neutral',
  'GIỮ': 'active',
  'SCALE NHẸ': 'active',
  'SCALE MẠNH': 'active'
};

function getRoiBadgeClass(roi) {
  const value = Number(roi || 0);
  if (value >= 80) return ROI_BADGE_CLASS.high;
  if (value >= 50) return ROI_BADGE_CLASS.medium;
  return ROI_BADGE_CLASS.low;
}

function getEvaluationBadgeClass(label = '') {
  return EVALUATION_BADGE_CLASS[label] || 'neutral';
}

function formatCompactVND(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000000000) return `${formatNumber(number / 1000000000)} tỷ`;
  if (Math.abs(number) >= 1000000) return `${formatNumber(number / 1000000)}tr`;
  return formatVND(number);
}

function buildBudgetPlan(rows = [], totalSpend = 0) {
  const eligibleRows = rows
    .filter(row => Number(row.roi || 0) > 0 && Number(row.hoa_hong || 0) > 0)
    .sort((a, b) => Number(b.roi || 0) - Number(a.roi || 0));

  const budgetPool = Number(totalSpend || 0);
  const totalRoiWeight = eligibleRows.reduce((sum, row) => sum + Math.max(0, Number(row.roi || 0)), 0);
  if (!eligibleRows.length || totalRoiWeight <= 0 || budgetPool <= 0) return [];

  return eligibleRows.slice(0, 12).map(row => {
    const roiWeight = Math.max(0, Number(row.roi || 0));
    const suggestedBudget = budgetPool * (roiWeight / totalRoiWeight);
    const estimatedCommission = suggestedBudget * (1 + (Number(row.roi || 0) / 100));
    return {
      sub_id2: row.sub_id2,
      ns_de_xuat: suggestedBudget,
      hh_du_kien: estimatedCommission,
      roi: Number(row.roi || 0)
    };
  });
}

function buildRowsPayload(rows = []) {
  return rows.map(row => ({
    sub_id2: row.sub_id2,
    hoa_hong: Number(row.hoa_hong || 0),
    hh_tb: Number(row.hh_tb || 0),
    chi_phi_pb: Number(row.chi_phi_pb || 0),
    clicks: Number(row.clicks || 0),
    cpc: Number(row.cpc || 0),
    so_camp: Number(row.so_camp || 0),
    roi: Number(row.roi || 0),
    danh_gia: row.danh_gia || ''
  }));
}

function extractClaudeText(response) {
  const content = Array.isArray(response?.content) ? response.content : [];
  return content
    .map(item => (typeof item?.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseClaudeJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI trả về dữ liệu không phải JSON');
    return JSON.parse(jsonMatch[0]);
  }
}

function normalizeAiList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? [text] : [];
}

function normalizeAiAnalysis(data = {}) {
  return {
    tom_tat: String(data.tom_tat || '').trim(),
    top_scale: normalizeAiList(data.top_scale),
    can_dung: normalizeAiList(data.can_dung),
    canh_bao: normalizeAiList(data.canh_bao),
    khuyen_nghi: String(data.khuyen_nghi || '').trim()
  };
}

function normalizeAiBudget(data = {}) {
  return {
    phan_bo: Array.isArray(data.phan_bo) ? data.phan_bo.map(item => ({
      sub_id2: String(item.sub_id2 || '').trim(),
      ngan_sach: Number(item.ngan_sach || 0),
      ly_do: String(item.ly_do || '').trim()
    })).filter(item => item.sub_id2) : [],
    tong_hh_du_kien: Number(data.tong_hh_du_kien || 0),
    loi_nhuan_du_kien: Number(data.loi_nhuan_du_kien || 0),
    chien_luoc: String(data.chien_luoc || '').trim()
  };
}

function getClaudeErrorMessage(error) {
  if (error?.status === 401) return 'API Key không hợp lệ, vui lòng kiểm tra lại';
  if (error?.status === 429) return 'Đã vượt rate limit, thử lại sau 60 giây';
  if (error?.status === 504 || /timeout|request qua lau|quá lâu|chậm/i.test(String(error?.message || ''))) {
    return 'AI phản hồi chậm, thử lại';
  }
  return error?.message ? `Lỗi AI: ${error.message}` : 'Lỗi AI không xác định';
}

function findRowAlert(row, alerts = []) {
  const key = String(row?.sub_id2 || '').trim().toLowerCase();
  return alerts.find(alert => String(alert?.sub_id2 || '').trim().toLowerCase() === key) || null;
}

function getRowChangeText(row, alerts = []) {
  const alert = findRowAlert(row, alerts);
  if (!alert) return 'Không có thay đổi nổi bật trong kỳ so sánh.';
  if (alert.type === 'positive') {
    return `Hoa hồng tăng từ ${formatCompactVND(alert.previous_hoa_hong)} lên ${formatCompactVND(alert.current_hoa_hong)}.`;
  }
  if (alert.type === 'warning') {
    return `Hoa hồng giảm từ ${formatCompactVND(alert.previous_hoa_hong)} xuống ${formatCompactVND(alert.current_hoa_hong)}.`;
  }
  if (alert.type === 'orange') {
    return `Kỳ trước ROI ${formatNumber(alert.previous_roi || 0)}%, hiện ROI ${formatNumber(alert.current_roi || 0)}%.`;
  }
  return 'Không có thay đổi nổi bật trong kỳ so sánh.';
}

function buildSubIdSystemPrompt(row, alerts = []) {
  return `Bạn là chuyên gia Affiliate Marketing Shopee.
Context về sub_id2 đang phân tích:
- Sub_id2: ${row.sub_id2}
- Hoa hồng: ${formatVND(row.hoa_hong || 0)}
- HH TB/đơn: ${formatVND(row.hh_tb || 0)}
- Chi phí phân bổ: ${formatVND(row.chi_phi_pb || 0)}
- Lượt click: ${formatNumber(row.clicks || 0)}
- CPC: ${row.clicks > 0 ? formatVND(row.cpc || 0) : '-'}
- Số dòng camp: ${formatNumber(row.so_camp || 0)}
- ROI: ${formatNumber(row.roi || 0)}%
- Đánh giá hiện tại: ${row.danh_gia || '-'}
- So với kỳ trước: ${getRowChangeText(row, alerts)}

Trả lời ngắn gọn bằng tiếng Việt, tập trung vào hành động cụ thể nên làm với sub_id2 này.`;
}

export default function ShopeeCommission() {
  const { currentUser } = useAppContext();
  const [fromDate, setFromDate] = useState(DEFAULT_FROM_DATE);
  const [toDate, setToDate] = useState(() => todayString());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiBudgetPlan, setAiBudgetPlan] = useState(null);
  const [aiBudgetLoading, setAiBudgetLoading] = useState(false);
  const [aiBudgetError, setAiBudgetError] = useState('');
  const [chatRow, setChatRow] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatApiMessages, setChatApiMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatRetryRequest, setChatRetryRequest] = useState(null);

  const loadSummary = async (dateRange = {}) => {
    const activeFromDate = dateRange.fromDate || fromDate;
    const activeToDate = dateRange.toDate || toDate;
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate: activeFromDate, toDate: activeToDate });
      const data = await api('GET', `/shopee/commission-summary?${params.toString()}`);
      setSummary(data);
      return data;
    } catch (error) {
      toast.error(`Lỗi tải thống kê Shopee: ${error.message}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commissionBySubId = summary?.commissionBySubId || EMPTY_ARRAY;
  const avgDailySpend = useMemo(() => {
    const dayCount = Number(summary?.activeDayCount || 0);
    return dayCount > 0 ? Number(summary?.totalSpend || 0) / dayCount : 0;
  }, [summary]);
  const budgetPlan = useMemo(
    () => buildBudgetPlan(commissionBySubId, summary?.totalSpend || 0),
    [commissionBySubId, summary]
  );
  const budgetPlanTotals = useMemo(() => (
    budgetPlan.reduce((acc, row) => {
      acc.suggestedBudget += Number(row.ns_de_xuat || 0);
      acc.estimatedCommission += Number(row.hh_du_kien || 0);
      return acc;
    }, { suggestedBudget: 0, estimatedCommission: 0 })
  ), [budgetPlan]);
  const bestRows = useMemo(() => (
    [...commissionBySubId]
      .filter(row => Number(row.hoa_hong || 0) > 0)
      .sort((a, b) => Number(b.roi || 0) - Number(a.roi || 0))
      .slice(0, 8)
  ), [commissionBySubId]);
  const watchRows = useMemo(() => (
    [...commissionBySubId]
      .filter(row => Number(row.hoa_hong || 0) > 0 || Number(row.chi_phi_pb || 0) > 0)
      .sort((a, b) => Number(a.roi || 0) - Number(b.roi || 0))
      .slice(0, 8)
  ), [commissionBySubId]);

  const callClaude = async ({ system = '', messages = [] }) => {
    const apiKey = getClaudeApiKey(currentUser);
    if (!apiKey) {
      toast.error('Vui lòng nhập Claude API Key');
      return null;
    }

    try {
      return await requestClaudeMessage({
        apiKey,
        system,
        messages,
        maxTokens: 1500,
        timeoutMs: 30000
      });
    } catch (error) {
      console.error('Claude API error:', error);
      if (error?.status === 401) {
        removeClaudeApiKeyForUser(currentUser);
      }
      toast.error(getClaudeErrorMessage(error));
      throw error;
    }
  };

  const clearInvalidClaudeKey = () => {
    removeClaudeApiKeyForUser(currentUser);
    setAiError('');
    setAiBudgetError('');
    setChatError('');
    toast.info('Đã xóa API Key lỗi. Nhập key mới ở thanh trên cùng.');
  };

  const runAiAnalysis = async (sourceSummary = summary, retryOnRateLimit = true) => {
    const rows = sourceSummary?.commissionBySubId || [];
    if (!rows.length) {
      toast.error('Chưa có dữ liệu sub_id2 để AI phân tích');
      return;
    }

    setAiLoading(true);
    setAiError('');
    try {
      const prompt = `Bạn là chuyên gia phân tích Affiliate Marketing Shopee.
Dưới đây là dữ liệu hiệu quả các sub_id2 tháng này:

${JSON.stringify(buildRowsPayload(rows), null, 2)}

Mỗi dòng đã bao gồm dữ liệu hoa hồng, chi phí quảng cáo phân bổ theo camp, lượt click, CPC và số dòng camp.

Hãy phân tích ngắn gọn bằng tiếng Việt, trả về JSON:
{
  "tom_tat": "1-2 câu tổng quan kết quả tháng này",
  "top_scale": ["sub_id2 nên tăng ngân sách ngay, kèm lý do ngắn"],
  "can_dung": ["sub_id2 nên dừng ngay, kèm lý do ngắn"],
  "canh_bao": ["rủi ro hoặc bất thường cần chú ý"],
  "khuyen_nghi": "1 khuyến nghị chiến lược tổng thể"
}
Chỉ trả về JSON, không giải thích thêm.`;
      const response = await callClaude({ messages: [{ role: 'user', content: prompt }] });
      if (!response) return;
      const parsed = parseClaudeJson(extractClaudeText(response));
      setAiAnalysis(normalizeAiAnalysis(parsed));
    } catch (error) {
      console.error('AI analysis error:', error);
      setAiError(getClaudeErrorMessage(error));
      if (error?.status === 429 && retryOnRateLimit) {
        window.setTimeout(() => runAiAnalysis(sourceSummary, false), 60000);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const runAiBudgetPlan = async (retryOnRateLimit = true) => {
    const rows = buildRowsPayload(commissionBySubId).filter(row => Number(row.roi || 0) > 0);
    const totalBudget = Number(summary?.totalSpend || 0);
    if (!rows.length || totalBudget <= 0) {
      toast.error('Chưa đủ dữ liệu ROI và ngân sách để hỏi AI');
      return;
    }

    setAiBudgetLoading(true);
    setAiBudgetError('');
    try {
      const prompt = `Tôi có tổng ngân sách ${Math.round(totalBudget)} đồng cho affiliate Shopee.
Dữ liệu hiệu quả các sub_id2: ${JSON.stringify(rows, null, 2)}

Mỗi sub_id2 có kèm lượt click, CPC và số dòng camp để đánh giá chất lượng traffic.

Hãy đề xuất phân bổ ngân sách tối ưu để maximize tổng hoa hồng. Trả về JSON:
{
  "phan_bo": [
    {"sub_id2": "xxx", "ngan_sach": 1000000, "ly_do": "..."}
  ],
  "tong_hh_du_kien": 5000000,
  "loi_nhuan_du_kien": 2000000,
  "chien_luoc": "giải thích ngắn về chiến lược phân bổ"
}
Chỉ phân bổ cho sub_id2 ROI > 0. Chỉ trả về JSON.`;
      const response = await callClaude({ messages: [{ role: 'user', content: prompt }] });
      if (!response) return;
      const parsed = parseClaudeJson(extractClaudeText(response));
      setAiBudgetPlan(normalizeAiBudget(parsed));
    } catch (error) {
      console.error('AI budget error:', error);
      setAiBudgetError(getClaudeErrorMessage(error));
      if (error?.status === 429 && retryOnRateLimit) {
        window.setTimeout(() => runAiBudgetPlan(false), 60000);
      }
    } finally {
      setAiBudgetLoading(false);
    }
  };

  const importCommissionCsv = async (file) => {
    if (!file || importingCsv) return;

    setImportingCsv(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadForm('/shopee/commission-import-csv', formData, { timeoutMs: 10 * 60 * 1000 });
      toast.success(`Đã import ${formatNumber(result.imported || 0)} dòng tổng hợp hoa hồng`);
      const nextSummary = await loadSummary();
      if (nextSummary?.commissionBySubId?.length) runAiAnalysis(nextSummary);
    } catch (error) {
      toast.error(`Lỗi import hoa hồng Shopee: ${error.message}`);
    } finally {
      setImportingCsv(false);
    }
  };

  const requestSubIdChat = async (row, apiMessages, displayMessages, retryOnRateLimit = true) => {
    setChatLoading(true);
    setChatError('');
    setChatRetryRequest({ row, apiMessages, displayMessages });
    try {
      const response = await callClaude({
        system: buildSubIdSystemPrompt(row, summary?.alerts || []),
        messages: apiMessages
      });
      if (!response) return;
      const answer = extractClaudeText(response) || 'AI chưa có phản hồi.';
      const nextApiMessages = [...apiMessages, { role: 'assistant', content: answer }];
      const nextDisplayMessages = [...displayMessages, { role: 'assistant', content: answer }];
      setChatApiMessages(nextApiMessages);
      setChatMessages(nextDisplayMessages);
      setChatRetryRequest(null);
    } catch (error) {
      console.error('AI chat error:', error);
      setChatError(getClaudeErrorMessage(error));
      if (error?.status === 429 && retryOnRateLimit) {
        window.setTimeout(() => requestSubIdChat(row, apiMessages, displayMessages, false), 60000);
      }
    } finally {
      setChatLoading(false);
    }
  };

  const openSubIdChat = (row) => {
    const initialApiMessages = [{
      role: 'user',
      content: 'Hãy phân tích ban đầu sub_id2 này: nên scale, giữ, giảm hay dừng? Nêu lý do và hành động cụ thể.'
    }];
    setChatRow(row);
    setChatMessages([]);
    setChatApiMessages(initialApiMessages);
    setChatInput('');
    setChatError('');
    requestSubIdChat(row, initialApiMessages, []);
  };

  const closeSubIdChat = () => {
    setChatRow(null);
    setChatMessages([]);
    setChatApiMessages([]);
    setChatInput('');
    setChatError('');
    setChatRetryRequest(null);
  };

  const sendChatMessage = (event) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content || !chatRow || chatLoading) return;
    const nextApiMessages = [...chatApiMessages, { role: 'user', content }];
    const nextDisplayMessages = [...chatMessages, { role: 'user', content }];
    setChatInput('');
    setChatApiMessages(nextApiMessages);
    setChatMessages(nextDisplayMessages);
    requestSubIdChat(chatRow, nextApiMessages, nextDisplayMessages);
  };

  return (
    <div id="page-shopee-commission">
      <div className="stats-grid inventory-stats shopee-profit-stats">
        <div className="stat g shopee-primary-commission">
          <div className="stat-label">TỔNG HOA HỒNG</div>
          <div className="stat-value stat-value-compact">{formatVND(summary?.totalCommission || 0)}</div>
        </div>
        <div className="stat b">
          <div className="stat-label">Chi phí quảng cáo</div>
          <div className="stat-value stat-value-compact">{formatVND(summary?.totalSpend || 0)}</div>
        </div>
        <div className="stat o">
          <div className="stat-label">Lợi nhuận</div>
          <div className="stat-value stat-value-compact">{formatVND(summary?.totalProfit || 0)}</div>
        </div>
        <div className="stat p">
          <div className="stat-label">ROI tổng</div>
          <div className="stat-value">{formatNumber(summary?.totalRoi || 0)}%</div>
        </div>
        <div className="stat g">
          <div className="stat-label">TB chi phí/ngày</div>
          <div className="stat-value stat-value-compact">{avgDailySpend > 0 ? formatVND(avgDailySpend) : '-'}</div>
        </div>
      </div>

      {(aiLoading || aiAnalysis || aiError) && (
        <div className="card shopee-ai-card section-gap">
          <div className="card-header">
            <div className="card-title">🤖 Nhận xét của AI</div>
            <button className="btn btn-ghost btn-sm" onClick={() => runAiAnalysis()} disabled={aiLoading}>
              {aiLoading ? 'Đang phân tích...' : '🤖 Phân tích lại'}
            </button>
          </div>
          {aiLoading ? (
            <div className="shopee-ai-loading">AI đang phân tích dữ liệu...</div>
          ) : aiError ? (
            <div className="shopee-ai-error">
              <span>{aiError}</span>
              <div className="shopee-ai-error-actions">
                {aiError.includes('API Key') && (
                  <button className="btn btn-ghost btn-sm" onClick={clearInvalidClaudeKey}>Xóa key lỗi</button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => runAiAnalysis()}>Thử lại</button>
              </div>
            </div>
          ) : (
            <div className="shopee-ai-content">
              <div>
                <div className="shopee-ai-label">Tổng quan</div>
                <div className="shopee-ai-summary">{aiAnalysis?.tom_tat || '-'}</div>
              </div>
              <div className="shopee-ai-groups">
                <div>
                  <div className="shopee-ai-label">Nên scale ngay</div>
                  <div className="shopee-ai-badge-list green">
                    {(aiAnalysis?.top_scale || []).map(item => <span key={item}>{item}</span>)}
                    {!aiAnalysis?.top_scale?.length && <em>-</em>}
                  </div>
                </div>
                <div>
                  <div className="shopee-ai-label">Cần dừng</div>
                  <div className="shopee-ai-badge-list red">
                    {(aiAnalysis?.can_dung || []).map(item => <span key={item}>{item}</span>)}
                    {!aiAnalysis?.can_dung?.length && <em>-</em>}
                  </div>
                </div>
                <div>
                  <div className="shopee-ai-label">Cảnh báo</div>
                  <div className="shopee-ai-badge-list yellow">
                    {(aiAnalysis?.canh_bao || []).map(item => <span key={item}>{item}</span>)}
                    {!aiAnalysis?.canh_bao?.length && <em>-</em>}
                  </div>
                </div>
              </div>
              <div className="shopee-ai-recommendation">
                {aiAnalysis?.khuyen_nghi || '-'}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card section-gap">
        <div className="card-header">
          <div>
            <div className="card-title">Dashboard tối ưu lợi nhuận</div>
            <div className="shopee-helper">Chi phí PB là chi phí quảng cáo đã phân bổ theo SUB_ID2.</div>
          </div>
          <div className="inventory-search">
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onChange={(nextFrom, nextTo) => {
                setFromDate(nextFrom);
                setToDate(nextTo);
                loadSummary({ fromDate: nextFrom, toDate: nextTo });
              }}
              centered
            />
            <button className="btn btn-ghost btn-sm" onClick={() => loadSummary()} disabled={loading}>
              {loading ? 'Đang tải...' : 'Tải lại'}
            </button>
          </div>
        </div>
        <div className="shopee-import-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Import CSV hoa hồng</label>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importingCsv}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                importCommissionCsv(file);
              }}
            />
          </div>
          <div className="shopee-helper">
            Lấy cột Sub_id2, Thời Gian Đặt Hàng và Tổng hoa hồng đơn hàng trong file AffiliateCommissionReport.
          </div>
        </div>
      </div>

      <div className="shopee-module-grid section-gap">
        <div className="card shopee-module-card shopee-budget-card">
          <div className="card-header">
            <div className="card-title">Budget Optimizer</div>
            <button className="btn btn-ghost btn-sm" onClick={() => runAiBudgetPlan()} disabled={aiBudgetLoading || !commissionBySubId.length}>
              {aiBudgetLoading ? 'AI đang tính...' : '✨ Hỏi AI phân bổ tối ưu'}
            </button>
          </div>
          {budgetPlan.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chưa đủ dữ liệu ROI để phân bổ ngân sách</p></div>
          ) : (
            <div className="shopee-budget-compare">
              <div className="shopee-budget-col">
                <div className="shopee-budget-title">Thuật toán</div>
                <div className="tbl-wrap shopee-module-table-wrap">
                  <table className="tbl shopee-module-table">
                    <thead>
                      <tr>
                        <th>SUB_ID2</th>
                        <th className="text-right">NS Đề xuất (đ)</th>
                        <th className="text-right">HH Dự kiến (đ)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetPlan.map(row => (
                        <tr key={row.sub_id2}>
                          <td>{row.sub_id2}</td>
                          <td className="text-right mono-sm">{formatVND(row.ns_de_xuat)}</td>
                          <td className="text-right mono-sm shopee-commission-main">{formatVND(row.hh_du_kien)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="shopee-module-footer">
                  <span>Tổng HH dự kiến: {formatVND(budgetPlanTotals.estimatedCommission)}</span>
                  <span>Lợi nhuận dự kiến: {formatVND(budgetPlanTotals.estimatedCommission - budgetPlanTotals.suggestedBudget)}</span>
                </div>
              </div>

              <div className="shopee-budget-col ai">
                <div className="shopee-budget-title">Đề xuất AI</div>
                {aiBudgetLoading ? (
                  <div className="shopee-ai-loading compact">✨ AI đang tối ưu ngân sách...</div>
                ) : aiBudgetError ? (
                  <div className="shopee-ai-error compact">
                    <span>{aiBudgetError}</span>
                    <div className="shopee-ai-error-actions">
                      {aiBudgetError.includes('API Key') && (
                        <button className="btn btn-ghost btn-sm" onClick={clearInvalidClaudeKey}>Xóa key lỗi</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => runAiBudgetPlan()}>Thử lại</button>
                    </div>
                  </div>
                ) : aiBudgetPlan ? (
                  <>
                    <div className="tbl-wrap shopee-module-table-wrap">
                      <table className="tbl shopee-module-table">
                        <thead>
                          <tr>
                            <th>SUB_ID2</th>
                            <th className="text-right">Ngân sách</th>
                            <th>Lý do</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiBudgetPlan.phan_bo.map(item => (
                            <tr key={item.sub_id2}>
                              <td>{item.sub_id2}</td>
                              <td className="text-right mono-sm shopee-commission-main">{formatVND(item.ngan_sach)}</td>
                              <td>{item.ly_do || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="shopee-module-footer ai">
                      <span>Tổng HH dự kiến: {formatVND(aiBudgetPlan.tong_hh_du_kien)}</span>
                      <span>Lợi nhuận dự kiến: {formatVND(aiBudgetPlan.loi_nhuan_du_kien)}</span>
                    </div>
                    <div className="shopee-ai-strategy">{aiBudgetPlan.chien_luoc}</div>
                  </>
                ) : (
                  <div className="empty"><div className="ei">✨</div><p>Bấm hỏi AI để so sánh đề xuất phân bổ</p></div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card shopee-module-card shopee-alert-card">
          <div className="card-header">
            <div className="card-title">Alert Panel</div>
          </div>
          {summary?.alerts?.length ? (
            <div className="shopee-alert-list">
              {summary.alerts.map((alert, index) => {
                const icon = alert.type === 'positive' ? '🟢' : alert.type === 'orange' ? '🟠' : '🟡';
                const text = alert.type === 'positive'
                  ? `Hoa hồng tăng từ ${formatCompactVND(alert.previous_hoa_hong)} → ${formatCompactVND(alert.current_hoa_hong)}`
                  : alert.type === 'orange'
                    ? `Từng SCALE MẠNH, hiện ROI ${formatNumber(alert.current_roi || 0)}%`
                    : `Hoa hồng giảm từ ${formatCompactVND(alert.previous_hoa_hong)} → ${formatCompactVND(alert.current_hoa_hong)}`;
                return (
                  <div className={`shopee-alert-item ${alert.type}`} key={`${alert.sub_id2}-${alert.type}-${index}`}>
                    <span>{icon}</span>
                    <strong>{alert.sub_id2}</strong>
                    <span>{text}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty"><div className="ei">✓</div><p>Không có cảnh báo theo kỳ so sánh</p></div>
          )}
        </div>

        <div className="card shopee-module-card">
          <div className="card-header">
            <div className="card-title">Module 3: Top ROI</div>
          </div>
          <div className="shopee-rank-list">
            {bestRows.map(row => (
              <div className="shopee-rank-item" key={row.sub_id2}>
                <span>{row.sub_id2}</span>
                <strong>{formatNumber(row.roi || 0)}%</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="card shopee-module-card">
          <div className="card-header">
            <div className="card-title">Module 4: Cần theo dõi</div>
          </div>
          <div className="shopee-rank-list">
            {watchRows.map(row => (
              <div className="shopee-rank-item" key={row.sub_id2}>
                <span>{row.sub_id2}</span>
                <strong>{formatNumber(row.roi || 0)}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Bảng SUB_ID2</div>
        </div>
        <div className="tbl-wrap">
          {loading && !summary ? (
            <div className="empty"><span className="spin">...</span><p>Đang tải...</p></div>
          ) : commissionBySubId.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chưa có dữ liệu hoa hồng đã import</p></div>
          ) : (
            <table className="tbl shopee-subid-table">
              <thead>
                <tr>
                  <th>SUB_ID2</th>
                  <th className="text-right">HOA HỒNG (đ)</th>
                  <th className="text-right">HH TB/ĐƠN (đ)</th>
                  <th className="text-right">CHI PHÍ PB (đ)</th>
                  <th className="text-right">LƯỢT CLICK</th>
                  <th className="text-right">CPC (đ)</th>
                  <th className="text-right">ROI (%)</th>
                  <th>ĐÁNH GIÁ</th>
                  <th className="text-center">AI</th>
                </tr>
              </thead>
              <tbody>
                {commissionBySubId.map(row => (
                  <tr key={row.sub_id2}>
                    <td>{row.sub_id2}</td>
                    <td className="text-right mono-sm shopee-commission-main">{formatVND(row.hoa_hong || 0)}</td>
                    <td className="text-right mono-sm">{formatVND(row.hh_tb || 0)}</td>
                    <td className="text-right mono-sm shopee-cost">{formatVND(row.chi_phi_pb || 0)}</td>
                    <td className="text-right mono-sm">{formatNumber(row.clicks || 0)}</td>
                    <td className="text-right mono-sm">{Number(row.clicks || 0) > 0 ? formatVND(row.cpc || 0) : '-'}</td>
                    <td className="text-right">
                      <span className={`badge ${getRoiBadgeClass(row.roi)}`}>{formatNumber(row.roi || 0)}%</span>
                    </td>
                    <td>
                      <span className={`badge ${getEvaluationBadgeClass(row.danh_gia)}`}>
                        {row.danh_gia || '-'}
                      </span>
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm shopee-ai-row-btn"
                        onClick={() => openSubIdChat(row)}
                        title={`AI phân tích ${row.sub_id2}`}
                      >
                        🤖
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {chatRow && (
        <div className="modal-overlay open shopee-ai-chat-overlay" onClick={closeSubIdChat}>
          <div className="modal shopee-ai-chat-modal" onClick={event => event.stopPropagation()}>
            <div className="shopee-ai-chat-header">
              <div>
                <div className="card-title">AI phân tích: {chatRow.sub_id2}</div>
                <div className="shopee-helper">🤖 Claude đang dùng dữ liệu hiệu quả của SUB_ID2 này.</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={closeSubIdChat}>Đóng</button>
            </div>

            <div className="shopee-chat-messages">
              {chatMessages.map((message, index) => (
                <div className={`shopee-chat-message ${message.role}`} key={`${message.role}-${index}`}>
                  {message.content}
                </div>
              ))}
              {chatLoading && <div className="shopee-chat-message assistant loading">AI đang phân tích...</div>}
              {chatError && (
                <div className="shopee-ai-error compact">
                  <span>{chatError}</span>
                  <div className="shopee-ai-error-actions">
                    {chatError.includes('API Key') && (
                      <button className="btn btn-ghost btn-sm" onClick={clearInvalidClaudeKey}>Xóa key lỗi</button>
                    )}
                    {chatRetryRequest && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => requestSubIdChat(
                          chatRetryRequest.row,
                          chatRetryRequest.apiMessages,
                          chatRetryRequest.displayMessages,
                          false
                        )}
                      >
                        Thử lại
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <form className="shopee-chat-input-row" onSubmit={sendChatMessage}>
              <input
                value={chatInput}
                onChange={event => setChatInput(event.target.value)}
                placeholder="Hỏi thêm về sub_id2 này..."
                disabled={chatLoading}
              />
              <button className="btn btn-p btn-sm" disabled={chatLoading || !chatInput.trim()}>
                Gửi
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
