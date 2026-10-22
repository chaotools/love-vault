// 生理期纯计算：服务端提醒、日历和统计共用，避免各路由重复解释。
const { shanghaiParts, shanghaiStartOfDay } = require('./date-resolution');

const DAY = 86400000;

function validCycles(period) {
  if (!period || !Array.isArray(period.lastCycles)) return [];
  return period.lastCycles
    .filter((value) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime()))
    .slice()
    .sort();
}

function averageDays(period) {
  const value = Number(period && period.avgDays);
  return Number.isInteger(value) && value >= 15 && value <= 60 ? value : 28;
}

function lastCycleDate(period) {
  const cycles = validCycles(period);
  return cycles.length ? new Date(cycles[cycles.length - 1]) : null;
}

function nextPeriodDate(period) {
  const last = lastCycleDate(period);
  if (!last) return null;
  return new Date(shanghaiStartOfDay(last).getTime() + averageDays(period) * DAY);
}

function periodStats(period) {
  const cycles = validCycles(period);
  if (cycles.length < 2) return null;
  const gaps = [];
  for (let index = 1; index < cycles.length; index++) {
    const gap = Math.round((new Date(cycles[index]) - new Date(cycles[index - 1])) / DAY);
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return null;
  return { count: cycles.length, avgGap: Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) };
}

// 返回指定上海月份内的第一条预测日期；没有则返回 null。
function periodDateInMonth(period, year, month) {
  let cursor = nextPeriodDate(period);
  if (!cursor) return null;
  const target = Number(year) * 12 + (Number(month) - 1);
  const step = averageDays(period) * DAY;
  for (let guard = 0; guard < 600; guard++) {
    const parts = shanghaiParts(cursor);
    const current = parts.year * 12 + (parts.month - 1);
    if (current === target) return cursor;
    if (current > target) return null;
    cursor = new Date(cursor.getTime() + step);
  }
  return null;
}

module.exports = { DAY, validCycles, averageDays, lastCycleDate, nextPeriodDate, periodStats, periodDateInMonth };