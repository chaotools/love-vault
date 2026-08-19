// 应用主控：启动、路由、全局搜索、随手记、设置、登录、首屏
import { el, get, post, toast, store, openModal, field, input, select, fmtDate, initLightbox, pad } from './core.js';
import { lunarDateText, nextOccurrence, daysUntil } from './lunar.js';
import * as timeline from './views/timeline.js';
import * as profile from './views/profile.js';
import * as preferences from './views/preferences.js';
import * as peopleView from './views/people.js';
import * as eventsView from './views/events.js';
import * as wishesView from './views/wishes.js';
import * as statsView from './views/stats.js';
import * as askView from './views/ask.js';

const VIEWS = {
  timeline, profile, preferences, people: peopleView, events: eventsView, wishes: wishesView, stats: statsView, ask: askView
};

const $ = (id) => document.getElementById(id);

/* ---------- 启动 ---------- */
async function boot() {
  initLightbox();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  initLogin();
  initMusic();
  initTheme();
  initReminders();
  spawnHearts();

  store.on('needLogin', (v) => { $('loginOverlay').hidden = !v; });
  let auth;
  try { auth = await get('/api/auth/status'); } catch (e) { auth = { enabled: false }; }
  if (!auth.authenticated) $('loginOverlay').hidden = false;

  try {
    store.set('config', await get('/api/config'));
    store.set('ai', await get('/api/ask/status'));
  } catch (e) { /* 未登录时等登录后再拉 */ }

  store.on('config', applyConfig);
  store.on('ai', (ai) => { $('navAsk').hidden = !ai.configured; });

  applyConfig(store.data.config);
  if (store.data.ai) $('navAsk').hidden = !store.data.ai.configured;
  $('heroLunar').textContent = lunarDateText(new Date());

  initRouter();
  initGlobalSearch();
  initQuickNote();
  initSettings();
  setInterval(renderDays, 1000);
}

/* ---------- 配置应用到 UI ---------- */
function applyConfig(config) {
  if (!config) return;
  const title = config.title || '爱人记忆库';
  $('toolbarTitle').textContent = title;
  $('heroTitle').textContent = title;
  document.title = title;
  $('heroNames').textContent = config.names || '';
  $('daysBox').hidden = !config.anniversary;
  $('musicBtn').hidden = !config.music;
  renderDays();
  renderChips();
  renderBanners();
  const route = location.hash.replace('#/', '').split('?')[0] || 'timeline';
  if (route === 'timeline') $('hero').hidden = false;
}

function renderDays() {
  const ann = store.data.config && store.data.config.anniversary;
  if (!ann) return;
  const start = new Date(ann + 'T00:00:00');
  let diff = Date.now() - start.getTime();
  if (diff < 0) diff = 0;
  const days = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  $('daysNum').textContent = days;
  $('daysTime').textContent = `${pad(h)} 时 ${pad(m)} 分 ${pad(s)} 秒`;
}

function renderChips() {
  const box = $('memorialChips');
  box.innerHTML = '';
  const now = new Date();
  for (const md of (store.data.config.memorialDays || [])) {
    if (!md.date) continue;
    const next = nextOccurrence(md.date, md.lunar, now);
    if (!next) continue;
    const diff = daysUntil(next, now);
    const tail = diff >= 0 ? `还有 ${diff} 天` : `已过 ${-diff} 天`;
    box.append(el('div', { class: 'chip', text: '' },
      md.name, ' · ', md.lunar ? '农历 ' : '', el('b', { text: tail })));
  }
}

// 首页提醒横幅：纪念日（公历/农历）、生日、生理期、里程碑
// 统一由 /api/reminders 提供，避免前端重复算农历/公历逻辑
async function renderBanners() {
  const box = $('banners');
  box.innerHTML = '';
  try {
    const r = await get('/api/reminders?days=30');
    const icons = { birthday: '🎂', period: '🌸', milestone: '🎉', memorial: '💘' };
    const cls = (it) => it.type === 'birthday' ? 'banner cake' : it.type === 'period' ? 'banner period' : 'banner';
    const rows = (r.items || [])
      .filter((it) => it.inDays >= 0)
      .map((it) => {
        const when = it.inDays === 0 ? '就是今天！' : `还有 ${it.inDays} 天`;
        return el('div', { class: cls(it), text: '' },
          icons[it.type] || '💘',
          el('span', null, it.title + (it.sub ? ` · ${it.sub}` : ''), el('b', { text: ' ' + when })));
      });
    rows.forEach((b) => box.append(b));
  } catch (e) { /* 未登录等场景忽略 */ }
}

