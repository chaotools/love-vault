// 媒体时间解析：EXIF 的 DateTimeOriginal 通常没有时区，必须按中国时间解释。
// 否则 Docker 默认 UTC 环境会把晚上拍摄的照片记录成第二天。
const MEDIA_TIME_ZONE_OFFSET = '+08:00';
const NAIVE_DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function parseDateValue(value) {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  // EXIF 常见格式：2023:01:01 20:30:00
  text = text.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  // 无时区的时间按上海本地时间解析；带 Z / ±hh:mm 的时间保持原样。
  if (NAIVE_DATE_TIME.test(text)) {
    text = text.replace(' ', 'T') + MEDIA_TIME_ZONE_OFFSET;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = { MEDIA_TIME_ZONE_OFFSET, parseDateValue };
