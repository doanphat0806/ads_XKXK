// xlsx day du ~425KB; ban mini ~250KB du cho xuat file va doc .xlsx/.csv, chi thieu .xls (Excel cu) -> moi tai ban day du.
export async function loadXlsx(fileName = '') {
  if (/\.xls$/i.test(String(fileName))) return import('xlsx');
  const mod = await import('xlsx/dist/xlsx.mini.min.js');
  return mod.default || mod;
}
