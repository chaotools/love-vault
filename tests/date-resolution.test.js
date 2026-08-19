const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDateText, resolveEventDate, shanghaiParts } = require('../src/date-resolution');

const now = new Date('2026-08-19T16:30:00.000Z'); // 上海时间 2026-08-20 00:30

test('上海时区决定相对日期的基准日', () => {
  assert.deepEqual(shanghaiParts(now), { year: 2026, month: 8, day: 20 });
  assert.equal(resolveDateText('今年7月31日', { now }).date, '2026-07-31');
  assert.equal(resolveDateText('今年的7月31号', { now }).date, '2026-07-31');
  assert.equal(resolveDateText('去年2月28日', { now }).date, '2025-02-28');
  assert.equal(resolveDateText('明天', { now }).date, '2026-08-21');
  assert.equal(resolveDateText('昨天', { now }).date, '2026-08-19');
});

test('绝对日期、无年份月日和非法日期被正确处理', () => {
  assert.equal(resolveDateText('2024年2月29日', { now }).date, '2024-02-29');
  assert.equal(resolveDateText('2026/07/31', { now }).date, '2026-07-31');
  assert.equal(resolveDateText('7月31日', { now }).date, '2026-07-31');
  assert.equal(resolveDateText('2026年2月29日', { now }).ok, false);
  assert.equal(resolveDateText('去年夏天', { now }).ok, false);
});

test('事件日期必须能在最后一条用户消息中验证', () => {
  const userText = '记一下，她是今年 7 月 31 日拿到驾驶证的。';
  const resolved = resolveEventDate({ dateText: '今年7月31日', userText, now });
  assert.deepEqual(resolved, { ok: true, date: '2026-07-31', source: 'user_relative', dateText: '今年7月31日' });
  assert.equal(resolveEventDate({ dateText: '2024-07-31', userText, now }).ok, false);
  assert.equal(resolveEventDate({ userText, now }).ok, false);
  assert.equal(resolveEventDate({ userText: '记一下我们去看了电影', now }).date, '2026-08-20');
});
