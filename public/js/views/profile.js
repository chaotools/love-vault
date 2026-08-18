// TA的档案：基本信息 / 尺码 / 健康 / 生理期 / 自定义字段 / 我们的故事
import { el, get, put, toast, openModal, field, input, select, emptyState } from '../core.js';

const BASIC_FIELDS = [
  ['nickname', '昵称'], ['birthday', '生日'], ['zodiac', '星座'], ['bloodType', '血型'],
  ['height', '身高 (cm)'], ['weight', '体重 (kg)'], ['shoeSize', '鞋码'],
  ['topSize', '上衣尺码'], ['bottomSize', '裤装尺码'], ['ringSize', '戒指圈口'], ['glasses', '眼镜度数']
];

// 将已有 birthday 规整为 input[type=date] 需要的 YYYY-MM-DD；无法解析则返回 ''
function normalizeBirthday(str) {
  if (!str) return '';
  str = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  let m = str.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `2000-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  m = str.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (m) return `2000-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return '';
}

// 由月日算星座（中文）
function getZodiac(month, day) {
  const md = month * 100 + day;
  if (md >= 1222 || md <= 119) return '摩羯座';
  if (md <= 218) return '水瓶座';
  if (md <= 320) return '双鱼座';
  if (md <= 419) return '白羊座';
  if (md <= 520) return '金牛座';
  if (md <= 621) return '双子座';
  if (md <= 722) return '巨蟹座';
  if (md <= 822) return '狮子座';
  if (md <= 922) return '处女座';
  if (md <= 1023) return '天秤座';
  if (md <= 1122) return '天蝎座';
  if (md <= 1221) return '射手座';
  return '摩羯座';
}

// 生日用年/月/日三段下拉：原生 date 控件的滚轮年份每次只 +1，选出生年份要滚好几十下，太慢
const BIRTHDAY_YEAR_MIN = 1925;
function buildYearOptions() {
  const thisYear = new Date().getFullYear();
  const opts = [['', '年']];
  for (let y = thisYear; y >= BIRTHDAY_YEAR_MIN; y--) opts.push([String(y), String(y)]);
  return opts;
}
function buildMonthOptions() {
  const opts = [['', '月']];
  for (let m = 1; m <= 12; m++) opts.push([String(m), String(m)]);
  return opts;
}
function daysInMonth(y, m) {
  if (!m) return 31;
  if (!y) y = 2000;
  return new Date(y, m, 0).getDate();
}
function buildDayOptions(y, m) {
  const max = daysInMonth(y ? +y : 2000, m ? +m : 12);
  const opts = [['', '日']];
  for (let d = 1; d <= max; d++) opts.push([String(d), String(d)]);
  return opts;
}

const HEALTH_FIELDS = [['allergies', '过敏（食物/药物）'], ['medications', '正在用的药'], ['notes', '其他健康备注']];

let profile = null;
let viewEl = null;

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  try { profile = await get('/api/profile'); } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  build();
  if (params && params.focus === 'story') {
    setTimeout(() => { const b = document.getElementById('storyBox'); if (b) b.scrollIntoView({ behavior: 'smooth' }); }, 100);
  }
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page' });
  page.append(el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '🧸 TA的档案' }),
      el('div', { class: 'page-desc', text: '身高体重尺码健康……送礼点餐，直接抄答案' }))));

  const grid = el('div', { class: 'profile-grid' });

  // 基本信息 + 尺码
  grid.append(section('📋 基本信息与尺码', () => editBasics(), () => kvList(BASIC_FIELDS, profile.basics)));

  // 健康
  grid.append(section('🩺 健康（重点记忆）', () => editHealth(), () => el('div', { class: 'kv-list' },
    ...HEALTH_FIELDS.map(([k, label]) => el('div', { class: 'kv alert' },
      el('div', { class: 'k', text: label }),
      el('div', { class: 'v', text: profile.health[k] || '' }))))));

  // 生理期（开启才显示）
  if (profile.period && profile.period.enabled) grid.append(periodCard());

  // 自定义字段
  grid.append(customFieldsCard());

  page.append(grid);

  // 我们的故事
  page.append(el('div', { class: 'section-card story-box', id: 'storyBox', style: 'margin-top:20px' },
    el('h3', { text: '💌 我们的故事' }),
    storyEditor()));

  viewEl.append(page);
}

