// 时间轴视图：照片 + 视频 + 文字大事记 按月混排
import { el, get, post, patch, del, toast, openModal, openLightbox, field, input, textarea, select, fmtDate, fmtDay, fmtDuration, toLocalInput, emptyState } from '../core.js';

let memories = [];
let events = [];
let filter = { type: 'all', year: 'all' };
let viewEl = null;

export async function render(container) {
  viewEl = container;
  container.innerHTML = '';
  try {
    [memories, events] = await Promise.all([get('/api/memories'), get('/api/events')]);
  } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  build();
}

function build() {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'timeline-page' });

  // 快速输入框：回车直接记一条大事记
  const quick = input({ type: 'text', placeholder: '今天发生了什么？一句话记下来，回车保存…' });
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    try {
      await post('/api/events', { date: new Date().toISOString(), title: quick.value.trim(), type: '其他' });
      toast('记下了 💕');
      quick.value = '';
      events = await get('/api/events');
      build();
    } catch (err) { toast(err.message, 'err'); }
  });
  page.append(el('div', { class: 'quick-note-bar' }, el('span', { text: '✎' }), quick));

  // 筛选
  const seg = el('div', { class: 'seg' },
    ...[['all', '全部'], ['photo', '照片'], ['video', '视频'], ['event', '大事记']].map(([v, t]) =>
      el('button', { 'data-type': v, class: filter.type === v ? 'active' : '', text: t, onclick: (e) => {
        filter.type = v;
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.type === v));
        buildList();
      } })));
  const years = [...new Set([
    ...memories.map((m) => String(new Date(m.takenAt).getFullYear())),
    ...events.map((e2) => String(new Date(e2.date).getFullYear()))
  ])].filter((y) => y !== 'NaN').sort((a, b) => b - a);
  const yearSel = el('select', { onchange: () => { filter.year = yearSel.value; buildList(); } },
    el('option', { value: 'all', text: '所有年份' }),
    ...years.map((y) => el('option', { value: y, text: y + ' 年' })));
  yearSel.value = filter.year;
  page.append(el('div', { class: 'view-filter' }, seg, yearSel));

  const listEl = el('div', { id: 'timelineList' });
  page.append(listEl, el('button', { class: 'fab', text: '＋', title: '上传照片/视频', onclick: openUpload }));
  viewEl.append(page);
  buildList();
}

function buildList() {
  const listEl = document.getElementById('timelineList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const items = [];
  for (const m of memories) items.push({ kind: 'media', date: m.takenAt, m });
  for (const e of events) items.push({ kind: 'event', date: e.date, e });
  let shown = items.filter((it) => {
    if (filter.type !== 'all') {
      if (filter.type === 'event' && it.kind !== 'event') return false;
      if (filter.type !== 'event' && (it.kind !== 'media' || it.m.type !== filter.type)) return false;
    }
    if (filter.year !== 'all' && String(new Date(it.date).getFullYear()) !== filter.year) return false;
    return true;
  });
  shown.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!shown.length) {
    listEl.append(emptyState('🕊️',
      memories.length || events.length
        ? '这个筛选下没有内容，换个条件看看？'
        : '还没有记忆。<b>右下角 ＋</b> 上传照片视频，或用顶部输入框<b>随手记一句</b>'));
    return;
  }

  // 按月分组
  const groups = new Map();
  for (const it of shown) {
    const d = new Date(it.date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!groups.has(key)) groups.set(key, { y: d.getFullYear(), mo: d.getMonth() + 1, items: [] });
    groups.get(key).items.push(it);
  }
  let cardIdx = 0;
  for (const key of [...groups.keys()].sort((a, b) => b.localeCompare(a))) {
    const g = groups.get(key);
    const nP = g.items.filter((i) => i.kind === 'media' && i.m.type === 'photo').length;
    const nV = g.items.filter((i) => i.kind === 'media' && i.m.type === 'video').length;
    const nE = g.items.filter((i) => i.kind === 'event').length;
    const txt = [nP && `${nP} 张照片`, nV && `${nV} 段视频`, nE && `${nE} 条记录`].filter(Boolean).join(' · ');
    const masonry = el('div', { class: 'masonry' });
    for (const it of g.items) {
      const node = it.kind === 'media' ? mediaCard(it.m) : eventCard(it.e);
      node.style.animationDelay = `${Math.min(cardIdx++, 12) * 0.05}s`;
      masonry.append(node);
    }
    listEl.append(el('div', { class: 'month-group' },
      el('div', { class: 'month-head' },
        el('div', { class: 'month-title', text: `${g.y}年${g.mo}月` }),
        el('div', { class: 'month-count', text: txt })),
      masonry));
  }
}

