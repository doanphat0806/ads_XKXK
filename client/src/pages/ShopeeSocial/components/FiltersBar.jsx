import React from 'react';
import { Search } from 'lucide-react';
import DateRangePicker from '../../../components/DateRangePicker';
import { PLATFORM_ORDER, STATUS_LABELS } from '../utils';

const PLATFORM_LABELS = {
  facebook: 'Facebook', tiktok: 'TikTok', telegram: 'Telegram',
  zalo: 'Zalo', threads: 'Threads', youtube: 'YouTube', instagram: 'Instagram', khac: 'Khác'
};

export default function FiltersBar({ filters, onChange, availablePlatforms }) {
  const platformOptions = PLATFORM_ORDER.filter(p => availablePlatforms.has(p));

  return (
    <div className="card shopee-social-filters">
      <DateRangePicker
        fromDate={filters.fromDate}
        toDate={filters.toDate}
        onChange={(fromDate, toDate) => onChange({ ...filters, fromDate, toDate })}
        centered
      />

      <select
        className="shopee-social-input"
        value={filters.platformKey}
        onChange={e => onChange({ ...filters, platformKey: e.target.value })}
        title="Lọc theo nền tảng"
      >
        <option value="all">Tất cả nền tảng</option>
        {platformOptions.map(p => (
          <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>
        ))}
      </select>

      <select
        className="shopee-social-input"
        value={filters.status}
        onChange={e => onChange({ ...filters, status: e.target.value })}
        title="Lọc theo trạng thái"
      >
        <option value="all">Tất cả trạng thái</option>
        <option value="completed">{STATUS_LABELS.completed}</option>
        <option value="pending">{STATUS_LABELS.pending}</option>
        <option value="cancelled">{STATUS_LABELS.cancelled}</option>
      </select>

      <div className="shopee-social-search">
        <Search size={14} strokeWidth={2} />
        <input
          className="shopee-social-input"
          placeholder="Tìm theo SubID, mã đơn, sản phẩm, shop..."
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
        />
      </div>
    </div>
  );
}