/* ---------- 登录 ---------- */
function initLogin() {
  let poll = null;
  const begin = async () => {
    try {
      const login = await post('/api/auth/web-login/start', {});
      $('loginQr').src = login.qr;
      $('loginErr').hidden = true;
      clearInterval(poll);
      poll = setInterval(async () => {
        try {
          const status = await get('/api/auth/web-login/status?id=' + encodeURIComponent(login.id) + '&secret=' + encodeURIComponent(login.secret));
          if (status.status === 'expired') { clearInterval(poll); $('loginErr').hidden = false; return; }
          if (status.status !== 'claimed' || !status.ticket) return;
          clearInterval(poll);
          await post('/api/auth/web-exchange', { ticket: status.ticket });
          location.reload();
        } catch { /* 下一轮轮询重试 */ }
      }, 1800);
    } catch (e) {
      $('loginErr').hidden = false;
    }
  };
  begin();
}

/* ---------- 深色模式 ---------- */
function initTheme() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    $('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
    if (meta) meta.content = theme === 'dark' ? '#171113' : '#e87b8e';
  };
  apply(document.documentElement.dataset.theme || 'light');
  $('themeBtn').addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('vault-theme', next); } catch (e) {}
  });
}

/* ---------- 提醒通知 ---------- */
function initReminders() {
  const btn = $('remindBtn');
  const badge = el('span', { class: 'remind-badge', hidden: true });
  btn.append(badge);

  const notifyKey = () => 'vault-notified-' + new Date().toISOString().slice(0, 10);
  const shownToday = () => { try { return JSON.parse(localStorage.getItem(notifyKey()) || '[]'); } catch (e) { return []; } };
  const markShown = (id) => { try { localStorage.setItem(notifyKey(), JSON.stringify([...new Set([...shownToday(), id])])); } catch (e) {} };

  const fireNative = (items) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const fresh = items.filter((it) => !shownToday().includes(it.id));
    for (const it of fresh.slice(0, 3)) {
      try {
        new Notification('💕 ' + it.title, { body: it.sub || it.date, tag: it.id });
        markShown(it.id);
      } catch (e) { /* 部分浏览器要求用户手势后才能弹 */ }
    }
  };

  // 铃铛点击：先请求通知权限，再弹当天事项
  btn.addEventListener('click', async () => {
    const all = store.data.reminders || [];
    const today = all.filter((it) => it.inDays === 0);
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    if (today.length) {
      fireNative(today);
      const rows = el('div', { class: 'remind-list' },
        ...today.map((it) => el('div', { class: 'remind-row' },
          el('span', { class: 'remind-emoji', text: it.type === 'birthday' ? '🎂' : it.type === 'period' ? '🌸' : it.type === 'milestone' ? '🎉' : '💘' }),
          el('div', null, el('div', { class: 'remind-title', text: it.title }), el('div', { class: 'remind-sub', text: it.sub || '就是今天' })))));
      const md = openModal({
        title: '今天 · ' + new Date().getMonth() + 1 + '月' + new Date().getDate() + '日', content: rows,
        buttons: [{ el: el('button', { class: 'primary-btn', text: '好的，记住了', onclick: () => md.close() }) }]
      });
      for (const it of today) markShown(it.id);
    } else {
      toast(all.length ? '最近没有待办提醒，安安静静过好每一天 💕' : '还没有配置纪念日/生日，去设置里加一个吧', 'ok');
    }
  });

  // 登录后拉一次提醒；today 的自动弹原生通知（当天去重）
  store.on('needLogin', (v) => { if (v) return; });
  const load = async () => {
    try {
      const r = await get('/api/reminders?days=30');
      store.set('reminders', r.items || []);
      const today = (r.items || []).filter((it) => it.inDays === 0);
      badge.hidden = today.length === 0;
      if (today.length) badge.textContent = String(today.length);
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'visible') {
        fireNative(today);
      }
    } catch (e) { /* 未登录等情况忽略 */ }
  };
  load();
  setInterval(load, 30 * 60 * 1000); // 每半小时刷新
}

/* ---------- 背景音乐 ---------- */
let musicOn = false;
function initMusic() {
  $('musicBtn').addEventListener('click', () => {
    const bgm = $('bgm');
    if (!store.data.config || !store.data.config.music) return;
    if (musicOn) { bgm.pause(); musicOn = false; }
    else { bgm.play().catch(() => {}); musicOn = true; }
    $('musicBtn').classList.toggle('on', musicOn);
  });
}
store.on('config', (c) => {
  const bgm = $('bgm');
  if (c && c.music) bgm.src = '/music/' + encodeURIComponent(c.music);
  else { bgm.pause(); musicOn = false; $('musicBtn').classList.remove('on'); }
});

