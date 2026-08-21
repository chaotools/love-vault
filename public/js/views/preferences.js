// 偏好视图：喜欢 / 不喜欢 双栏，按 吃/喝/穿/用/玩 分组
import { el, get, post, patch, del, toast, openModal, field, input, select, emptyState, subjectLabel } from '../core.js';

const CATEGORIES = ['吃', '喝', '穿', '用', '玩', '其他'];
let prefs = [];
let filterCat = 'all';
let viewEl = null;

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  try { prefs = await get('/api/preferences'); } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  build();
  if (params && params.focus) {
    const it = prefs.find((p) => p.id === params.focus);
    if (it) setTimeout(() => editItem(it), 120);
  }
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page' });

  page.append(el('div', { class: 'page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '💗 偏好' }),
      el('div', { class: 'page-desc', text: '爱吃什么、讨厌什么、口味尺寸颜色……点餐送礼不踩雷' })),
    el('button', { class: 'primary-btn', text: '＋ 记一条', onclick: () => editItem(null) })));

  const seg = el('div', { class: 'seg' },
    el('button', { 'data-c': 'all', class: filterCat === 'all' ? 'active' : '', text: '全部' }),
    ...CATEGORIES.map((c) => el('button', { 'data-c': c, class: filterCat === c ? 'active' : '', text: c })));
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filterCat = b.dataset.c;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    buildColumns();
  }));
  page.append(el('div', { class: 'view-filter' }, seg));

  const cols = el('div', { class: 'pref-columns', id: 'prefCols' });
  page.append(cols);
  viewEl.append(page);
  buildColumns();
}

function buildColumns() {
  const cols = document.getElementById('prefCols');
  if (!cols) return;
  cols.innerHTML = '';
  const shown = prefs.filter((p) => filterCat === 'all' || p.category === filterCat);

  const subject = subjectLabel();
  for (const [polarity, cls, icon, title] of [['喜欢', 'like', '💗', `${subject} 喜欢`], ['不喜欢', 'dislike', '🙅', `${subject} 不喜欢`]]) {
    const items = shown.filter((p) => p.polarity === polarity);
    const col = el('div', { class: 'pref-col ' + cls },
      el('h3', null, `${icon} ${title}`, el('span', { style: 'font-size:12px;color:var(--muted)', text: items.length + ' 条' })));
    if (!items.length) {
      col.append(el('p', { style: 'font-size:13px;color:var(--muted);padding:10px 0', text: '还空着，点右上「＋ 记一条」补上吧' }));
    }
    for (const cat of CATEGORIES) {
      const group = items.filter((p) => p.category === cat);
      if (!group.length) continue;
      col.append(el('div', { class: 'pref-cat', text: '· ' + cat + ' ·' }));
      for (const p of group) {
        col.append(el('div', { class: 'pref-item', onclick: () => editItem(p) },
          el('div', null,
            el('div', { class: 'pi-title' }, p.title,
              p.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null),
            p.detail ? el('div', { class: 'pi-detail', text: p.detail }) : null),
          el('button', {
            class: 'pi-del', text: '✕', onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`删除「${p.title}」？`)) return;
              await del('/api/preferences/' + p.id);
              prefs = prefs.filter((x) => x.id !== p.id);
              buildColumns(); toast('已删除');
            }
          })));
      }
    }
    cols.append(col);
  }
}

function editItem(p) {
  const pol = select([['喜欢', '💗 喜欢'], ['不喜欢', '🙅 不喜欢']], p ? p.polarity : '喜欢');
  const cat = select(CATEGORIES.map((c) => [c, c]), p ? p.category : (filterCat !== 'all' ? filterCat : '吃'));
  const title = input({ type: 'text', value: p ? p.title : '', placeholder: '比如：杨枝甘露 / 深紫色 / 香水百合' });
  const detail = input({ type: 'text', value: p ? p.detail : '', placeholder: '补充：三分糖去冰 / 只在夏天 / 讨厌的原因…（可空）' });
  const md = openModal({
    title: p ? '编辑偏好' : '记一条偏好',
    content: el('div', null, field('态度', pol), field('分类', cat), field('内容', title), field('细节', detail)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        if (!title.value.trim()) { toast('内容不能为空', 'err'); return; }
        const body = { polarity: pol.value, category: cat.value, title: title.value.trim(), detail: detail.value.trim() };
        if (p) {
          const updated = await patch('/api/preferences/' + p.id, body);
          const i = prefs.findIndex((x) => x.id === p.id);
          prefs[i] = updated;
        } else {
          prefs.push(await post('/api/preferences', body));
        }
        md.close(); buildColumns(); toast('已保存');
      } }) }
    ]
  });
  setTimeout(() => title.focus(), 60);
}

window.addEventListener('vault:focus-preferences', (e) => {
  const it = prefs.find((p) => p.id === e.detail);
  if (it) editItem(it);
});
