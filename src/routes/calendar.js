// 爱情日历：按月份聚合与 TA 相关的所有日子
// 数据全部读现有集合，只做纯计算不落盘。
// 返回 { year, month, days: { "MM-DD": [items...] } }
const express = require('express');
const lunar = require('../lunar');

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// 按本地时区取日期组件（ISO 字符串是 UTC，直接取 getMonth/getDate 会差一天）
const localParts = (d) => ({ y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() });

function calendarRouter(getData) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const d = getData(req);
    const config = d.config || {};
    const profile = d.profile || {};
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    // 校验月份
    if (month < 1 || month > 12) return res.status(400).json({ error: '月份无效' });

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const items = {}; // dayKey -> [{type, id, title, sub, date}]

    const push = (type, id, title, sub, date) => {
      const key = dayKey(date);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1) return; // 只留本月的
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
        date = lunar.nextLunarMonthDay(ref.month, ref.day, leap, new Date(year, month - 1, 1));
        if (date && date.getFullYear() === year && date.getMonth() === month - 1) sub = '农历纪念日';
        else if (leap) {
          date = lunar.nextLunarMonthDay(ref.month, ref.day, false, new Date(year, month - 1, 1));
          if (date && date.getFullYear() === year && date.getMonth() === month - 1) sub = '农历纪念日（按平月）';
        }
      } else {
        // 公历月日：本月的该日（如果存在）
        if (ref.day <= daysInMonth) date = new Date(year, month - 1, ref.day);
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
        date = lunar.nextLunarMonthDay(ref.month, ref.day, leap, new Date(year, month - 1, 1));
        if (date && date.getFullYear() === year && date.getMonth() === month - 1) sub = '农历生日';
        else if (leap) {
          date = lunar.nextLunarMonthDay(ref.month, ref.day, false, new Date(year, month - 1, 1));
          if (date && date.getFullYear() === year && date.getMonth() === month - 1) sub = '农历生日（按平月）';
        }
      } else {
        if (ref.day <= daysInMonth) date = new Date(year, month - 1, ref.day);
      }
      if (date) push('birthday', 'p-' + p.id, p.name + ' 的生日', sub, date);
    }

    // 3. 大事记（events，按日期落在本月，按本地时区）
    for (const e of (d.events || [])) {
      const date = new Date(e.date);
      if (isNaN(date.getTime())) continue;
      const p = localParts(date);
      if (p.y !== year || p.m !== month) continue;
      push('event', e.id, e.title, e.type || '其他', new Date(year, month - 1, p.day));
    }

    // 4. 照片/视频（memories，按拍摄时间落在本月，只记当天数量与缩略图，本地时区）
    const photoDayCount = {}; // key -> {photos, videos, thumbs: []}
    for (const m of (d.memories || [])) {
      const date = new Date(m.takenAt);
      if (isNaN(date.getTime())) continue;
      const p = localParts(date);
      if (p.y !== year || p.m !== month) continue;
      const key = dayKey(new Date(year, month - 1, p.day));
      if (!photoDayCount[key]) photoDayCount[key] = { photos: 0, videos: 0, thumbs: [] };
      if (m.type === 'video') photoDayCount[key].videos++;
      else {
        photoDayCount[key].photos++;
        if (photoDayCount[key].thumbs.length < 3 && m.thumb) photoDayCount[key].thumbs.push(m.thumb);
      }
    }
    for (const key of Object.keys(photoDayCount)) {
      const p = photoDayCount[key];
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
