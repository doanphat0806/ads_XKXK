'use strict';

const { VN_OFFSET_MS } = require('../config/appConstants');

/**
 * Trả về số phút trong ngày theo giờ Việt Nam (UTC+7).
 * @param {Date} [date]
 * @returns {number}
 */
function getVietnamDayMinute(date = new Date()) {
  const vnOffset = 7 * 60; // minutes
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + vnOffset) % (24 * 60);
}

/**
 * Kiểm tra thời điểm hiện tại có đúng giờ:phút VN không.
 * @param {number} hour
 * @param {number} minute
 * @param {Date} [date]
 * @returns {boolean}
 */
function isVietnamTimeMinute(hour = 0, minute = 0, date = new Date()) {
  return getVietnamDayMinute(date) === (hour * 60 + minute);
}

/**
 * Kiểm tra giờ VN hiện tại có nằm trong khoảng startTime–endTime không.
 * @param {string} startTime  HH:MM
 * @param {string} endTime    HH:MM
 * @returns {boolean}
 */
function isWithinAutoRuleTimeWindow(startTime, endTime) {
  const vnMinutes = getVietnamDayMinute();

  const [sh, sm] = (startTime || '00:00').split(':').map(Number);
  const [eh, em] = (endTime || '09:00').split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    return vnMinutes >= startMin && vnMinutes < endMin;
  } else {
    // Overnight range, e.g. 22:00 - 06:00
    return vnMinutes >= startMin || vnMinutes < endMin;
  }
}

/**
 * Trả về ngày hôm nay theo giờ VN (YYYY-MM-DD).
 * @returns {string}
 */
function todayStr() {
  const d = new Date();
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split('T')[0];
}

/**
 * Trả về YYYY-MM-DD của ngày lệch daysOffset so với hôm nay (giờ VN).
 * @param {number} daysOffset
 * @returns {string}
 */
function dateKeyFromVnOffset(daysOffset = 0) {
  const d = new Date(Date.now() + VN_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().split('T')[0];
}

/**
 * Chuẩn hóa chuỗi ngày, nếu rỗng thì dùng hôm nay.
 * @param {string} value
 * @returns {string}
 */
function normalizeCampaignDate(value) {
  const date = String(value || '').trim();
  return date || todayStr();
}

/**
 * Trả về { startUtc, endUtc } cho một ngày theo giờ VN.
 * @param {string} dateKey
 */
function buildVnDateRange(dateKey) {
  const normalized = normalizeCampaignDate(dateKey);
  const startUtc = new Date(`${normalized}T00:00:00+07:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { normalized, startUtc, endUtc };
}

/**
 * Kiểm tra thời điểm VN có sau giờ:phút không.
 * @param {number} hour
 * @param {number} minute
 * @returns {boolean}
 */
function isAfterVietnamTime(hour = 21, minute = 0) {
  const now = new Date(Date.now() + VN_OFFSET_MS);
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const thresholdMinutes = hour * 60 + minute;
  return currentMinutes >= thresholdMinutes;
}

/**
 * Parse chuỗi "HH:MM" thành { hour, minute }.
 * @param {string} value
 * @param {string} fallback
 */
function parseHourMinute(value, fallback = '21:00') {
  const raw = String(value || fallback).trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return parseHourMinute(fallback, fallback);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Lấy date key VN từ một giá trị Date/timestamp.
 * @param {Date|string|number} value
 * @returns {string}
 */
function getVnDateKeyFromDateValue(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time)) return '';
  return new Date(time + VN_OFFSET_MS).toISOString().split('T')[0];
}

/**
 * Kiểm tra dateKey có nằm trong khoảng [fromDate, toDate] không.
 * @param {string} dateKey
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {boolean}
 */
function isDateKeyInRange(dateKey, fromDate, toDate) {
  const normalized = String(dateKey || '').trim();
  if (!normalized) return false;
  const from = normalizeCampaignDate(fromDate);
  const to = normalizeCampaignDate(toDate || from);
  return normalized >= from && normalized <= to;
}

/**
 * Trả về { startUtc, endUtc } từ khoảng ngày VN.
 */
function getVietnamDateRangeBounds(fromDate, toDate) {
  const from = normalizeCampaignDate(fromDate);
  const to = normalizeCampaignDate(toDate || from);
  const startUtc = new Date(`${from}T00:00:00+07:00`);
  const endStartUtc = new Date(`${to}T00:00:00+07:00`);
  return {
    startUtc,
    endUtc: new Date(endStartUtc.getTime() + 24 * 60 * 60 * 1000)
  };
}

/**
 * Kiểm tra khoảng ngày có bao gồm hôm nay không.
 */
function dateRangeIncludesToday(fromDate, toDate) {
  const today = todayStr();
  return String(fromDate || today) <= today && String(toDate || fromDate || today) >= today;
}

/**
 * Kiểm tra khoảng ngày có chạm hôm nay hoặc tương lai không.
 */
function dateRangeTouchesTodayOrFuture(fromDate, toDate) {
  const today = todayStr();
  return String(toDate || fromDate || today) >= today;
}

module.exports = {
  getVietnamDayMinute,
  isVietnamTimeMinute,
  isWithinAutoRuleTimeWindow,
  todayStr,
  dateKeyFromVnOffset,
  normalizeCampaignDate,
  buildVnDateRange,
  isAfterVietnamTime,
  parseHourMinute,
  getVnDateKeyFromDateValue,
  isDateKeyInRange,
  getVietnamDateRangeBounds,
  dateRangeIncludesToday,
  dateRangeTouchesTodayOrFuture
};
