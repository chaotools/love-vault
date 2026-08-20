const test = require('node:test');
const assert = require('node:assert/strict');
const { computeReminders } = require('../src/reminders');

// 固定"今天"为 2026-08-19，方便断言
const NOW = new Date(2026, 7, 19, 12, 0, 0);

function data(overrides = {}) {
  return {
    config: {
      title: '测试', anniversary: '2023-08-19', periodEnabled: true,
      memorialDays: [
        { name: '在一起纪念日', date: '2023-08-19' },      // 公历，今天就是三周年
        { name: '七夕', date: '2026-07-07', lunar: true },  // 农历七月初七，恰逢今天
        { name: '随便纪念日', date: '1999-01-01' }          // 很久以前的日期，忽略年份
      ]
    },
    profile: {
      period: { enabled: true, lastCycles: ['2026-08-06T00:00:00.000Z'], avgDays: 28 }
    },
    people: [
      { id: 'a', name: '妈妈', birthday: '08-20' },          // 明天生日
      { id: 'b', name: '爷爷', birthday: '01-15', lunar: true } // 农历腊月十八（无此农历月名但测试匹配逻辑）
    ],
    ...overrides
  };
}

test('今天三周年在提醒列表且 inDays=0', () => {
  const { items } = computeReminders(data(), { now: NOW });
  const hit = items.find((it) => it.id === 'md-在一起纪念日');
  assert.ok(hit, '纪念日应出现');
  assert.equal(hit.inDays, 0);
  assert.equal(hit.date, '2026-08-19');
});

test('生日：明天生日 inDays=1', () => {
  const { items } = computeReminders(data(), { now: NOW });
  const hit = items.find((it) => it.id === 'p-a');
  assert.ok(hit, '生日应出现');
  assert.equal(hit.inDays, 1);
});

test('农历纪念日：七夕（七月初七）恰逢今天', () => {
  const { items } = computeReminders(data(), { now: NOW });
  const hit = items.find((it) => it.id === 'md-七夕');
  assert.ok(hit, '农历纪念日应出现');
  assert.equal(hit.inDays, 0);
  assert.equal(hit.date, '2026-08-19');
  assert.equal(hit.sub, '农历纪念日');
});

test('生理期预测：avg 28 天，距上次 13 天 → inDays=15', () => {
  const { items } = computeReminders(data(), { now: NOW });
  const hit = items.find((it) => it.id === 'period');
  assert.ok(hit, '生理期预测应出现');
  assert.equal(hit.inDays, 15);
});

test('里程碑：今天恰好在一起 100 天', () => {
  const { items } = computeReminders(data({ config: { ...data({}).config, anniversary: '2026-05-11' } }), { now: NOW });
  const hit = items.find((it) => it.id === 'milestone-100');
  assert.ok(hit, '100 天里程碑应出现');
  assert.equal(hit.inDays, 0);
  assert.equal(hit.date, '2026-08-19');
});

test('今天农历文案', () => {
  const { today } = computeReminders(data(), { now: NOW });
  assert.equal(today.date, '2026-08-19');
  assert.equal(today.lunar, '农历七月初七');
});

test('关闭生理期后不出现该提醒', () => {
  const { items } = computeReminders(data({ config: { anniversary: '', periodEnabled: false, memorialDays: [], people: [] } }), { now: NOW });
  assert.equal(items.find((it) => it.id === 'period'), undefined);
});

test('预测日已过 3 天：给出“正在经期中”的进行中提醒（active 条目）', () => {
  const during = computeReminders({
    config: { periodEnabled: true, memorialDays: [], anniversary: '' },
    profile: { period: { enabled: true, lastCycles: ['2026-07-19T00:00:00.000Z'], avgDays: 28 } },
    people: []
  }, { now: NOW });
  const hit = during.items.find((it) => it.id === 'period');
  assert.ok(hit, '经期中提醒应出现');
  assert.equal(hit.active, true);
  assert.equal(hit.inDays, -3);
  assert.equal(hit.title, '可能正在经期中');
});

test('预测日已过 10 天：不做经期中提醒（已出窗口）', () => {
  const out = computeReminders({
    config: { periodEnabled: true, memorialDays: [], anniversary: '' },
    profile: { period: { enabled: true, lastCycles: ['2026-07-11T00:00:00.000Z'], avgDays: 28 } },
    people: []
  }, { now: NOW });
  assert.equal(out.items.find((it) => it.id === 'period'), undefined);
});

test('闰月生日：当年无对应闰月时按平月提醒，并在文案说明', () => {
  const { items } = computeReminders(data({
    people: [{ id: 'c', name: '宝宝', birthday: '02-01', lunar: true, leap: true }]
  }), { now: NOW, daysAhead: 400 });
  const hit = items.find((it) => it.id === 'p-c');
  assert.ok(hit, '闰月生日应有提醒');
  assert.equal(hit.sub, '农历生日（本年按平月）');
  assert.ok(hit.inDays > 0, '下一次应落在未来的平月那天');
});

test('普通农历生日不受闰月逻辑影响', () => {
  // 农历七月十五 ≈ 2026-08-27，恰在 30 天提醒窗口内
  const { items } = computeReminders(data({ people: [{ id: 'd', name: '奶奶', birthday: '07-15', lunar: true }] }), { now: NOW });
  const hit = items.find((it) => it.id === 'p-d');
  assert.ok(hit);
  assert.equal(hit.sub, '农历生日');
});

test('北京时间凌晨按上海日期提醒，不受 UTC 容器影响', () => {
  const now = new Date('2026-08-19T16:30:00.000Z'); // 上海时间 2026-08-20 00:30
  const result = computeReminders({
    config: { anniversary: '', periodEnabled: false, memorialDays: [{ name: '今天', date: '08-20' }] },
    profile: {}, people: []
  }, { now });
  assert.equal(result.today.date, '2026-08-20');
  assert.equal(result.items.find((item) => item.id === 'md-今天').inDays, 0);
});
