import React, { useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api, formatNumber } from '../../lib/api';
import { toast } from 'react-toastify';

// Cung bo dieu kien voi tab "Tat camp tu dong" trong ConfigModal; key = ten field cau hinh chung
const FB_LIMIT_GROUPS = [
  {
    title: 'Theo tin nhắn',
    rows: [
      { label: '0 tin nhắn', hint: 'Tắt khi tiêu tới mức này', daily: 'dailyZeroMessageSpendLimit', lifetime: 'lifetimeZeroMessageSpendLimit' },
      { label: '1 tin nhắn', hint: 'Tắt khi tiêu tới mức này', daily: 'dailyOneMessageSpendLimit', lifetime: 'lifetimeOneMessageSpendLimit' },
      { label: 'TN đắt — giá TN trên', hint: 'Ngưỡng giá để coi là TN đắt', daily: 'dailyHighCostPerMessageLimit', lifetime: 'lifetimeHighCostPerMessageLimit', param: true },
      { label: 'TN đắt — tiêu tới', hint: 'Tắt khi TN đắt và tiêu tới mức này', daily: 'dailyHighCostSpendLimit', lifetime: 'lifetimeHighCostSpendLimit' },
      { label: 'TN rẻ — giá TN dưới', hint: 'Ngưỡng giá để coi là TN rẻ', daily: 'dailyCheapMessageCostLimit', lifetime: 'lifetimeCheapMessageCostLimit', param: true },
      { label: 'TN rẻ, 0 đơn — tiêu tới', hint: 'Tắt khi TN rẻ mà chưa có đơn', daily: 'dailyCheapMessageSpendLimit', lifetime: 'lifetimeCheapMessageSpendLimit' }
    ]
  },
  {
    title: 'Theo đơn hàng',
    rows: [
      { label: '0 đơn — tiêu tới', hint: 'Tắt khi chưa có đơn mà tiêu tới mức này', daily: 'autoPauseZeroOrderSpendLimit', lifetime: 'autoPauseZeroOrderSpendLimitLifetime' },
      { label: 'Có đơn — CPO tối đa', hint: 'Tắt khi CPO vượt mức này', daily: 'autoPauseCpoLimit', lifetime: 'autoPauseCpoLimitLifetime' },
      { label: 'Nhiều đơn — trên số đơn', hint: 'Camp vượt số đơn này dùng CPO riêng bên dưới', daily: 'autoPauseMultiOrderThreshold', lifetime: 'autoPauseMultiOrderThresholdLifetime', param: true },
      { label: 'Nhiều đơn — CPO tối đa', hint: 'Thay cho CPO ở trên khi vượt số đơn; trống = dùng CPO ở trên', daily: 'autoPauseMultiOrderCpoLimit', lifetime: 'autoPauseMultiOrderCpoLimitLifetime' }
    ]
  }
];

const SHOPEE_LIMIT_ROWS = [
  { label: 'CPC tối đa', hint: 'Tắt khi chi phí / click vượt mức này', daily: 'dailyCpcLimit', lifetime: 'lifetimeCpcLimit' },
  { label: 'Số click tối đa', hint: 'Tắt khi số click vượt mức này', daily: 'dailyClickLimit', lifetime: 'lifetimeClickLimit' }
];

function toInputLimits(limits) {
  return Object.fromEntries(
    Object.entries(limits || {}).map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)])
  );
}

