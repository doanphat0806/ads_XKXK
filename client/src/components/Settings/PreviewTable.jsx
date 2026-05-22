import React from 'react';
import { DEFAULT_CONFIG } from '../../types/chuaCoConfig.types';
import { getPreviewSamples } from '../../utils/calculations';

export default function PreviewTable({ samples }) {
  const defaultSamples = getPreviewSamples(DEFAULT_CONFIG);

  return (
    <div className="deal-preview-box">
      {samples.map((sample, index) => {
        const defaultValue = defaultSamples[index]?.value;
        const changed = defaultValue !== sample.value;
        return (
          <div key={sample.qty} className={`deal-preview-chip ${changed ? 'is-changed' : ''}`}>
            SL={sample.qty}→{sample.value}
          </div>
        );
      })}
      <div className="deal-preview-note">(màu vàng = khác mặc định)</div>
    </div>
  );
}
