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
test('邮件提醒配置校验接收邮箱并持久化发送时间', async () => {
  const { server, state } = await startServer({ title: '通知测试' });
  const base = `http://127.0.0.1:${server.address().port}/api/config`;
  try {
    const invalid = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifications: { emailEnabled: true, emailTo: 'bad-email', time: '09:00' } })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /接收邮箱/);

    const saved = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifications: { emailEnabled: true, emailTo: 'me@example.com, you@example.com', time: '10:30' } })
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.notifications.emailEnabled, true);
    assert.deepEqual(body.notifications.emails, ['me@example.com', 'you@example.com']);
    assert.equal(body.notifications.time, '10:30');
    assert.equal(state.data.notifications.emailEnabled, true);
    assert.equal(state.data.notifications.time, '10:30');
  } finally {
    server.close();
  }
});