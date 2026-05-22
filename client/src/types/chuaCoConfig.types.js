export const DEFAULT_CONFIG = {
  tiers: [
    { id: 't1', maxQty: 9, rate: 1.0 },
    { id: 't2', maxQty: 20, rate: 0.7 },
    { id: 't3', maxQty: 40, rate: 0.6 },
    { id: 't4', maxQty: null, rate: 0.5 }
  ]
};

export const MIN_TIER_COUNT = 2;
export const MAX_TIER_COUNT = 8;
