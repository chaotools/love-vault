// 愿望 & 礼物 & 约会灵感：想要清单、礼物双向记录、随机抽卡
import { el, get, post, patch, del, toast, openModal, field, input, select, textarea, fmtDate, emptyState, store } from '../core.js';

const STATUSES = ['想要', '计划', '已实现'];
const PRIORITIES = ['高', '中', '低'];
const DIRECTIONS = ['送给TA', 'TA送我'];

// 内置约会灵感卡池（结合愿望清单与偏好动态混入）
const DATE_IDEAS = [
  '去看一次日落，什么都不干', '挑一家没去过的甜品店', '一起做一顿从没做过的菜', '夜骑共享单车穿过全城',
  '去植物园认十种花', '找个天台看星星', '一起拼一幅 1000 块拼图', '去菜市场买菜回来做饭',
  '雨天窝在家看老电影', '去 KTV 唱到嗓子哑', '一起给对方画一张像（画得越丑越好）', '去海边捡贝壳',
  '逛旧书店给对方挑一本书', '一起上一节体验课（陶艺/烘焙/拳击）', '露营一次，看清晨的雾', '去livehouse看一支没听过的乐队',
  '在公园野餐，带上 TA 爱吃的全部', '一起逛超市，只买零食', '凌晨去看海或看日出', '互相拍一组胶片照片',
  '去邻市吃一顿再当天回来', '一起打一整晚游戏', '给对方的手写一封信，一年后拆开', '去温泉或汗蒸',
  '一起做志愿者一天', '摩天轮或缆车，最高的那种', '夜市从头吃到尾', '一起养一盆植物，看谁先养死',
  '去美术馆假装很懂地评头论足', '冬天去滑雪或堆雪人', '找个咖啡馆各干各的，安静陪一下午', '去拍一次正式的合照',
  '重走第一次约会的地方', '一起制定明年的旅行计划', '半夜去吃一顿烧烤', '去猫咖或狗咖吸小动物',
  '对方选衣服，你必须穿一天', '一起整理手机相册，边看边笑', '去游乐园把刺激项目刷完', '在阳台 barbecue',
  '交换歌单听一周', '一起腌一罐泡菜/酿一罐酒等着喝', '去湖边发呆两小时', '给对方妈妈打个电话问好',
  '比赛谁先学会一首新歌', '一起许个愿，写在纸上藏起来', '去看一次话剧或脱口秀', '下雪天去踩没人踩过的雪',
  '一起逛宜家假装布置未来的家', '给 TA 按摩十分钟不许喊停', '去采一次水果（草莓/樱桃）', '玩一次桌游，赌注自定',
  '雨后去踩水坑，踩得越响越好', '一起剪一个vlog记录普通的一天', '去寺庙道观求个签', '夜宿山顶等云海',
  '把恋爱里的小事做成手账', '去上一次舞蹈体验课', '一起放一次风筝', '冬天同一个被窝看剧一整天'
];

let wishes = [];
let gifts = [];
let tab = 'wish';
let filterStatus = 'all';
let viewEl = null;

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  try {
    [wishes, gifts] = await Promise.all([get('/api/wishes'), get('/api/gifts')]);
  } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  wishes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  gifts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (params && params.focus) tab = 'wish';
  build();
  if (params && params.focus) {
    const it = wishes.find((w) => w.id === params.focus);
    if (it) setTimeout(() => editWish(it), 150);
  }
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '🎁 愿望 & 礼物' }),
      el('div', { class: 'page-desc', text: 'TA随口提过想要的，都记下来——送礼不重样' })),
    el('button', { class: 'primary-btn', text: '＋ ' + (tab === 'gift' ? '记一件礼物' : '记一个愿望'), onclick: () => tab === 'gift' ? editGift(null) : editWish(null) })));

  const seg = el('div', { class: 'seg' },
    ...[['wish', '💝 愿望清单'], ['gift', '🎀 礼物记录'], ['draw', '🃏 约会灵感']].map(([v, t]) =>
      el('button', { 'data-t': v, class: tab === v ? 'active' : '', text: t, onclick: () => {
        tab = v;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.t === v));
        buildBody();
        // 头部按钮的点击处理器在构造时绑定为读取当前 tab，这里只更新文案
        page.querySelector('.primary-btn').textContent = '＋ ' + (v === 'gift' ? '记一件礼物' : v === 'wish' ? '记一个愿望' : '抽三张');
      } })));
  page.append(el('div', { class: 'view-filter' }, seg));

  const body = el('div', { id: 'wishBody' });
  page.append(body);
  viewEl.append(page);
  buildBody();
}

