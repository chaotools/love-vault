const test = require('node:test');
const assert = require('node:assert/strict');
const lunar = require('../src/lunar');

test('公历转农历：2023 年春节是正月初一', () => {
  const l = lunar.toLunar(new Date(2023, 0, 22));
  assert.equal(l.month, 1);
  assert.equal(l.day, 1);
  assert.equal(l.leap, false);
});

test('公历转农历：2023-03-22 是闰二月初一', () => {
  const l = lunar.toLunar(new Date(2023, 2, 22));
  assert.equal(l.month, 2);
  assert.equal(l.day, 1);
  assert.equal(l.leap, true);
});

test('农历中文名：2026-08-19 是七月初七（七夕）', () => {
  assert.equal(lunar.lunarDateText(new Date(2026, 7, 19)), '农历七月初七');
  assert.equal(lunar.lunarDateName({ month: 2, day: 15, leap: true }), '农历闰二月十五');
  assert.equal(lunar.lunarDateName({ month: 1, day: 1, leap: false }), '农历正月初一');
});

test('公历月日下一次：跨年正确', () => {
  const d = lunar.nextSolarMonthDay(1, 1, new Date(2026, 2, 1));
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 1);
  // 当天也算"接下来"
  const today = new Date(2026, 6, 15);
  const same = lunar.nextSolarMonthDay(7, 15, today);
  assert.equal(same.getTime(), today.getTime());
});

test('农历月日下一次：正月十五每年都有', () => {
  const d = lunar.nextLunarMonthDay(1, 15, false, new Date(2026, 7, 19));
  const l = lunar.toLunar(d);
  assert.equal(l.month, 1);
  assert.equal(l.day, 15);
});

test('农历闰月：窗口内没有对应闰月则返回 null', () => {
  // 2023 年闰二月之后，闰二月要到 2042 年才有 → 扫描窗口内应为 null
  const d = lunar.nextLunarMonthDay(2, 1, true, new Date(2024, 0, 1));
  assert.equal(d, null);
});

test('解析月日：支持 MM-DD 与 YYYY-MM-DD，非法返回 null', () => {
  assert.deepEqual(lunar.parseMonthDay('03-14'), { month: 3, day: 14 });
  assert.deepEqual(lunar.parseMonthDay('1998-03-14'), { month: 3, day: 14 });
  assert.equal(lunar.parseMonthDay(''), null);
  assert.equal(lunar.parseMonthDay('13-40'), null);
  assert.equal(lunar.parseMonthDay('随便'), null);
});