import React from 'react';
import { Search } from 'lucide-react';

export default function SearchBar({ value, onChange }) {
  return (
    <label className="deal-search-bar">
      <Search size={16} />
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Tìm theo mã, ghi chú..."
      />
    </label>
  );
}
