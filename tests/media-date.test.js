const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDateValue, MEDIA_TIME_ZONE_OFFSET } = require('../src/media-date');

test('无时区 EXIF 时间按中国时区解析，避免 UTC 容器跨日', () => {
  assert.equal(MEDIA_TIME_ZONE_OFFSET, '+08:00');
  assert.equal(parseDateValue('2023:01:01 20:30:00'), '2023-01-01T12:30:00.000Z');
  assert.equal(parseDateValue('2023-01-01 20:30:00'), '2023-01-01T12:30:00.000Z');
  assert.equal(parseDateValue('2023-01-01T20:30:00'), '2023-01-01T12:30:00.000Z');
});

test('已带时区的媒体时间保持原语义', () => {
  assert.equal(parseDateValue('2023-01-01T20:30:00Z'), '2023-01-01T20:30:00.000Z');
  assert.equal(parseDateValue('2023-01-01T20:30:00+08:00'), '2023-01-01T12:30:00.000Z');
  assert.equal(parseDateValue('2023-01-01T12:30:00-05:00'), '2023-01-01T17:30:00.000Z');
});

test('无效或空媒体时间安全返回 null', () => {
  assert.equal(parseDateValue(''), null);
  assert.equal(parseDateValue(null), null);
  assert.equal(parseDateValue('not-a-date'), null);
});