export default function CampaignRuleModal({ data }) {
  const { closeModal, appConfig } = useAppContext();
  const { accountId, campaignId, campaignName, provider, isLifetimeBudget, rule, onSaved } = data || {};
  const isShopee = provider === 'shopee';
  // Camp chi co 1 loai ngan sach -> chi hien cot nguong tuong ung (auto cung chi dung cot do)
  const budgetField = isLifetimeBudget ? 'lifetime' : 'daily';
  const budgetLabel = isLifetimeBudget ? 'Trọn đời' : 'Ngân sách ngày';
  const [mode, setMode] = useState(rule?.mode || 'default');
  const [limits, setLimits] = useState(() => toInputLimits(rule?.limits));
  const [saving, setSaving] = useState(false);

  const rulePath = `/campaign-rules/${accountId}/${campaignId}`;

  const setLimit = (key) => (e) => setLimits(prev => ({ ...prev, [key]: e.target.value }));
  const globalPlaceholder = (key) => {
    const value = appConfig?.[key];
    // Chi hien so: o nhap hep, "Chung: 100.000" bi cat chu
    return value === null || value === undefined ? '' : formatNumber(value);
  };
  // Dieu kien tat: o trong = khong xet. Tham so (param): o trong = dung muc chung
  const numInput = (key, isParam = false) => (
    <input
      type="number"
      inputMode="numeric"
      min="0"
      placeholder={isParam ? globalPlaceholder(key) : 'Không xét'}
      value={limits[key] ?? ''}
      onChange={setLimit(key)}
      disabled={saving}
    />
  );
  const renderLimitRow = (row) => (
    <tr key={row.daily}>
      <td>
        <div className="cfg-cond">{row.label}</div>
        <div className="cfg-hint">{row.hint}</div>
      </td>
      <td data-label={budgetLabel}>{numInput(row[budgetField], row.param)}</td>
    </tr>
  );

  const fillGeneralLimits = () => {
    const rows = isShopee ? SHOPEE_LIMIT_ROWS : FB_LIMIT_GROUPS.flatMap(group => group.rows);
    const keys = rows.map(row => row[budgetField]);
    if (isShopee) keys.push('autoPauseShopeeMinSpendLimit');
    setLimits(prev => {
      const next = { ...prev };
      for (const key of keys) {
        const value = appConfig?.[key];
        if (value !== null && value !== undefined && (next[key] ?? '') === '') next[key] = String(value);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'default') {
        if (rule) await api('DELETE', rulePath);
        onSaved?.(null);
        toast.success('Camp dùng lại cấu hình chung');
      } else {
        const saved = await api('PUT', rulePath, { mode, campaignName, limits });
        onSaved?.(saved);
        toast.success(mode === 'skip' ? 'Auto sẽ bỏ qua camp này' : 'Đã lưu điều kiện riêng cho camp');
      }
      closeModal();
    } catch (error) {
      toast.error('Lỗi: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card cfg-modal campaign-rule-modal">
      <div className="card-header">
        <div className="card-title">Quy tắc auto: {campaignName || campaignId}</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>

      <div className="cfg-tabs">
        <button className={`cfg-tab ${mode === 'default' ? 'is-active' : ''}`} onClick={() => setMode('default')} disabled={saving}>
          Theo cấu hình chung
        </button>
        <button className={`cfg-tab ${mode === 'custom' ? 'is-active' : ''}`} onClick={() => setMode('custom')} disabled={saving}>
          Điều kiện riêng
        </button>
        <button className={`cfg-tab ${mode === 'skip' ? 'is-active' : ''}`} onClick={() => setMode('skip')} disabled={saving}>
          Bỏ qua auto
        </button>
      </div>

      <div className="cfg-body">
        {rule && (
          <div className="cfg-hint">
            Quy tắc dùng chung cho mọi user quản lý TKQC này.
            {(rule.updatedBy?.name || rule.updatedAt) ? ' Sửa lần cuối' : ''}
            {rule.updatedBy?.name ? ` bởi ${rule.updatedBy.name}` : ''}
            {rule.updatedAt ? ` lúc ${new Date(rule.updatedAt).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })}` : ''}
            {(rule.updatedBy?.name || rule.updatedAt) ? '.' : ''}
          </div>
        )}
        {mode === 'default' && (
          <div className="cfg-block">
            <div className="cfg-hint">Camp dùng các điều kiện trong Cấu hình → Tắt camp tự động.</div>
          </div>
        )}

        {mode === 'skip' && (
          <div className="cfg-block">
            <div className="cfg-hint">Auto sẽ không tự tắt / bật camp này, kể cả luật tắt camp trùng theo giờ. Bạn tự tắt bật bằng tay.</div>
          </div>
        )}

        {mode === 'custom' && (
          <div className="cfg-block">
            <div className="cfg-block-head">
              <div className="cfg-block-title">Điều kiện tắt camp riêng</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={fillGeneralLimits} disabled={saving} title="Chép mức của cấu hình chung vào các ô đang trống để sửa">
                Điền mức chung
              </button>
            </div>
            <div className="cfg-hint" style={{ marginBottom: '10px' }}>
              Camp dùng ngân sách <b>{isLifetimeBudget ? 'trọn đời' : 'hằng ngày'}</b> nên chỉ hiện điều kiện {isLifetimeBudget ? 'trọn đời' : 'theo ngày'}.{' '}
              Ô <b>trống</b> hoặc <b>0</b> = <b>không xét</b> điều kiện đó. Riêng các ô giá TN đắt / rẻ, số đơn{isShopee ? ', chi tiêu tối thiểu' : ''} để trống thì dùng mức chung (hiện mờ). Đơn vị: đ (trừ số đơn, số click).
            </div>
            <div className="cfg-hint" style={{ marginBottom: '10px' }}>
              <b>Quy tắc riêng được ưu tiên:</b> camp <b>chỉ bị tắt theo các ô bạn nhập</b> trong bảng này. Mọi điều kiện của cấu hình chung{isShopee ? ', luật ROI, luật tiêu trung bình thấp' : ''} và luật tắt camp trùng theo giờ đều không áp vào camp này.
            </div>

            {isShopee && (
              <div className="cfg-block-head" style={{ marginBottom: '10px' }}>
                <div>
                  <div className="cfg-cond">Chi tiêu tối thiểu để xét tắt</div>
                  <div className="cfg-hint">Camp chưa tiêu đủ mức này sẽ không bị xét tắt.</div>
                </div>
                <div className="cfg-inline">
                  <input
                    type="number"
                    min="1"
                    placeholder={globalPlaceholder('autoPauseShopeeMinSpendLimit')}
                    value={limits.autoPauseShopeeMinSpendLimit ?? ''}
                    onChange={setLimit('autoPauseShopeeMinSpendLimit')}
                    disabled={saving}
                    style={{ width: '140px' }}
                  />
                </div>
              </div>
            )}

            <table className="cfg-table">
              <thead>
                <tr>
                  <th>Điều kiện</th>
                  <th>{budgetLabel}</th>
                </tr>
              </thead>
              {isShopee ? (
                <tbody>{SHOPEE_LIMIT_ROWS.map(renderLimitRow)}</tbody>
              ) : (
                FB_LIMIT_GROUPS.map(group => (
                  <tbody key={group.title}>
                    <tr className="cfg-group-row"><td colSpan={2}>{group.title}</td></tr>
                    {group.rows.map(renderLimitRow)}
                  </tbody>
                ))
              )}
            </table>
          </div>
        )}

        <div className="cfg-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={closeModal} disabled={saving}>Hủy</button>
          <button className="btn btn-p btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu quy tắc'}</button>
        </div>
      </div>
    </div>
  );
}
