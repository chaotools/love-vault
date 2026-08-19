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