// 人名关系库：TA身边的人，谁是谁、什么关系、生日、怎么认识的
// 支持卡片 / 关系图两种视图；关系图是自研力导向（零依赖）
import { el, get, post, patch, del, toast, openModal, field, input, select, textarea, emptyState, subjectLabel } from '../core.js';
import { RelationGraph } from '../relation-graph.js';
import { buildRelationModel, personRelationEdges, relationDetail, GROUPS as RELATION_GROUPS } from '../relation-model.mjs';

const GROUPS = RELATION_GROUPS;
let people = [];
let filterGroup = 'all';
let viewMode = 'card'; // 'card' | 'graph' | 'list'
let graph = null;
let graphStopTimer = null;
let viewEl = null;
let relationModel = null;
let selectedRelationId = null;
let selectedPersonId = null;

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
  relationModel = null;
  selectedRelationId = null;
  selectedPersonId = null;
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
      el('div', { class: 'page-desc', text: `${subjectLabel()}的家人朋友同事——聚会前翻一遍，"那个谁"再也不怕` })),
    el('button', { class: 'primary-btn', text: '＋ 加个人', onclick: () => editPerson(null) })));

  const seg = el('div', { class: 'seg' },
    el('button', { 'data-g': 'all', class: filterGroup === 'all' ? 'active' : '', text: '全部' }),
    ...GROUPS.map((g) => el('button', { 'data-g': g, class: filterGroup === g ? 'active' : '', text: g })));
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filterGroup = b.dataset.g;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (viewMode === 'graph') renderGraph();
    else if (viewMode === 'list') buildRelationsList();
    else buildGrid();
  }));

  // 卡片 / 关系图 / 关系清单切换
  const viewSeg = el('div', { class: 'seg' },
    el('button', { 'data-v': 'card', class: viewMode === 'card' ? 'active' : '', text: '卡片' }),
    el('button', { 'data-v': 'graph', class: viewMode === 'graph' ? 'active' : '', text: '关系图' }),
    el('button', { 'data-v': 'list', class: viewMode === 'list' ? 'active' : '', text: '关系清单' }));
  viewSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    viewMode = b.dataset.v;
    viewSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (viewMode === 'graph') renderGraph();
    else if (viewMode === 'list') { destroyGraph(); buildRelationsList(); }
    else { destroyGraph(); buildGrid(); }
  }));

  page.append(el('div', { class: 'view-filter people-filters' },
    el('div', { class: 'people-filter-group' },
      el('span', { class: 'filter-label', text: '人物分组' }),
      seg),
    el('div', { class: 'people-filter-group' },
      el('span', { class: 'filter-label', text: '查看方式' }),
      viewSeg)));

  const grid = el('div', { class: 'people-grid', id: 'peopleGrid' });
  const graphBox = el('div', { class: 'people-graph', id: 'peopleGraph', hidden: true },
    el('canvas', { id: 'relationCanvas' }),
    el('button', { class: 'small-btn graph-reset', type: 'button', text: '重置布局', onclick: () => { if (graph) graph.resetLayout(); } }),
    el('div', { class: 'graph-hint', text: `拖拽人物 · 滚轮缩放 · 单击选择 · 双击或详情按钮编辑 · ${subjectLabel()} 固定在中心` }));
  const graphLegend = el('div', { class: 'graph-legend', id: 'graphLegend', hidden: true },
    el('span', { class: 'legend-outgoing', text: '● 发出的关系' }),
    el('span', { class: 'legend-incoming', text: '● 指向我的关系' }),
    el('span', { text: '↔ 双向关系（如夫妻/朋友）' }),
    el('span', { text: `${subjectLabel()} 关系：${subjectLabel()} → 人物` }));
  const relationDetails = el('div', { class: 'relation-details', id: 'relationDetails', hidden: true });
  const relationList = el('div', { class: 'relation-list', id: 'relationList', hidden: true });
  page.append(grid, graphBox, graphLegend, relationDetails, relationList);
  viewEl.append(page);
  if (viewMode === 'graph') renderGraph();
  else if (viewMode === 'list') buildRelationsList();
  else buildGrid();
}

