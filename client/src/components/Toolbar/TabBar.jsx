import React from 'react';

export default function TabBar({ tabs, activeTab, onChange }) {
  return (
    <div className="deal-tabbar">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          className={`deal-tab ${activeTab === tab.id ? 'is-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