function buildBody() {
  const body = document.getElementById('wishBody');
  if (!body) return;
  body.innerHTML = '';
  if (tab === 'wish') body.append(wishTab());
  else if (tab === 'gift') body.append(giftTab());
  else body.append(drawTab());
}

/* ---------- 愿望 ---------- */
function wishTab() {
  const wrap = el('div');
  const seg = el('div', { class: 'view-filter' },
    el('div', { class: 'seg' },
      el('button', { 'data-s': 'all', class: filterStatus === 'all' ? 'active' : '', text: '全部' }),
      ...STATUSES.map((s) => el('button', { 'data-s': s, class: filterStatus === s ? 'active' : '', text: s }))));
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filterStatus = b.dataset.s;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    grid.innerHTML = '';
    renderGrid();
  }));

  const grid = el('div', { class: 'wish-grid' });
  const renderGrid = () => {
    const shown = wishes.filter((w) => filterStatus === 'all' || w.status === filterStatus);
    if (!shown.length) {
      grid.append(emptyState('💝', wishes.length ? '这个状态下还没有愿望' : 'TA 随口说想要什么的时候，<b>记下来</b>——下次送礼就是惊喜'));
      return;
    }
    for (const w of shown) {
      grid.append(el('div', { class: 'wish-card' + (w.status === '已实现' ? ' done' : ''), onclick: () => editWish(w) },
        el('button', {
          class: 'small-btn wish-cycle', text: '↻ ' + w.status, onclick: (e) => {
            e.stopPropagation();
            cycleStatus(w);
          }
        }),
        el('div', { class: 'wish-title' }, w.title,
          w.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null),
        w.note ? el('div', { class: 'wish-note', text: w.note }) : null,
        el('div', { class: 'wish-meta' },
          el('span', { class: 'wish-priority p-' + (w.priority || '低'), title: '优先级' }),
          el('span', { class: 'wish-status s-' + w.status, text: w.status }),
          w.source ? el('span', { class: 'wish-source', text: '来源：' + w.source }) : null,
          w.doneAt ? el('span', { class: 'wish-source', text: fmtDate(w.doneAt) + ' 实现' }) : null)));
    }
  };
  renderGrid();
  wrap.append(seg, grid);
  return wrap;
}

async function cycleStatus(w) {
  const next = STATUSES[(STATUSES.indexOf(w.status) + 1) % STATUSES.length];
  const updated = await patch('/api/wishes/' + w.id, {
    status: next, doneAt: next === '已实现' ? new Date().toISOString() : null
  });
  const i = wishes.findIndex((x) => x.id === w.id);
  wishes[i] = { ...wishes[i], ...updated };
  if (next === '已实现') toast('愿望实现啦 🎉');
  buildBody();
}

function editWish(w) {
  const title = input({ type: 'text', value: w ? w.title : '', placeholder: 'TA想要什么，如：一台胶片相机' });
  const status = select(STATUSES.map((s) => [s, s]), w ? w.status : (filterStatus !== 'all' ? filterStatus : '想要'));
  const priority = select(PRIORITIES.map((p) => [p, p === '高' ? '高（近期就想送）' : p]), w ? w.priority : '中');
  const source = input({ type: 'text', value: w ? w.source : '', placeholder: 'TA随口说的 / 逛街时盯了三秒 / 生日提过' });
  const note = textarea({ placeholder: '型号、颜色、尺寸、在哪买…（可空）' }, w ? w.note : '');
  const md = openModal({
    title: w ? '编辑愿望' : '记一个愿望',
    content: el('div', null, field('愿望', title), field('状态', status), field('优先级', priority), field('来源', source), field('备注', note)),
    buttons: [
      w ? { el: el('button', { class: 'ghost-btn danger', text: '删除', onclick: async () => {
        if (!confirm(`删除「${w.title}」？`)) return;
        await del('/api/wishes/' + w.id);
        wishes = wishes.filter((x) => x.id !== w.id);
        md.close(); buildBody(); toast('已删除');
      } }) } : null,
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!title.value.trim()) { toast('愿望不能为空', 'err'); return; }
        const body = { title: title.value.trim(), status: status.value, priority: priority.value, source: source.value.trim(), note: note.value.trim() };
        if (w) {
          const updated = await patch('/api/wishes/' + w.id, body);
          const i = wishes.findIndex((x) => x.id === w.id);
          wishes[i] = { ...wishes[i], ...updated };
        } else {
          wishes.push(await post('/api/wishes', body));
        }
        md.close(); buildBody(); toast('已保存');
      } }) }
    ].filter(Boolean)
  });
  setTimeout(() => title.focus(), 60);
}

