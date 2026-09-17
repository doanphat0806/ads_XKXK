const STORAGE_KEY = 'shopee_social_affiliate_v1';

function safeParse(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadState() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = safeParse(raw, null);
    if (!parsed) return null;
    return {
      ...parsed,
      orders: (parsed.orders || []).map(o => ({ ...o, orderTime: o.orderTime ? new Date(o.orderTime) : null }))
    };
  } catch {
    return null;
  }
}

export function saveState(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function clearState() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
