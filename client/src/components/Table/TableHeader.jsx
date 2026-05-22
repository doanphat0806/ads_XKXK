import React from 'react';
import { ORDER_GROUP_META } from '../../types/order.types';

function getSortIcon(column) {
  const sorted = column.getIsSorted();
  if (sorted === 'asc') return '↑';
  if (sorted === 'desc') return '↓';
  return '↕';
}

export default function TableHeader({ table, visibleColumns }) {
  const groupCells = [];
  let currentGroup = null;

  visibleColumns.forEach(column => {
    if (!currentGroup || currentGroup.group !== column.group) {
      currentGroup = { group: column.group, count: 1 };
      groupCells.push(currentGroup);
    } else {
      currentGroup.count += 1;
    }
  });

  return (
    <thead>
      <tr className="deal-header-groups">
        {groupCells.map(group => (
          <th key={group.group} colSpan={group.count} className={ORDER_GROUP_META[group.group]?.colorClass}>
            {ORDER_GROUP_META[group.group]?.label}
          </th>
        ))}
      </tr>
      <tr className="deal-header-columns">
        {table.getVisibleLeafColumns().map(column => {
          const meta = column.columnDef.meta;
          const canSort = column.getCanSort();
          return (
            <th
              key={column.id}
              style={{ width: meta.width, minWidth: meta.width }}
              className={`${meta.sticky ? 'is-sticky-col sticky-shadow' : ''} align-${meta.align || 'left'}`}
              onClick={canSort ? column.getToggleSortingHandler() : undefined}
            >
              <div className="deal-header-cell">
                <span>{column.columnDef.header}</span>
                <span className="deal-sort-icon">{canSort ? getSortIcon(column) : ''}</span>
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
