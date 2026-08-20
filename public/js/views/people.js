// 人名关系库：TA身边的人，谁是谁、什么关系、生日、怎么认识的
// 支持卡片 / 关系图两种视图；关系图是自研力导向（零依赖）
import { el, get, post, patch, del, toast, openModal, field, input, select, textarea, emptyState } from '../core.js';
import { RelationGraph } from '../relation-graph.js';

const GROUPS = ['家人', '朋友', '同事', '其他'];
let people = [];
let filterGroup = 'all';
let viewMode = 'card'; // 'card' | 'graph'
let graph = null;
let viewEl = null;

// 同名区分：按名字分组，同名的人 label 加 ①②③
function disambiguatedLabel(p, idx) {
  const same = people.filter((x) => x.name === p.name);
  if (same.length <= 1) return p.name;
  const order = ['①', '②', '③', '④', '⑤'];
  const pos = same.sort((a, b) => (a.id || '').localeCompare(b.id || '')).findIndex((x) => x.id === p.id);
  return p.name + (order[pos] || '');
}

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  destroyGraph();
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
    if (viewMode === 'graph') renderGraph(); else buildGrid();
  }));

  // 卡片 / 关系图切换
  const viewSeg = el('div', { class: 'seg' },
    el('button', { 'data-v': 'card', class: viewMode === 'card' ? 'active' : '', text: '卡片' }),
    el('button', { 'data-v': 'graph', class: viewMode === 'graph' ? 'active' : '', text: '关系图' }));
  viewSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    viewMode = b.dataset.v;
    viewSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (viewMode === 'graph') renderGraph();
    else { destroyGraph(); buildGrid(); }
  }));

  page.append(el('div', { class: 'view-filter' }, seg, viewSeg));

  const grid = el('div', { class: 'people-grid', id: 'peopleGrid' });
  const graphBox = el('div', { class: 'people-graph', id: 'peopleGraph', hidden: true },
    el('canvas', { id: 'relationCanvas' }),
    el('div', { class: 'graph-hint', text: '🖱 拖拽节点调整位置 · 滚轮缩放 · 双击节点看详情 · 同名自动加①②③' }));
  page.append(grid, graphBox);
  viewEl.append(page);
  if (viewMode === 'graph') renderGraph(); else buildGrid();
}

function destroyGraph() {
  if (graph) { graph.destroy(); graph = null; }
}

