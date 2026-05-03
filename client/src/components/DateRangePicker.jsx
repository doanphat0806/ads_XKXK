import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';

const formatDate = (d) => {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PRESETS = [
  { label: 'Trọn đời', value: 'lifetime' },
  { label: 'Hôm nay', value: 'today' },
  { label: 'Hôm qua', value: 'yesterday' },
  { label: '7 ngày qua', value: 'last7' },
  { label: '30 ngày qua', value: 'last30' },
  { label: 'Tuần này', value: 'thisWeek' },
  { label: 'Tuần trước', value: 'lastWeek' },
  { label: 'Tháng này', value: 'thisMonth' },
  { label: 'Tháng trước', value: 'lastMonth' },
];

const getRangeFromPreset = (preset) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let from, to = new Date(today);

  switch (preset) {
    case 'today':
      from = new Date(today);
      break;
    case 'yesterday':
      from = new Date(today);
      from.setDate(from.getDate() - 1);
      to = new Date(from);
      break;
    case 'last7':
      from = new Date(today);
      from.setDate(from.getDate() - 6);
      break;
    case 'last30':
      from = new Date(today);
      from.setDate(from.getDate() - 29);
      break;
    case 'thisWeek': {
      from = new Date(today);
      const day = from.getDay(); // 0 is Sun
      const diff = from.getDate() - day + (day === 0 ? -6 : 1); 
      from.setDate(diff);
      break;
    }
    case 'lastWeek': {
      from = new Date(today);
      const d2 = from.getDay();
      const diff2 = from.getDate() - d2 + (d2 === 0 ? -6 : 1) - 7;
      from.setDate(diff2);
      to = new Date(from);
      to.setDate(to.getDate() + 6);
      break;
    }
    case 'thisMonth':
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'lastMonth':
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
      break;
    case 'lifetime':
      from = new Date('2026-02-22');
      break;
    default:
      from = new Date(today);
  }

  return {
    from: formatDate(from),
    to: formatDate(to)
  };
};

