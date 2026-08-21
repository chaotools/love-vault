// 前端工具核心：DOM 构建 / API / 弹窗 / 灯箱 / 轻量状态总线
import { subjectLabelFromConfig, quickWishSourceFromConfig } from './subject-label.mjs';
export function el(tag, attrs = {}, ...children) {
  attrs = attrs || {};
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // 仅用于可信内容
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// 媒体预览：照片可在缩略图缺失时回退原图；视频绝不把视频 URL 交给 <img>。
export function mediaPreview(media, { className = '', title = '', alt = '', loading = '' } = {}) {
  const placeholder = () => el('div', {
    class: `media-placeholder ${media.type === 'video' ? 'media-video' : 'media-photo'} ${className}`.trim(),
    title
  }, el('span', { text: media.type === 'video' ? '🎬' : '🖼️' }));

  const image = (src) => {
    const img = el('img', { src, class: className, title, alt, ...(loading ? { loading } : {}) });
    let triedOriginal = src === media.url;
    img.addEventListener('error', () => {
      if (!triedOriginal && media.type !== 'video' && media.url && img.getAttribute('src') !== media.url) {
        triedOriginal = true;
        img.setAttribute('src', media.url);
        return;
      }
      img.replaceWith(placeholder());
    });
    return img;
  };

  if (media.thumb) return image(media.thumb);
  if (media.type !== 'video' && media.url) return image(media.url);
  return placeholder();
}

export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};
export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};
export const fmtDuration = (sec) => {
  if (sec == null || !isFinite(sec)) return '';
  return `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;
};
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ---------- 状态总线 ---------- */
const listeners = new Map();
export const store = {
  data: { config: null, ai: null },
  set(key, value) {
    this.data[key] = value;
    (listeners.get(key) || []).forEach((fn) => fn(value));
  },
  on(key, fn) {
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(fn);
  }
};

// 所有展示文案通过这个 helper 读取统一称呼；空值和旧配置回退为 TA。
export const subjectLabel = () => subjectLabelFromConfig(store.data.config);
export const quickWishSource = () => quickWishSourceFromConfig(store.data.config);

/* ---------- API ---------- */
export async function api(method, path, body) {
  const resp = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (resp.status === 401) {
    store.set('needLogin', true);
    throw new Error('请先登录');
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error((data && data.error) || ('请求失败 ' + resp.status));
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, type = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', { id: 'toast' });
    document.body.append(box);
  }
  box.textContent = msg;
  box.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast'; }, 2600);
}

/* ---------- 弹窗 ---------- */
// 滚动锁计数器：弹窗/灯箱嵌套打开关闭时保持状态一致，不会把页面卡成不可滚动
let scrollLocks = 0;
function lockScroll() {
  scrollLocks++;
  document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = '';
}

export function openModal({ title, content, buttons = [], wide = false, onClose }) {
  const card = el('div', { class: 'modal-card' + (wide ? ' wide' : '') },
    el('h2', { text: title }),
    content
  );
  const foot = buttons.length ? el('div', { class: 'modal-foot' }, buttons.map((b) => b.el)) : null;
  if (foot) card.append(foot);
  const overlay = el('div', { class: 'modal' }, card);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    unlockScroll();
    if (onClose) onClose();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !buttons.some((b) => b.sticky)) close(); });
  lockScroll();
  document.body.append(overlay);
  return { close, card, overlay };
}

// 表单行：label + 控件
export function field(labelText, control, hint) {
  const lab = el('label', { text: labelText });
  if (hint) lab.append(el('span', { class: 'field-hint', text: hint }));
  return el('div', { class: 'field' }, lab, control);
}
export const input = (attrs = {}) => el('input', attrs);
export const select = (options, value, attrs = {}) => {
  const s = el('select', attrs);
  for (const [val, label] of options) s.append(el('option', { value: val, text: label }));
  if (value != null) s.value = value;
  return s;
};
export const textarea = (attrs = {}, text = '') => {
  const t = el('textarea', attrs);
  t.value = text;
  return t;
};

/* ---------- 灯箱（照片/视频共用） ---------- */
let lbItems = [], lbIndex = -1;

export function openLightbox(items, index, { onEdit, onDelete } = {}) {
  lbItems = items; lbIndex = index;
  const lb = document.getElementById('lightbox');
  lb.hidden = false;
  lockScroll();

  const render = () => {
    const m = lbItems[lbIndex];
    if (!m) return closeLightbox();
    const media = document.getElementById('lbMedia');
    media.innerHTML = '';
    media.append(m.type === 'video'
      ? el('video', { src: m.url, controls: true, autoplay: true, playsinline: true })
      : el('img', { src: m.url, alt: m.note || '' }));
    document.getElementById('lbDate').textContent = fmtDateTime(m.takenAt);
    document.getElementById('lbNote').textContent = [m.note, m.location ? '📍' + m.location : ''].filter(Boolean).join(' · ');
    const tags = document.getElementById('lbTags');
    tags.innerHTML = '';
    for (const t of m.tags || []) tags.append(el('span', { class: 'tag', text: '#' + t }));
    document.getElementById('lbCounter').textContent = `${lbIndex + 1} / ${lbItems.length}`;
    document.getElementById('lbEdit').hidden = !onEdit;
    document.getElementById('lbDelete').hidden = !onDelete;
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    lb.hidden = true;
    document.getElementById('lbMedia').innerHTML = '';
    unlockScroll();
    lbIndex = -1;
  };
  const nav = (d) => {
    lbIndex = Math.min(Math.max(lbIndex + d, 0), lbItems.length - 1);
    render();
  };

  lb._nav = nav; lb._close = close; lb._render = render; lb._handlers = { onEdit, onDelete, item: () => lbItems[lbIndex] };
  render();
}
export function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb._close) lb._close();
}
export function initLightbox() {
  const lb = document.getElementById('lightbox');
  document.getElementById('lbClose').addEventListener('click', () => lb._close && lb._close());
  document.getElementById('lbPrev').addEventListener('click', () => lb._nav && lb._nav(-1));
  document.getElementById('lbNext').addEventListener('click', () => lb._nav && lb._nav(1));
  lb.addEventListener('click', (e) => { if (e.target === lb && lb._close) lb._close(); });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') lb._close && lb._close();
    else if (e.key === 'ArrowLeft') lb._nav && lb._nav(-1);
    else if (e.key === 'ArrowRight') lb._nav && lb._nav(1);
  });
  document.getElementById('lbEdit').addEventListener('click', () => {
    if (lb._handlers && lb._handlers.onEdit) lb._handlers.onEdit(lb._handlers.item());
  });
  document.getElementById('lbDelete').addEventListener('click', () => {
    if (lb._handlers && lb._handlers.onDelete) lb._handlers.onDelete(lb._handlers.item());
  });
}

/* ---------- 通用空状态 ---------- */
export const emptyState = (icon, content) => el('div', { class: 'empty' },
  el('div', { class: 'empty-icon', text: icon }),
  typeof content === 'string' ? el('p', { html: content }) : el('p', null, content)
);
