import React from 'react';
import { MAX_TIER_COUNT, MIN_TIER_COUNT } from '../../types/chuaCoConfig.types';

export default function TierEditor({ tiers, onChange, onDelete, onAdd, errors = [] }) {
  const canAdd = tiers.length < MAX_TIER_COUNT;

  return (
    <div className="deal-tier-editor">
      <table className="deal-tier-table">
        <thead>
          <tr>
            <th>#</th>
            <th>SL Khách Đặt</th>
            <th>Tỉ Lệ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, index) => {
            const isLast = index === tiers.length - 1;
            return (
              <tr key={tier.id}>
                <td>{index + 1}</td>
                <td>
                  {isLast ? (
                    <div className="deal-tier-static">{index === 0 ? '> 0 (còn lại)' : `> ${tiers[index - 1].maxQty || 0} (còn lại)`}</div>
                  ) : (
                    <label className="deal-tier-field">
                      <span>{index === 0 ? '<' : '≤'}</span>
                      <input
                        type="number"
                        min="1"
                        value={tier.maxQty ?? ''}
                        onChange={event => onChange(tier.id, 'maxQty', event.target.value)}
                      />
                    </label>
                  )}
                </td>
                <td>
                  <label className="deal-tier-field">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={Math.round((tier.rate || 0) * 100)}
                      onChange={event => onChange(tier.id, 'rate', event.target.value)}
                    />
                    <span>%</span>
                  </label>
                </td>
                <td>
                  {!isLast && tiers.length > MIN_TIER_COUNT ? (
                    <button type="button" className="deal-icon-btn" onClick={() => onDelete(tier.id)} aria-label="Xóa mức">
                      🗑
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {errors.length ? (
        <div className="deal-form-errors">
          {errors.map(error => <div key={error}>{error}</div>)}
        </div>
      ) : null}

      <button type="button" className="deal-btn deal-btn-ghost" onClick={onAdd} disabled={!canAdd}>
        + Thêm Mức
      </button>
    </div>
  );
}
