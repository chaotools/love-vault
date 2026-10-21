const test = require('node:test');
const assert = require('node:assert/strict');

const calcPromise = import('../public/js/period-calc.mjs');
const birthdayPromise = import('../public/js/birthday-soon.mjs');
const lunarPromise = import('../public/js/lunar.js');

test('记录新周期后按实际间隔自动计算平均周期', async () => {
  const { appendCycle, averageCycleDays } = await calcPromise;
  const cycles = appendCycle(['2026-01-01T00:00:00.000Z'], '2026-01-31T00:00:00.000Z', 12);
  assert.deepEqual(cycles, ['2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z']);
  assert.equal(averageCycleDays(cycles, 28), 30);
  assert.equal(averageCycleDays([], 28), 28);
});

test('周期记录会去重、排序并保留最近 12 条', async () => {
  const { appendCycle } = await calcPromise;
  const cycles = appendCycle([
    '2026-03-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    '2026-03-01T00:00:00.000Z'
  ], '2026-02-01T00:00:00.000Z', 2);
  assert.deepEqual(cycles, ['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']);
});

test('生日临近提示正确处理公历和农历生日', async () => {
  const { isBirthdaySoon } = await birthdayPromise;
  const { toLunar } = await lunarPromise;
  const now = new Date(2026, 7, 19, 12, 0, 0); // 2026-08-19，农历七月初七
  assert.equal(isBirthdaySoon({ birthday: '08-20' }, now), true);
  assert.equal(isBirthdaySoon({ birthday: '12-01' }, now), false);

  const currentLunar = toLunar(now);
  const lunarBirthday = `${String(currentLunar.month).padStart(2, '0')}-${String(currentLunar.day).padStart(2, '0')}`;
  assert.equal(isBirthdaySoon({ birthday: lunarBirthday, lunar: true, leap: currentLunar.leap }, now), true);
});