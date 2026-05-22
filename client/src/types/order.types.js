export const TAB_OPTIONS = [
  { id: 'tong-sl-hang-dat-new', label: 'Tổng SL Hàng Đặt (NEW)' }
];

export const STAFF_COLOR_OPTIONS = [
  'cyan',
  'red',
  'pink',
  'indigo',
  'orange',
  'yellow',
  'purple',
  'green',
  'slate'
];

export const DEFAULT_STAFF_LIST = [
  { id: 'staff-p', name: 'Thuy ChiHuahua', prefix: 'P', color: 'cyan' },
  { id: 'staff-z', name: 'Hiếu Phát', prefix: 'Z', color: 'red' },
  { id: 'staff-g', name: 'CHỊ MAI', prefix: 'G', color: 'pink' },
  { id: 'staff-f', name: 'LINH BÁCH', prefix: 'F', color: 'indigo' },
  { id: 'staff-l', name: 'LAN', prefix: 'L', color: 'orange' },
  { id: 'staff-u', name: 'UYÊN', prefix: 'U', color: 'yellow' },
  { id: 'staff-t', name: 'TRANG', prefix: 'T', color: 'purple' },
  { id: 'staff-x', name: 'Hoa Lớn', prefix: 'X', color: 'green' }
];

export const ORDER_GROUP_META = {
  thongTin: { id: 'thongTin', label: 'THÔNG TIN', colorClass: 'group-cyan' },
  datHang: { id: 'datHang', label: 'ĐẶT HÀNG', colorClass: 'group-orange' },
  tiLe: { id: 'tiLe', label: 'TỈ LỆ', colorClass: 'group-green' },
  giaoHang: { id: 'giaoHang', label: 'GIAO HÀNG', colorClass: 'group-purple' }
};

export const ORDER_COLUMN_CONFIG = [
  { id: 'actions', header: 'Xóa', group: 'thongTin', width: 76, type: 'action', editable: false, align: 'center', enableSorting: false },
  { id: 'ghiChu', header: 'Ghi Chú', group: 'thongTin', width: 220, type: 'text', editable: true, align: 'left' },
  { id: 'ma', header: 'Mã', group: 'thongTin', width: 132, type: 'text', editable: false, sticky: true, align: 'left' },
  { id: 'cpo', header: 'CPO', group: 'thongTin', width: 120, type: 'currency', editable: false, align: 'right' },
  { id: 'slKhachDat', header: 'SL Khách Đặt', group: 'thongTin', width: 120, type: 'number', editable: true, align: 'right' },
  { id: 'slThucDat', header: 'SL Thực Đặt', group: 'thongTin', width: 120, type: 'number', editable: true, align: 'right' },
  { id: 'slCanDatThem', header: 'SL Cần Đặt Thêm', group: 'datHang', width: 130, type: 'numberOrText', editable: false, align: 'right' },
  { id: 'sizeS', header: 'SIZE: S', group: 'datHang', width: 116, type: 'text', editable: true, align: 'left' },
  { id: 'sizeM', header: 'SIZE: M', group: 'datHang', width: 116, type: 'text', editable: true, align: 'left' },
  { id: 'sizeL', header: 'SIZE: L', group: 'datHang', width: 116, type: 'text', editable: true, align: 'left' },
  { id: 'sizeXL', header: 'SIZE: XL', group: 'datHang', width: 116, type: 'text', editable: true, align: 'left' },
  { id: 'slChenh', header: 'SL Chênh', group: 'datHang', width: 106, type: 'number', editable: false, align: 'right' },
  { id: 'tiLeDat', header: 'Tỉ Lệ Đặt', group: 'tiLe', width: 104, type: 'percent', editable: false, align: 'right' },
  { id: 'tiLeHoan', header: 'Tỉ Lệ Hoàn', group: 'tiLe', width: 104, type: 'percent', editable: true, align: 'right' },
  { id: 'dangGuiHang', header: 'Đang Gửi Hàng', group: 'giaoHang', width: 118, type: 'number', editable: true, align: 'right' },
  { id: 'tongDaShip', header: 'Tổng Đã Ship', group: 'giaoHang', width: 110, type: 'number', editable: true, align: 'right' },
  { id: 'tiLeShip', header: 'Tỉ Lệ Ship', group: 'giaoHang', width: 104, type: 'percent', editable: false, align: 'right' }
];

export const ORDER_COLUMN_MAP = ORDER_COLUMN_CONFIG.reduce((acc, column) => {
  acc[column.id] = column;
  return acc;
}, {});

export const DEFAULT_COLUMN_VISIBILITY = ORDER_COLUMN_CONFIG.reduce((acc, column) => {
  acc[column.id] = true;
  return acc;
}, {});

export const EDITABLE_COLUMNS = ORDER_COLUMN_CONFIG.filter(column => column.editable).map(column => column.id);

export const NUMERIC_COLUMNS = [
  'slKhachDat',
  'slThucDat',
  'dangGuiHang',
  'tongDaShip'
];

export const PERCENT_COLUMNS = ['tiLeDat', 'tiLeHoan', 'tiLeShip'];

export function getStaffByMa(ma, staffList = DEFAULT_STAFF_LIST) {
  const prefix = String(ma || '').trim().charAt(0).toUpperCase();
  if (!prefix) return null;
  return staffList.find(staff => String(staff.prefix || '').trim().toUpperCase() === prefix) || null;
}

export function createUnknownStaff(prefix) {
  return {
    id: `staff-${String(prefix || '').toLowerCase() || 'unknown'}`,
    name: `Nhóm ${String(prefix || '').toUpperCase() || '?'}`,
    prefix: String(prefix || '?').toUpperCase(),
    color: 'slate'
  };
}
