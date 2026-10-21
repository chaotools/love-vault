// 记忆地图：把大事记里已定位的地点按年份串起来
import { el, get, emptyState, fmtDate, toast } from '../core.js';
import { loadTencentMap } from '../tencent-map.mjs';

const TYPES = ['里程碑', '约会', '旅行', '争吵与和解', '承诺', '其他'];
const TYPE_COLORS = {
  里程碑: '#b84a65',
  约会: '#d56b8d',
  旅行: '#4e93b8',
  争吵与和解: '#7d9d78',
  承诺: '#b7833b',
  其他: '#8b7b83'
};
const TYPE_ICONS = { 里程碑: '💘', 约会: '🌹', 旅行: '✈️', 争吵与和解: '🕊️', 承诺: '🤙', 其他: '📌' };

let activeMap = null;
let activeResize = null;

function hasGeo(event) {
  return Boolean(event && event.geo && Number.isFinite(Number(event.geo.lat)) && Number.isFinite(Number(event.geo.lng)));
}

function markerIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38"><path d="M15 1C7.3 1 1 7.2 1 14.8c0 10.3 14 22.2 14 22.2s14-11.9 14-22.2C29 7.2 22.7 1 15 1Z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function typeOf(event) {
  return TYPES.includes(event.type) ? event.type : '其他';
}

function fitPoints(map, TMap, points) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setCenter(points[0]);
    map.setZoom(14);
    return;
  }
  const bounds = new TMap.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, { padding: 80 });
}