function section(title, onEdit, bodyFn) {
  return el('div', { class: 'section-card' },
    el('h3', null, title, el('button', { class: 'small-btn', text: '编辑', onclick: onEdit })),
    bodyFn());
}
function kvList(fields, data) {
  return el('div', { class: 'kv-list' },
    ...fields.map(([k, label]) => el('div', { class: 'kv' },
      el('div', { class: 'k', text: label }),
      el('div', { class: 'v', text: (data && data[k]) || '' }))));
}

function editBasics() {
  const inputs = {};
  const content = el('div', null, ...BASIC_FIELDS.map(([k, label]) => {
    if (k === 'birthday') {
      const cur = normalizeBirthday(profile.basics && profile.basics[k]); // 'YYYY-MM-DD' | ''
      const [ey, em, ed] = cur ? cur.split('-').map((n) => String(parseInt(n, 10))) : ['', '', ''];
      const yearSel = select(buildYearOptions(), ey);
      const monthSel = select(buildMonthOptions(), em);
      const daySel = select(buildDayOptions(ey, em), ed);
      const hidden = el('input', { type: 'hidden', value: cur });
      inputs[k] = hidden;

      // 切换年/月时重排「日」选项（2 月、闰年、大小月天数不同），并保留已选日（超界则清空）
      const syncDays = () => {
        const max = daysInMonth(yearSel.value ? +yearSel.value : 2000, monthSel.value ? +monthSel.value : 12);
        const prev = daySel.value;
        daySel.innerHTML = '';
        daySel.append(el('option', { value: '', text: '日' }));
        for (let d = 1; d <= max; d++) daySel.append(el('option', { value: String(d), text: String(d) }));
        daySel.value = prev && +prev <= max ? prev : '';
      };
      // 合成 YYYY-MM-DD 写入隐藏字段，并按月日自动补星座（仍可被手动改）
      const refresh = () => {
        const y = yearSel.value, m = monthSel.value, d = daySel.value;
        hidden.value = y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
        if (inputs.zodiac) inputs.zodiac.value = hidden.value ? getZodiac(+m, +d) : '';
      };
      yearSel.addEventListener('change', () => { syncDays(); refresh(); });
      monthSel.addEventListener('change', () => { syncDays(); refresh(); });
      daySel.addEventListener('change', refresh);

      return field(label, el('div', { class: 'birthday-selects' },
        yearSel, el('span', { class: 'bd-sep', text: '年' }),
        monthSel, el('span', { class: 'bd-sep', text: '月' }),
        daySel, el('span', { class: 'bd-sep', text: '日' })));
    }
    inputs[k] = input({ type: 'text', value: (profile.basics && profile.basics[k]) || '' });
    return field(label, inputs[k]);
  }));
  const md = openModal({
    title: '编辑基本信息', content, buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        const basics = {}; for (const [k] of BASIC_FIELDS) basics[k] = inputs[k].value.trim();
        profile = await put('/api/profile', { basics });
        md.close(); build(); toast('已保存');
      } }) }
    ]
  });
}

function editHealth() {
  const inputs = {};
  const content = el('div', null, ...HEALTH_FIELDS.map(([k, label]) => {
    inputs[k] = input({ type: 'text', value: (profile.health && profile.health[k]) || '' });
    return field(label, inputs[k]);
  }));
  const md = openModal({
    title: '编辑健康档案', content, buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        const health = {}; for (const [k] of HEALTH_FIELDS) health[k] = inputs[k].value.trim();
        profile = await put('/api/profile', { health });
        md.close(); build(); toast('已保存');
      } }) }
    ]
  });
}

