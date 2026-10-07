import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .trim();

// Cua so tuy chinh cot: trai = nhom, giua = tim + tick chon, phai = cot da chon (keo de sap xep, x de bo).
// Chi ap dung khi bam "Ap dung"; Huy / Esc / bam ra ngoai thi bo thay doi.
export default function ColumnSettingsModal({
  columns,
  groups,
  order,
  hidden,
  defaultOrder,
  defaultHidden = [],
  pinnedLabel,
  presetName = '',
  onApply,
  onSavePreset,
  onClose
}) {
  const [draftOrder, setDraftOrder] = useState(order);
  const [draftHidden, setDraftHidden] = useState(() => new Set(hidden));
  const [search, setSearch] = useState('');
  const [draftPresetName, setDraftPresetName] = useState(presetName);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [activeGroup, setActiveGroup] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  const listRef = useRef(null);
  const groupRefs = useRef({});

  useEffect(() => {
    const handleKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const columnById = useMemo(() => new Map(columns.map(column => [column.id, column])), [columns]);
  const selectedColumns = draftOrder.map(id => columnById.get(id)).filter(column => column && !draftHidden.has(column.id));
  const query = normalize(search);
  const groupedColumns = groups
    .map(group => ({
      ...group,
      items: columns.filter(column => column.group === group.id && (!query || normalize(column.label).includes(query)))
    }))
    .filter(group => group.items.length > 0);

  const toggle = (id) => {
    const nextHidden = new Set(draftHidden);
    if (nextHidden.has(id)) {
      nextHidden.delete(id);
      // Cot vua bat them xuong cuoi danh sach da chon
      setDraftOrder(current => [...current.filter(item => item !== id), id]);
    } else {
      nextHidden.add(id);
    }
    setDraftHidden(nextHidden);
  };

  const move = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setDraftOrder(current => {
      const next = current.filter(id => id !== fromId);
      const fromIndex = current.indexOf(fromId);
      const toIndex = next.indexOf(toId);
      next.splice(fromIndex <= toIndex ? toIndex + 1 : toIndex, 0, fromId);
      return next;
    });
  };

  const scrollToGroup = (groupId) => {
    setActiveGroup(groupId);
    setSearch('');
    setCollapsedGroups(current => {
      if (!current.has(groupId)) return current;
      const next = new Set(current);
      next.delete(groupId);
      return next;
    });
    requestAnimationFrame(() => {
      const target = groupId ? groupRefs.current[groupId] : null;
      if (target && listRef.current) listRef.current.scrollTo({ top: target.offsetTop - listRef.current.offsetTop, behavior: 'smooth' });
      else listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const toggleCollapse = (groupId) => {
    setCollapsedGroups(current => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const resetDefault = () => {
    setDraftOrder(defaultOrder);
    setDraftHidden(new Set(defaultHidden));
  };

  const clearDrag = () => { setDraggingId(''); setDragOverId(''); };

  return createPortal(
    <div className="colset-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="colset-modal" role="dialog" aria-modal="true" aria-labelledby="colset-title">
        <div className="colset-header">
          <h3 id="colset-title">Tùy chỉnh</h3>
          <button type="button" className="colset-close" onClick={onClose} aria-label="Đóng">×</button>
        </div>

        <div className="colset-body">
          <nav className="colset-nav">
            <button type="button" className={`colset-nav-item colset-nav-title${activeGroup === '' ? ' is-active' : ''}`} onClick={() => scrollToGroup('')}>
              Tất cả cột
            </button>
            {groups.map(group => (
              <button
                key={group.id}
                type="button"
                className={`colset-nav-item${activeGroup === group.id ? ' is-active' : ''}`}
                onClick={() => scrollToGroup(group.id)}
              >
                {group.label}
              </button>
            ))}
          </nav>

          <div className="colset-main">
            <div className="colset-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm kiếm" autoFocus />
            </div>
            <div className="colset-list" ref={listRef}>
              <div className="colset-group">
                <div className="colset-group-head"><span>Cố định</span></div>
                <label className="colset-check is-disabled">
                  <input type="checkbox" checked disabled />
                  <span>{pinnedLabel}</span>
                </label>
              </div>
              {groupedColumns.map(group => (
                <div key={group.id} className="colset-group" ref={node => { groupRefs.current[group.id] = node; }}>
                  <button type="button" className="colset-group-head" onClick={() => toggleCollapse(group.id)} aria-expanded={!collapsedGroups.has(group.id)}>
                    <span>{group.label}</span>
                    <span className={`colset-chevron${collapsedGroups.has(group.id) ? ' is-collapsed' : ''}`} aria-hidden="true" />
                  </button>
                  {!collapsedGroups.has(group.id) && group.items.map(column => (
                    <label key={column.id} className="colset-check">
                      <input type="checkbox" checked={!draftHidden.has(column.id)} onChange={() => toggle(column.id)} />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              ))}
              {groupedColumns.length === 0 && <div className="colset-empty">Không tìm thấy cột "{search}"</div>}
            </div>
          </div>

          <aside className="colset-selected">
            <div className="colset-selected-title">Đã chọn {selectedColumns.length + 1} cột</div>
            <div className="colset-chip is-pinned" title="Cột cố định">
              <span className="colset-grip" aria-hidden="true">⠿</span>
              <span className="colset-chip-label">{pinnedLabel}</span>
            </div>
            <div className="colset-divider" />
            <div className="colset-selected-list">
              {selectedColumns.map(column => (
                <div
                  key={column.id}
                  className={`colset-chip${draggingId === column.id ? ' is-dragging' : ''}${dragOverId === column.id && draggingId !== column.id ? ' is-drag-over' : ''}`}
                  draggable
                  onDragStart={event => {
                    setDraggingId(column.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', column.id);
                  }}
                  onDragOver={event => {
                    event.preventDefault();
                    if (dragOverId !== column.id) setDragOverId(column.id);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    move(draggingId || event.dataTransfer.getData('text/plain'), column.id);
                    clearDrag();
                  }}
                  onDragEnd={clearDrag}
                >
                  <span className="colset-grip" aria-hidden="true">⠿</span>
                  <span className="colset-chip-label">{column.label}</span>
                  <button type="button" className="colset-chip-remove" onClick={() => toggle(column.id)} aria-label={`Bỏ cột ${column.label}`}>×</button>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="colset-footer">
          <button type="button" className="colset-link" onClick={resetDefault}>Khôi phục mặc định</button>
          <div className="colset-footer-actions">
            {onSavePreset && (
              <form
                className="colset-preset-form"
                onSubmit={event => {
                  event.preventDefault();
                  const name = draftPresetName.trim();
                  if (name) onSavePreset(name, { order: draftOrder, hidden: draftHidden });
                }}
              >
                <input value={draftPresetName} onChange={event => setDraftPresetName(event.target.value)} placeholder="Tên phương án" maxLength={40} />
                <button type="submit" className="colset-save" disabled={!draftPresetName.trim()}>Lưu phương án</button>
              </form>
            )}
            <button type="button" className="colset-cancel" onClick={onClose}>Hủy</button>
            <button type="button" className="colset-apply" onClick={() => onApply({ order: draftOrder, hidden: draftHidden })}>Áp dụng</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