export async function render(container, params = {}) {
  destroy();
  container.innerHTML = '';
  const page = el('div', { class: 'page map-page' });
  container.append(page);

  let events = [];
  let geoStatus = {};
  try {
    [events, geoStatus] = await Promise.all([
      get('/api/events'),
      get('/api/geo/status').catch(() => ({ configured: false, mapKey: '' }))
    ]);
  } catch (error) {
    page.append(emptyState('🔒', '请先登录后再查看记忆地图'));
    return;
  }

  const years = [...new Set(events.map((event) => String(event.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  let selectedYear = params.year && years.includes(params.year) ? params.year : 'all';
  let selectedType = 'all';
  let selectedId = null;

  const yearSelect = el('select', { class: 'map-filter-select', 'aria-label': '按年份筛选' },
    el('option', { value: 'all', text: '全部年份' }),
    ...years.map((year) => el('option', { value: year, text: year + ' 年' })));
  yearSelect.value = selectedYear;

  const typeButtons = el('div', { class: 'seg map-type-seg' },
    el('button', { 'data-type': 'all', class: 'active', text: '全部' }),
    ...TYPES.map((type) => el('button', { 'data-type': type, text: TYPE_ICONS[type] + ' ' + type })));
  typeButtons.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      selectedType = button.dataset.type;
      typeButtons.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      updateLayers();
    });
  });
  yearSelect.addEventListener('change', () => {
    selectedYear = yearSelect.value;
    updateLayers();
  });

  page.append(el('div', { class: 'page-head map-page-head' },
    el('div', null,
      el('div', { class: 'page-title', text: '🗺️ 记忆地图' }),
      el('div', { class: 'page-desc', text: '把一起去过的地方按时间串起来，点开标记就能回到那一天' })),
    el('div', { class: 'map-filters' }, yearSelect)));

  const mappedCount = events.filter(hasGeo).length;
  const unlocatedCount = events.filter((event) => event.location && !hasGeo(event)).length;
  page.append(el('div', { class: 'map-summary' },
    el('span', { text: `📍 ${mappedCount} 个地点已定位` }),
    unlocatedCount ? el('span', { class: 'map-summary-muted', text: ` · ${unlocatedCount} 个待定位` }) : null));

  const mapEl = el('div', { class: 'memory-map' });
  const panel = el('div', { class: 'map-panel' });
  const mapShell = el('div', { class: 'map-shell' }, mapEl);
  page.append(el('div', { class: 'map-type-filter' }, typeButtons));
  page.append(el('div', { class: 'map-layout' }, mapShell, panel));

  let TMap;
  let map;
  let markers;
  let polyline;
  const filtered = () => events
    .filter((event) => selectedYear === 'all' || String(event.date || '').startsWith(selectedYear))
    .filter((event) => selectedType === 'all' || typeOf(event) === selectedType);

  const selectedEvent = () => events.find((event) => event.id === selectedId) || null;

  const selectEvent = (id, pan = false) => {
    selectedId = id;
    const event = selectedEvent();
    if (event && pan && hasGeo(event) && map) {
      map.setCenter(new TMap.LatLng(Number(event.geo.lat), Number(event.geo.lng)));
      map.setZoom(15);
    }
    renderPanel(filtered().filter((event) => event.location || hasGeo(event)), geoStatus);
  };

  const renderPanel = (list, status) => {
    panel.innerHTML = '';
    const selected = selectedEvent();
    if (selected && hasGeo(selected)) {
      panel.append(el('div', { class: 'map-detail-card' },
        el('div', { class: 'map-detail-date', text: fmtDate(selected.date) }),
        el('div', { class: 'map-detail-title', text: selected.title || '未命名记录' }),
        el('div', { class: 'map-detail-location', text: '📍 ' + (selected.geo.name || selected.location || '') }),
        selected.geo.address ? el('div', { class: 'map-detail-address', text: selected.geo.address }) : null,
        selected.description ? el('div', { class: 'map-detail-desc', text: selected.description }) : null,
        el('button', { class: 'small-btn', text: '打开大事记', onclick: () => { location.hash = '#/events?focus=' + encodeURIComponent(selected.id); } })));
    }
    const mapped = list.filter(hasGeo).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const unlocated = list.filter((event) => !hasGeo(event) && event.location);
    if (!mapped.length && !unlocated.length) {
      panel.append(emptyState('📍', selectedType === 'all' && selectedYear === 'all' ? '还没有带地点的大事记' : '这个筛选下没有记录'));
      return;
    }
    if (mapped.length) {
      panel.append(el('div', { class: 'map-panel-title', text: '已定位地点' }));
      for (const event of mapped) {
        panel.append(el('button', {
          class: 'map-event-item' + (event.id === selectedId ? ' selected' : ''),
          type: 'button',
          onclick: () => selectEvent(event.id, true)
        },
        el('span', { class: 'map-event-icon', text: TYPE_ICONS[typeOf(event)] }),
        el('span', { class: 'map-event-copy' },
          el('span', { class: 'map-event-title', text: event.title || '未命名记录' }),
          el('span', { class: 'map-event-meta', text: fmtDate(event.date) + ' · ' + (event.geo.name || event.location || '') }))));
      }
    }
    if (unlocated.length) {
      panel.append(el('div', { class: 'map-panel-title', text: '待定位地点' }));
      for (const event of unlocated.slice(0, 30)) {
        panel.append(el('button', {
          class: 'map-event-item map-event-unlocated', type: 'button',
          onclick: () => { location.hash = '#/events?focus=' + encodeURIComponent(event.id); }
        },
        el('span', { class: 'map-event-icon', text: '📍' }),
        el('span', { class: 'map-event-copy' },
          el('span', { class: 'map-event-title', text: event.title || '未命名记录' }),
          el('span', { class: 'map-event-meta', text: fmtDate(event.date) + ' · ' + event.location + '（点击补定位）' }))));
      }
    }
    if (!status.configured) panel.append(el('p', { class: 'map-panel-note', text: '地图 Key 未配置，暂时只显示地点列表。' }));
  };

  if (!geoStatus.configured || !geoStatus.mapKey) {
    mapEl.append(emptyState('🗺️', '腾讯地图还没有配置。<br>请先在服务器设置 TENCENT_MAP_JS_KEY 和 TENCENT_MAP_WEBSERVICE_KEY。'));
    renderPanel(events.filter((event) => event.location), geoStatus);
    return;
  }

  const updateLayers = () => {
    if (!map || !markers || !polyline) return;
    const list = filtered();
    const located = list.filter(hasGeo);
    const points = located.map((event) => new TMap.LatLng(Number(event.geo.lat), Number(event.geo.lng)));
    markers.setGeometries(located.map((event) => ({
      id: event.id,
      position: new TMap.LatLng(Number(event.geo.lat), Number(event.geo.lng)),
      styleId: typeOf(event)
    })));

    const byYear = new Map();
    for (const event of located.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
      const year = String(event.date || '').slice(0, 4) || '未知';
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(new TMap.LatLng(Number(event.geo.lat), Number(event.geo.lng)));
    }
    polyline.setGeometries([...byYear.entries()]
      .filter(([, paths]) => paths.length >= 2)
      .map(([year, paths], index) => ({ id: 'year-' + index, styleId: 'route', paths })));
    if (points.length) fitPoints(map, TMap, points);
    if (!selectedId || !located.some((event) => event.id === selectedId)) selectedId = located[0] ? located[0].id : null;
    renderPanel(list, geoStatus);
  };

  try {
    TMap = await loadTencentMap(geoStatus.mapKey);
    map = new TMap.Map(mapEl, {
      center: new TMap.LatLng(35.0, 105.0),
      zoom: 4,
      showControl: true
    });
    activeMap = map;
    const styles = {};
    for (const type of TYPES) {
      styles[type] = new TMap.MarkerStyle({
        width: 30,
        height: 38,
        anchor: { x: 15, y: 38 },
        src: markerIcon(TYPE_COLORS[type])
      });
    }
    markers = new TMap.MultiMarker({ map, styles, geometries: [] });
    markers.on('click', (event) => {
      if (event && event.geometry && event.geometry.id) selectEvent(event.geometry.id);
    });
    polyline = new TMap.MultiPolyline({
      map,
      styles: { route: new TMap.PolylineStyle({ color: '#c0516f', width: 4, borderWidth: 1, borderColor: '#ffffff', lineCap: 'round' }) },
      geometries: []
    });
    activeResize = () => { if (map) map.resize(); };
    window.addEventListener('resize', activeResize);
    requestAnimationFrame(activeResize);
    updateLayers();
  } catch (error) {
    mapEl.append(emptyState('🗺️', '地图加载失败：' + error.message));
    renderPanel(events.filter((event) => event.location), geoStatus);
  }
}

export function destroy() {
  if (activeResize) window.removeEventListener('resize', activeResize);
  activeResize = null;
  if (activeMap) {
    try { activeMap.destroy(); } catch { /* ignore */ }
  }
  activeMap = null;
}