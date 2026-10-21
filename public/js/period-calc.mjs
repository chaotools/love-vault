const DAY = 86400000;

function validCycle(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function appendCycle(cycles, value, max = 12) {
  const next = validCycle(value);
  if (!next) return Array.isArray(cycles) ? cycles.slice(-max) : [];
  return [...(Array.isArray(cycles) ? cycles : []), next]
    .map(validCycle)
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort()
    .slice(-max);
}

export function averageCycleDays(cycles, fallback = 28) {
  if (!Array.isArray(cycles) || cycles.length < 2) return fallback;
  const sorted = cycles.map(validCycle).filter(Boolean).sort();
  const gaps = [];
  for (let index = 1; index < sorted.length; index++) {
    const gap = Math.round((new Date(sorted[index]) - new Date(sorted[index - 1])) / DAY);
    if (gap > 0 && gap <= 90) gaps.push(gap);
  }
  return gaps.length ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) : fallback;
}