/* ---------- 礼物 ---------- */
function giftTab() {
  const wrap = el('div');
  if (!gifts.length) {
    wrap.append(emptyState('🎀', '送过什么、收到什么，都记下来——<b>防止重复送</b>，也留住感动'));
    return wrap;
  }
  const list = el('div', { class: 'gift-list' });
  for (const g of gifts) {
    list.append(el('div', { class: 'gift-row', onclick: () => editGift(g) },
      el('span', { class: 'gift-dir d-' + g.direction, text: g.direction }),
      el('span', { class: 'gift-title' }, g.title,
        g.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null),
      el('span', { class: 'gift-meta', text: [g.occasion, g.date ? fmtDate(g.date) : ''].filter(Boolean).join(' · ') }),
      el('button', {
        class: 'cf-del', text: '✕', onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`删除「${g.title}」？`)) return;
          await del('/api/gifts/' + g.id);
          gifts = gifts.filter((x) => x.id !== g.id);
          buildBody(); toast('已删除');
        }
      })));
  }
  wrap.append(list);
  return wrap;
}

function editGift(g) {
  const title = input({ type: 'text', value: g ? g.title : '', placeholder: '礼物名' });
  const direction = select(DIRECTIONS.map((d) => [d, d]), g ? g.direction : '送给TA');
  const occasion = input({ type: 'text', value: g ? g.occasion : '', placeholder: '生日 / 纪念日 / 没理由的惊喜…' });
  const date = input({ type: 'date', value: g && g.date ? g.date.slice(0, 10) : '' });
  const note = textarea({ placeholder: 'TA当时的反应、为什么选它…（可空）' }, g ? g.note : '');
  const md = openModal({
    title: g ? '编辑礼物' : '记一件礼物',
    content: el('div', null, field('礼物', title), field('方向', direction), field('场合', occasion), field('日期', date), field('备注', note)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!title.value.trim()) { toast('礼物名不能为空', 'err'); return; }
        const body = { title: title.value.trim(), direction: direction.value, occasion: occasion.value.trim(), date: date.value || null, note: note.value.trim() };
        if (g) {
          const updated = await patch('/api/gifts/' + g.id, body);
          const i = gifts.findIndex((x) => x.id === g.id);
          gifts[i] = { ...gifts[i], ...updated };
        } else {
          gifts.push(await post('/api/gifts', body));
        }
        gifts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        md.close(); buildBody(); toast('已保存');
      } }) }
    ]
  });
}

/* ---------- 约会灵感抽卡 ---------- */
function drawTab() {
  const zone = el('div', { class: 'draw-zone' });
  const cards = el('div', { class: 'draw-cards' });
  const draw = async () => {
    cards.innerHTML = '';
    // 三路来源：未实现愿望 / TA的喜欢 / 内置卡池
    const openWishes = wishes.filter((w) => w.status !== '已实现').map((w) => ({ text: '去实现：' + w.title, from: '来自愿望清单' }));
    let likes = [];
    try { likes = (await get('/api/preferences')).filter((p) => p.polarity === '喜欢').map((p) => ({ text: '围绕TA喜欢的「' + p.title + '」安排一次', from: '来自TA的偏好' })); } catch (e) { /* ignore */ }
    const pool = DATE_IDEAS.map((t) => ({ text: t, from: '灵感卡池' }));
    const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
    const picks = [pick(openWishes), pick(likes), pick(pool), pick(pool), pick(pool)].filter(Boolean);
    const used = new Set();
    let shown = 0;
    for (const p of picks) {
      if (used.has(p.text) || shown >= 3) continue;
      used.add(p.text); shown++;
      cards.append(el('div', { class: 'draw-card', style: `animation-delay:${shown * 0.12}s` },
        el('div', { class: 'dc-tag', text: 'IDEA · ' + p.from }),
        el('div', { class: 'dc-text', text: p.text })));
    }
    toast('这周末就从里面挑一个吧 💕');
  };
  zone.append(
    el('div', { class: 'empty-icon', text: '🃏' }),
    el('p', { style: 'color:var(--muted);font-size:14px', text: '不知道去哪约会？从TA的愿望、TA的喜欢和60张灵感卡里抽三张' }),
    el('button', { class: 'primary-btn', style: 'margin-top:16px', text: '🎲 抽三张', onclick: draw }),
    cards);
  return zone;
}

window.addEventListener('vault:focus-wishes', (e) => {
  const it = wishes.find((w) => w.id === e.detail);
  if (it) {
    if (tab !== 'wish') { tab = 'wish'; build(); }
    editWish(it);
  }
});
