// 爱情日历：月视图，聚合纪念日/生日/大事记/照片/生理期
import { el, get, openModal, emptyState, fmtDate, subjectLabel } from '../core.js';

let viewEl = null;
let year = new Date().getFullYear();
let month = new Date().getMonth() + 1;

const TYPE_ICON = {
  birthday: '🎂', memorial: '💘', event: '📌', media: '🖼️', period: '🌸', milestone: '🎉'
};
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export async function render(container) {
  viewEl = container;
  container.innerHTML = '';
  try { await loadAndBuild(); } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
}

async function loadAndBuild() {
  viewEl.innerHTML = '';
  const r = await get(`/api/calendar?year=${year}&month=${month}`);
  build(r);
}

function build(data) {
  const page = el('div', { class: 'page' });

  // 头部：标题 + 切月
  const monthLabel = `${year} 年 ${month} 月`;
  const pageHead = el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '📅 爱情日历' }),
      el('div', { class: 'page-desc', text: `一眼看全这个月与 ${subjectLabel()} 相关的日子` })),
    el('div', { class: 'cal-nav' },
      el('button', { class: 'ghost-btn', text: '‹', onclick: () => { month--; if (month < 1) { month = 12; year--; } loadAndBuild(); } }),
      el('span', { class: 'cal-month', text: monthLabel }),
      el('button', { class: 'ghost-btn', text: '›', onclick: () => { month++; if (month > 12) { month = 1; year++; } loadAndBuild(); } }),
      el('button', { class: 'ghost-btn', text: '今天', onclick: () => { year = new Date().getFullYear(); month = new Date().getMonth() + 1; loadAndBuild(); } })));

  // 图例
  const legend = el('div', { class: 'cal-legend' },
    ...Object.entries(TYPE_ICON).map(([k, v]) => el('span', { class: 'lg', text: '' }, el('i', { class: 'dot ' + k }), `${v} ${k === 'media' ? '照片' : k === 'event' ? '大事记' : k === 'birthday' ? '生日' : k === 'memorial' ? '纪念日' : k === 'period' ? '生理期' : '里程碑'}`)));

  // 星期表头
  const headRow = el('div', { class: 'cal-grid cal-head' },
    ...WEEKDAYS.map((w) => el('div', { class: 'cal-cell cal-weekday', text: w })));

  // 计算月历格子：第一天是星期几（周日=0），共 daysInMonth 天
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();

  const dayItems = data.days || {};
  const grid = el('div', { class: 'cal-grid' });
  // 前置空格
  for (let i = 0; i < firstDow; i++) grid.append(el('div', { class: 'cal-cell cal-empty' }));
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const items = dayItems[key] || [];
    const isToday = key === todayStr;
    const cell = el('div', { class: 'cal-cell' + (isToday ? ' today' : '') + (items.length ? ' has-items' : '') },
      el('div', { class: 'cal-daynum', text: day }));
    if (items.length) {
      // 图标行（最多显示 4 个，多的折叠）
      const icons = el('div', { class: 'cal-icons' });
      items.slice(0, 4).forEach((it) => {
        if (it.type === 'media' && it.thumbs && it.thumbs.length) {
          icons.append(el('img', { class: 'cal-thumb', src: it.thumbs[0], alt: '' }));
        } else {
          icons.append(el('span', { class: 'cal-ico', text: TYPE_ICON[it.type] || '📌' }));
        }
      });
      if (items.length > 4) icons.append(el('span', { class: 'cal-more', text: `+${items.length - 4}` }));
      cell.append(icons);
      cell.addEventListener('click', () => showDay(key, items));
      cell.classList.add('clickable');
    }
    grid.append(cell);
  }

  page.append(pageHead, legend, headRow, grid);
  viewEl.append(page);
}

// 点某天：弹窗显示当天所有内容
function showDay(key, items) {
  const rows = el('div', { class: 'cal-day-list' });
  for (const it of items) {
    const icon = TYPE_ICON[it.type] || '📌';
    const title = it.type === 'media'
      ? el('div', null, el('div', { class: 'cal-day-title', text: it.title }), it.thumbs && it.thumbs.length
        ? el('div', { class: 'cal-day-thumbs' }, ...it.thumbs.map((t) => el('img', { src: t })))
        : null)
      : el('div', { class: 'cal-day-title', text: it.title });
    rows.append(el('div', { class: 'cal-day-row' },
      el('span', { class: 'cal-day-ico', text: icon }),
      el('div', null, title, it.sub ? el('div', { class: 'cal-day-sub', text: it.sub }) : null)));
  }
  const date = key.slice(5).replace('-', '月') + '日';
  const md = openModal({
    title: `${key.slice(0, 4)}年${date}`,
    content: rows,
    buttons: [{ el: el('button', { class: 'primary-btn', text: '知道了', onclick: () => md.close() }) }]
  });
}
