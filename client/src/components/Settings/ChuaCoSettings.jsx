import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import PreviewTable from './PreviewTable';
import TierEditor from './TierEditor';
import { DEFAULT_CONFIG, MAX_TIER_COUNT, MIN_TIER_COUNT } from '../../types/chuaCoConfig.types';
import { getPreviewSamples } from '../../utils/calculations';

function cloneConfig(config) {
  return {
    tiers: config.tiers.map(tier => ({ ...tier }))
  };
}

function validateConfig(config) {
  const errors = [];
  const tiers = config.tiers || [];

  if (tiers.length < MIN_TIER_COUNT) {
    errors.push('Cần ít nhất 2 mức');
  }

  if (tiers.length > MAX_TIER_COUNT) {
    errors.push('Tối đa 8 mức');
  }

  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const ratePercent = Math.round(Number(tier.rate || 0) * 100);
    if (!Number.isInteger(ratePercent) || ratePercent < 1 || ratePercent > 100) {
      errors.push('Tỉ lệ phải từ 1% đến 100%');
      break;
    }

    if (index < tiers.length - 1) {
      if (!Number.isInteger(Number(tier.maxQty)) || Number(tier.maxQty) <= 0) {
        errors.push(`Ngưỡng mức ${index + 1} phải là số nguyên dương`);
        break;
      }
      if (index > 0 && Number(tier.maxQty) <= Number(tiers[index - 1].maxQty)) {
        errors.push(`Ngưỡng mức ${index + 1} phải lớn hơn mức ${index}`);
        break;
      }
    }
  }

  return errors;
}

export default function ChuaCoSettings({
  open,
  config,
  onClose,
  onSave
}) {
  const [draft, setDraft] = useState(() => cloneConfig(config));
  const [errors, setErrors] = useState([]);

  React.useEffect(() => {
    if (open) {
      setDraft(cloneConfig(config));
      setErrors([]);
    }
  }, [open, config]);

  const draftPreview = useMemo(() => getPreviewSamples(draft), [draft]);

  const handleTierChange = (tierId, field, value) => {
    setDraft(current => ({
      ...current,
      tiers: current.tiers.map(tier => {
        if (tier.id !== tierId) return tier;
        if (field === 'rate') {
          const next = Number(value || 0);
          return { ...tier, rate: next / 100 };
        }
        return { ...tier, maxQty: value === '' ? '' : Number(value) };
      })
    }));
  };

  const handleDelete = (tierId) => {
    setDraft(current => ({
      ...current,
      tiers: current.tiers.filter(tier => tier.id !== tierId)
    }));
  };

  const handleAdd = () => {
    setDraft(current => {
      if (current.tiers.length >= MAX_TIER_COUNT) return current;

      const last = current.tiers[current.tiers.length - 2];
      const beforeLast = current.tiers[current.tiers.length - 1];
      const newTier = {
        id: `t${Date.now()}`,
        maxQty: last?.maxQty ? Number(last.maxQty) + 10 : 10,
        rate: beforeLast?.rate || 0.5
      };

      return {
        ...current,
        tiers: [...current.tiers.slice(0, -1), newTier, current.tiers[current.tiers.length - 1]]
      };
    });
  };

  const handleReset = () => {
    setDraft(cloneConfig(DEFAULT_CONFIG));
    setErrors([]);
    toast('⚠️ Đã đặt lại về mặc định');
  };

  const handleSave = () => {
    const normalized = {
      tiers: draft.tiers.map((tier, index, array) => ({
        ...tier,
        maxQty: index === array.length - 1 ? null : Number(tier.maxQty),
        rate: Number(tier.rate)
      }))
    };
    const nextErrors = validateConfig(normalized);
    setErrors(nextErrors);
    if (nextErrors.length) {
      toast.error('Cấu hình không hợp lệ');
      return;
    }
    onSave(normalized);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="⚙️ Cấu Hình Tỉ Lệ Giữ Hàng"
      onClose={onClose}
      className="deal-settings-modal"
      footer={(
        <>
          <button type="button" className="deal-btn deal-btn-ghost" onClick={handleReset}>
            🔄 Đặt Lại
          </button>
          <button type="button" className="deal-btn deal-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="deal-btn deal-btn-primary" onClick={handleSave}>
            💾 Lưu & Áp Dụng
          </button>
        </>
      )}
    >
      <div className="deal-settings-section">
        <div className="deal-settings-label">TIER EDITOR:</div>
        <TierEditor
          tiers={draft.tiers}
          onChange={handleTierChange}
          onDelete={handleDelete}
          onAdd={handleAdd}
          errors={errors}
        />
      </div>

      <div className="deal-settings-section">
        <div className="deal-settings-label">📊 Xem Trước:</div>
        <PreviewTable samples={draftPreview} />
      </div>
    </Modal>
  );
}
