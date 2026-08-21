const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/rate-limit');
const { resolveConfig, validateUserAiSettings, validateUserAiSettingsAsync, isPublicIp } = require('../src/ai');

function invoke(middleware, req = {}) {
  let nextCalled = false;
  let statusCode = null;
  let body = null;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { body = value; }
  };
  middleware({ vaultUserId: 'user-a', method: 'POST', ...req }, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, body };
}

test('写入限流按用户拒绝超额请求，读取请求不计入', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2, skip: (req) => req.method === 'GET' });
  assert.equal(invoke(limiter).nextCalled, true);
  assert.equal(invoke(limiter).nextCalled, true);
  const rejected = invoke(limiter);
  assert.equal(rejected.statusCode, 429);
  assert.match(rejected.body.error, /频繁/);
  assert.equal(invoke(limiter, { method: 'GET' }).nextCalled, true);
});

test('多用户模式允许公网自定义供应商，但拒绝危险地址并忽略历史配置', async () => {
  const oldToken = process.env.MOBILE_SERVICE_TOKEN;
  try {
    process.env.MOBILE_SERVICE_TOKEN = 'test-token';
    assert.equal(validateUserAiSettings({ provider: 'custom', baseUrl: 'https://ai.example/v1' }).ok, true);
    assert.equal(validateUserAiSettings({ provider: 'custom', baseUrl: 'http://127.0.0.1:8080' }).ok, false);
    assert.equal(validateUserAiSettings({ provider: 'openai', baseUrl: 'http://127.0.0.1:8080' }).ok, false);
    const resolved = resolveConfig({ ai: { provider: 'custom', baseUrl: 'https://ai.example/v1', apiKey: 'x', model: 'x' } });
    assert.equal(resolved.baseUrl, 'https://ai.example/v1');
    const historical = resolveConfig({ ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:8080', apiKey: 'x', model: 'x' } });
    assert.equal(historical.baseUrl, '');
    assert.equal(isPublicIp('8.8.8.8'), true);
    assert.equal(isPublicIp('127.0.0.1'), false);
    assert.equal(isPublicIp('10.0.0.1'), false);
    assert.equal(isPublicIp('::1'), false);
    assert.equal(isPublicIp('2001:4860:4860::8888'), true);
    assert.equal((await validateUserAiSettingsAsync({ provider: 'custom', baseUrl: 'https://127.0.0.1/v1' })).ok, false);
  } finally {
    if (oldToken === undefined) delete process.env.MOBILE_SERVICE_TOKEN;
    else process.env.MOBILE_SERVICE_TOKEN = oldToken;
  }
});
