// 提醒计算：纪念日（公历/农历）、生日（公历/农历）、生理期预测、在一起里程碑
// 只做纯计算，不做持久化；由路由暴露给前端，前端负责展示与浏览器通知去重。
const lunar = require('./lunar');
const { shanghaiMonthKey } = require('./date-resolution');
const { nextPeriodDate } = require('./period');

const DAY = 86400000;
// 在一起的里程碑日：挑的都是"有说法"的数字
const MILESTONES = [100, 365, 520, 999, 1000, 1314, 2000, 3650, 5000, 7300, 10000, 20000];

function daysBetween(a, b) {
  return Math.round((lunar.startOfDay(b) - lunar.startOfDay(a)) / DAY);
}

// 解析公历/农历月日，返回下一次发生日期和对应的提示文案。
function resolveMonthDay(item, today, baseSub) {
  const ref = lunar.parseMonthDay(item && item.date !== undefined ? item.date : item && item.birthday);
  if (!ref) return null;
  if (!item.lunar) return { next: lunar.nextSolarMonthDay(ref.month, ref.day, today), sub: baseSub };
  const leap = item.leap === true;
  let next = lunar.nextLunarMonthDay(ref.month, ref.day, leap, today);
  if (next) return { next, sub: '农历' + baseSub };
  if (leap) return { next: lunar.nextLunarMonthDay(ref.month, ref.day, false, today), sub: '农历' + baseSub + '（本年按平月）' };
  return { next: null, sub: '农历' + baseSub };
}

function collectMonthDayReminders(entries, { type, baseSub, id, title, today, push }) {
  for (const entry of entries || []) {
    const occurrence = resolveMonthDay(entry, today, baseSub);
    if (occurrence && occurrence.next) push(type, id(entry), title(entry), occurrence.sub, occurrence.next);
  }
}

function collectPeriodReminder(config, profile, today, push) {
  if (!config.periodEnabled || !profile.period) return;
  const next = nextPeriodDate(profile.period);
  if (!next) return;
  const inDays = daysBetween(today, next);
  if (inDays >= 0) push('period', 'period', '预计生理期', '温柔一点，提前准备好红糖热水', next);
  else if (inDays > -6) push('period', 'period', '可能正在经期中', '多一点理解和红糖热水', next, { minInDays: -31, active: true });
}

function collectMilestoneReminders(config, today, daysAhead, push) {
  if (!config.anniversary) return;
  const anniversary = new Date(config.anniversary + 'T00:00:00');
  if (isNaN(anniversary.getTime())) return;
  const days = daysBetween(anniversary, today);
  if (days < 0) return;
  for (const milestone of MILESTONES) {
    if (milestone === days) {
      push('milestone', 'milestone-' + milestone, '在一起 ' + milestone + ' 天啦', '今天就是这一天', today);
    } else if (milestone > days && milestone - days <= daysAhead) {
      push('milestone', 'milestone-' + milestone, '在一起 ' + milestone + ' 天', '里程碑', new Date(lunar.startOfDay(anniversary).getTime() + milestone * DAY));
    }
  }
}

function collectActivity(data, today) {
  const activityCollections = ['preferences', 'people', 'events', 'wishes', 'gifts', 'memories'];
  const recordDates = new Set();
  let monthCount = 0;
  const thisMonthKey = shanghaiMonthKey(today);
  for (const key of activityCollections) {
    for (const item of data[key] || []) {
      if (!item || !item.createdAt) continue;
      const date = new Date(item.createdAt);
      if (isNaN(date.getTime())) continue;
      recordDates.add(lunar.toDateStr(lunar.startOfDay(date)));
      if (shanghaiMonthKey(date) === thisMonthKey) monthCount++;
    }
  }
  const sortedDates = [...recordDates].sort();
  const lastRecordAt = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
  let streak = 0;
  let cursorDate = today;
  if (!recordDates.has(lunar.toDateStr(today))) cursorDate = new Date(today.getTime() - DAY);
  while (recordDates.has(lunar.toDateStr(cursorDate))) {
    streak++;
    cursorDate = new Date(cursorDate.getTime() - DAY);
  }
  return {
    lastRecordAt,
    streak,
    monthCount,
    daysSinceLastRecord: lastRecordAt ? daysBetween(new Date(lastRecordAt), today) : null
  };
}

// 由 data 快照计算提醒，返回 { today, items, activity }，items 按 inDays 升序。
function computeReminders(data, opts = {}) {
  const daysAhead = opts.daysAhead || 30;
  const now = opts.now || new Date();
  const today = lunar.startOfDay(now);
  const config = data.config || {};
  const profile = data.profile || {};
  const items = [];
  const push = (type, id, title, sub, date, options = {}) => {
    const minInDays = options.minInDays !== undefined ? options.minInDays : 0;
    const inDays = daysBetween(today, date);
    if (inDays < minInDays || inDays > daysAhead) return;
    items.push({ type, id, title, sub, date: lunar.toDateStr(date), inDays, ...(options.active ? { active: true } : {}) });
  };

  collectMonthDayReminders(config.memorialDays, {
    type: 'memorial', baseSub: '纪念日', today, push,
    id: (entry) => 'md-' + entry.name,
    title: (entry) => entry.name
  });
  collectMonthDayReminders(data.people, {
    type: 'birthday', baseSub: '生日', today, push,
    id: (person) => 'p-' + person.id,
    title: (person) => person.name + ' 的生日'
  });
  collectPeriodReminder(config, profile, today, push);
  collectMilestoneReminders(config, today, daysAhead, push);
  items.sort((a, b) => a.inDays - b.inDays);

  return {
    today: { date: lunar.toDateStr(today), lunar: lunar.lunarDateText(now) },
    items,
    activity: collectActivity(data, today)
  };
}

module.exports = { computeReminders, MILESTONES };
