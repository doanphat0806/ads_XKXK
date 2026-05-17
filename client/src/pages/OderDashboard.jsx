import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api, formatNumber, todayString } from '../lib/api';

const DEFAULT_FROM_DATE = '2026-04-01';
const EMPTY_ARRAY = [];

export default function OderDashboard() {
  const [fromDate, setFromDate] = useState(DEFAULT_FROM_DATE);
  const [toDate, setToDate] = useState(() => todayString());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingDate, setSavingDate] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteEditor, setNoteEditor] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const result = await api('GET', `/oder/dashboard?${params.toString()}`);
      setData(result);
    } catch (error) {
      toast.error(`Loi tai dashboard: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dailyStats = data?.dailyStats || EMPTY_ARRAY;

  const saveCancellation = async (row, value) => {
    if (!row?.ngay || row.isWeekTotal || row.isMonthTotal) return;
    const huy = Math.max(0, Math.floor(Number(value) || 0));
    setSavingDate(row.ngay);
    try {
      await api('PUT', `/oder/dashboard/cancellations/${encodeURIComponent(row.ngay)}`, { huy });
      await loadData();
      toast.success('Đã lưu cột Hủy');
    } catch (error) {
      toast.error(`Lỗi lưu Hủy: ${error.message}`);
      await loadData();
    } finally {
      setSavingDate('');
    }
  };

  const openNoteEditor = (row) => {
    if (!row?.ngay) return;
    const isTotal = row.isWeekTotal || row.isMonthTotal;
    if (isTotal && !row.chuaCoMvdNote) return;
    setNoteEditor({
      dateKey: row.ngay,
      chuaCoMvd: row.chuaCoMvd || 0,
      note: row.chuaCoMvdNote || '',
      readOnly: isTotal
    });
  };

  const closeNoteEditor = () => {
    if (!savingNote) setNoteEditor(null);
  };

  const saveNote = async (event) => {
    event.preventDefault();
    if (!noteEditor || noteEditor.readOnly) return;
    setSavingNote(true);
    try {
      await api('PUT', `/oder/dashboard/notes/${encodeURIComponent(noteEditor.dateKey)}`, {
        note: noteEditor.note
      });
      await loadData();
      setNoteEditor(null);
      toast.success('Đã lưu ghi chú');
    } catch (error) {
      toast.error(`Lỗi lưu ghi chú: ${error.message}`);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div id="page-oder-dashboard">
      <div className="card">
        <div className="card-header">
          <div className="card-title">Dashboard Đơn Hàng</div>
          <div className="inventory-search">
            <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
            <button className="btn btn-ghost btn-sm" onClick={loadData} disabled={loading}>
              {loading ? 'Dang tai...' : 'Tai lai'}
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          {loading && !data ? (
            <div className="empty"><span className="spin">...</span><p>Dang tai...</p></div>
          ) : dailyStats.length === 0 ? (
            <div className="empty"><div className="ei">0</div><p>Chua co du lieu</p></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th className="text-right">Mã đơn hàng</th>
                  <th className="text-right">SL Hàng</th>
                  <th className="text-right">Mã Vận Đơn</th>
                  <th className="text-right">MVĐ Về</th>
                  <th className="text-right">Chưa có MVĐ</th>
                  <th className="text-right">Hủy</th>
                  <th className="text-right">Tỉ Lệ MVĐ/Đơn</th>
                  <th className="text-right">Thiếu Hàng</th>
                  <th className="text-right">Sai Hàng</th>
                  <th className="text-right">Về Thừa</th>
                  <th className="text-right">Thất Lạc</th>
                </tr>
              </thead>
              <tbody>
                {dailyStats.map(row => {
                  const effectiveOrderCount = Math.max(0, Number(row.maDonHang || 0) - Number(row.huy || 0));
                  const tiLePercent = effectiveOrderCount > 0 ? (row.maVanDon / effectiveOrderCount) * 100 : 0;
                  const isWeekTotal = row.isWeekTotal;
                  const isMonthTotal = row.isMonthTotal;
                  const rowClass = isMonthTotal ? 'row-month-total' : isWeekTotal ? 'row-week-total' : '';
                  const isTotal = isWeekTotal || isMonthTotal;
                  const hasNote = Boolean(row.chuaCoMvdNote);
                  const canOpenNote = !isTotal || hasNote;
                  const noteTitle = isTotal
                    ? (hasNote ? 'Bấm để xem ghi chú tổng hợp' : '')
                    : (hasNote ? 'Bấm để xem/sửa ghi chú' : 'Bấm để thêm ghi chú');

                  return (
                    <tr key={row.ngay} className={rowClass}>
                      <td>{row.ngay}</td>
                      <td className="text-right mono-sm">{formatNumber(row.maDonHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.slHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.maVanDon || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.mvdVe || 0)}</td>
                      <td
                        className={`text-right mono-sm dashboard-chua-cell ${hasNote ? 'dashboard-note-cell' : ''} ${canOpenNote ? 'dashboard-note-clickable' : ''}`}
                        title={noteTitle}
                        role={canOpenNote ? 'button' : undefined}
                        tabIndex={canOpenNote ? 0 : undefined}
                        onClick={() => openNoteEditor(row)}
                        onKeyDown={event => {
                          if (!canOpenNote) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openNoteEditor(row);
                          }
                        }}
                      >
                        {formatNumber(row.chuaCoMvd || 0)}
                      </td>
                      <td className="text-right mono-sm">
                        {isWeekTotal || isMonthTotal ? (
                          formatNumber(row.huy || 0)
                        ) : (
                          <input
                            key={`${row.ngay}-${row.huy || 0}`}
                            className="dashboard-cancel-input"
                            type="number"
                            min="0"
                            defaultValue={row.huy || 0}
                            disabled={savingDate === row.ngay}
                            onBlur={event => saveCancellation(row, event.target.value)}
                            onKeyDown={event => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                              if (event.key === 'Escape') {
                                event.currentTarget.value = row.huy || 0;
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        )}
                      </td>
                      <td className="text-right mono-sm" style={{
                        backgroundColor: tiLePercent < 90 ? '#ff4444' : tiLePercent < 95 ? '#ff9933' : 'transparent',
                        color: tiLePercent < 90 ? 'white' : 'inherit'
                      }}>
                        {tiLePercent.toFixed(2)}%
                      </td>
                      <td className="text-right mono-sm">{formatNumber(row.thieuHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.saiHang || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.veThua || 0)}</td>
                      <td className="text-right mono-sm">{formatNumber(row.thatLac || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {noteEditor && (
        <div className="modal-overlay open" onClick={closeNoteEditor}>
          <div className="modal dashboard-note-modal" onClick={event => event.stopPropagation()}>
            <form onSubmit={saveNote}>
              <div className="card-header dashboard-note-modal-header">
                <div>
                  <div className="card-title">Ghi chú Chưa có MVĐ</div>
                  <div className="dashboard-note-meta">
                    {noteEditor.dateKey} - Chưa có MVĐ: {formatNumber(noteEditor.chuaCoMvd || 0)}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeNoteEditor} disabled={savingNote}>
                  Đóng
                </button>
              </div>
              <div className="dashboard-note-modal-body">
                <div className="form-group">
                  <label>Nội dung ghi chú</label>
                  <textarea
                    value={noteEditor.note}
                    onChange={event => setNoteEditor(current => (
                      current ? { ...current, note: event.target.value } : current
                    ))}
                    placeholder="Nhập ghi chú thủ công cho ngày này..."
                    readOnly={noteEditor.readOnly}
                    disabled={savingNote}
                    autoFocus={!noteEditor.readOnly}
                  />
                </div>
                <div className="helper-text">
                  {noteEditor.readOnly
                    ? 'Dòng tổng hợp chỉ để xem ghi chú của các ngày bên trong.'
                    : 'Xóa hết nội dung và bấm Lưu nếu muốn bỏ góc cam ghi chú.'}
                </div>
                {!noteEditor.readOnly && (
                  <div className="form-actions dashboard-note-actions">
                    <button type="button" className="btn btn-ghost" onClick={closeNoteEditor} disabled={savingNote}>
                      Hủy
                    </button>
                    <button type="submit" className="btn btn-g" disabled={savingNote}>
                      {savingNote ? 'Đang lưu...' : 'Lưu ghi chú'}
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
