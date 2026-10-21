const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('events');
const content = require('../src/routes/content');

function memoryCollection(initial = []) {
  const items = initial.map((item) => ({ ...item }));
  return {
    list: () => items,
    get: (id) => items.find((item) => item.id === id) || null,
    add: async (fields) => { const item = { id: crypto.randomUUID(), ...fields }; items.push(item); return item; },
    update: async (id, patch) => { const item = items.find((entry) => entry.id === id); if (!item) return null; Object.assign(item, patch); return item; },
    remove: async (id) => { const index = items.findIndex((item) => item.id === id); if (index < 0) return false; items.splice(index, 1); return true; }
  };
}

async function withRouter(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, 'close'); }
}

test('大事记保存腾讯坐标，并允许显式清除', async () => {
  const collection = memoryCollection();
  await withRouter(content.eventsRouter(collection), async (origin) => {
    const created = await fetch(origin + '/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-08-19T12:00:00.000Z', title: '第一次看海', type: '旅行', location: '栈桥',
        geo: { name: '栈桥景区', address: '青岛市市南区', lat: 36.060231, lng: 120.319859, placeId: 'p1' }
      })
    });
    assert.equal(created.status, 200);
    const event = await created.json();
    assert.deepEqual(event.geo, {
      name: '栈桥景区', address: '青岛市市南区', lat: 36.060231, lng: 120.319859,
      coordSystem: 'gcj02', provider: 'tencent', placeId: 'p1'
    });

    const cleared = await fetch(origin + '/' + event.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geo: null })
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).geo, null);
  });
});

test('非法地图坐标会被丢弃为未定位', async () => {
  const collection = memoryCollection();
  await withRouter(content.eventsRouter(collection), async (origin) => {
    const response = await fetch(origin + '/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-08-19T12:00:00.000Z', title: '测试', type: '其他', geo: { lat: 999, lng: 999 } })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).geo, null);
  });
});