const Calendar = ({ month, year, selectedFrom, selectedTo, onSelect, hoverDate, onHover }) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
  const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1; // Mon = 0

  const days = [];
  // Padding
  for (let i = 0; i < adjustedFirstDay; i++) days.push(null);
  // Real days
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

  const isSelected = (d) => {
    if (!d) return false;
    const s = formatDate(d);
    return s === selectedFrom || s === selectedTo;
  };

  const isInRange = (d) => {
    if (!d || !selectedFrom) return false;
    const s = formatDate(d);
    const to = selectedTo || hoverDate;
    if (!to) return false;
    if (selectedFrom < to) {
      return s > selectedFrom && s < to;
    } else {
      return s < selectedFrom && s > to;
    }
  };

  const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  return (
    <div className="drp-calendar">
      <div className="drp-days-grid">
        {dayNames.map(d => (
          <div key={d} className="drp-day-name">{d}</div>
        ))}
        {days.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} className="drp-day empty"></div>;
          const s = formatDate(d);
          const selected = isSelected(d);
          const range = isInRange(d);
          const isStart = s === selectedFrom;
          const isEnd = s === selectedTo;

          return (
            <div
              key={s}
              className={`drp-day ${selected ? 'selected' : ''} ${range ? 'in-range' : ''} ${isStart ? 'start' : ''} ${isEnd ? 'end' : ''}`}
              onClick={() => onSelect(s)}
              onMouseEnter={() => onHover(s)}
            >
              {d.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function DateRangePicker({ fromDate, toDate, onChange, centered = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState(fromDate);
  const [tempTo, setTempTo] = useState(toDate);
  const [activePreset, setActivePreset] = useState(null);
  const [viewDate, setViewDate] = useState(new Date(fromDate));
  const [hoverDate, setHoverDate] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    setTempFrom(fromDate);
    setTempTo(toDate);
    setViewDate(new Date(fromDate));
  }, [fromDate, toDate, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectDate = (date) => {
    setActivePreset(null);
    if (!tempFrom || (tempFrom && tempTo)) {
      setTempFrom(date);
      setTempTo(null);
    } else {
      if (date < tempFrom) {
        setTempTo(tempFrom);
        setTempFrom(date);
      } else {
        setTempTo(date);
      }
    }
  };

  const handlePreset = (preset) => {
    const { from, to } = getRangeFromPreset(preset.value);
    setTempFrom(from);
    setTempTo(to);
    setActivePreset(preset.value);
    setViewDate(new Date(from));
  };

  const handleUpdate = () => {
    onChange(tempFrom, tempTo || tempFrom);
    setIsOpen(false);
  };

  const displayRange = useMemo(() => {
    if (!tempFrom) return '...';
    if (!tempTo || tempFrom === tempTo) return tempFrom.split('-').reverse().join('/');
    return `${tempFrom.split('-').reverse().join('/')} ~ ${tempTo.split('-').reverse().join('/')}`;
  }, [tempFrom, tempTo]);

  const mainDisplay = useMemo(() => {
    if (!fromDate) return '...';
    if (!toDate || fromDate === toDate) return fromDate.split('-').reverse().join('/');
    return `${fromDate.split('-').reverse().join('/')} ~ ${toDate.split('-').reverse().join('/')}`;
  }, [fromDate, toDate]);

  const months = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const arr = [];
    for (let i = currentYear - 5; i <= currentYear + 5; i++) arr.push(i);
    return arr;
  }, []);

  return (
    <div className="drp-container" ref={containerRef}>
      <div className={`drp-trigger ${isOpen ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        <CalendarIcon size={14} className="icon" />
        <span>{mainDisplay}</span>
      </div>

      {isOpen && (
        <>
          {centered && <div className="drp-backdrop" onClick={() => setIsOpen(false)} />}
          <div className={`drp-popover ${centered ? 'centered' : ''}`}>
          <div className="drp-sidebar">
            <div className="drp-sidebar-title">Ngày đặt sẵn</div>
            <div className="drp-presets-list">
              {PRESETS.map(p => (
                <div
                  key={p.value}
                  className={`drp-preset-pill ${activePreset === p.value ? 'active' : ''}`}
                  onClick={() => handlePreset(p)}
                >
                  {p.label}
                </div>
              ))}
            </div>
          </div>

          <div className="drp-main">
            <div className="drp-calendars">
              <div className="drp-calendar-wrap">
                <div className="drp-header">
                  <select 
                    value={viewDate.getMonth()} 
                    onChange={e => setViewDate(new Date(viewDate.getFullYear(), parseInt(e.target.value), 1))}
                  >
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select 
                    value={viewDate.getFullYear()} 
                    onChange={e => setViewDate(new Date(parseInt(e.target.value), viewDate.getMonth(), 1))}
                  >
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <Calendar
                  month={viewDate.getMonth()}
                  year={viewDate.getFullYear()}
                  selectedFrom={tempFrom}
                  selectedTo={tempTo}
                  onSelect={handleSelectDate}
                  hoverDate={hoverDate}
                  onHover={setHoverDate}
                />
              </div>

              <div className="drp-calendar-wrap">
                <div className="drp-header">
                  <select 
                    value={new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1).getMonth()} 
                    onChange={e => setViewDate(new Date(viewDate.getFullYear(), parseInt(e.target.value) - 1, 1))}
                  >
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select 
                    value={new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1).getFullYear()} 
                    onChange={e => setViewDate(new Date(parseInt(e.target.value), viewDate.getMonth(), 1))}
                  >
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <Calendar
                  month={new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1).getMonth()}
                  year={new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1).getFullYear()}
                  selectedFrom={tempFrom}
                  selectedTo={tempTo}
                  onSelect={handleSelectDate}
                  hoverDate={hoverDate}
                  onHover={setHoverDate}
                />
              </div>
            </div>

            <div className="drp-footer">
              <div className="drp-footer-range">
                <div className="drp-footer-date">{displayRange}</div>
                <div className="drp-footer-tz">UTC+07:00</div>
              </div>
              <div className="drp-footer-actions">
                <button className="btn-drp btn-drp-cancel" onClick={() => setIsOpen(false)}>Hủy</button>
                <button className="btn-drp btn-drp-apply" onClick={handleUpdate}>Cập nhật</button>
              </div>
            </div>
          </div>
        </div>
      </>)}
    </div>
  );
}
