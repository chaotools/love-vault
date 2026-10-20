// 时间轴排序与会话月份分组的纯函数，避免月份字符串未补零导致跨月顺序错误。
function timeValue(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function compareTimelineItems(a, b) {
  const ta = timeValue(a && a.date);
  const tb = timeValue(b && b.date);
  if (ta === null && tb === null) return String((b && b.date) || '').localeCompare(String((a && a.date) || ''));
  if (ta === null) return 1;
  if (tb === null) return -1;
  if (ta !== tb) return tb - ta;
  return String((b && b.date) || '').localeCompare(String((a && a.date) || ''));
}

export function sortTimelineItems(items) {
  return [...items].sort(compareTimelineItems);
}

export function groupTimelineByMonth(items) {
  const groups = new Map();
  for (const item of items) {
    const date = new Date(item && item.date);
    const valid = !Number.isNaN(date.getTime());
    const year = valid ? date.getFullYear() : null;
    const month = valid ? date.getMonth() + 1 : null;
    const key = valid ? `${year}-${String(month).padStart(2, '0')}` : 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        year,
        month,
        label: valid ? `${year}年${month}月` : '时间未知',
        items: []
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.year === null && b.year === null) return 0;
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return (b.year - a.year) || (b.month - a.month);
  });
}