/* ---------- 路由 ---------- */
function initRouter() {
  window.addEventListener('hashchange', router);
  router();
}
function router() {
  const raw = location.hash.replace('#/', '') || 'timeline';
  const [routeName, query] = raw.split('?');
  const params = {};
  if (query) for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  const view = VIEWS[routeName] || timeline;
  $('hero').hidden = view !== timeline;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (VIEWS[routeName] ? routeName : 'timeline')));
  window.scrollTo(0, 0);
  view.render($('view'), params);
}
export const refreshBanners = renderBanners;

/* ---------- 全局搜索 ---------- */
function initGlobalSearch() {
  const input = $('globalSearch');
  const dropdown = $('searchDropdown');
  let timer = null;

  const MODULE_ROUTE = {
    memories: 'timeline', profile: 'profile', preferences: 'preferences',
    people: 'people', events: 'events', wishes: 'wishes', gifts: 'wishes', config: 'timeline'
  };
  const jump = (module, id) => {
    dropdown.hidden = true;
    const route = MODULE_ROUTE[module] || 'timeline';
    if (module === 'memories') {
      location.hash = '#/timeline';
      setTimeout(() => window.dispatchEvent(new CustomEvent('vault:focus-media', { detail: id })), 80);
    } else if (route !== location.hash.replace('#/', '')) {
      location.hash = '#/' + route + (id ? '?focus=' + encodeURIComponent(id) : '');
    } else {
      window.dispatchEvent(new CustomEvent('vault:focus-' + module, { detail: id }));
    }
  };

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) { dropdown.hidden = true; return; }
    try {
      const r = await get('/api/search?q=' + encodeURIComponent(q));
      dropdown.innerHTML = '';
      if (!r.groups.length) {
        dropdown.append(el('div', { class: 'search-empty', text: '没有找到相关记忆，试试其他关键词？' }));
      }
      for (const g of r.groups) {
        dropdown.append(el('div', { class: 'search-group-title', text: g.name }));
        for (const item of g.items) {
          dropdown.append(el('div', { class: 'search-item', onclick: () => jump(g.module, item.id) },
            el('span', { class: 'si-title', text: item.title }),
            el('span', { class: 'si-sub', text: item.subtitle })
          ));
        }
      }
      dropdown.hidden = false;
    } catch (e) { dropdown.hidden = true; }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(doSearch, 250);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { dropdown.hidden = true; input.blur(); } });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search')) dropdown.hidden = true;
  });
}

/* ---------- 随手记 ---------- */
function initQuickNote() {
  $('quickNoteBtn').addEventListener('click', () => {
    const kind = select([
      ['event', '大事记 · 刚发生的事'],
      ['like', '偏好 · TA喜欢什么'],
      ['dislike', '偏好 · TA不喜欢什么'],
      ['wish', '愿望 · TA随口说想要的'],
      ['person', '人名 · TA提到谁']
    ], 'event', { id: 'qnKind' });
    const text = input({ id: 'qnText', type: 'text', placeholder: '一句话就好，比如：说想去一次海边露营' });
    const hint = el('div', { class: 'field-hint', text: '捕捉越快，记得越多。以后可以再去对应模块补充细节。' });

    const save = async (m) => {
      const v = text.value.trim();
      if (!v) { toast('先写一句话呀', 'err'); return; }
      try {
        const k = kind.value;
        if (k === 'event') await post('/api/events', { date: new Date().toISOString(), title: v, type: '其他' });
        else if (k === 'like') await post('/api/preferences', { polarity: '喜欢', category: '其他', title: v });
        else if (k === 'dislike') await post('/api/preferences', { polarity: '不喜欢', category: '其他', title: v });
        else if (k === 'wish') await post('/api/wishes', { title: v, status: '想要', source: 'TA随口说的' });
        else if (k === 'person') await post('/api/people', { name: v, group: '其他' });
        toast('记下了 💕');
        m.close();
        router(); // 当前视图刷新
      } catch (e) { toast(e.message, 'err'); }
    };

    const m = openModal({
      title: '随手记 ✎',
      content: el('div', null, field('记到哪本册子', kind), field('一句话', text), hint),
      buttons: [
        { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => m.close() }) },
        { el: el('button', { class: 'primary-btn', text: '记下', onclick: () => save(m) }) }
      ]
    });
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(m); });
    setTimeout(() => text.focus(), 60);
  });
}

