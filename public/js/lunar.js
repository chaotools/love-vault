// 农历工具（浏览器版）：与服务端 src/lunar.js 同思路，基于 Intl chinese 历法
const EN = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric' });

const MONTH_NAMES = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const DAY_NAMES = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

export function toLunar(date) {
  const out = { year: 0, month: 0, day: 0, leap: false };
  for (const p of EN.formatToParts(date)) {
    if (p.type === 'relatedYear') out.year = parseInt(p.value, 10);
    else if (p.type === 'month') {
      const m = p.value.match(/^(\d+)(bis)?$/);
      if (m) { out.month = parseInt(m[1], 10); out.leap = Boolean(m[2]); }
    } else if (p.type === 'day') out.day = parseInt(p.value, 10);
  }
  return out;
}

export function monthName(month, leap) {
  return (leap ? '闰' : '') + (MONTH_NAMES[month] || (month + '月'));
}

export function lunarDateText(date) {
  const l = toLunar(date);
  return '农历' + monthName(l.month, l.leap) + (DAY_NAMES[l.day] || (l.day + '日'));
}

const DAY = 86400000;
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// 公历月日：from（含）之后的最近一次
export function nextSolarMonthDay(month, day, from) {
  const f = startOfDay(from);
  let d = new Date(f.getFullYear(), month - 1, day);
  if (d < f) d = new Date(f.getFullYear() + 1, month - 1, day);
  return d;
}

// 农历月日：from（含）之后最近一次；窗口内没有对应闰月则返回 null
export function nextLunarMonthDay(month, day, leap, from) {
  const start = startOfDay(from).getTime();
  for (let i = 0; i < 390; i++) {
    const d = new Date(start + i * DAY);
    const l = toLunar(d);
    if (l.month === month && l.day === day && l.leap === leap) return d;
  }
  return null;
}

// 解析 "MM-DD" 或 "YYYY-MM-DD" → {month, day}
export function parseMonthDay(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let month, day;
  if (m) { month = parseInt(m[2], 10); day = parseInt(m[3], 10); }
  else {
    m = s.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    month = parseInt(m[1], 10); day = parseInt(m[2], 10);
  }
  return (month >= 1 && month <= 12 && day >= 1 && day <= 31) ? { month, day } : null;
}

// 距 from 的天数（负数表示已过）
export function daysUntil(target, from) {
  return Math.round((startOfDay(target) - startOfDay(from)) / DAY);
}

// 纪念日/生日统一换算：按是否农历算出下一次日期
export function nextOccurrence(dateStr, lunar, from) {
  const ref = parseMonthDay(dateStr);
  if (!ref) return null;
  return lunar ? nextLunarMonthDay(ref.month, ref.day, false, from) : nextSolarMonthDay(ref.month, ref.day, from);
}