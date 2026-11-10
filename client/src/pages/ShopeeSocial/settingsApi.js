import { api } from '../../lib/api';

// Cai dat nhap tay (CPC mac dinh, CPC/click theo SubID2, ten file) luu tren server
// de khong mat khi restart / doi trinh duyet / xoa cache.

export async function fetchShopeeSocialSettings() {
  const result = await api('GET', '/shopee-social/settings');
  return result?.settings || null;
}

export async function saveShopeeSocialSettings(settings) {
  const result = await api('PUT', '/shopee-social/settings', settings);
  return result?.settings || null;
}

export async function deleteShopeeSocialSettings() {
  return api('DELETE', '/shopee-social/settings');
}
