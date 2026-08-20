// 人物关系（relations）校验测试：sanitize 白名单、自引用、悬空引用、去重
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const content = require('../src/routes/content');

// 构造一个临时 people 集合（Collection 直接读内存数组）
function makeVault() {
  const items = [
    { id: 'aaa11111-1111-4111-8111-111111111111', name: '李阿姨', relation: '妈妈', group: '家人', relations: [] },
    { id: 'bbb22222-2222-4222-8222-222222222222', name: '王叔叔①', relation: '邻居', group: '其他', relations: [] },
    { id: 'ccc33333-3333-4333-8333-333333333333', name: '王叔叔②', relation: '同事', group: '同事', relations: [] }
  ];
  return {
    list: () => items,
    get: (id) => items.find((x) => x.id === id) || null,
    add: async (fields) => { const item = { ...fields, id: 'new-' + Date.now() }; items.push(item); return item; },
    update: async (id, patch) => { const i = items.findIndex((x) => x.id === id); items[i] = { ...items[i], ...patch }; return items[i]; },
    remove: async (id) => { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1); return true; }
  };
}

function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/people', content.peopleRouter((req) => makeVault()));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
}

test('relations：合法关联可保存（POST）', async () => {
  const srv = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '小王', group: '朋友',
        relations: [{ toId: 'aaa11111-1111-4111-8111-111111111111', type: '表姐' }]
      })
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.relations.length, 1);
    assert.equal(body.relations[0].type, '表姐');
  } finally { srv.close(); }
});

test('relations：悬空引用被拒绝（toId 不存在）', async () => {
  const srv = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '小张', group: '朋友',
        relations: [{ toId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', type: '同事' }]
      })
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /不存在/);
  } finally { srv.close(); }
});

test('relations：非法 toId / 空 type / 重复关联被清洗', async () => {
  const srv = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '小李', group: '朋友',
        relations: [
          { toId: 'not-a-uuid', type: '同事' },            // 非法 toId → 丢弃
          { toId: 'aaa11111-1111-4111-8111-111111111111', type: '' }, // 空 type → 丢弃
          { toId: 'bbb22222-2222-4222-8222-222222222222', type: '邻居' },
          { toId: 'bbb22222-2222-4222-8222-222222222222', type: '邻居' } // 重复 → 去重
        ]
      })
    });
    const body = await r.json();
    assert.equal(body.relations.length, 1);
    assert.equal(body.relations[0].type, '邻居');
  } finally { srv.close(); }
});

test('relations：不能关联自己（PATCH 自引用被清洗）', async () => {
  const srv = await startServer();
  try {
    const id = 'aaa11111-1111-4111-8111-111111111111';
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/people/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relations: [{ toId: id, type: '自己' }] })
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.relations.length, 0); // 自引用被丢弃
  } finally { srv.close(); }
});