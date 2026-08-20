// 统计接口：给"统计"视图提供聚合数据，全部在内存里算，不落盘
const express = require('express');

function monthKey(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function statsRouter(getData) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const d = getData(req);
    const config = d.config || {};
    const profile = d.profile || {};
    const memories = d.memories || [];
    const events = d.events || [];
    const wishes = d.wishes || [];
    const gifts = d.gifts || [];
    const preferences = d.preferences || [];
    const people = d.people || [];
    const albums = d.albums || [];

    // 在一起天数
    let daysTogether = null;
    if (config.anniversary) {
      const ann = new Date(config.anniversary + 'T00:00:00');
      if (!isNaN(ann.getTime())) {
        daysTogether = Math.max(0, Math.floor((new Date(new Date().toDateString()) - ann) / 86400000));
      }
    }

    // 最近 12 个月的媒体/大事记分布
    const now = new Date();
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const d0 = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}`;
      monthly.push({ ym: key, label: `${d0.getFullYear()}.${String(d0.getMonth() + 1).padStart(2, '0')}`, photos: 0, videos: 0, events: 0 });
    }
    const monthIndex = new Map(monthly.map((m) => [m.ym, m]));
    for (const m of memories) {
      const k = monthKey(m.takenAt);
      const bucket = k && monthIndex.get(k);
      if (bucket) m.type === 'video' ? bucket.videos++ : bucket.photos++;
    }
    for (const e of events) {
      const k = monthKey(e.date);
      const bucket = k && monthIndex.get(k);
      if (bucket) bucket.events++;
    }

    // 大事记类型分布
    const eventByType = {};
    for (const e of events) eventByType[e.type || '其他'] = (eventByType[e.type || '其他'] || 0) + 1;

    // 愿望状态分布
    const wishByStatus = {};
    for (const w of wishes) wishByStatus[w.status || '想要'] = (wishByStatus[w.status || '想要'] || 0) + 1;

    // 礼物方向
    const giftByDirection = {};
    for (const g of gifts) giftByDirection[g.direction || '送给TA'] = (giftByDirection[g.direction || '送给TA'] || 0) + 1;

    // 偏好分布
    const prefByPolarity = {};
    for (const p of preferences) prefByPolarity[p.polarity || '喜欢'] = (prefByPolarity[p.polarity || '喜欢'] || 0) + 1;

    // 标签 Top
    const tagCount = {};
    for (const m of memories) for (const t of (m.tags || [])) tagCount[t] = (tagCount[t] || 0) + 1;
    const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tag, count]) => ({ tag, count }));

    // 生理期统计（开启且记录 ≥2 条时给出平均周期）
    let periodStat = null;
    if (profile.period && profile.period.enabled !== false && Array.isArray(profile.period.lastCycles) && profile.period.lastCycles.length >= 2) {
      const cycles = profile.period.lastCycles.slice().sort();
      const gaps = [];
      for (let i = 1; i < cycles.length; i++) {
        gaps.push(Math.round((new Date(cycles[i]) - new Date(cycles[i - 1])) / 86400000));
      }
      const sum = gaps.reduce((a, b) => a + b, 0);
      periodStat = { count: cycles.length, avgGap: Math.round(sum / gaps.length) };
    }

    // —— 记录统计增强 ——

    // 地点 Top（照片/大事记的 location）
    const locationCount = {};
    for (const m of memories) if (m.location) locationCount[m.location] = (locationCount[m.location] || 0) + 1;
    for (const e of events) if (e.location) locationCount[e.location] = (locationCount[e.location] || 0) + 1;
    const topLocations = Object.entries(locationCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([location, count]) => ({ location, count }));

    // 偏好分类占比
    const prefByCategory = {};
    for (const p of preferences) prefByCategory[p.category || '其他'] = (prefByCategory[p.category || '其他'] || 0) + 1;

    // 愿望实现率
    const wishRate = wishes.length
      ? { total: wishes.length, done: wishes.filter((w) => w.status === '已实现').length, rate: Math.round((wishes.filter((w) => w.status === '已实现').length / wishes.length) * 100) }
      : null;

    // 承诺兑现率
    const promises = events.filter((e) => e.type === '承诺');
    const promiseRate = promises.length
      ? { total: promises.length, done: promises.filter((p) => p.done).length, rate: Math.round((promises.filter((p) => p.done).length / promises.length) * 100) }
      : null;

    // 人名关系分布
    const peopleByGroup = {};
    for (const p of people) peopleByGroup[p.group || '其他'] = (peopleByGroup[p.group || '其他'] || 0) + 1;

    // TA 画像摘要卡（关键字段）
    const basics = profile.basics || {};
    const portrait = {
      nickname: basics.nickname || '',
      birthday: basics.birthday || '',
      zodiac: basics.zodiac || '',
      bloodType: basics.bloodType || '',
      height: basics.height || '',
      weight: basics.weight || '',
      shoeSize: basics.shoeSize || ''
    };
    // 只保留有值的字段
    const portraitCard = Object.fromEntries(Object.entries(portrait).filter(([, v]) => v));

    res.json({
      daysTogether,
      counts: {
        memories: memories.length,
        photos: memories.filter((m) => m.type === 'photo').length,
        videos: memories.filter((m) => m.type === 'video').length,
        events: events.length,
        wishes: wishes.length,
        wishesDone: wishes.filter((w) => w.status === '已实现').length,
        gifts: gifts.length,
        preferences: preferences.length,
        people: people.length,
        albums: albums.length
      },
      monthly,
      eventByType,
      wishByStatus,
      giftByDirection,
      prefByPolarity,
      topTags,
      periodStat,
      // —— 增强 ——
      topLocations,
      prefByCategory,
      wishRate,
      promiseRate,
      peopleByGroup,
      portraitCard
    });
  });

  return r;
}

module.exports = { statsRouter };