function destroyGraph() {
  if (graphStopTimer) {
    clearTimeout(graphStopTimer);
    graphStopTimer = null;
  }
  if (graph) { graph.destroy(); graph = null; }
}

// 路由离开人名页时由 app.js 调用，释放关系图的动画和窗口事件监听。
export function destroy() {
  destroyGraph();
}

// 关系图：有向边、双向弧线和选中详情共用同一份投影数据。
function renderGraph() {
  destroyGraph();
  const box = document.getElementById('peopleGraph');
  const grid = document.getElementById('peopleGrid');
  const legend = document.getElementById('graphLegend');
  const list = document.getElementById('relationList');
  const details = document.getElementById('relationDetails');
  if (!box) return;
  box.hidden = false;
  grid.hidden = true;
  legend.hidden = false;
  list.hidden = false;
  relationModel = buildRelationModel(people, filterGroup, subjectLabel());
  if (selectedRelationId && !relationModel.edges.some((edge) => edge.id === selectedRelationId)) selectedRelationId = null;
  if (selectedPersonId && !relationModel.nodes.some((node) => node.id === selectedPersonId)) selectedPersonId = null;
  if (!selectedRelationId && !selectedPersonId && details) details.hidden = true;
  renderRelationList(relationModel, list, true);
  const canvas = document.getElementById('relationCanvas');
  if (!canvas) return;

  graph = new RelationGraph(canvas, {
    onNodeClick: (id) => {
      if (id === 'TA') return;
      const person = people.find((item) => item.id === id);
      if (person) editPerson(person);
    },
    onNodeSelect: (node) => {
      selectedRelationId = null;
      selectedPersonId = node && node.id;
      showNodeDetails(node && node.id);
    },
    onEdgeSelect: (edge) => {
      selectedRelationId = edge && edge.id;
      selectedPersonId = null;
      showEdgeDetails(edge);
      updateRelationListSelection();
    },
    onEdgeHover: (edge) => {
      if (!selectedRelationId) {
        if (edge) showEdgeDetails(edge, true);
        else if (selectedPersonId) showNodeDetails(selectedPersonId);
        else showEdgeDetails(null, true);
      }
    }
  });
  graph.setData(relationModel.nodes, relationModel.edges);
  if (selectedRelationId && relationModel.edges.some((edge) => edge.id === selectedRelationId)) {
    graph.selectEdge(selectedRelationId, false);
    showEdgeDetails(relationModel.edges.find((edge) => edge.id === selectedRelationId));
  }
  const currentGraph = graph;
  graphStopTimer = setTimeout(() => {
    if (graph === currentGraph) currentGraph.stop();
  }, 2500);
}

function showEdgeDetails(edge, transient = false) {
  const details = document.getElementById('relationDetails');
  if (!details) return;
  if (!edge) {
    if (!selectedRelationId && !selectedPersonId) details.hidden = true;
    return;
  }
  details.hidden = false;
  details.innerHTML = '';
  const editId = edge.kind === 'ta' ? edge.to : edge.from;
  const editPersonButton = editId && editId !== 'TA'
    ? el('button', { class: 'small-btn', text: '编辑人物', onclick: () => {
      const person = people.find((item) => item.id === editId);
      if (person) editPerson(person);
    } })
    : null;
  const note = typeof edge.note === 'string' ? edge.note.trim() : '';
  const noteNode = note && !/^(null|undefined)$/i.test(note)
    ? el('div', { class: 'relation-details-note', text: '备注：' + note })
    : null;
  details.append(
    el('div', { class: 'relation-details-head' },
      el('div', { class: 'relation-details-title', text: '关系详情' }),
      editPersonButton),
    el('div', { class: 'relation-details-main', text: relationDetail(edge) })
  );
  if (noteNode) details.append(noteNode);
}

