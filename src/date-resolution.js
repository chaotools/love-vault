// 用户口语日期的确定性解析。所有“今天/今年”等相对日期都以中国标准时间为准，
// 绝不依赖模型训练数据中的当前年份。
const TIME_ZONE = 'Asia/Shanghai';

function shanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function formatDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shanghaiDate(parts, hour = 0) {
  const { year, month, day } = parts;
  return new Date(Date.UTC(year, month - 1, day, hour - 8));
}

function shanghaiStartOfDay(date = new Date()) {
  return shanghaiDate(shanghaiParts(date));
}

function shanghaiMonthKey(date = new Date()) {
  const { year, month } = shanghaiParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function isValidDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function shiftDate(parts, days) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function fail(error) { return { ok: false, error }; }

// 只解析完整、可验证的单个日期片段。调用方应先确认 dateText 来自用户最后一条消息。
function resolveDateText(dateText, { now = new Date() } = {}) {
  const raw = typeof dateText === 'string' ? dateText.trim() : '';
  const text = raw.replace(/\s+/g, '');
  if (!text) return fail('缺少日期原文');

  const today = shanghaiParts(now);
  const relativeDay = { 今天: 0, 昨天: -1, 前天: -2, 明天: 1, 后天: 2 };
  if (Object.hasOwn(relativeDay, text)) {
    return { ok: true, date: formatDate(shiftDate(today, relativeDay[text])), source: 'user_relative', dateText: raw };
  }

  let match = text.match(/^(今年|去年|明年)(?:的)?(\d{1,2})月(\d{1,2})(?:日|号)?$/);
  if (match) {
    const year = today.year + ({ 今年: 0, 去年: -1, 明年: 1 })[match[1]];
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidDate(year, month, day)) return fail('日期无效，请确认月和日');
    return { ok: true, date: formatDate({ year, month, day }), source: 'user_relative', dateText: raw };
  }

  match = text.match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})(?:日|号)?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidDate(year, month, day)) return fail('日期无效，请确认月和日');
    return { ok: true, date: formatDate({ year, month, day }), source: 'user_absolute', dateText: raw };
  }

  match = text.match(/^(\d{1,2})月(\d{1,2})(?:日|号)?$/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (!isValidDate(today.year, month, day)) return fail('日期无效，请确认月和日');
    return { ok: true, date: formatDate({ year: today.year, month, day }), source: 'user_absolute', dateText: raw };
  }

  return fail('日期表达不明确，请使用“今年7月31日”或“2026年7月31日”');
}

function containsDateMention(text) {
  return /今天|昨天|前天|明天|后天|今年|去年|明年|\d{4}[年/-]\d{1,2}[月/-]\d{1,2}|\d{1,2}月\d{1,2}日?/.test(text || '');
}

// 线上请求的唯一入口：若用户明确说了日期，必须带能在原话中验证的 dateText。
function resolveEventDate({ dateText, userText, now = new Date() } = {}) {
  const user = typeof userText === 'string' ? userText : '';
  const raw = typeof dateText === 'string' ? dateText.trim() : '';
  if (raw) {
    const normalizedUser = user.replace(/\s+/g, '');
    const normalizedRaw = raw.replace(/\s+/g, '');
    if (!normalizedUser.includes(normalizedRaw)) return fail('日期必须原样引用用户消息中的日期');
    return resolveDateText(raw, { now });
  }
  if (containsDateMention(user)) return fail('用户已提供日期，请确认具体日期后再记录');
  return { ok: true, date: formatDate(shanghaiParts(now)), source: 'server_default', dateText: '' };
}

module.exports = { TIME_ZONE, shanghaiParts, shanghaiDate, shanghaiStartOfDay, shanghaiMonthKey, formatDate, resolveDateText, resolveEventDate };
