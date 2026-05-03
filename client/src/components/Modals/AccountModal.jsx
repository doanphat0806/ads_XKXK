import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { api } from '../../lib/api';
import { isValidAdAccountId } from '../../lib/validators';
import { toast } from 'react-toastify';
import InitialAutomationSettings from './InitialAutomationSettings';
import LinkedPagesField from './LinkedPagesField';

const emptyFormData = {
  name: '',
  provider: 'facebook',
  fbToken: '',
  adAccountId: '',
  claudeKey: '',
  spendThreshold: 20000,
  checkInterval: 60,
  autoEnabled: false,
  linkedPageIds: []
};

const autofillTrapStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: 'none'
};

export default function AccountModal({ data }) {
  const { provider, closeModal, loadAccounts, appConfig } = useAppContext();
  const [formData, setFormData] = useState(emptyFormData);

  const isEdit = !!data;

  useEffect(() => {
    if (data) {
      setFormData({
        name: data.name || '',
        provider: data.provider || 'facebook',
        fbToken: '', // Don't show token
        adAccountId: data.adAccountId || '',
        claudeKey: '', // Don't show key
        spendThreshold: data.spendThreshold || 20000,
        checkInterval: data.checkInterval || 60,
        autoEnabled: data.autoEnabled || false,
        linkedPageIds: data.linkedPageIds || []
      });
    } else {
      setFormData({ ...emptyFormData, provider });
    }
  }, [data, provider]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        name: formData.name.trim(),
        provider: formData.provider,
        adAccountId: formData.adAccountId.trim(),
        fbToken: formData.fbToken.trim(),
        claudeKey: formData.claudeKey.trim()
      };

      if (!payload.adAccountId) {
        toast.error('Ad Account/Shopee ID không được để trống');
        return;
      }
      if (payload.provider === 'facebook' && !isValidAdAccountId(payload.adAccountId)) {
        toast.error('Ad Account ID Facebook phải là số hoặc dạng act_123456789');
        return;
      }

      if (!payload.fbToken) delete payload.fbToken;
      if (!payload.claudeKey) delete payload.claudeKey;

      if (isEdit) {
        await api('PUT', `/accounts/${data._id}`, payload);
        toast.success('Đã cập nhật tài khoản');
      } else {
        await api('POST', '/accounts', payload);
        toast.success('Đã thêm tài khoản');
      }
      loadAccounts();
      closeModal();
    } catch (error) {
      toast.error('Lỗi: ' + error.message);
    }
  };

  return (
    <div className="card" style={{ border: 'none', margin: 0 }}>
      <div className="card-header">
        <div className="card-title">{isEdit ? '✏️ Sửa tài khoản' : '➕ Thêm tài khoản mới'}</div>
        <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
      </div>
      <form onSubmit={handleSubmit} autoComplete="off" style={{ padding: '20px' }}>
        <input name="username" type="text" autoComplete="username" tabIndex="-1" aria-hidden="true" style={autofillTrapStyle} />
        <input name="password" type="password" autoComplete="new-password" tabIndex="-1" aria-hidden="true" style={autofillTrapStyle} />
        <div className="form-group">
          <label>Tên gợi nhớ</label>
          <input 
            type="text" 
            name="account-label"
            autoComplete="off"
            required 
            value={formData.name} 
            onChange={e => setFormData({ ...formData, name: e.target.value })} 
            placeholder="Ví dụ: TK No Limit 01"
          />
        </div>
        <div className="form-group">
          <label>Facebook Access Token</label>
          <input 
            type="password" 
            name="facebook-access-token-new"
            autoComplete="new-password"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
            value={formData.fbToken} 
            onChange={e => setFormData({ ...formData, fbToken: e.target.value })} 
            placeholder={isEdit ? "Để trống nếu không đổi" : "EAAxxxxxxxxxx..."}
          />
          <div className="inline-note">
            {formData.provider === 'shopee'
              ? 'Shopee account không cần Facebook Token nếu chưa dùng Facebook integration.'
              : appConfig.hasFbToken
                ? 'Đã có token dùng chung, có thể bỏ trống'
                : 'Bắt buộc nếu chưa có token dùng chung'}
          </div>
        </div>
        <div className="form-group">
          <label>{formData.provider === 'shopee' ? 'Shopee Shop ID / Account ID' : 'Ad Account ID (act_xxxxxxxx)'}</label>
          <input 
            type="text" 
            name="facebook-ad-account-id"
            autoComplete="off"
            inputMode="text"
            pattern={formData.provider === 'facebook' ? '^(act_)?[0-9]+$' : '.*'}
            title={formData.provider === 'facebook' ? 'Nhap so ID tai khoan quang cao hoac dang act_123456789' : 'Nhap Shopee shop/account ID'}
            required 
            value={formData.adAccountId} 
            onChange={e => setFormData({ ...formData, adAccountId: e.target.value })} 
            placeholder={formData.provider === 'shopee' ? 'Shopee shop id / account id' : 'act_123456789'}
          />
        </div>

        {formData.provider === 'shopee' && (
          <LinkedPagesField
            selectedPageIds={formData.linkedPageIds}
            onChange={linkedPageIds => setFormData(prev => ({ ...prev, linkedPageIds }))}
          />
        )}
        <div className="form-group">
          <label>Claude API Key (Tùy chọn)</label>
          <input 
            type="password" 
            name="claude-api-key-new"
            autoComplete="new-password"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
            value={formData.claudeKey} 
            onChange={e => setFormData({ ...formData, claudeKey: e.target.value })} 
            placeholder={isEdit ? "Để trống nếu không đổi" : "sk-ant-api03-..."}
          />
        </div>
        
        {!isEdit && (
          <InitialAutomationSettings
            checkInterval={formData.checkInterval}
            autoEnabled={formData.autoEnabled}
            onChange={changes => setFormData(prev => ({ ...prev, ...changes }))}
          />
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Hủy</button>
          <button type="submit" className="btn btn-p">{isEdit ? 'Lưu thay đổi' : 'Thêm tài khoản'}</button>
        </div>
      </form>
    </div>
  );
}
