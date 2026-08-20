// 爱情日历：按月份聚合与 TA 相关的所有日子
// 数据全部读现有集合，只做纯计算不落盘。
// 返回 { year, month, days: { "MM-DD": [items...] } }
const express = require('express');
const lunar = require('../lunar');

const DAY = 86400000;
const TIME_ZONE = 'Asia/Shanghai';
const datePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// 网站面向中国用户，日期绝不能跟随容器所在时区。ISO 时间在 UTC 容器里直接取
// getDate() 会把北京时间凌晨的照片归到前一天，因此统一明确按上海时间分组。
function shanghaiParts(date) {
  const parts = datePartsFormatter.formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function dayKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 用上海中午构造一个稳定的日期对象，避免在任意部署时区中跨日。
function shanghaiDate(year, month, day) {
  return new Date(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+08:00`);
}

function calendarRouter(getData) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const d = getData(req);
    const config = d.config || {};
    const profile = d.profile || {};
    const now = new Date();
    const today = shanghaiParts(now);
    const year = parseInt(req.query.year, 10) || today.year;
    const month = parseInt(req.query.month, 10) || today.month;
    // 校验月份
    if (month < 1 || month > 12) return res.status(400).json({ error: '月份无效' });

    const daysInMonth = new Date(year, month, 0).getDate();
    const items = {}; // dayKey -> [{type, id, title, sub, date}]

    const push = (type, id, title, sub, date) => {
      const parts = shanghaiParts(date);
      const key = dayKey(parts);
      if (parts.year !== year || parts.month !== month) return; // 只留本月的
      if (!items[key]) items[key] = [];
      items[key].push({ type, id, title, sub, date: key });
    };

    // 1. 纪念日（公历/农历，含闰月，本月对应日）
    for (const md of config.memorialDays || []) {
      const ref = lunar.parseMonthDay(md.date);
      if (!ref) continue;
      let date = null;
      let sub = '纪念日';
      if (md.lunar) {
        const leap = md.leap === true;
        date = lunar.nextLunarMonthDay(ref.month, ref.day, leap, shanghaiDate(year, month, 1));
        if (date && shanghaiParts(date).year === year && shanghaiParts(date).month === month) sub = '农历纪念日';
        else if (leap) {
          date = lunar.nextLunarMonthDay(ref.month, ref.day, false, shanghaiDate(year, month, 1));
          if (date && shanghaiParts(date).year === year && shanghaiParts(date).month === month) sub = '农历纪念日（按平月）';
        }
      } else {
        // 公历月日：本月的该日（如果存在）
        if (ref.day <= daysInMonth) date = shanghaiDate(year, month, ref.day);
      }
      if (date) push('memorial', 'md-' + md.name, md.name, sub, date);
    }

    // 2. 人名生日（公历/农历）
    for (const p of (d.people || [])) {
      const ref = lunar.parseMonthDay(p.birthday);
      if (!ref) continue;
      let date = null;
      let sub = '生日';
      if (p.lunar) {
        const leap = p.leap === true;
        date = lunar.nextLunarMonthDay(ref.month, ref.day, leap, shanghaiDate(year, month, 1));
        if (date && shanghaiParts(date).year === year && shanghaiParts(date).month === month) sub = '农历生日';
        else if (leap) {
          date = lunar.nextLunarMonthDay(ref.month, ref.day, false, shanghaiDate(year, month, 1));
          if (date && shanghaiParts(date).year === year && shanghaiParts(date).month === month) sub = '农历生日（按平月）';
        }
      } else {
        if (ref.day <= daysInMonth) date = shanghaiDate(year, month, ref.day);
      }
      if (date) push('birthday', 'p-' + p.id, p.name + ' 的生日', sub, date);
    }

    // 3. 大事记（events，按日期落在本月，按本地时区）
    for (const e of (d.events || [])) {
      const date = new Date(e.date);
      if (isNaN(date.getTime())) continue;
      const p = shanghaiParts(date);
      if (p.year !== year || p.month !== month) continue;
      push('event', e.id, e.title, e.type || '其他', shanghaiDate(year, month, p.day));
    }

    // 4. 照片/视频（memories，按拍摄时间落在本月，只记当天数量与缩略图，本地时区）
    const photoDayCount = {}; // key -> {photos, videos, thumbs: []}
    for (const m of (d.memories || [])) {
      const date = new Date(m.takenAt);
      if (isNaN(date.getTime())) continue;
      const p = shanghaiParts(date);
      if (p.year !== year || p.month !== month) continue;
      const key = dayKey(p);
      if (!photoDayCount[key]) photoDayCount[key] = { photos: 0, videos: 0, thumbs: [] };
      if (m.type === 'video') photoDayCount[key].videos++;
      else {
        photoDayCount[key].photos++;
        if (photoDayCount[key].thumbs.length < 3 && m.thumb) photoDayCount[key].thumbs.push(m.thumb);
      }
    }
    for (const key of Object.keys(photoDayCount)) {
      const p = photoDayCount[key];
      // 照片日期可能没有其他记录；先初始化，不能假定事件/纪念日已创建该数组。
      if (!items[key]) items[key] = [];
      items[key].push({
        type: 'media', id: 'media-' + key, title: `${p.photos} 张照片${p.videos ? ` · ${p.videos} 段视频` : ''}`,
        sub: '照片', date: key, photos: p.photos, videos: p.videos, thumbs: p.thumbs
      });
    }

    // 5. 生理期预测（若开启且本月有预测日）
    if (config.periodEnabled && profile.period && profile.period.enabled !== false &&
        Array.isArray(profile.period.lastCycles) && profile.period.lastCycles.length) {
      const last = new Date(profile.period.lastCycles.slice().sort().pop());
      if (!isNaN(last.getTime())) {
        const avg = profile.period.avgDays || 28;
        // 从最近一次经期往前推到本月的所有预测日（避免只算一次）
        let cursor = startOfDay(last);
        let guard = 0;
        while (guard++ < 60) {
          const next = new Date(cursor.getTime() + avg * DAY);
          if (next.getFullYear() > year || (next.getFullYear() === year && next.getMonth() > month - 1)) break;
          cursor = next;
        }
        // cursor 现在是本月或更早最近一次预测日；若在更早，再往后推到本月
        while (cursor.getFullYear() < year || (cursor.getFullYear() === year && cursor.getMonth() < month - 1)) {
          cursor = new Date(cursor.getTime() + avg * DAY);
        }
        if (cursor.getFullYear() === year && cursor.getMonth() === month - 1) {
          push('period', 'period', '预计生理期', '温柔一点，提前准备好红糖热水', cursor);
        }
      }
    }

    res.json({ year, month, days: items });
  });

  return r;
}

module.exports = { calendarRouter };
