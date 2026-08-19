// 全局搜索回归测试：相册名可被检索（node:test + 内置 http）
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { searchRouter } = require('../src/routes/search');

function sampleData() {
  return {
    config: { memorialDays: [] },
    profile: { basics: {}, health: {}, customFields: [], story: '' },
    preferences: [], people: [], events: [], wishes: [], gifts: [],
    albums: [{ id: 'alb-1', name: '厦门旅行', description: '2024 五一' }],
    memories: [
      { id: 'm1', type: 'photo', filename: 'a.jpg', note: '海边的日落', tags: ['旅行'], location: '', takenAt: '2024-05-01T00:00:00.000Z', albumId: 'alb-1' }
    ]
  };
}

function startServer(getData) {
  const app = express();
  app.use('/api/search', searchRouter(getData));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
}

test('相册名可被全局搜索命中，副标题带照片数', async () => {
  const srv = await startServer(sampleData);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/search?q=${encodeURIComponent('厦门')}`);
    assert.equal(r.status, 200);
    const body = await r.json();
    const g = body.groups.find((x) => x.module === 'albums');
    assert.ok(g, '结果中应有相册分组');
    assert.equal(g.name, '相册');
    assert.equal(g.items[0].title, '厦门旅行');
    assert.equal(g.items[0].subtitle, '相册 · 1 张');
  } finally {
    srv.close();
  }
});

test('相册描述不匹配时不误报', async () => {
  const srv = await startServer(sampleData);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/search?q=${encodeURIComponent('火锅')}`);
    const body = await r.json();
    assert.ok(!body.groups.some((x) => x.module === 'albums'));
  } finally {
    srv.close();
  }
});