// 关系图：自研力导向
function renderGraph() {
  destroyGraph();
  const box = document.getElementById('peopleGraph');
  const grid = document.getElementById('peopleGrid');
  if (!box) return;
  box.hidden = false;
  grid.hidden = true;
  const canvas = document.getElementById('relationCanvas');
  if (!canvas) return;

  const nodes = [];
  const edges = [];
  // 中心"TA"虚拟节点
  nodes.push({ id: 'TA', label: 'TA', group: 'TA', fixed: true, x: 0, y: 0 });
  const shown = people.filter((p) => filterGroup === 'all' || p.group === filterGroup);
  for (const p of shown) {
    nodes.push({ id: p.id, label: disambiguatedLabel(p, 0), group: p.group || '其他' });
    // 中心节点连接所有人
    edges.push({ from: 'TA', to: p.id, label: p.relation || '' });
    // 人物间连接（relations）
    for (const r of (p.relations || [])) {
      const target = people.find((x) => x.id === r.toId);
      if (!target) continue;
      if (filterGroup === 'all' || [p.group, target.group].includes(filterGroup)) {
        // 去重：只画一次（避免 A→B 和 B→A 都画，除非方向不同）
        const already = edges.some((e) => (e.from === r.toId && e.to === p.id) || (e.from === p.id && e.to === r.toId));
        if (!already) edges.push({ from: p.id, to: r.toId, label: r.type });
      }
    }
  }

  graph = new RelationGraph(canvas, {
    onNodeClick: (id) => {
      if (id === 'TA') return;
      const p = people.find((x) => x.id === id);
      if (p) editPerson(p);
    },
    onNodeHover: (id) => { /* 预留 */ }
  });
  graph.setData(nodes, edges);
  // 初始自动收敛后再允许拖拽（让布局先稳定）
  setTimeout(() => graph.stop(), 2500);
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
      p.notes ? el('div', { class: 'person-notes', text: p.notes }) : null,
      (p.relations || []).length ? el('div', { class: 'person-rels' },
        ...p.relations.map((r) => {
          const t = people.find((x) => x.id === r.toId);
          return el('span', { class: 'rel-chip', text: '→ ' + (t ? disambiguatedLabel(t, 0) : '?') + '·' + r.type });
        })) : null));
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

  // —— 关联其他人（人物间连接） ——
  // relations: [{ toId, type, note }]，用 id 引用解决同名歧义
  const relations = (p ? (p.relations || []) : []).map((r) => ({ ...r }));
  const RELATION_SUGGESTIONS = ['爸爸', '妈妈', '哥哥', '姐姐', '弟弟', '妹妹', '老公', '老婆', '同事', '同学', '朋友', '表弟', '表姐', '其他'];
  const relationBox = el('div', { class: 'rel-edit-box' });
  const renderRelations = () => {
    relationBox.innerHTML = '';
    if (!relations.length) {
      relationBox.append(el('p', { style: 'font-size:13px;color:var(--muted)', text: '还没有关联其他人（可选）。同名区分靠这个，比如两个"王叔叔"可以分别关联到不同的人' }));
    }
    relations.forEach((r, i) => {
      const target = people.find((x) => x.id === r.toId);
      const row = el('div', { class: 'rel-edit-row' },
        el('span', { class: 'rel-target', text: target ? disambiguatedLabel(target, 0) : '（已删除的人）' }),
        el('input', {
          type: 'text', value: r.type, placeholder: '关系，如：妈妈',
          oninput: (e) => { relations[i].type = e.target.value.trim(); }
        }),
        el('button', { class: 'cf-del', text: '✕', onclick: () => { relations.splice(i, 1); renderRelations(); } }));
      row.querySelectorAll('input')[0].addEventListener('input', (e) => { relations[i].type = e.target.value.trim(); });
      relationBox.append(row);
    });
  };
  renderRelations();

  // 添加关联：选人 + 关系类型
  const otherPeople = people.filter((x) => !p || x.id !== p.id);
  const relTarget = select([['', '选择要关联的人…'], ...otherPeople.map((x) => [x.id, disambiguatedLabel(x, 0)])], '', {});
  const relType = input({ type: 'text', placeholder: '关系，如：同事 / 表姐', list: 'relSuggest' });
  const relSuggest = el('datalist', { id: 'relSuggest' }, ...RELATION_SUGGESTIONS.map((s) => el('option', { value: s })));
  const addRelBtn = el('button', {
    class: 'small-btn', text: '＋ 关联', onclick: () => {
      const toId = relTarget.value;
      const type = relType.value.trim();
      if (!toId) { toast('先选要关联的人', 'err'); return; }
      if (!type) { toast('填一下关系，如：同事', 'err'); return; }
      if (relations.some((r) => r.toId === toId && r.type === type)) { toast('这个关系已经加过了', 'err'); return; }
      relations.push({ toId, type });
      relTarget.value = ''; relType.value = '';
      renderRelations();
    }
  });
  const relAddRow = el('div', { class: 'rel-add-row' }, relTarget, relType, relSuggest, addRelBtn);

  const md = openModal({
    title: p ? '编辑 ' + p.name : '加一个人',
    content: el('div', null,
      field('称呼', name), field('关系', relation), field('分组', group),
      field('生日', birthday), lunarRow, field('相识', howMet), field('备注', notes),
      el('div', { class: 'field' }, el('label', { text: '关联其他人（区分同名）' }), relationBox, relAddRow)),
    buttons: [
      p ? { el: el('button', { class: 'ghost-btn danger', text: '删除', onclick: async () => {
        if (!confirm(`删除「${p.name}」？`)) return;
        await del('/api/people/' + p.id);
        people = people.filter((x) => x.id !== p.id);
        // 清掉别人对 TA 的引用（防悬空）
        for (const other of people) {
          if ((other.relations || []).some((r) => r.toId === p.id)) {
            await patch('/api/people/' + other.id, { relations: (other.relations || []).filter((r) => r.toId !== p.id) });
            other.relations = (other.relations || []).filter((r) => r.toId !== p.id);
          }
        }
        md.close(); build(); toast('已删除');
      } }) } : null,
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!name.value.trim()) { toast('称呼不能为空', 'err'); return; }
        const body = {
          name: name.value.trim(), relation: relation.value.trim(), group: group.value,
          birthday: birthday.value.trim(), lunar: lunarChk.checked, leap: lunarChk.checked && leapChk.checked,
          howMet: howMet.value.trim(), notes: notes.value.trim(),
          relations: relations.filter((r) => r.toId && r.type)
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