/* ---------- 设置 ---------- */
function initSettings() {
  $('settingsBtn').addEventListener('click', openSettings);
}

async function openSettings() {
  const cfg = await get('/api/config');
  const aiStatus = await get('/api/ask/status');
  const aiPresetBaseUrls = {};
  const providersResp = await fetch('/js/ai-providers.json').then((r) => r.json()).catch(() => ({}));

  // —— 基本区 ——
  const sTitle = input({ type: 'text', value: cfg.title || '' });
  const sNames = input({ type: 'text', value: cfg.names || '', placeholder: '例如：宝宝 & 贝贝' });
  const sAnn = input({ type: 'date', value: cfg.anniversary || '' });
  const sMusic = input({ type: 'text', value: cfg.music || '', placeholder: '例如 our-song.mp3（放进 data/music 目录）' });
  const sPeriod = select([['true', '开启'], ['false', '关闭']], String(cfg.periodEnabled || false));

  const memorialRows = el('div');
  const days = [...(cfg.memorialDays || [])];
  const renderRows = () => {
    memorialRows.innerHTML = '';
    days.forEach((d, i) => {
      const name = input({ type: 'text', value: d.name, placeholder: '名字' });
      const date = input({ type: 'date', value: d.date });
      const lunarChk = el('input', { type: 'checkbox', id: 'lunar-' + i });
      lunarChk.checked = !!d.lunar;
      const lunarLabel = el('label', { class: 'lunar-chk', for: 'lunar-' + i }, lunarChk, el('span', { text: '农历' }));
      name.addEventListener('change', () => { days[i].name = name.value; });
      date.addEventListener('change', () => { days[i].date = date.value; });
      lunarChk.addEventListener('change', () => { days[i].lunar = lunarChk.checked; });
      memorialRows.append(el('div', { class: 'memorial-edit-row' }, name, date, lunarLabel,
        el('button', { class: 'cf-del', text: '✕', onclick: () => { days.splice(i, 1); renderRows(); } })));
    });
  };
  renderRows();
  const addDay = el('button', { class: 'small-btn', text: '＋ 添加纪念日', onclick: () => { days.push({ name: '', date: '' }); renderRows(); } });

  // —— AI 区 ——
  const ai = cfg.ai || {};
  const providerOptions = Object.entries(providersResp).map(([k, v]) => [k, v.name]);
  if (!providerOptions.length) providerOptions.push(['zhipu', '智谱 GLM']);
  const sProvider = select(providerOptions, ai.provider || 'zhipu');
  const sBaseUrl = input({ type: 'text', value: ai.baseUrl || '', placeholder: '留空用该供应商默认地址' });
  const sModel = input({ type: 'text', value: ai.model || '', list: 'modelList', placeholder: '模型名' });
  const modelList = el('datalist', { id: 'modelList' });
  const sApiKey = input({ type: 'password', value: '', placeholder: aiStatus.fromEnv ? '已用环境变量配置，留空即可' : (ai.hasApiKey ? '已保存，留空则不修改' : 'API Key') });
  const privacy = ai.privacy || {};
  const sAiHealth = input({ type: 'checkbox', checked: privacy.health === true });
  const sAiPeriod = input({ type: 'checkbox', checked: privacy.period === true });
  const aiStatusLine = el('div', { class: 'ai-status-line', text: aiStatus.configured ? `当前可用：${aiStatus.provider} · ${aiStatus.model}` : '尚未配置' });

  const refreshModels = () => {
    const p = providersResp[sProvider.value];
    modelList.innerHTML = '';
    if (p && p.models) for (const m of p.models) modelList.append(el('option', { value: m }));
    if (p && p.baseUrl) sBaseUrl.placeholder = '留空用默认：' + p.baseUrl;
  };
  refreshModels();
  sProvider.addEventListener('change', refreshModels);

  const testAi = el('button', {
    class: 'ghost-btn', text: '测试连接', onclick: async (e) => {
      // 先保存当前填写的 AI 配置再测试
      try {
        await post('/api/config', { ai: { provider: sProvider.value, baseUrl: sBaseUrl.value.trim(), apiKey: sApiKey.value.trim(), model: sModel.value.trim(), privacy: { health: sAiHealth.checked, period: sAiPeriod.checked } } });
        const r = await post('/api/ask/test', {});
        aiStatusLine.textContent = `✓ ${r.provider} · ${r.model}：${r.reply}`;
        aiStatusLine.className = 'ai-status-line ok';
        store.set('ai', await get('/api/ask/status'));
      } catch (err) {
        aiStatusLine.textContent = '✗ ' + err.message;
        aiStatusLine.className = 'ai-status-line bad';
      }
    }
  });

  // —— 数据区（导出 / 导入备份） ——
  const exportBtn = el('a', {
    class: 'ghost-btn', href: '/api/transfer/export', download: '', text: '⬇ 导出备份 zip'
  });
  const importFile = input({ type: 'file', accept: '.zip,application/zip', hidden: true });
  const importBtn = el('button', {
    class: 'ghost-btn', text: '⬆ 导入备份', onclick: () => importFile.click()
  });
  const dataStatus = el('div', { class: 'ai-status-line', text: '' });
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    if (!confirm('导入会覆盖当前全部数据，确定继续吗？（建议先导出一份备份）')) return;
    const fd = new FormData();
    fd.append('file', file);
    dataStatus.textContent = '导入中…';
    dataStatus.className = 'ai-status-line';
    try {
      const r = await fetch('/api/transfer/import', { method: 'POST', body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { dataStatus.textContent = '✗ ' + (body.error || '导入失败'); dataStatus.className = 'ai-status-line bad'; return; }
      dataStatus.textContent = `✓ 已恢复 ${body.dataFiles.length} 个数据文件，补齐 ${body.mediaCopied} 个媒体文件`;
      dataStatus.className = 'ai-status-line ok';
      toast('导入完成，正在刷新…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      dataStatus.textContent = '✗ ' + e.message;
      dataStatus.className = 'ai-status-line bad';
    }
  });

  const m = openModal({
    title: '设置 ⚙', wide: true,
    content: el('div', null,
      el('div', { class: 'settings-section' },
        el('h4', { text: '基本' }),
        field('标题', sTitle), field('两个人的名字', sNames), field('在一起的日子', sAnn),
        field('背景音乐文件名', sMusic), field('生理期记录', sPeriod),
        field('纪念日', addDay), memorialRows
      ),
      el('div', { class: 'settings-section' },
        el('h4', { text: 'AI 问答（可以随时换供应商）' }),
        field('供应商', sProvider), field('接口地址', sBaseUrl),
        field('模型', el('span', null, sModel, modelList)),
        field('API Key', sApiKey),
        el('div', { class: 'settings-section' },
          el('h4', { text: 'AI 隐私（发给第三方模型的数据）' }),
          field('允许读取健康信息（过敏/用药）', sAiHealth),
          field('允许读取生理期信息', sAiPeriod)
        ),
        el('div', { class: 'modal-foot', style: 'justify-content:flex-start;margin-top:4px' }, testAi, aiStatusLine)
      ),
      el('div', { class: 'settings-section' },
        el('h4', { text: '数据（全部记忆都在 data/ 目录，此处可打包带走）' }),
        el('div', { class: 'data-actions', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, exportBtn, importBtn, importFile),
        el('div', { style: 'margin-top:8px' }, dataStatus)
      )
    ),
    buttons: [
      { el: el('button', { class: 'ghost-btn', text: '取消', onclick: () => m.close() }) },
      {
        el: el('button', {
          class: 'primary-btn', text: '保存', onclick: async () => {
            try {
              const saved = await post('/api/config', {
                title: sTitle.value.trim(), names: sNames.value.trim(), anniversary: sAnn.value,
                music: sMusic.value.trim(), periodEnabled: sPeriod.value === 'true',
                memorialDays: days.filter((d) => d.name && d.date),
                ai: { provider: sProvider.value, baseUrl: sBaseUrl.value.trim(), apiKey: sApiKey.value.trim(), model: sModel.value.trim(), privacy: { health: sAiHealth.checked, period: sAiPeriod.checked } }
              });
              store.set('config', saved);
              store.set('ai', await get('/api/ask/status'));
              toast('已保存 💕');
              m.close();
              renderBanners();
            } catch (e) { toast(e.message, 'err'); }
          }
        })
      }
    ]
  });
}

/* ---------- 漂浮爱心 ---------- */
function spawnHearts() {
  const box = $('hearts');
  const symbols = ['💗', '💕', '🤍', '💞', '♥', '💘'];
  setInterval(() => {
    if (box.children.length > 14) box.removeChild(box.firstChild);
    const h = el('span', {
      class: 'heart-float', text: symbols[Math.floor(Math.random() * symbols.length)]
    });
    h.style.left = (5 + Math.random() * 90) + '%';
    h.style.fontSize = (14 + Math.random() * 18) + 'px';
    h.style.animationDuration = (10 + Math.random() * 10) + 's';
    box.append(h);
  }, 1800);
}

boot();
