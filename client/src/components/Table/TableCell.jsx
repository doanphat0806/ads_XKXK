import React from 'react';
import toast from 'react-hot-toast';
import ColorCell from './ColorCell';
import { formatCurrency, formatInt, formatPercent } from '../../utils/formatters';

const CPO_CODE_WARNING_LIMIT = 140000;

function renderDisplayValue(value, type) {
  if (type === 'currency') return formatCurrency(Number(value || 0));
  if (type === 'percent') return formatPercent(Number(value || 0));
  if (type === 'number' || type === 'numberOrText') return typeof value === 'number' ? formatInt(value) : String(value ?? '');
  return String(value ?? '');
}

function buildSearchMarkup(text, searchTerm) {
  if (!searchTerm) return text;
  const lowerText = String(text).toLowerCase();
  const lowerSearch = String(searchTerm).toLowerCase();
  const index = lowerText.indexOf(lowerSearch);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + searchTerm.length)}</mark>
      {text.slice(index + searchTerm.length)}
    </>
  );
}

function CellInner({
  value,
  column,
  row,
  searchTerm,
  isEditing,
  editValue,
  onStartEdit,
  onEditChange,
  onEditKeyDown,
  onEditBlur,
  colorRules,
  onDeleteRow,
  onDirectInputChange
}) {
  const { id, type, sticky, align } = column;
  const classes = [`align-${align || 'left'}`];
  if (sticky) classes.push('is-sticky-col');
  const isDirectInputColumn = ['orderSizeS', 'orderSizeM', 'orderSizeL', 'orderSizeXL', 'orderSizeFZ'].includes(id);

  if (type === 'action') {
    return (
      <td className={classes.join(' ')} style={{ width: column.width, minWidth: column.width }}>
        <button type="button" className="deal-delete-btn" onClick={() => onDeleteRow?.(row)}>
          Xóa
        </button>
      </td>
    );
  }

  let toneClass = '';
  if (id === 'ma' && (Number(row.tiLeHoan || 0) >= 0.39 || Number(row.cpo || 0) > CPO_CODE_WARNING_LIMIT)) toneClass = 'tone-danger-strong';
  if (id === 'slCanDatThem') toneClass = colorRules.getSLCanDatThemColor(value);
  if (id === 'tiLeDat') toneClass = colorRules.getTiLeDatColor(value);
  if (id === 'tiLeHoan') toneClass = colorRules.getTiLeHoanColor(value);
  if (id === 'tiLeShip') toneClass = colorRules.getTiLeShipColor(value);

  const isCodeColumn = id === 'ma';
  const editable = column.editable;
  const isNoteColumn = id === 'ghiChu';
  const noteDot = id === 'ghiChu' && String(value || '').trim();
  const displayValue = renderDisplayValue(value, type);

  if (isDirectInputColumn) {
    return (
      <td className={classes.join(' ')} style={{ width: column.width, minWidth: column.width }}>
        <input
          className="deal-inline-grid-input"
          value={value === '' || value === null || value === undefined ? '' : String(value)}
          onChange={event => onDirectInputChange?.(row.id, id, event.target.value)}
          type="text"
        />
      </td>
    );
  }

  const handleCellClick = async () => {
    if (isCodeColumn) {
      const text = String(value || '').trim();
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        toast.success(`Đã copy mã ${text}`);
      } catch {
        toast.error('Không copy được mã');
      }
      return;
    }

    if (editable) {
      onStartEdit(row.id, id, value);
    }
  };

  return (
    <td className={classes.join(' ')} style={{ width: column.width, minWidth: column.width }}>
      {isEditing ? (
        isNoteColumn ? (
          <textarea
            autoFocus
            className="deal-inline-textarea"
            value={editValue}
            onChange={event => onEditChange(event.target.value)}
            onKeyDown={onEditKeyDown}
            onBlur={onEditBlur}
            rows={2}
          />
        ) : (
          <input
            autoFocus
            className="deal-inline-input"
            value={editValue}
            onChange={event => onEditChange(event.target.value)}
            onKeyDown={onEditKeyDown}
            onBlur={onEditBlur}
          />
        )
      ) : (
        <button
          type="button"
          className={`deal-cell-button ${editable ? 'is-editable' : ''} ${isCodeColumn ? 'is-copyable' : ''}`.trim()}
          onClick={editable || isCodeColumn ? handleCellClick : undefined}
        >
          {noteDot ? <span className="deal-note-dot" /> : null}
          {toneClass ? (
            <ColorCell className={toneClass}>{buildSearchMarkup(displayValue, id === 'ma' || id === 'ghiChu' ? searchTerm : '')}</ColorCell>
          ) : (
            <span className={`deal-cell-content ${isNoteColumn ? 'is-note' : ''}`.trim()}>
              {buildSearchMarkup(displayValue, id === 'ma' || id === 'ghiChu' ? searchTerm : '')}
            </span>
          )}
          {editable ? <span className="deal-edit-icon">✏️</span> : null}
        </button>
      )}
    </td>
  );
}

const TableCell = React.memo(CellInner);

export default TableCell;
