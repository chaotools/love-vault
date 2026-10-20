const test = require('node:test');
const assert = require('node:assert/strict');

const orderPromise = import('../public/js/timeline-order.mjs');

test('时间轴条目按实际时间倒序，而不是按月份字符串排序', async () => {
  const { sortTimelineItems, groupTimelineByMonth } = await orderPromise;
  const input = [
    { id: 'aug', date: '2026-08-31T12:00:00.000Z' },
    { id: 'oct', date: '2026-10-02T12:00:00.000Z' },
    { id: 'sep', date: '2026-09-30T12:00:00.000Z' },
    { id: 'sep-late', date: '2026-09-30T18:00:00.000Z' }
  ];

  const sorted = sortTimelineItems(input);
  assert.deepEqual(sorted.map((item) => item.id), ['oct', 'sep-late', 'sep', 'aug']);
  assert.deepEqual(groupTimelineByMonth(sorted).map((group) => group.label), ['2026年10月', '2026年9月', '2026年8月']);
});

test('同月条目保持时间倒序，无效时间排到最后', async () => {
  const { sortTimelineItems, groupTimelineByMonth } = await orderPromise;
  const sorted = sortTimelineItems([
    { id: 'invalid', date: 'not-a-date' },
    { id: 'early', date: '2026-10-01T08:00:00.000Z' },
    { id: 'late', date: '2026-10-01T20:00:00.000Z' }
  ]);

  assert.deepEqual(sorted.map((item) => item.id), ['late', 'early', 'invalid']);
  const groups = groupTimelineByMonth(sorted);
  assert.equal(groups[0].label, '2026年10月');
  assert.deepEqual(groups[0].items.map((item) => item.id), ['late', 'early']);
  assert.equal(groups[1].label, '时间未知');
});