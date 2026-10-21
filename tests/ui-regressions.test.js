const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('boolean properties use DOM properties', async () => {
  const { BOOLEAN_PROPERTIES, applyBooleanProperty } = await import('../public/js/dom-properties.mjs');
  assert.ok(BOOLEAN_PROPERTIES.has('checked'));
  const node = {};
  assert.equal(applyBooleanProperty(node, 'checked', false), true);
  assert.equal(node.checked, false);
  assert.equal(applyBooleanProperty(node, 'hidden', false), true);
  assert.equal(node.hidden, false);
  assert.equal(applyBooleanProperty(node, 'class', 'x'), false);
});

test('wish header draw action and gift focus are wired', () => {
  const source = read('public/js/views/wishes.js');
  assert.match(source, /const drawButton = document\.querySelector\('\.draw-zone \.primary-btn'\)/);
  assert.match(source, /function runPrimaryAction\(\)/);
  assert.match(source, /vault:focus-gifts/);
});

test('profile and config search focus are wired', () => {
  const app = read('public/js/app.js');
  const profile = read('public/js/views/profile.js');
  assert.match(app, /if \(module === 'config'\) \{ openSettings\(\); return; \}/);
  assert.match(profile, /vault:focus-profile/);
  assert.match(profile, /function focusProfile\(id\)/);
});

test('period clear is available with one cycle', () => {
  assert.match(read('public/js/views/profile.js'), /cycles\.length > 0 \?/);
});

test('event save validates date input', () => {
  assert.match(read('public/js/views/events.js'), /Number\.isNaN\(parsedDate\.getTime\(\)\)/);
});

test('album rename refreshes visible album chips', () => {
  const source = read('public/js/views/timeline.js');
  assert.match(source, /renderList\(\);\s*renderAlbumChipsSafe\(\);\s*toast\('已改名'\)/);
});
test('关系图单击不会冻结节点，拖拽后才固定', () => {
  const source = read('public/js/relation-graph.js');
  const pointerDown = source.slice(source.indexOf('_onPointerDown(e)'), source.indexOf('_onPointerMove(e)'));
  assert.doesNotMatch(pointerDown, /node\.fixed = true/);
  assert.match(source, /this\.dragMoved = true;\s*this\.dragged\.fixed = true;/);
  assert.match(read('public/js/views/people.js'), /showNodeDetails\(node && node\.id\);\s*updateRelationListSelection\(\);/);
});
test('生理期记录入口只由设置里的全局开关控制', () => {
  const source = read('public/js/views/profile.js');
  assert.match(source, /store\.data\.config && store\.data\.config\.periodEnabled/);
  assert.doesNotMatch(source, /profile\.period\.enabled/);
});
test('设置保存后会重新渲染当前页面', () => {
  assert.match(read('public/js/app.js'), /renderBanners\(\);\s*router\(\);/);
});

test('生理期记录支持自动平均周期和手动编辑', () => {
  const source = read('public/js/views/profile.js');
  assert.match(source, /averageCycleDays\(/);
  assert.match(source, /type: 'number'.*平均周期|avgInput/);
  assert.match(source, /保存周期/);
});

test('愿望状态切换会同步完成时间', () => {
  const source = read('public/js/views/wishes.js');
  assert.match(source, /const nextStatus = status\.value/);
  assert.match(source, /doneAt: nextStatus === '已实现'/);
  assert.match(source, /w\.status === '已实现' && w\.doneAt/);
});

test('承诺兑现时间会保存并显示', () => {
  const source = read('public/js/views/events.js');
  assert.match(source, /const doneAt = done \? new Date\(\)\.toISOString\(\) : null/);
  assert.match(source, /e\.doneAt \? ' · ' \+ fmtDate\(e\.doneAt\)/);
  assert.match(source, /e\.doneAt = doneAt/);
});
test('设置页包含可配置的邮件提醒', () => {
  const source = read('public/js/app.js');
  assert.match(source, /邮件提醒/);
  assert.match(source, /sEmailEnabled/);
  assert.match(source, /sEmailTo/);
  assert.match(source, /notifications: emailSettings\(\)/);
  assert.match(source, /发送测试邮件/);
});
test('记忆地图路由、地点提示和事件坐标已接线', () => {
  const app = read('public/js/app.js');
  const html = read('public/index.html');
  const events = read('public/js/views/events.js');
  const map = read('public/js/views/map.js');
  assert.match(app, /map: mapView/);
  assert.match(html, /data-route="map"/);
  assert.match(events, /\/api\/geo\/suggest/);
  assert.match(events, /geo: selectedGeo/);
  assert.match(map, /loadTencentMap/);
  assert.match(map, /MultiMarker/);
  assert.match(map, /MultiPolyline/);
});