function relationRow(edge, onSelect) {
  const row = el('button', { type: 'button', class: 'relation-row' });
  const direction = edge.bidirectional || edge.directed === false ? '↔' : '→';
  const source = edge.sourceLabel || '未命名';
  const target = edge.targetLabel || '未命名';
  const type = edge.label || '未填写关系';
  row.setAttribute('aria-label', `${source} ${direction} ${target}，关系：${type}`);
  row.append(
    el('span', { class: 'relation-row-source', text: source }),
    el('span', { class: 'relation-row-arrow', text: direction }),
    el('span', { class: 'relation-row-target', text: target }),
    el('span', { class: 'relation-row-type', text: '关系：' + type })
  );
  row.addEventListener('click', onSelect);
  return row;
}

function updateRelationListSelection() {
  document.querySelectorAll('#relationList .relation-row').forEach((row) => {
    row.classList.toggle('selected', row.dataset.relationId === selectedRelationId);
  });
}

function showNodeDetails(id) {
  const details = document.getElementById('relationDetails');
  if (!details || !relationModel || !id) return;
  const node = relationModel.nodes.find((item) => item.id === id);
  if (!node) return;
  const mutual = relationModel.edges.filter((edge) => edge.bidirectional && (edge.from === id || edge.to === id));
  const outgoing = relationModel.edges.filter((edge) => !edge.bidirectional && edge.from === id);
  const incoming = relationModel.edges.filter((edge) => !edge.bidirectional && edge.to === id);
  const section = (title, edges) => {
    const box = el('div', { class: 'relation-detail-group' }, el('div', { class: 'relation-detail-group-title', text: title }));
    if (!edges.length) box.append(el('div', { class: 'relation-detail-empty', text: '暂无' }));
    for (const edge of edges) {
      const row = relationRow(edge, () => focusRelation(edge.id));
      box.append(row);
    }
    return box;
  };
  details.hidden = false;
  details.innerHTML = '';
  const person = id === 'TA' ? null : people.find((item) => item.id === id);
  const editButton = person
    ? el('button', { class: 'small-btn', text: '编辑人物', onclick: () => editPerson(person) })
    : null;
  const sections = [];
  if (mutual.length) sections.push(section('双向关系', mutual));
  sections.push(section('我指向的人', outgoing), section('指向我的人', incoming));
  details.append(
    el('div', { class: 'relation-details-head' },
      el('div', { class: 'relation-details-title', text: `“${node.label}”的关系` }),
      editButton),
    ...sections
  );
}

function showRelationListEmpty(list) {
  list.append(emptyState('🔗', '还没有可显示的关系'));
}

function renderRelationList(model, list, compact = false) {
  list.innerHTML = '';
  list.hidden = false;
  list.append(el('div', { class: 'relation-list-title', text: compact ? '关系清单（点击查看详情）' : '全部关系' }));
  if (model.filterHint) list.append(el('div', { class: 'relation-list-hint', text: model.filterHint }));
  if (!model.edges.length) return showRelationListEmpty(list);
  const rows = el('div', { class: 'relation-list-rows' });
  for (const edge of model.edges) {
    const row = relationRow(edge, () => focusRelation(edge.id, viewMode === 'list'));
    row.dataset.relationId = edge.id;
    rows.append(row);
  }
  list.append(rows);
  updateRelationListSelection();
}

function focusRelation(id, switchToGraph = false) {
  selectedRelationId = id;
  selectedPersonId = null;
  if (switchToGraph && viewMode === 'list') {
    viewMode = 'graph';
    build();
    setTimeout(() => { if (graph) graph.selectEdge(id); }, 0);
    return;
  }
  if (graph) graph.selectEdge(id);
  else {
    const edge = relationModel && relationModel.edges.find((item) => item.id === id);
    showEdgeDetails(edge);
  }
  updateRelationListSelection();
}

