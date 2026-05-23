import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import GroupHeader from './GroupHeader';
import SummaryFooter from './SummaryFooter';
import TableCell from './TableCell';
import TableHeader from './TableHeader';
import { formatCompactInt, formatCurrency, formatPercent } from '../../utils/formatters';

function GroupSummaryRow({ group, visibleColumns }) {
  const labelColumnId = visibleColumns.some(column => column.id === 'ghiChu')
    ? 'ghiChu'
    : visibleColumns[0]?.id;

  return (
    <tr className="deal-group-summary-row">
      {visibleColumns.map((column, index) => {
        let value = '';
        if (column.id === labelColumnId && index >= 0) value = 'TỔNG';
        if (column.id === 'cpo') value = formatCurrency(group.summary.cpo);
        if (column.id === 'slKhachDat') value = formatCompactInt(group.summary.slKhachDat);
        if (column.id === 'slThucDat') value = formatCompactInt(group.summary.slThucDat);
        if (column.id === 'tongDaShip') value = formatCompactInt(group.summary.tongDaShip);
        if (column.id === 'tiLeDat') value = formatPercent(group.summary.tiLeDat);

        return (
          <td key={column.id} className={`${column.sticky ? 'is-sticky-col' : ''} align-${column.align || 'left'}`}>
            {value}
          </td>
        );
      })}
    </tr>
  );
}

export default function OrderTable({
  groupedRows,
  visibleColumns,
  table,
  groupExpanded,
  onToggleGroup,
  editingCell,
  editValue,
  onStartEdit,
  onEditChange,
  onEditKeyDown,
  onEditBlur,
  searchTerm,
  colorRules,
  summary,
  onDeleteRow,
  onDirectInputChange
}) {
  const useVirtual = groupedRows.reduce((count, group) => count + group.rows.length, 0) > 80;
  const scrollRef = React.useRef(null);
  const flatRows = React.useMemo(() => groupedRows.flatMap(group => (
    groupExpanded[group.prefix] === false
      ? [{ kind: 'group', group }]
      : [
          { kind: 'group', group },
          ...group.rows.map(row => ({ kind: 'row', group, row })),
          { kind: 'summary', group }
        ]
  )), [groupExpanded, groupedRows]);

  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? flatRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => flatRows[index]?.kind === 'group' ? 48 : 34,
    overscan: 8
  });

  const virtualItems = useVirtual ? rowVirtualizer.getVirtualItems() : [];
  const totalSize = useVirtual ? rowVirtualizer.getTotalSize() : 0;

  const renderItem = (item) => {
    if (item.kind === 'group') {
      return (
        <GroupHeader
          key={`group-${item.group.prefix}`}
          group={item.group}
          expanded={groupExpanded[item.group.prefix] !== false}
          onToggle={() => onToggleGroup(item.group.prefix)}
          columnCount={visibleColumns.length}
        />
      );
    }

    if (item.kind === 'summary') {
      return <GroupSummaryRow key={`summary-${item.group.prefix}`} group={item.group} visibleColumns={visibleColumns} />;
    }

    const rowClass = colorRules.getRowColor(item.row.slCanDatThem);
    return (
      <tr key={item.row.id} className={`deal-data-row ${rowClass}`.trim()}>
        {visibleColumns.map(column => {
          const isEditing = editingCell?.rowId === item.row.id && editingCell?.columnId === column.id;
          return (
            <TableCell
              key={`${item.row.id}-${column.id}`}
              value={item.row[column.id]}
              column={column}
              row={item.row}
              searchTerm={searchTerm}
              isEditing={isEditing}
              editValue={isEditing ? editValue : ''}
              onStartEdit={onStartEdit}
              onEditChange={onEditChange}
              onEditKeyDown={onEditKeyDown}
              onEditBlur={onEditBlur}
              colorRules={colorRules}
              onDeleteRow={onDeleteRow}
              onDirectInputChange={onDirectInputChange}
            />
          );
        })}
      </tr>
    );
  };

  return (
    <div className="deal-table-shell">
      <div className="deal-table-scroll" ref={scrollRef}>
        <table className="deal-table">
          <TableHeader table={table} visibleColumns={visibleColumns} />
          {!useVirtual ? (
            <tbody>{flatRows.map(renderItem)}</tbody>
          ) : (
            <tbody style={{ position: 'relative', height: `${totalSize}px` }}>
              {virtualItems.map(virtualItem => {
                const item = flatRows[virtualItem.index];
                return (
                  <tr
                    key={`virtual-${virtualItem.key}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transform: `translateY(${virtualItem.start}px)`,
                      width: '100%',
                      display: 'table',
                      tableLayout: 'fixed'
                    }}
                  >
                    <td colSpan={visibleColumns.length} style={{ padding: 0, border: 0 }}>
                      <table className="deal-table deal-table-virtual-inner">
                        <tbody>{renderItem(item)}</tbody>
                      </table>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>
      <SummaryFooter summary={summary} />
    </div>
  );
}
