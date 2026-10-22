const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('events');
const { nextPeriodDate, periodStats, periodDateInMonth } = require('../src/period');
const content = require('../src/routes/content');

test('生理期预测统一使用上海日期和有效平均周期', () => {
  const next = nextPeriodDate({ lastCycles: ['2026-08-06T00:00:00.000Z'], avgDays: 28 });
  assert.equal(next.toISOString(), '2026-09-02T16:00:00.000Z');
  const fallback = nextPeriodDate({ lastCycles: ['2026-08-06T00:00:00.000Z'], avgDays: 999 });
  assert.equal(fallback.toISOString(), '2026-09-02T16:00:00.000Z');
});

test('生理期统计只计算有效正间隔', () => {
  assert.deepEqual(periodStats({ lastCycles: ['2026-07-22T00:00:00.000Z', '2026-08-19T00:00:00.000Z'] }), { count: 2, avgGap: 28 });
  assert.equal(periodStats({ lastCycles: ['2026-08-19T00:00:00.000Z'] }), null);
  assert.equal(periodStats({ lastCycles: ['invalid', '2026-08-19T00:00:00.000Z'] }), null);
});

test('日历周期预测命中指定上海月份', () => {
  const date = periodDateInMonth({ lastCycles: ['2026-08-06T00:00:00.000Z'], avgDays: 28 }, 2026, 9);
  assert.equal(date.toISOString(), '2026-09-02T16:00:00.000Z');
  assert.equal(periodDateInMonth({ lastCycles: ['2026-08-06T00:00:00.000Z'], avgDays: 28 }, 2026, 8), null);
});

test('档案保存会移除旧的 period.enabled 字段', async () => {
  const app = express();
  const store = { data: { period: { enabled: true, lastCycles: ['2026-08-19T00:00:00.000Z'], avgDays: 28 } }, save: async () => {} };
  app.use(express.json());
  app.use('/api/profile', content.profileRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: { enabled: false, avgDays: 30 } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(Object.hasOwn(body.period, 'enabled'), false);
    assert.equal(body.period.avgDays, 30);
  } finally {
    server.close();
    await once(server, 'close');
  }
});