function buildRelationsList() {
  const grid = document.getElementById('peopleGrid');
  const box = document.getElementById('peopleGraph');
  const legend = document.getElementById('graphLegend');
  const list = document.getElementById('relationList');
  const details = document.getElementById('relationDetails');
  if (!grid || !box || !list) return;
  grid.hidden = true;
  box.hidden = true;
  legend.hidden = true;
  details.hidden = true;
  relationModel = buildRelationModel(people, filterGroup, subjectLabel());
  renderRelationList(relationModel, list, false);
}

function buildGrid() {
  const grid = document.getElementById('peopleGrid');
  const box = document.getElementById('peopleGraph');
  const legend = document.getElementById('graphLegend');
  const details = document.getElementById('relationDetails');
  const list = document.getElementById('relationList');
  if (!grid) return;
  grid.hidden = false;
  if (box) box.hidden = true;
  if (legend) legend.hidden = true;
  if (details) details.hidden = true;
  if (list) list.hidden = true;
  relationModel = null;
  selectedRelationId = null;
  selectedPersonId = null;
  grid.innerHTML = '';
  const cardRelationModel = buildRelationModel(people, 'all', subjectLabel());
  const shown = people.filter((p) => filterGroup === 'all' || p.group === filterGroup)
    .slice()
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));

  if (!shown.length) {
    grid.append(emptyState('👥', people.length
      ? '该分组还没有人'
      : el('span', { text: `从 ${subjectLabel()} 常提起的人开始记：名字 + 关系就够了` })));
    return;
  }
  for (const p of shown) {
    const cardRelations = personRelationEdges(cardRelationModel, p.id);
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
      cardRelations.length ? el('div', { class: 'person-rels' },
        ...cardRelations.map((edge) => {
          const counterpart = edge.from === p.id ? edge.targetLabel : edge.sourceLabel;
          const direction = edge.bidirectional === true ? '↔ ' : '→ ';
          return el('span', { class: 'rel-chip', text: direction + (counterpart || '?') + '·' + edge.label });
        })) : null));
  }
}

