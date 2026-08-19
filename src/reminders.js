// 提醒计算：纪念日（公历/农历）、生日（公历/农历）、生理期预测、在一起里程碑
// 只做纯计算，不做持久化；由路由暴露给前端，前端负责展示与浏览器通知去重。
const lunar = require('./lunar');

const DAY = 86400000;
// 在一起的里程碑日：挑的都是"有说法"的数字
const MILESTONES = [100, 365, 520, 999, 1000, 1314, 2000, 3650, 5000, 7300, 10000, 20000];

function daysBetween(a, b) {
  return Math.round((lunar.startOfDay(b) - lunar.startOfDay(a)) / DAY);
}

// 由 data 快照（server.js getData 的返回值）计算提醒
// 返回 { today: {date, lunar}, items: [...] }，items 按 inDays 升序
function computeReminders(data, opts = {}) {
  const daysAhead = opts.daysAhead || 30;
  const now = opts.now || new Date();
  const today = lunar.startOfDay(now);
  const config = data.config || {};
  const profile = data.profile || {};
  const items = [];
  const push = (type, id, title, sub, date, opts = {}) => {
    const minInDays = opts.minInDays !== undefined ? opts.minInDays : 0;
    const inDays = daysBetween(today, date);
    if (inDays < minInDays || inDays > daysAhead) return;
    items.push({ type, id, title, sub, date: lunar.toDateStr(date), inDays, ...(opts.active ? { active: true } : {}) });
  };

  // 纪念日（可标农历与闰月；闰月精确匹配，当年无对应闰月时按平月提醒并在文案说明）
  for (const md of config.memorialDays || []) {
    const ref = lunar.parseMonthDay(md.date);
    if (!ref) continue;
    let next = null;
    let sub = '纪念日';
    if (md.lunar) {
      const leap = md.leap === true;
      next = lunar.nextLunarMonthDay(ref.month, ref.day, leap, today);
      if (next) sub = '农历纪念日';
      else if (leap) {
        next = lunar.nextLunarMonthDay(ref.month, ref.day, false, today);
        sub = '农历纪念日（本年按平月）';
      }
    } else {
      next = lunar.nextSolarMonthDay(ref.month, ref.day, today);
    }
    if (next) push('memorial', 'md-' + md.name, md.name, sub, next);
  }

  // 人名生日（支持农历与闰月；闰月当年缺席时按平月提醒，文案如实说明）
  for (const p of (data.people || [])) {
    const ref = lunar.parseMonthDay(p.birthday);
    if (!ref) continue;
    let next = null;
    let sub = '生日';
    if (p.lunar) {
      const leap = p.leap === true;
      next = lunar.nextLunarMonthDay(ref.month, ref.day, leap, today);
      if (next) sub = '农历生日';
      else if (leap) {
        next = lunar.nextLunarMonthDay(ref.month, ref.day, false, today);
        sub = '农历生日（本年按平月）';
      }
    } else {
      next = lunar.nextSolarMonthDay(ref.month, ref.day, today);
    }
    if (next) push('birthday', 'p-' + p.id, p.name + ' 的生日', sub, next);
  }

  // 生理期预测
  const period = profile.period;
  if (config.periodEnabled && period && period.enabled !== false && Array.isArray(period.lastCycles) && period.lastCycles.length) {
    const last = new Date(period.lastCycles.slice().sort().pop());
    if (!isNaN(last.getTime())) {
      const next = new Date(lunar.startOfDay(last).getTime() + (period.avgDays || 28) * DAY);
      const inDays = daysBetween(today, next);
      if (inDays >= 0) {
        push('period', 'period', '预计生理期', '温柔一点，提前准备好红糖热水', next);
      } else if (inDays > -6) {
        // 预测日刚过去：很可能正在经期中，反而最需要温柔提醒（负窗口专用条目）
        push('period', 'period', '可能正在经期中', '多一点理解和红糖热水', next, { minInDays: -31, active: true });
      }
    }
  }

  // 在一起里程碑（100 / 365 / 520 / 1000 / 1314 …）
  if (config.anniversary) {
    const ann = new Date(config.anniversary + 'T00:00:00');
    if (!isNaN(ann.getTime())) {
      const days = daysBetween(ann, today);
      if (days >= 0) {
        for (const m of MILESTONES) {
          if (m === days) push('milestone', 'milestone-' + m, '在一起 ' + m + ' 天啦', '今天就是这一天', today);
          else if (m > days && m - days <= daysAhead) {
            push('milestone', 'milestone-' + m, '在一起 ' + m + ' 天', '里程碑', new Date(lunar.startOfDay(ann).getTime() + m * DAY));
          }
        }
      }
    }
  }

  items.sort((a, b) => a.inDays - b.inDays);

  // —— 记录活跃 ——
  // 所有可记录模块的 createdAt 都算"一次记录"；连续天数 = 从今天往前数，
  // 每一天至少有一条记录才算连续。
  const activityCollections = ['preferences', 'people', 'events', 'wishes', 'gifts', 'memories'];
  const recordDates = new Set();
  for (const key of activityCollections) {
    const list = data[key] || [];
    for (const item of list) {
      if (item && item.createdAt) {
        const d = new Date(item.createdAt);
        if (!isNaN(d.getTime())) recordDates.add(lunar.toDateStr(lunar.startOfDay(d)));
      }
    }
  }
  // 最近一次记录
  let lastRecordAt = null;
  if (recordDates.size) {
    const sorted = [...recordDates].sort();
    lastRecordAt = sorted[sorted.length - 1];
  }
  // 连续记录天数（含今天，若今天还没记则从昨天开始算）
  let streak = 0;
  let cursorDate = today;
  const dayStr = (d) => lunar.toDateStr(d);
  if (!recordDates.has(dayStr(today))) cursorDate = new Date(today.getTime() - DAY);
  while (recordDates.has(dayStr(cursorDate))) {
    streak++;
    cursorDate = new Date(cursorDate.getTime() - DAY);
  }
  // 本月记录条数
  const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  let monthCount = 0;
  for (const key of activityCollections) {
    const list = data[key] || [];
    for (const item of list) {
      if (item && item.createdAt) {
        const d = new Date(item.createdAt);
        if (!isNaN(d.getTime()) && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === thisMonthKey) monthCount++;
      }
    }
  }
  const activity = {
    lastRecordAt,
    streak,
    monthCount,
    daysSinceLastRecord: lastRecordAt ? daysBetween(new Date(lastRecordAt), today) : null
  };

  return {
    today: { date: lunar.toDateStr(today), lunar: lunar.lunarDateText(now) },
    items,
    activity
  };
}

module.exports = { computeReminders, MILESTONES };
