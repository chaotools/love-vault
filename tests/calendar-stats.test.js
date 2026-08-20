// 爱情日历 / 统计增强 / 记录活跃 测试
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { calendarRouter } = require('../src/routes/calendar');
const { statsRouter } = require('../src/routes/stats');
const { computeReminders } = require('../src/reminders');

function sampleData() {
  return {
    config: {
      anniversary: '2023-08-19',
      periodEnabled: true,
      memorialDays: [
        { name: '在一起', date: '2023-08-19' },     // 公历 8-19
        { name: '七夕', date: '2026-07-07', lunar: true } // 农历七月初七
      ]
    },
    profile: {
      basics: { nickname: '贝贝', birthday: '1998-03-14', zodiac: '双鱼座', height: '165', shoeSize: '37' },
      health: {},
      period: { enabled: true, lastCycles: ['2026-07-22T00:00:00.000Z'], avgDays: 28 }
    },
    preferences: [
      { polarity: '喜欢', category: '吃', title: '杨枝甘露' },
      { polarity: '喜欢', category: '吃', title: '火锅' },
      { polarity: '不喜欢', category: '吃', title: '香菜' }
    ],
    people: [
      { id: 'p1', name: '李阿姨', birthday: '08-20', group: '家人' },
      { id: 'p2', name: '小王', birthday: '12-01', group: '朋友' }
    ],
    events: [
      { id: 'e1', title: '七夕约会', date: '2026-08-19T11:00:00.000Z', type: '约会', location: '江边' },
      { id: 'e2', title: '去青岛', date: '2026-08-05T08:00:00.000Z', type: '旅行', location: '青岛' },
      { id: 'e3', title: '答应看海', date: '2026-01-01T00:00:00.000Z', type: '承诺', done: true }
    ],
    wishes: [
      { id: 'w1', title: '胶片相机', status: '已实现' },
      { id: 'w2', title: '去露营', status: '想要' }
    ],
    gifts: [{ id: 'g1', title: '围巾', direction: '送给TA' }],
    memories: [
      { id: 'm1', type: 'photo', filename: 'm1.jpg', takenAt: '2026-08-19T11:00:00.000Z', thumb: '/thumbs/m1.jpg', location: '江边', tags: ['日常'] },
      { id: 'm2', type: 'photo', filename: 'm2.jpg', takenAt: '2026-08-05T08:00:00.000Z', thumb: '/thumbs/m2.jpg', location: '青岛', tags: ['旅行'] }
    ],
    albums: []
  };
}

function startServer(router, getData) {
  const app = express();
  app.use('/', router(getData));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
}

test('日历：2026-08 正确聚合生日/纪念日/大事记/照片', async () => {
  const srv = await startServer(calendarRouter, () => sampleData());
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/?year=2026&month=8`);
    const body = await r.json();
    assert.equal(r.status, 200);
    // 8-19：纪念日"在一起" + 七夕约会事件 + 照片
    const d19 = body.days['2026-08-19'];
    assert.ok(d19, '8-19 应有内容');
    const types19 = d19.map((i) => i.type);
    assert.ok(types19.includes('memorial'), '8-19 有纪念日');
    assert.ok(types19.includes('event'), '8-19 有大事记');
    assert.ok(types19.includes('media'), '8-19 有照片');
    // 8-20：李阿姨生日
    const d20 = body.days['2026-08-20'];
    assert.ok(d20.some((i) => i.type === 'birthday' && i.title.includes('李阿姨')));
    // 8-05：旅行事件 + 照片
    const d05 = body.days['2026-08-05'];
    assert.ok(d05.some((i) => i.type === 'event' && i.title === '去青岛'));
    // 8 月外的不应出现（1 月的承诺事件）
    assert.ok(!body.days['2026-01-01']);
  } finally {
    srv.close();
  }
});

test('日历：月份校验', async () => {
  const srv = await startServer(calendarRouter, () => sampleData());
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/?year=2026&month=13`);
    assert.equal(r.status, 400);
  } finally {
    srv.close();
  }
});