function editPerson(p) {
  const name = input({ type: 'text', value: p ? p.name : '', placeholder: '怎么称呼' });
  const relation = input({ type: 'text', value: p ? p.relation : '', maxLength: '50', placeholder: `${subjectLabel()} 对当前人物的关系，如：爸爸 / 大学室友` });
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
  const howMet = input({ type: 'text', value: p ? p.howMet : '', placeholder: `怎么认识/交集，如：${subjectLabel()}的高中同桌` });
  const notes = textarea({ placeholder: `${subjectLabel()}提过的八卦、喜好、要注意的点…（可空）` }, p ? p.notes : '');

  // —— 关联其他人（人物间连接） ——
  // relations: [{ toId, type, note, bidirectional? }]，用 id 引用解决同名歧义
  const relations = (p ? (p.relations || []) : []).map((r) => ({ ...r }));
  const incomingMutual = p
    ? personRelationEdges(buildRelationModel(people, 'all', subjectLabel()), p.id)
      .filter((edge) => edge.bidirectional === true && edge.to === p.id)
    : [];
  const hasReverseBidirectional = (relation) => p && relation.bidirectional === true
    && (people.find((person) => person.id === relation.toId)?.relations || []).some((other) =>
      other.bidirectional === true && other.toId === p.id && other.type === relation.type);
  const RELATION_SUGGESTIONS = ['爸爸', '妈妈', '哥哥', '姐姐', '弟弟', '妹妹', '老公', '老婆', '夫妻', '情侣', '同事', '同学', '朋友', '表弟', '表姐', '其他'];
  const relationBox = el('div', { class: 'rel-edit-box' });
  const renderRelations = () => {
    relationBox.innerHTML = '';
    if (!relations.length && !incomingMutual.length) {
      relationBox.append(el('p', { style: 'font-size:13px;color:var(--muted)', text: '还没有关系。默认记录为“当前人物 → 目标人物”；夫妻、朋友等可勾选“双向”，同名人物按编号区分' }));
    }
    relations.forEach((r, i) => {
      const target = people.find((x) => x.id === r.toId);
      const typeInput = input({
        type: 'text', value: r.type, placeholder: '关系，如：妈妈',
        oninput: (e) => { relations[i].type = e.target.value.trim(); }
      });
      const bidirectionalChk = el('input', { type: 'checkbox' });
      bidirectionalChk.checked = r.bidirectional === true;
      bidirectionalChk.addEventListener('change', () => {
        if (bidirectionalChk.checked) relations[i].bidirectional = true;
        else delete relations[i].bidirectional;
      });
      const bidirectionalLabel = el('label', { class: 'rel-bidirectional' }, bidirectionalChk, el('span', { text: '双向' }));
      const row = el('div', { class: 'rel-edit-row' },
        el('span', { class: 'rel-target', text: target ? disambiguatedLabel(target, 0) : '（已删除的人）' }),
        typeInput,
        bidirectionalLabel,
        el('button', { class: 'cf-del', text: '✕', onclick: () => { relations.splice(i, 1); renderRelations(); } }));
      relationBox.append(row);
    });
    for (const edge of incomingMutual) {
      relationBox.append(el('div', { class: 'rel-incoming', text: `↔ ${edge.sourceLabel} · ${edge.label}（由对方维护）` }));
    }
  };
  renderRelations();

  // 添加关联：选人 + 关系类型
  const otherPeople = people.filter((x) => !p || x.id !== p.id);
  const relTarget = select([['', '选择要关联的人…'], ...otherPeople.map((x) => [x.id, disambiguatedLabel(x, 0)])], '', {});
  const relType = input({ type: 'text', placeholder: '关系，如：同事 / 表姐', list: 'relSuggest' });
  const relBidirectionalChk = el('input', { type: 'checkbox' });
  const relBidirectionalLabel = el('label', { class: 'rel-bidirectional' }, relBidirectionalChk, el('span', { text: '双向' }));
  const relSuggest = el('datalist', { id: 'relSuggest' }, ...RELATION_SUGGESTIONS.map((s) => el('option', { value: s })));
  const addRelBtn = el('button', {
    class: 'small-btn', text: '＋ 关联', onclick: () => {
      const toId = relTarget.value;
      const type = relType.value.trim();
      if (!toId) { toast('先选要关联的人', 'err'); return; }
      if (!type) { toast('填一下关系，如：同事', 'err'); return; }
      if (relations.some((r) => r.toId === toId && r.type === type)) { toast('这个关系已经加过了', 'err'); return; }
      const next = { toId, type, ...(relBidirectionalChk.checked ? { bidirectional: true } : {}) };
      if (hasReverseBidirectional(next)) { toast('该双向关系已由对方记录', 'err'); return; }
      relations.push(next);
      relTarget.value = ''; relType.value = ''; relBidirectionalChk.checked = false;
      renderRelations();
    }
  });
  const relAddRow = el('div', { class: 'rel-add-row' }, relTarget, relType, relBidirectionalLabel, relSuggest, addRelBtn);

  const md = openModal({
    title: p ? '编辑 ' + p.name : '加一个人',
    content: el('div', null,
      field(`${subjectLabel()} 对当前人物的关系`, relation), field('分组', group),
      field('生日', birthday), lunarRow, field('相识', howMet), field('备注', notes),
      el('div', { class: 'field' }, el('label', { text: '当前人物与目标人物的关系（默认单向，可选双向）' }), relationBox, relAddRow)),
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
          howMet: howMet.value.trim(), notes: notes.value.trim(),
          relations: relations.filter((r) => r.toId && r.type)
        };
        if (body.relations.some(hasReverseBidirectional)) {
          toast('该双向关系已由对方记录，请编辑另一方', 'err');
          return;
        }
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
