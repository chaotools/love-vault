// 人名关系库：TA身边的人，谁是谁、什么关系、生日、怎么认识的
import { el, get, post, patch, del, toast, openModal, field, input, select, textarea, emptyState } from '../core.js';

const GROUPS = ['家人', '朋友', '同事', '其他'];
let people = [];
let filterGroup = 'all';
let viewEl = null;

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  try { people = await get('/api/people'); } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  build();
  if (params && params.focus) {
    const it = people.find((p) => p.id === params.focus);
    if (it) setTimeout(() => editPerson(it), 120);
  }
}

// 生日临近判断（30 天内显示蛋糕）
function birthdaySoon(birthday) {
  if (!birthday) return false;
  const m = birthday.match(/(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), parseInt(m[1]) - 1, parseInt(m[2]));
  if (next < today) next = new Date(today.getFullYear() + 1, parseInt(m[1]) - 1, parseInt(m[2]));
  return Math.round((next - today) / 86400000) <= 30;
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '👨‍👩‍👧 人名关系库' }),
      el('div', { class: 'page-desc', text: 'TA的家人朋友同事——聚会前翻一遍，"那个谁"再也不怕' })),
    el('button', { class: 'primary-btn', text: '＋ 加个人', onclick: () => editPerson(null) })));

  const seg = el('div', { class: 'seg' },
    el('button', { 'data-g': 'all', class: filterGroup === 'all' ? 'active' : '', text: '全部' }),
    ...GROUPS.map((g) => el('button', { 'data-g': g, class: filterGroup === g ? 'active' : '', text: g })));
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filterGroup = b.dataset.g;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    buildGrid();
  }));
  page.append(el('div', { class: 'view-filter' }, seg));

  const grid = el('div', { class: 'people-grid', id: 'peopleGrid' });
  page.append(grid);
  viewEl.append(page);
  buildGrid();
}

function buildGrid() {
  const grid = document.getElementById('peopleGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const shown = people.filter((p) => filterGroup === 'all' || p.group === filterGroup)
    .slice()
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));

  if (!shown.length) {
    grid.append(emptyState('👥', people.length ? '该分组还没有人' : '从 TA 常提起的人开始记：名字 + 关系就够了'));
    return;
  }
  for (const p of shown) {
    const soon = birthdaySoon(p.birthday);
    grid.append(el('div', { class: 'person-card', onclick: () => editPerson(p) },
      soon ? el('div', { class: 'person-bday-cake', text: '🎂' }) : null,
      el('div', { class: 'person-top' },
        el('div', { class: 'person-avatar', text: p.name.slice(0, 1) }),
        el('div', null,
          el('div', { class: 'person-name' }, p.name,
            p.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null),
          el('div', { class: 'person-relation', text: p.relation || '' }))),
      el('span', { class: 'person-tag g-' + (p.group || '其他'), text: p.group || '其他' }),
      p.birthday ? el('div', { class: 'person-bday' + (soon ? ' soon' : ''), text: '🎂 ' + p.birthday + (p.lunar ? (p.leap ? '（农历·闰月）' : '（农历）') : '') }) : null,
      p.howMet ? el('div', { class: 'person-notes', text: '相识：' + p.howMet }) : null,
      p.notes ? el('div', { class: 'person-notes', text: p.notes }) : null));
  }
}

function editPerson(p) {
  const name = input({ type: 'text', value: p ? p.name : '', placeholder: '怎么称呼' });
  const relation = input({ type: 'text', value: p ? p.relation : '', placeholder: '和TA的关系，如：妈妈 / 大学室友' });
  const group = select(GROUPS.map((g) => [g, g]), p ? p.group : (filterGroup !== 'all' ? filterGroup : '朋友'));
  const birthday = input({ type: 'text', value: p ? p.birthday : '', placeholder: '03-14 或 1998-03-14' });
  const lunarChk = el('input', { type: 'checkbox', id: 'pLunar' });
  lunarChk.checked = !!(p && p.lunar);
  const lunarLabel = el('label', { class: 'lunar-chk' }, lunarChk, el('span', { text: '按农历过生日' }));
  const leapChk = el('input', { type: 'checkbox' });
  leapChk.checked = !!(p && p.leap);
  leapChk.disabled = !lunarChk.checked;
  const leapLabel = el('label', { class: 'lunar-chk' }, leapChk, el('span', { text: '闰月生日' }));
  lunarChk.addEventListener('change', () => {
    birthday.placeholder = lunarChk.checked ? '农历月-日，如 03-02（三月初二）' : '03-14 或 1998-03-14';
    if (!lunarChk.checked) leapChk.checked = false;
    leapChk.disabled = !lunarChk.checked;
  });
  if (lunarChk.checked) birthday.placeholder = '农历月-日，如 03-02（三月初二）';
  const lunarRow = el('div', { class: 'lunar-chk-row' }, lunarLabel, leapLabel);
  const howMet = input({ type: 'text', value: p ? p.howMet : '', placeholder: '怎么认识/交集，如：TA的高中同桌' });
  const notes = textarea({ placeholder: 'TA提过的八卦、喜好、要注意的点…（可空）' }, p ? p.notes : '');

  const md = openModal({
    title: p ? '编辑 ' + p.name : '加一个人',
    content: el('div', null,
      field('称呼', name), field('关系', relation), field('分组', group),
      field('生日', birthday), lunarRow, field('相识', howMet), field('备注', notes)),
    buttons: [
      p ? { el: el('button', { class: 'ghost-btn danger', text: '删除', onclick: async () => {
        if (!confirm(`删除「${p.name}」？`)) return;
        await del('/api/people/' + p.id);
        people = people.filter((x) => x.id !== p.id);
        md.close(); build(); toast('已删除');
      } }) } : null,
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!name.value.trim()) { toast('称呼不能为空', 'err'); return; }
        const body = {
          name: name.value.trim(), relation: relation.value.trim(), group: group.value,
          birthday: birthday.value.trim(), lunar: lunarChk.checked, leap: lunarChk.checked && leapChk.checked,
          howMet: howMet.value.trim(), notes: notes.value.trim()
        };
        if (p) {
          const updated = await patch('/api/people/' + p.id, body);
          const i = people.findIndex((x) => x.id === p.id);
          people[i] = updated;
        } else {
          people.push(await post('/api/people', body));
        }
        md.close(); build(); toast('已保存');
      } }) }
    ].filter(Boolean)
  });
  setTimeout(() => name.focus(), 60);
}

window.addEventListener('vault:focus-people', (e) => {
  const it = people.find((p) => p.id === e.detail);
  if (it) editPerson(it);
});