test('统计增强：地点/偏好分类/愿望率/承诺率/人名分布/画像', async () => {
  const srv = await startServer(statsRouter, () => sampleData());
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/`);
    const body = await r.json();
    // 地点 Top：江边(2) 青岛(2)
    const locs = body.topLocations;
    assert.ok(locs.find((l) => l.location === '江边' && l.count === 2));
    assert.ok(locs.find((l) => l.location === '青岛' && l.count === 2));
    // 偏好分类：吃 3 条
    assert.equal(body.prefByCategory['吃'], 3);
    // 愿望率：2 个愿望 1 个实现 → 50%
    assert.deepEqual(body.wishRate, { total: 2, done: 1, rate: 50 });
    // 承诺率：1 个承诺 1 个兑现 → 100%
    assert.deepEqual(body.promiseRate, { total: 1, done: 1, rate: 100 });
    // 人名分布
    assert.deepEqual(body.peopleByGroup, { 家人: 1, 朋友: 1 });
    // 画像卡
    assert.equal(body.portraitCard.nickname, '贝贝');
    assert.equal(body.portraitCard.zodiac, '双鱼座');
  } finally {
    srv.close();
  }
});

test('记录活跃：连续天数/本月条数/最近记录', () => {
  // 固定"今天"= 2026-08-19；preferences 有 8-18 记录 → 连续 1 天（今天没记，从昨天算）
  const data = sampleData();
  data.preferences[0].createdAt = '2026-08-18T10:00:00.000Z';
  data.preferences[1].createdAt = '2026-08-16T10:00:00.000Z';
  data.preferences[2].createdAt = '2026-07-30T10:00:00.000Z';
  data.people[0].createdAt = '2026-08-18T09:00:00.000Z';
  const { activity } = computeReminders(data, { now: new Date(2026, 7, 19, 12, 0, 0) });
  assert.equal(activity.lastRecordAt, '2026-08-18');
  assert.equal(activity.daysSinceLastRecord, 1);
  // 8-18、8-16 两天有记录，7-30 不算 → 连续 1 天
  assert.equal(activity.streak, 1);
  // 本月（8 月）记录：8-18(偏好) + 8-16(偏好) = 2 条（7-30 不算；people 8-18 也算）
  assert.equal(activity.monthCount, 3);
});

test('记录活跃：连续多天（含今天）streak 正确', () => {
  const data = sampleData();
  // 今天 8-19、昨天 8-18、前天 8-17 都有记录 → streak 3
  data.preferences[0].createdAt = '2026-08-19T10:00:00.000Z';
  data.preferences[1].createdAt = '2026-08-18T10:00:00.000Z';
  data.people[0].createdAt = '2026-08-17T10:00:00.000Z';
  const { activity } = computeReminders(data, { now: new Date(2026, 7, 19, 12, 0, 0) });
  assert.equal(activity.streak, 3);
  assert.equal(activity.monthCount, 3);
});

test('记录活跃：完全没有记录时返回空', () => {
  const data = sampleData();
  data.preferences = []; data.people = []; data.events = []; data.wishes = []; data.gifts = []; data.memories = [];
  const { activity } = computeReminders(data, { now: new Date(2026, 7, 19, 12, 0, 0) });
  assert.equal(activity.lastRecordAt, null);
  assert.equal(activity.streak, 0);
  assert.equal(activity.monthCount, 0);
});

test('日历：只有照片的日期会初始化，并按上海日期归类', async () => {
  const data = sampleData();
  // 这张照片是北京时间 8 月 4 日凌晨 00:30；UTC 容器中则仍是 8 月 3 日。
  // 同一天没有任何大事记/生日/纪念日，用于覆盖媒体独占日期的初始化。
  data.config.memorialDays = [];
  data.people = [];
  data.events = [];
  data.memories = [{
    id: 'night-photo', type: 'photo', filename: 'night.jpg',
    takenAt: '2026-08-03T16:30:00.000Z', thumb: '/thumbs/night-photo.jpg'
  }];
  const srv = await startServer(calendarRouter, () => data);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/?year=2026&month=8`);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.days['2026-08-04'].length, 1);
    assert.equal(body.days['2026-08-04'][0].type, 'media');
    assert.equal(body.days['2026-08-03'], undefined);
  } finally {
    srv.close();
  }
});
