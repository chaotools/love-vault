// 时间轴视图：照片 + 视频 + 文字大事记 按月混排
import { el, get, post, patch, del, toast, openModal, field, input, textarea, select, fmtDate, fmtDay, fmtDuration, toLocalInput, emptyState, mediaPreview } from '../core.js';

let memories = [];
let events = [];
let albums = [];
let filter = { type: 'all', year: 'all', album: 'all' };
let viewEl = null;

export async function render(container, params) {
  viewEl = container;
  container.innerHTML = '';
  try {
    [memories, events, albums] = await Promise.all([get('/api/memories'), get('/api/events'), get('/api/albums')]);
  } catch (e) { container.append(emptyState('🔒', '请先登录')); return; }
  // 从全局搜索/相册链接跳转过来时，直接选中对应相册
  if (params && params.album && albums.some((a) => a.id === params.album)) {
    filter.album = params.album;
  }
  build();
}

// 当前已在时间轴页时，全局搜索点相册结果改由事件驱动切换筛选
window.addEventListener('vault:focus-album', (e) => {
  if (!viewEl) return;
  if (albums.some((a) => a.id === e.detail)) filter.album = e.detail;
  build();
});

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

  // 相册分组
  const albumChips = el('div', { class: 'album-chips' });
  const renderAlbumChips = () => {
    albumChips.innerHTML = '';
    const pick = (value, label, icon) => {
      const b = el('button', {
        class: 'album-chip' + (filter.album === value ? ' active' : ''),
        text: icon + ' ' + label,
        onclick: () => { filter.album = value; renderAlbumChips(); buildList(); }
      });
      return b;
    };
    albumChips.append(pick('all', '全部', '📁'), pick('none', '未分组', '🗂'));
    for (const a of albums) {
      const n = memories.filter((m) => m.albumId === a.id).length;
      albumChips.append(pick(a.id, `${a.name} ${n}`, '💗'));
    }
    albumChips.append(el('button', { class: 'album-chip add', text: '＋ 新建相册', onclick: createAlbum }));
    if (albums.length) albumChips.append(el('button', { class: 'album-chip manage', text: '管理', onclick: manageAlbums }));
  };
  renderAlbumChips();
  page.append(albumChips);

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
    if (filter.album !== 'all') {
      if (it.kind !== 'media') return false;
      if (filter.album === 'none' ? it.m.albumId : it.m.albumId !== filter.album) return false;
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
  const children = [mediaPreview(m, { loading: 'lazy', alt: m.note || '' })];
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
  const albumSel = select([['', '未分组'], ...albums.map((a) => [a.id, a.name])], m.albumId || '', {});
  const md = openModal({
    title: '编辑记忆', content: el('div', null,
      field('拍摄时间', dInput), field('备注', nInput), field('标签（逗号分隔）', tInput), field('地点', lInput),
      field('相册', albumSel)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '保存', onclick: async () => {
        try {
          const updated = await patch('/api/memories/' + m.id, {
            takenAt: dInput.value ? new Date(dInput.value).toISOString() : undefined,
            note: nInput.value, tags: tInput.value.split(',').map((s) => s.trim()).filter(Boolean),
            location: lInput.value, albumId: albumSel.value || null
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

/* 相册：新建 / 管理（重命名、删除） */
function createAlbum() {
  const nameInput = input({ type: 'text', placeholder: '相册名，如：厦门旅行 / 2026 日常' });
  const descInput = input({ type: 'text', placeholder: '一句话说明（可空）' });
  const md = openModal({
    title: '新建相册', content: el('div', null, field('相册名', nameInput), field('说明', descInput)),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => md.close() }) },
      { el: el('button', { class: 'primary-btn', text: '创建', onclick: async () => {
        if (!nameInput.value.trim()) { toast('相册名不能为空', 'err'); return; }
        try {
          await post('/api/albums', { name: nameInput.value.trim(), description: descInput.value.trim() });
          albums = await get('/api/albums');
          md.close(); renderAlbumChipsSafe(); toast('已创建相册 💕');
        } catch (e) { toast(e.message, 'err'); }
      } }) }
    ]
  });
  setTimeout(() => nameInput.focus(), 60);
}

function manageAlbums() {
  const list = el('div', { class: 'album-manage-list' });
  const renderList = () => {
    list.innerHTML = '';
    if (!albums.length) { list.append(el('p', { style: 'font-size:13px;color:var(--muted)', text: '还没有相册' })); return; }
    for (const a of albums) {
      const nameInput = input({ type: 'text', value: a.name });
      const row = el('div', { class: 'album-manage-row' },
        nameInput,
        el('button', { class: 'small-btn', text: '改名', onclick: async () => {
          if (!nameInput.value.trim()) { toast('相册名不能为空', 'err'); return; }
          await patch('/api/albums/' + a.id, { name: nameInput.value.trim() });
          albums = await get('/api/albums');
          toast('已改名');
        } }),
        el('button', { class: 'cf-del', title: '删除相册（照片不删除）', text: '✕', onclick: async () => {
          if (!confirm(`删除相册「${a.name}」？里面的照片会移回未分组，不会删除照片。`)) return;
          await del('/api/albums/' + a.id);
          for (const m of memories.filter((x) => x.albumId === a.id)) {
            m.albumId = null;
            await patch('/api/memories/' + m.id, { albumId: null });
          }
          albums = await get('/api/albums');
          renderList(); renderAlbumChipsSafe(); buildList();
        } }));
      list.append(row);
    }
  };
  renderList();
  const md = openModal({
    title: '管理相册', content: list, buttons: [{ el: el('button', { class: 'primary-btn', text: '完成', onclick: () => { md.close(); } }) }]
  });
}

function renderAlbumChipsSafe() {
  // 相册条在 build() 内以快照生成，统一重建整个视图最稳妥
  build();
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
    el('div', { class: 'ev-title' }, e.title,
      e.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null),
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
      const preview = mediaPreview(m);
      preview.addEventListener('click', (ev) => { ev.stopPropagation(); openLightbox(linked, linked.indexOf(m)); });
      return preview;
    })) : null;
  const md = openModal({
    title: e.title,
    content: el('div', null,
      el('div', { class: 'ev-top', style: 'margin-bottom:10px' },
        el('span', { class: 'ev-badge', text: e.type || '其他' }),
        el('span', { class: 'ev-day', text: fmtDate(e.date) }),
        e.createdBy === 'ai' ? el('span', { class: 'record-origin', text: 'AI 记录' }) : null,
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
    el('p', { class: 'sub', text: '或点击选择文件 · 支持多选 · 可逐张填写实际拍摄时间' }));
  const fi = input({ type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true });
  dz.append(fi);
  const filesEl = el('div', { class: 'upload-files', hidden: true });
  const progress = el('div', { class: 'progress', hidden: true },
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill', id: 'barFill' })),
    el('span', { id: 'progressText', text: '0%' }));

  let pending = [];
  let objectUrls = [];
  let uploading = false;
  const uploadBtn = el('button', { class: 'primary-btn', text: '开始上传', disabled: true });
  const clearPreviews = () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  };
  const localPreview = (file) => {
    if (file.type.startsWith('image/') && !/heic|heif/i.test(file.type)) {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      return el('img', { class: 'upload-file-preview', src: url, alt: file.name });
    }
    return el('div', { class: 'upload-file-placeholder', text: file.type.startsWith('video/') ? '🎬' : '🖼️' });
  };
  const chooseFiles = (fileList) => {
    clearPreviews();
    pending = Array.from(fileList).map((file) => ({ file, date: input({ type: 'datetime-local', step: '60' }) }));
    filesEl.innerHTML = '';
    filesEl.hidden = pending.length === 0;
    for (const item of pending) {
      const type = item.file.type || '未知格式';
      filesEl.append(el('div', { class: 'upload-file-row' },
        localPreview(item.file),
        el('div', { class: 'upload-file-meta' },
          el('div', { class: 'upload-file-name', text: item.file.name }),
          el('div', { class: 'upload-file-type', text: `${type} · ${Math.max(1, Math.round(item.file.size / 1024))} KB` }),
          el('label', { class: 'upload-date-label' },
            el('span', { text: '实际拍摄时间（可选）' }),
            item.date,
            el('small', { text: '留空时自动读取照片元数据；无法读取才使用上传时间' })))));
    }
    uploadBtn.disabled = pending.length === 0;
    uploadBtn.textContent = pending.length ? `上传 ${pending.length} 个文件` : '开始上传';
  };

  const md = openModal({
    title: '上传记忆',
    content: el('div', null, dz, filesEl, progress),
    onClose: clearPreviews,
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '关闭', onclick: () => md.close() }) },
      { el: uploadBtn }
    ]
  });

  dz.addEventListener('click', () => { if (!uploading) fi.click(); });
  fi.addEventListener('change', () => {
    if (fi.files.length) chooseFiles(fi.files);
    fi.value = '';
  });
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if (!uploading && e.dataTransfer.files.length) chooseFiles(e.dataTransfer.files); });
  uploadBtn.addEventListener('click', () => uploadFiles());

  function uploadFiles() {
    if (!pending.length || uploading) return;
    uploading = true;
    uploadBtn.disabled = true;
    uploadBtn.textContent = '上传中…';
    const fd = new FormData();
    for (const item of pending) {
      fd.append('files', item.file);
      fd.append('takenAt', item.date.value ? new Date(item.date.value).toISOString() : '');
    }
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
        // 若当前在看某个相册，新上传的照片自动归入该相册
        if (filter.album && filter.album !== 'all' && filter.album !== 'none') {
          for (const item of data.items) {
            const updated = await patch('/api/memories/' + item.id, { albumId: filter.album });
            Object.assign(item, updated);
          }
        }
        for (const item of data.items) memories.push(item);
        memories.sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''));
        build(); renderFAB();
        document.getElementById('progressText').textContent = '完成 ✓';
        toast(`上传了 ${data.items.length} 段记忆 💕`);
        pending = [];
        clearPreviews();
        setTimeout(() => md.close(), 700);
      } else {
        uploading = false;
        uploadBtn.disabled = false;
        uploadBtn.textContent = pending.length ? `上传 ${pending.length} 个文件` : '开始上传';
        document.getElementById('progressText').textContent = '失败';
        const body = JSON.parse(xhr.responseText || '{}');
        toast('上传失败：' + (body.error || '未知错误'), 'err');
      }
    };
    xhr.onerror = () => {
      uploading = false;
      uploadBtn.disabled = false;
      uploadBtn.textContent = pending.length ? `上传 ${pending.length} 个文件` : '开始上传';
      document.getElementById('progressText').textContent = '失败';
      toast('网络错误', 'err');
    };
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
