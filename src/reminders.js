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
  const push = (type, id, title, sub, date) => {
    const inDays = daysBetween(today, date);
    if (inDays < 0 || inDays > daysAhead) return;
    items.push({ type, id, title, sub, date: lunar.toDateStr(date), inDays });
  };

  // 纪念日（配置里可标农历，农历按"每年最近一次"推算；闰月场景暂不细分）
  for (const md of config.memorialDays || []) {
    const ref = lunar.parseMonthDay(md.date);
    if (!ref) continue;
    const next = md.lunar
      ? lunar.nextLunarMonthDay(ref.month, ref.day, false, today)
      : lunar.nextSolarMonthDay(ref.month, ref.day, today);
    if (next) push('memorial', 'md-' + md.name, md.name, md.lunar ? '农历纪念日' : '纪念日', next);
  }

  // 人名生日（支持农历）
  for (const p of (data.people || [])) {
    const ref = lunar.parseMonthDay(p.birthday);
    if (!ref) continue;
    const next = p.lunar
      ? lunar.nextLunarMonthDay(ref.month, ref.day, false, today)
      : lunar.nextSolarMonthDay(ref.month, ref.day, today);
    if (next) push('birthday', 'p-' + p.id, p.name + ' 的生日', p.lunar ? '农历生日' : '生日', next);
  }

  // 生理期预测
  const period = profile.period;
  if (config.periodEnabled && period && period.enabled !== false && Array.isArray(period.lastCycles) && period.lastCycles.length) {
    const last = new Date(period.lastCycles.slice().sort().pop());
    if (!isNaN(last.getTime())) {
      const next = new Date(lunar.startOfDay(last).getTime() + (period.avgDays || 28) * DAY);
      push('period', 'period', '预计生理期', '温柔一点，提前准备好红糖热水', next);
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
  return {
    today: { date: lunar.toDateStr(today), lunar: lunar.lunarDateText(now) },
    items
  };
}

module.exports = { computeReminders, MILESTONES };
