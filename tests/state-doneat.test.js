const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('events');
const content = require('../src/routes/content');

function memoryCollection(initial) {
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
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('愿望离开已实现状态时能清空 doneAt，重新实现时能保存新时间', async () => {
  const collection = memoryCollection([
    { id: 'w1', title: '胶片相机', status: '已实现', doneAt: '2026-01-01T00:00:00.000Z' }
  ]);
  await withRouter(content.wishesRouter(collection), async (origin) => {
    const cleared = await fetch(origin + '/w1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '想要', doneAt: null })
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).doneAt, null);

    const doneAt = '2026-09-01T12:00:00.000Z';
    const completed = await fetch(origin + '/w1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '已实现', doneAt })
    });
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).doneAt, doneAt);
  });
});

test('承诺兑现时间可以保存并在取消兑现时清空', async () => {
  const collection = memoryCollection([
    { id: 'e1', title: '一起看极光', type: '承诺', done: false, doneAt: null }
  ]);
  await withRouter(content.eventsRouter(collection), async (origin) => {
    const doneAt = '2026-09-01T12:00:00.000Z';
    const completed = await fetch(origin + '/e1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true, doneAt })
    });
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).doneAt, doneAt);

    const cleared = await fetch(origin + '/e1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: false, doneAt: null })
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).doneAt, null);
  });
});