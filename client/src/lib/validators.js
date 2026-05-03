export const isValidAdAccountId = (value) => /^(act_)?\d+$/.test(String(value || '').trim());
