export function getSLCanDatThemColor(value) {
  if (typeof value !== 'number') return '';
  if (value < 0) return 'tone-danger-strong';
  if (value > 0) return 'tone-success-strong';
  return 'tone-neutral-soft';
}

export function getTiLeDatColor(value) {
  if (value < 0.6) return 'tone-danger';
  if (value < 0.8) return 'tone-warning';
  return 'tone-success';
}

export function getTiLeHoanColor(value) {
  if (value >= 0.5) return 'tone-danger';
  if (value >= 0.3) return 'tone-orange';
  if (value > 0) return 'tone-warning-soft';
  return 'tone-success-soft';
}

export function getTiLeShipColor(value) {
  if (value >= 0.99) return 'tone-success';
  if (value >= 0.8) return 'tone-warning';
  return 'tone-danger';
}

export function getNgayKetThucColor(value) {
  if (value <= 0) return 'tone-slate';
  if (value <= 7) return 'tone-danger-strong';
  if (value <= 30) return 'tone-orange';
  return '';
}

export function getRowColor(slCanDatThem) {
  if (typeof slCanDatThem !== 'number') return '';
  if (slCanDatThem < -5) return 'row-danger';
  if (slCanDatThem < 0) return 'row-warning';
  return '';
}