function mediaCard(m) {
  const d = new Date(m.takenAt);
  const cap = el('figcaption', { text: `${d.getMonth() + 1}月${d.getDate()}日` + (m.note ? ` · ${m.note}` : '') + (m.location ? ` · 📍${m.location}` : '') });
  const children = [el('img', { src: m.thumb, loading: 'lazy', alt: m.note || '' })];
  children[0].onerror = () => { if (children[0].src !== m.url) children[0].src = m.url; };
  if (m.type === 'video') {
    children.push(el('div', { class: 'video-badge', text: '▶ ' + fmtDuration(m.duration) }));
    children.push(el('div', { class: 'play-icon', text: '▶' }));
  }
  children.push(cap);
  const card = el('figure', { class: 'card' }, ...children);
  card.addEventListener('click', () => openMediaLightbox(m));
  return card;
}

function openMediaLightbox(m) {
  const items = memories; // 顺序与列表一致（倒序）
  openLightbox(items, items.indexOf(m), { onEdit: editMemory, onDelete: deleteMemory });
}

function editMemory(m) {
  const dInput = input({ type: 'datetime-local', value: toLocalInput(m.takenAt) });
  const nInput = input({ type: 'text', value: m.note || '', placeholder: '写下这一刻…' });
  const tInput = input({ type: 'text', value: (m.tags || []).join(', '), placeholder: '旅行, 生日, 日常' });
  const lInput = input({ type: 'text', value: m.location || '', placeholder: '比如：厦门 · 鼓浪屿' });
  const md = openModal({
    title: '编辑记忆', content: el('div', null,
      field('时间', dInput), field('备注', nInput), field('标签（逗号分隔）', tInput), field('地点', lInput)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        try {
          const updated = await patch('/api/memories/' + m.id, {
            takenAt: dInput.value ? new Date(dInput.value).toISOString() : undefined,
            note: nInput.value, tags: tInput.value.split(',').map((s) => s.trim()).filter(Boolean),
            location: lInput.value
          });
          const i = memories.findIndex((x) => x.id === m.id);
          if (i !== -1) memories[i] = { ...memories[i], ...updated };
          md.close(); buildList(); toast('已保存');
          const lb = document.getElementById('lightbox');
          if (!lb.hidden && lb._render) lb._render();
        } catch (e) { toast(e.message, 'err'); }
      } }) }
    ]
  });
}

async function deleteMemory(m) {
  if (!confirm('确定删除这段记忆吗？文件会被永久删除。')) return;
  try {
    await del('/api/memories/' + m.id);
    memories = memories.filter((x) => x.id !== m.id);
    closeLightboxSafe();
    buildList(); toast('已删除');
  } catch (e) { toast(e.message, 'err'); }
}
function closeLightboxSafe() {
  const lb = document.getElementById('lightbox');
  if (lb._close) lb._close(); else lb.hidden = true;
}

