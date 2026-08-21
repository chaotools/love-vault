// 大事记视图：竖向时间线，里程碑/约会/旅行/争吵与和解/承诺
import { el, get, post, patch, del, toast, openModal, openLightbox, field, input, select, textarea, fmtDate, toLocalInput, emptyState, mediaPreview, subjectLabel } from '../core.js';

const TYPES = ['里程碑', '约会', '旅行', '争吵与和解', '承诺', '其他'];
const TYPE_ICON = { 里程碑: '💘', 约会: '🌹', 旅行: '✈️', 争吵与和解: '🕊️', 承诺: '🤙', 其他: '📌' };

let events = [];
let memories = [];
let filterType = 'all';
let viewEl = null;

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  try {
    [events, memories] = await Promise.all([get('/api/events'), get('/api/memories')]);
  } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  build();
  if (params && params.focus) {
    const it = events.find((e) => e.id === params.focus);
    if (it) setTimeout(() => editEvent(it), 120);
  }
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page' });

  const undone = events.filter((e) => e.type === '承诺' && !e.done).length;
  page.append(el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '📖 大事记' }),
      el('div', { class: 'page-desc', text: undone ? `还有 ${undone} 个承诺没兑现哦` : '第一次约会、每一次和好、答应过的事…' })),
    el('button', { class: 'primary-btn', text: '＋ 记一件', onclick: () => editEvent(null) })));

  const seg = el('div', { class: 'seg' },
    el('button', { 'data-t': 'all', class: filterType === 'all' ? 'active' : '', text: '全部' }),
    ...TYPES.map((t) => el('button', { 'data-t': t, class: filterType === t ? 'active' : '', text: t })));
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filterType = b.dataset.t;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    buildList();
  }));
  page.append(el('div', { class: 'view-filter' }, seg));

  const list = el('div', { class: 'vtl', id: 'vtlList' });
  page.append(list);
  viewEl.append(page);
  buildList();
}

function buildList() {
  const list = document.getElementById('vtlList');
  if (!list) return;
  list.innerHTML = '';
  const shown = events.filter((e) => filterType === 'all' || e.type === filterType);
  if (!shown.length) {
    list.append(emptyState('📖', events.length ? '该类型还没有记录' : '从「在一起第一天」开始记起吧'));
    return;
  }
  for (const e of shown) {
    const linked = memories.filter((m) => (e.mediaIds || []).includes(m.id));
    const isPromise = e.type === '承诺';
    list.append(el('div', { class: 'vtl-item t-' + (e.type || '其他') },
      el('div', { class: 'vtl-card' },
        el('div', { class: 'vtl-head' },
          el('span', { class: 'vtl-date', text: fmtDate(e.date) }),
          el('span', { class: 'ev-badge', text: (TYPE_ICON[e.type] || '📌') + ' ' + (e.type || '其他') }),
          e.location ? el('span', { class: 'vtl-date', text: '📍 ' + e.location }) : null),
        el('div', { class: 'vtl-title' }, e.title,
          e.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null),
        e.description ? el('div', { class: 'vtl-desc', text: e.description }) : null,
        linked.length ? el('div', { class: 'vtl-media' },
          ...linked.map((m) => {
            const preview = mediaPreview(m, { title: m.note || '' });
            preview.addEventListener('click', () => openLightbox(linked, linked.indexOf(m)));
            return preview;
          })) : null,
        el('div', { class: 'vtl-actions' },
          isPromise ? promiseCheck(e) : null,
          el('button', { class: 'ghost-btn', style: 'padding:5px 14px;font-size:12px', text: '编辑', onclick: () => editEvent(e) }),
          el('button', {
            class: 'ghost-btn danger', style: 'padding:5px 14px;font-size:12px', text: '删除', onclick: async () => {
              if (!confirm(`删除「${e.title}」？`)) return;
              await del('/api/events/' + e.id);
              events = events.filter((x) => x.id !== e.id);
              build(); toast('已删除');
            }
          })))));
  }
}

function promiseCheck(e) {
  const check = el('label', { class: 'promise-check' + (e.done ? ' done' : '') },
    el('span', { class: 'box', text: e.done ? '✓' : '' }),
    el('span', { class: 'txt', text: e.done ? '已兑现' : '未兑现' }));
  check.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const done = !e.done;
    await patch('/api/events/' + e.id, { done, ...(done ? { doneAt: new Date().toISOString() } : {}) });
    e.done = done;
    build();
    toast(done ? '又一个承诺兑现了 🎉' : '已标记为未兑现');
  });
  return check;
}

function editEvent(e) {
  const date = input({ type: 'datetime-local', value: e ? toLocalInput(e.date) : toLocalInput(new Date().toISOString()) });
  const title = input({ type: 'text', value: e ? e.title : '', placeholder: '比如：第一次一起看海' });
  const type = select(TYPES.map((t) => [t, (TYPE_ICON[t] || '') + ' ' + t]), e ? e.type : (filterType !== 'all' ? filterType : '里程碑'));
  const location = input({ type: 'text', value: e ? e.location : '', placeholder: '地点（可空）' });
  const desc = textarea({ placeholder: `发生了什么、${subjectLabel()}说了什么、你的感受…（可空）` }, e ? e.description : '');

  // 关联照片选择器
  const selected = new Set(e ? (e.mediaIds || []) : []);
  const picker = el('div', { class: 'media-picker' });
  const renderPicker = () => {
    picker.innerHTML = '';
    if (!memories.length) {
      picker.append(el('p', { style: 'font-size:12px;color:var(--muted);grid-column:1/-1', text: '还没有照片，先去时间轴上传，再来关联' }));
      return;
    }
    for (const m of memories.slice(0, 60)) {
      const preview = mediaPreview(m, { className: selected.has(m.id) ? 'sel' : '', title: m.note || '' });
      preview.addEventListener('click', () => {
        if (selected.has(m.id)) selected.delete(m.id); else selected.add(m.id);
        preview.classList.toggle('sel');
      });
      picker.append(preview);
    }
  };
  renderPicker();

  const md = openModal({
    title: e ? '编辑大事记' : '记一件大事', wide: true,
    content: el('div', null,
      field('时间', date), field('标题', title), field('类型', type), field('地点', location),
      field('详情', desc), field('关联照片（点击选择/取消）', picker)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!title.value.trim()) { toast('标题不能为空', 'err'); return; }
        const body = {
          date: new Date(date.value).toISOString(), title: title.value.trim(),
          type: type.value, location: location.value.trim(), description: desc.value.trim(),
          mediaIds: [...selected]
        };
        if (e) {
          const updated = await patch('/api/events/' + e.id, body);
          const i = events.findIndex((x) => x.id === e.id);
          events[i] = updated;
        } else {
          events.push(await post('/api/events', body));
        }
        events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        md.close(); build(); toast('已保存');
      } }) }
    ]
  });
  setTimeout(() => title.focus(), 60);
}

window.addEventListener('vault:focus-events', (e) => {
  const it = events.find((x) => x.id === e.detail);
  if (it) editEvent(it);
});
