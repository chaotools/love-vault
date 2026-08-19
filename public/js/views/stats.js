// 统计视图：在一起天数、各类计数、月度分布柱状图、标签云
import { el, get, emptyState } from '../core.js';

let stats = null;
let viewEl = null;

export async function render(container) {
  viewEl = container;
  container.innerHTML = '';
  try { stats = await get('/api/stats'); } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  build();
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page' });
  page.append(el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '📊 统计' }),
      el('div', { class: 'page-desc', text: '我们一共留下了多少回忆' }))));

  // 数字卡片
  const c = stats.counts;
  const doneRate = c.wishes ? Math.round((c.wishesDone / c.wishes) * 100) + '%' : '—';
  const cards = el('div', { class: 'stats-cards' },
    statCard('💞', stats.daysTogether != null ? stats.daysTogether + ' 天' : '—', '在一起'),
    statCard('🖼️', c.photos, '照片'),
    statCard('🎬', c.videos, '视频'),
    statCard('📖', c.events, '大事记'),
    statCard('💝', c.wishes + (c.wishes ? ` · ${doneRate}已实现` : ''), '愿望'),
    statCard('🎁', c.gifts, '礼物'),
    statCard('👥', c.people, 'TA身边的人'),
    statCard('📁', c.albums, '相册'));
  page.append(cards);

  // 月度分布柱状图
  page.append(section('近 12 个月'), monthlyChart());

  // 标签云
  if (stats.topTags.length) {
    page.append(section('照片标签 TOP'), el('div', { class: 'tag-cloud' },
      ...stats.topTags.map((t) => el('span', { class: 'tag-chip', text: `#${t.tag} ${t.count}` }))));
  }

  // 分布小卡
  page.append(el('div', { class: 'stats-grid' },
    distCard('📖 大事记类型', stats.eventByType),
    distCard('💝 愿望状态', stats.wishByStatus),
    distCard('🎁 礼物方向', stats.giftByDirection),
    distCard('💗 喜好', stats.prefByPolarity)));
  if (stats.periodStat) {
    page.append(section('🌸 生理期'),
      el('div', { class: 'section-card' },
        el('p', { style: 'font-size:14px;color:var(--ink-light)', text: `已记录 ${stats.periodStat.count} 个周期，平均间隔 ${stats.periodStat.avgGap} 天。` })));
  }

  viewEl.append(page);
}

function section(title) {
  return el('div', { class: 'stats-section-title', text: title });
}
function statCard(icon, num, label) {
  return el('div', { class: 'stat-card' },
    el('div', { class: 'stat-icon', text: icon }),
    el('div', { class: 'stat-num', text: num }),
    el('div', { class: 'stat-label', text: label }));
}
function distCard(title, obj) {
  const entries = Object.entries(obj || {});
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return el('div', { class: 'section-card' },
    el('h3', { text: title }),
    entries.length ? el('div', { class: 'dist-list' },
      ...entries.sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        el('div', { class: 'dist-row' },
          el('span', { class: 'dist-name', text: k }),
          el('span', { class: 'dist-bar-wrap' }, el('span', { class: 'dist-bar', style: `width:${total ? Math.max(6, Math.round((v / total) * 100)) : 0}%` })),
          el('span', { class: 'dist-num', text: v }))))
      : el('p', { style: 'font-size:13px;color:var(--muted)', text: '暂无数据' }));
}

function monthlyChart() {
  const m = stats.monthly || [];
  const max = Math.max(1, ...m.map((x) => Math.max(x.photos, x.videos, x.events)));
  return el('div', { class: 'section-card' },
    el('div', { class: 'bar-chart' },
      ...m.map((x) => {
        const tot = x.photos + x.videos + x.events;
        return el('div', { class: 'bar-col' },
          el('div', { class: 'bar-total', text: tot || '' }),
          el('div', { class: 'bar-track' },
            x.photos ? el('div', { class: 'bar-fill photo', style: `height:${Math.round((x.photos / max) * 100)}%` }) : null,
            x.videos ? el('div', { class: 'bar-fill video', style: `height:${Math.round((x.videos / max) * 100)}%` }) : null,
            x.events ? el('div', { class: 'bar-fill event', style: `height:${Math.round((x.events / max) * 100)}%` }) : null),
          el('div', { class: 'bar-label', text: x.label }));
      })),
    el('div', { class: 'bar-legend' },
      el('span', { class: 'lg', text: '' }, el('i', { class: 'dot photo' }), '照片'),
      el('span', { class: 'lg', text: '' }, el('i', { class: 'dot video' }), '视频'),
      el('span', { class: 'lg', text: '' }, el('i', { class: 'dot event' }), '大事记')));
}