/* 生理期卡片 */
function periodCard() {
  const p = profile.period;
  const cycles = (p.lastCycles || []).slice().sort();
  const last = cycles.length ? new Date(cycles[cycles.length - 1]) : null;
  const avg = p.avgDays || 28;
  const next = last ? new Date(last.getTime() + avg * 86400000) : null;
  const dInput = input({ type: 'date' });

  const record = async () => {
    if (!dInput.value) return;
    p.lastCycles = [...(p.lastCycles || []), new Date(dInput.value).toISOString()].slice(-12);
    await put('/api/profile', { period: p });
    profile = await get('/api/profile');
    build(); toast('已记录 🌸');
  };

  return el('div', { class: 'section-card' },
    el('h3', { text: '🌸 生理期记录' }),
    el('div', { class: 'period-row' },
      el('div', { class: 'period-stat' }, el('span', { class: 'k', text: '最近一次' }), el('span', { class: 'v', text: last ? `${last.getMonth() + 1}月${last.getDate()}日` : '—' })),
      el('div', { class: 'period-stat' }, el('span', { class: 'k', text: '平均周期' }), el('span', { class: 'v', text: avg + ' 天' })),
      el('div', { class: 'period-stat' }, el('span', { class: 'k', text: '预计下次' }), el('span', { class: 'v', text: next ? `${next.getMonth() + 1}月${next.getDate()}日` : '—' }))),
    el('div', { style: 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap' },
      dInput, el('button', { class: 'small-btn', text: '记一次', onclick: record }),
      cycles.length > 1 ? el('button', {
        class: 'ghost-btn danger', style: 'padding:6px 14px;font-size:12px', text: '清空记录', onclick: async () => {
          if (!confirm('清空全部生理期记录？')) return;
          p.lastCycles = [];
          await put('/api/profile', { period: p });
          profile = await get('/api/profile');
          build();
        }
      }) : null),
    el('p', { style: 'font-size:11.5px;color:var(--muted);margin-top:12px', text: '开启后首页会提前 3 天温柔提醒。仅为贴心参考，身体不适请就医。' }));
}

/* 自定义字段 */
function customFieldsCard() {
  const card = el('div', { class: 'section-card' },
    el('h3', { text: '✨ 自定义字段' }, el('button', { class: 'small-btn', text: '＋ 添加', onclick: () => editCustom(null) })));
  const list = el('div');
  const fields = profile.customFields || [];
  if (!fields.length) {
    list.append(el('p', { style: 'font-size:13px;color:var(--muted)', text: '任何想记的都可以加：口头禅、用哪只手、怕什么、枕边习惯…' }));
  }
  for (const f of fields) {
    list.append(el('div', { class: 'custom-field-row' },
      el('span', { class: 'cf-label', text: f.label }),
      el('span', { class: 'cf-value', text: f.value }),
      el('button', { class: 'cf-del', text: '✎', onclick: () => editCustom(f) }),
      el('button', { class: 'cf-del', text: '✕', onclick: async () => {
        if (!confirm(`删除字段「${f.label}」？`)) return;
        profile.customFields = fields.filter((x) => x.id !== f.id);
        profile = await put('/api/profile', { customFields: profile.customFields });
        build(); toast('已删除');
      } })));
  }
  card.append(list);
  return card;
}

function editCustom(f) {
  const l = input({ type: 'text', value: f ? f.label : '', placeholder: '字段名，如：口头禅' });
  const v = input({ type: 'text', value: f ? f.value : '', placeholder: '内容，如：好家伙' });
  const md = openModal({
    title: f ? '编辑字段' : '添加字段', content: el('div', null, field('字段名', l), field('内容', v)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!l.value.trim()) { toast('字段名不能为空', 'err'); return; }
        const fields = [...(profile.customFields || [])];
        if (f) {
          const i = fields.findIndex((x) => x.id === f.id);
          fields[i] = { ...fields[i], label: l.value.trim(), value: v.value.trim() };
        } else {
          fields.push({ id: crypto.randomUUID(), label: l.value.trim(), value: v.value.trim() });
        }
        profile = await put('/api/profile', { customFields: fields });
        md.close(); build(); toast('已保存');
      } }) }
    ]
  });
}

/* 我们的故事 */
function storyEditor() {
  const ta = el('textarea', { placeholder: '怎么认识的、第一次约会说了什么、TA哪一点打动了你……写下来，越早写越清楚。' });
  ta.value = profile.story || '';
  let dirty = false;
  ta.addEventListener('input', () => { dirty = true; });
  const saveBtn = el('button', {
    class: 'small-btn', text: '保存', onclick: async () => {
      profile = await put('/api/profile', { story: ta.value });
      dirty = false; toast('故事已保存 💕');
    }
  });
  return el('div', null, ta, el('div', { style: 'margin-top:12px;text-align:right' }, saveBtn));
}
