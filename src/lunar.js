// 农历工具：基于 Node 自带 ICU 的 chinese 历法（full-icu），零第三方依赖
// 英文格式的 month 部件带 "bis" 后缀即闰月（如 "2bis"），relatedYear 为农历年；
// 中文格式直接给出"正月 / 闰二月"等名称。
const EN = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric' });
const ZH = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric' });

const MONTH_NAMES = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const DAY_NAMES = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 解析单个日期为 {year, month, day, leap}（本地时区）
function toLunar(date) {
  const parts = EN.formatToParts(date);
  const out = { year: 0, month: 0, day: 0, leap: false };
  for (const p of parts) {
    if (p.type === 'relatedYear') out.year = parseInt(p.value, 10);
    else if (p.type === 'month') {
      const m = p.value.match(/^(\d+)(bis)?$/);
      if (m) { out.month = parseInt(m[1], 10); out.leap = Boolean(m[2]); }
    } else if (p.type === 'day') out.day = parseInt(p.value, 10);
  }
  return out;
}

function monthName(month, leap) {
  const base = MONTH_NAMES[month] || (month + '月');
  return leap ? '闰' + base : base;
}

// "农历闰二月十五" 风格的全名（不含年）
function lunarDateName(l) {
  return '农历' + monthName(l.month, l.leap) + (DAY_NAMES[l.day] || (l.day + '日'));
}

function lunarDateText(date) {
  return lunarDateName(toLunar(date));
}

// 解析 "MM-DD" 或 "YYYY-MM-DD" → {month, day}；解析失败返回 null
function parseMonthDay(str) {
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
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

// 本地时区的 YYYY-MM-DD（不要用 toISOString，那会按 UTC 截断，东八区会差一天）
function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 公历月日：fromDate（含）之后的最近一次
function nextSolarMonthDay(month, day, from) {
  const fromDate = startOfDay(from);
  let d = new Date(fromDate.getFullYear(), month - 1, day);
  if (d < fromDate) d = new Date(fromDate.getFullYear() + 1, month - 1, day);
  return d;
}

// 农历月日（闰月按标记精确匹配）：fromDate（含）之后的最近一次
// 注意：闰月不是每年都有（如闰二月间隔可达十几年），扫描窗口内没有就返回 null
function nextLunarMonthDay(month, day, leap, from) {
  const fromDate = startOfDay(from).getTime();
  const WINDOW = 390; // 覆盖到明年同一时段
  for (let i = 0; i < WINDOW; i++) {
    const d = new Date(fromDate + i * 86400000);
    const l = toLunar(d);
    if (l.month === month && l.day === day && l.leap === leap) return d;
  }
  return null;
}

module.exports = {
  toLunar, monthName, lunarDateName, lunarDateText,
  parseMonthDay, nextSolarMonthDay, nextLunarMonthDay, startOfDay, toDateStr,
  MONTH_NAMES, DAY_NAMES
};
