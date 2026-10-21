const express = require('express');
const { once } = require('events');
const { notificationsRouter } = require('../src/routes/notifications');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SENDER,
  normalizeNotificationSettings,
  validateNotificationSettings,
  smtpConfig,
  buildDailyDigest,
  buildTestEmail,
  runScheduledEmailDigests
} = require('../src/email-notifications');

function sampleData() {
  return {
    config: {
      title: '测试',
      anniversary: '',
      periodEnabled: false,
      memorialDays: [{ name: '在一起', date: '2026-08-19' }],
      notifications: { emailEnabled: true, emailTo: 'me@example.com', time: '09:00' }
    },
    profile: {},
    preferences: [],
    people: [{ id: 'p1', name: '小鹿', birthday: '08-20' }],
    events: [],
    wishes: [],
    gifts: [],
    albums: [],
    memories: []
  };
}

test('邮件接收地址支持多个并用中英文分隔符校验', () => {
  const valid = validateNotificationSettings({ emailEnabled: true, emailTo: 'a@example.com, b@example.com', time: '10:30' });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.settings.emails, ['a@example.com', 'b@example.com']);
  assert.equal(valid.settings.time, '10:30');

  const missing = validateNotificationSettings({ emailEnabled: true, emailTo: '' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /必须填写/);

  const invalid = validateNotificationSettings({ emailEnabled: true, emailTo: 'not-an-email' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /格式/);

  assert.equal(normalizeNotificationSettings({ time: '25:99' }).time, '09:00');
});

test('SMTP 默认使用 163 发件账号且密码只从环境变量读取', () => {
  const config = smtpConfig({ SMTP_PASS: 'auth-code' });
  assert.equal(DEFAULT_SENDER, 'chaotools2026@163.com');
  assert.equal(config.host, 'smtp.163.com');
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.user, 'chaotools2026@163.com');
  assert.equal(config.pass, 'auth-code');
  assert.equal(config.from, 'chaotools2026@163.com');
});

test('每日摘要包含今天和未来 7 天的提醒', () => {
  const digest = buildDailyDigest(sampleData(), { now: new Date('2026-08-19T01:00:00.000Z'), daysAhead: 7 });
  assert.ok(digest);
  assert.match(digest.subject, /08月19日/);
  assert.match(digest.text, /在一起/);
  assert.match(digest.text, /小鹿 的生日|小鹿的生日/);
  assert.equal(digest.items.some((item) => item.type === 'memorial'), true);
  assert.equal(digest.items.some((item) => item.type === 'birthday'), true);
});

test('没有提醒时不生成摘要', () => {
  const data = sampleData();
  data.config.memorialDays = [];
  data.people = [];
  assert.equal(buildDailyDigest(data, { now: new Date('2026-08-19T01:00:00.000Z') }), null);
});

test('定时发送按用户去重，并且邮件内容可直接交给 SMTP', async () => {
  const sent = [];
  const email = {
    isConfigured: () => true,
    send: async (message) => { sent.push(message); return { accepted: message.to }; }
  };
  const state = {};
  const vault = {
    config: { data: sampleData().config },
    profile: { data: {} },
    preferences: { list: () => [] },
    people: { list: () => sampleData().people },
    events: { list: () => [] },
    wishes: { list: () => [] },
    gifts: { list: () => [] },
    albums: { list: () => [] },
    memories: { list: () => [] }
  };
  const now = new Date('2026-08-19T01:00:00.000Z'); // 上海时间 09:00
  const first = await runScheduledEmailDigests({ vaults: [{ scope: 'local', vault }], email, state, now });
  assert.equal(first.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /爱人记忆库提醒/);
  assert.deepEqual(sent[0].to, ['me@example.com']);

  const second = await runScheduledEmailDigests({ vaults: [{ scope: 'local', vault }], email, state, now });
  assert.equal(second.length, 0);
  assert.equal(sent.length, 1);
});

test('测试邮件包含当前接收地址', () => {
  const mail = buildTestEmail(['a@example.com', 'b@example.com']);
  assert.match(mail.text, /a@example.com/);
  assert.match(mail.text, /b@example.com/);
});
test('测试邮件接口使用已保存的接收邮箱并调用邮件服务', async () => {
  const sent = [];
  const vault = { config: { data: { notifications: { emailEnabled: true, emailTo: 'me@example.com', time: '09:00' } } } };
  const email = { isConfigured: () => true, config: { from: 'chaotools2026@163.com', host: 'smtp.163.com' }, send: async (message) => { sent.push(message); } };
  const app = express();
  app.use(express.json());
  app.use('/', notificationsRouter(() => vault, email));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/test`, { method: 'POST' });
    const statusResponse = await fetch(`http://127.0.0.1:${server.address().port}/status`);
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).configured, true);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, to: ['me@example.com'] });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['me@example.com']);
    assert.match(sent[0].subject, /测试邮件/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});