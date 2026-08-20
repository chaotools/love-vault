// 统计视图：在一起天数、各类计数、月度分布柱状图、标签云、记录活跃、TA 画像
import { el, get, emptyState, subjectLabel } from '../core.js';

let stats = null;
let viewEl = null;

export async function render(container) {
  viewEl = container;
  container.innerHTML = '';
  try {
    const [s, r] = await Promise.all([get('/api/stats'), get('/api/reminders?days=30').catch(() => null)]);
    stats = s;
    stats._activity = r ? r.activity : null;
  } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
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
    statCard('👥', c.people, `${subjectLabel()}身边的人`),
    statCard('📁', c.albums, '相册'));
  page.append(cards);

  // 记录活跃卡
  if (stats._activity) {
    const act = stats._activity;
    page.append(section('记录活跃'),
      el('div', { class: 'stats-cards' },
        statCard('🔥', act.streak + ' 天', '连续记录'),
        statCard('📝', act.monthCount, '本月记录'),
        statCard('🗓️', act.lastRecordAt || '—', '最近记录')));
  }

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

  // —— 记录统计增强 ——

  // 地点 Top
  if (stats.topLocations && stats.topLocations.length) {
    page.append(section('📍 一起去过最多的地方'),
      el('div', { class: 'tag-cloud' },
        ...stats.topLocations.map((l) => el('span', { class: 'tag-chip', text: `📍 ${l.location} ${l.count}` }))));
  }

  // 愿望实现率 / 承诺兑现率（进度卡）
  const rateCards = el('div', { class: 'stats-grid' });
  if (stats.wishRate) rateCards.append(rateCard('💝 愿望实现率', stats.wishRate.done, stats.wishRate.total, stats.wishRate.rate));
  if (stats.promiseRate) rateCards.append(rateCard('🤙 承诺兑现率', stats.promiseRate.done, stats.promiseRate.total, stats.promiseRate.rate));
  if (rateCards.children.length) page.append(section('完成进度'), rateCards);

  // 偏好分类 + 人名分布 + TA 画像
  const extraGrid = el('div', { class: 'stats-grid' });
  if (stats.prefByCategory && Object.keys(stats.prefByCategory).length) extraGrid.append(distCard('💗 偏好分类', stats.prefByCategory));
  if (stats.peopleByGroup && Object.keys(stats.peopleByGroup).length) extraGrid.append(distCard(`👥 ${subjectLabel()}身边的人`, stats.peopleByGroup));
  if (stats.portraitCard && Object.keys(stats.portraitCard).length) extraGrid.append(portraitCard(stats.portraitCard));
  if (extraGrid.children.length) page.append(section(`关于 ${subjectLabel()}`), extraGrid);

  viewEl.append(page);
}

// 进度卡（愿望/承诺实现率）
function rateCard(icon, done, total, rate) {
  return el('div', { class: 'section-card' },
    el('h3', { text: icon }),
    el('div', { class: 'rate-num', text: rate + '%' }),
    el('div', { class: 'rate-bar' }, el('div', { class: 'rate-fill', style: `width:${rate}%` })),
    el('p', { style: 'font-size:12px;color:var(--muted);margin-top:6px', text: `${done} / ${total}` }));
}

// TA 画像卡
function portraitCard(portrait) {
  return el('div', { class: 'section-card' },
    el('h3', { text: `🧸 ${subjectLabel()} 画像` }),
    el('div', { class: 'kv-list' },
      ...Object.entries(portrait).map(([k, v]) => {
        const label = { nickname: '昵称', birthday: '生日', zodiac: '星座', bloodType: '血型', height: '身高', weight: '体重', shoeSize: '鞋码' }[k] || k;
        return el('div', { class: 'kv' }, el('div', { class: 'k', text: label }), el('div', { class: 'v', text: v }));
      })));
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