/* 大事记卡片：点击看全文和关联照片 */
function eventCard(e) {
  const d = new Date(e.date);
  const card = el('div', { class: 'event-card ev-' + (e.type || '其他') },
    el('div', { class: 'ev-top' },
      el('span', { class: 'ev-badge', text: e.type || '其他' }),
      el('span', { class: 'ev-day', text: `${d.getMonth() + 1}月${d.getDate()}日` }),
      e.type === '承诺' ? el('span', { class: e.done ? 'ev-done-flag' : 'ev-pending-flag', text: e.done ? '✓ 已兑现' : '未兑现' }) : null
    ),
    el('div', { class: 'ev-title', text: e.title }),
    e.description ? el('div', { class: 'ev-desc', text: e.description }) : null,
    e.location ? el('div', { class: 'ev-loc', text: '📍 ' + e.location }) : null
  );
  card.addEventListener('click', () => showEvent(e));
  return card;
}

function showEvent(e) {
  const linked = memories.filter((m) => (e.mediaIds || []).includes(m.id));
  const mediaStrip = linked.length ? el('div', { class: 'vtl-media' },
    ...linked.map((m) => {
      const img = el('img', { src: m.thumb, onclick: (ev) => { ev.stopPropagation(); openLightbox(linked, linked.indexOf(m)); } });
      img.onerror = () => { if (img.src !== m.url) img.src = m.url; };
      return img;
    })) : null;
  const md = openModal({
    title: e.title,
    content: el('div', null,
      el('div', { class: 'ev-top', style: 'margin-bottom:10px' },
        el('span', { class: 'ev-badge', text: e.type || '其他' }),
        el('span', { class: 'ev-day', text: fmtDate(e.date) }),
        e.location ? el('span', { class: 'ev-day', text: '📍 ' + e.location }) : null),
      e.description ? el('p', { style: 'font-size:14px;line-height:1.9;white-space:pre-wrap', text: e.description }) : null,
      mediaStrip
    ),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '关闭', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '去大事记编辑 →', onclick: () => { md.close(); location.hash = '#/events?focus=' + encodeURIComponent(e.id); } }) }
    ]
  });
}

/* 上传弹窗 */
function openUpload() {
  const dz = el('div', { class: 'dropzone' },
    el('div', { class: 'dz-icon', text: '📷' }),
    el('p', { text: '拖拽照片 / 视频到这里' }),
    el('p', { class: 'sub', text: '或点击选择文件 · 支持多选 · HEIC 自动转换 · 按拍摄时间排序' }));
  const fi = input({ type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true });
  dz.append(fi);
  const progress = el('div', { class: 'progress', hidden: true },
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill', id: 'barFill' })),
    el('span', { id: 'progressText', text: '0%' }));

  const md = openModal({
    title: '上传记忆',
    content: el('div', null, dz, progress),
    buttons: [{ el: el('button', { class: 'ghost-btn', text: '关闭', onclick: () => md.close() }) }]
  });

  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => { if (fi.files.length) uploadFiles(fi.files); });
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

  function uploadFiles(files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/memories/upload');
    progress.hidden = false;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        document.getElementById('barFill').style.width = pct + '%';
        document.getElementById('progressText').textContent = pct + '%';
      }
    };
    xhr.onload = async () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        for (const item of data.items) memories.push(item);
        memories.sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''));
        build(); renderFAB();
        document.getElementById('progressText').textContent = '完成 ✓';
        toast(`上传了 ${data.items.length} 段记忆 💕`);
        setTimeout(() => md.close(), 700);
      } else {
        document.getElementById('progressText').textContent = '失败';
        toast('上传失败：' + (JSON.parse(xhr.responseText).error || '未知错误'), 'err');
      }
    };
    xhr.onerror = () => { document.getElementById('progressText').textContent = '失败'; toast('网络错误', 'err'); };
    xhr.send(fd);
  }
  function renderFAB() { /* FAB 在 build() 里已重建 */ }
}

// 全局搜索跳转：聚焦某张照片（数据可能还在加载，稍作等待重试）
window.addEventListener('vault:focus-media', (e) => {
  let tries = 0;
  const tryFocus = () => {
    const m = memories.find((x) => x.id === e.detail);
    if (m) openMediaLightbox(m);
    else if (++tries < 20) setTimeout(tryFocus, 150);
  };
  tryFocus();
});
