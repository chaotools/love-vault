const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { configRouter, DEFAULT_CONFIG } = require('../src/routes/config');

function startServer(initial = {}) {
  const app = express();
  const state = { data: { ...DEFAULT_CONFIG, ...initial } };
  app.use(express.json());
  app.use('/api/config', configRouter(state, async () => {}));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, state }));
  });
}

test('subjectName 兼容旧配置，并在保存时 trim 和限制 30 个字符', async () => {
  const { server, state } = await startServer({ title: '旧配置' });
  try {
    const before = await fetch(`http://127.0.0.1:${server.address().port}/api/config`);
    const oldConfig = await before.json();
    assert.equal(before.status, 200);
    assert.equal(oldConfig.subjectName, '');

    const longName = `  小鹿${'很可爱'.repeat(20)}  `;
    const saved = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectName: longName })
    });
    const body = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(body.subjectName.length, 30);
    assert.equal(body.subjectName, state.data.subjectName);

    const cleared = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectName: '   ' })
    });
    assert.equal((await cleared.json()).subjectName, '');
    assert.equal(state.data.subjectName, '');
  } finally {
    server.close();
  }
});

test('AI 配置校验失败时，普通配置不会部分写入内存', async () => {
  const previousToken = process.env.MOBILE_SERVICE_TOKEN;
  process.env.MOBILE_SERVICE_TOKEN = 'test-token';
  const { server, state } = await startServer({ subjectName: '旧称呼' });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectName: '新称呼',
        ai: { provider: 'custom', baseUrl: 'https://127.0.0.1/v1', model: 'test-model' }
      })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /HTTPS 公网域名/);
    assert.equal(state.data.subjectName, '旧称呼');
  } finally {
    server.close();
    if (previousToken === undefined) delete process.env.MOBILE_SERVICE_TOKEN;
    else process.env.MOBILE_SERVICE_TOKEN = previousToken;
  }
});
