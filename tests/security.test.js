const test = require('node:test');
const assert = require('node:assert/strict');
const { csrfProtect } = require('../src/auth');
const { encryptApiKey, decryptApiKey, migrateStoredApiKeys } = require('../src/secrets');
const { buildDataContext } = require('../src/ai');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

function runCsrf(headers, hostname, method = 'POST') {
  let nextCalled = false;
  let statusCode = null;
  const req = { method, headers: {}, protocol: 'https', get: (name) => headers[name.toLowerCase()], hostname };
  const res = { status(code) { statusCode = code; return this; }, json() {} };
  csrfProtect(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode };
}

test('CSRF：同源放行，跨域拒绝，无 Origin 的服务端请求放行', () => {
  const previous = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = 'https://love.example.com';
  try {
  assert.deepEqual(
    runCsrf({ origin: 'https://love.example.com', host: 'love.example.com' }, 'love.example.com'),
    { nextCalled: true, statusCode: null }
  );
  assert.deepEqual(
    runCsrf({ origin: 'https://evil.example.com', host: 'love.example.com' }, 'love.example.com'),
    { nextCalled: false, statusCode: 403 }
  );
  // 协议不同即使主机名相同也必须拒绝。
  assert.deepEqual(
    runCsrf({ origin: 'http://love.example.com', host: 'love.example.com' }, 'love.example.com'),
    { nextCalled: false, statusCode: 403 }
  );
  // 无 Origin：curl / 小程序后端代理
  assert.deepEqual(runCsrf({}, 'love.example.com'), { nextCalled: true, statusCode: null });
  // 非法 Origin 头按拒绝处理
  assert.deepEqual(runCsrf({ origin: 'not-a-url' }, 'love.example.com'), { nextCalled: false, statusCode: 403 });
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = previous;
  }
});

test('API Key 加密落盘：设置 VAULT_ENC_KEY 时加解密往返一致', () => {
  const prev = process.env.VAULT_ENC_KEY;
  process.env.VAULT_ENC_KEY = 'test-secret';
  try {
    const enc = encryptApiKey('sk-123456');
    assert.ok(enc.startsWith('enc:v1:'));
    assert.ok(!enc.includes('sk-123456'));
    assert.equal(decryptApiKey(enc), 'sk-123456');
    // 明文与空值原样返回（兼容旧数据）
    assert.equal(decryptApiKey('sk-plain'), 'sk-plain');
    assert.equal(decryptApiKey(''), '');
  } finally {
    if (prev === undefined) delete process.env.VAULT_ENC_KEY;
    else process.env.VAULT_ENC_KEY = prev;
  }
});

test('未设置 VAULT_ENC_KEY 时保持明文，密钥不符时解密为空', () => {
  const prev = process.env.VAULT_ENC_KEY;
  process.env.VAULT_ENC_KEY = 'key-a';
  const enc = encryptApiKey('sk-secret');
  process.env.VAULT_ENC_KEY = 'key-b';
  assert.equal(decryptApiKey(enc), '');
  delete process.env.VAULT_ENC_KEY;
  assert.equal(encryptApiKey('sk-plain'), 'sk-plain');
  if (prev === undefined) delete process.env.VAULT_ENC_KEY;
  else process.env.VAULT_ENC_KEY = prev;
});

test('AI 上下文默认剔除健康/生理期，显式开启后才发送', () => {
  const base = {
    config: { title: 't', ai: {} },
    profile: {
      basics: { nickname: '小可爱' },
      health: { allergies: '花生过敏' },
      period: { enabled: true }
    }
  };
  const off = buildDataContext(base);
  assert.ok(off.includes('小可爱'));
  assert.ok(!off.includes('花生过敏'));
  assert.ok(!off.includes('"period"'));

  const on = buildDataContext({
    ...base,
    config: { title: 't', ai: { privacy: { health: true, period: true } } }
  });
  assert.ok(on.includes('花生过敏'));
  assert.ok(on.includes('"period"'));
});

test('AI 上下文明确区分 TA 对人物关系与人物间单向/双向关系', () => {
  const context = buildDataContext({
    config: { title: 't', ai: {} },
    profile: {},
    preferences: [],
    people: [
      { id: 'a', name: '小王', relation: '朋友', relations: [{ toId: 'b', type: '同事', bidirectional: true }] },
      { id: 'b', name: '小李', relation: '同学', relations: [] }
    ],
    events: [], wishes: [], gifts: [], memories: []
  });
  assert.ok(context.includes('TA对该人物的关系'));
  assert.ok(context.includes('人物间关联'));
  assert.ok(context.includes('小李：同事（双向）'));
  assert.ok(!context.includes('"关系":"朋友"'));
});

test('启动迁移会加密主库、用户库及 .bak 中的明文 API Key', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-key-migration-'));
  const previous = process.env.VAULT_ENC_KEY;
  process.env.VAULT_ENC_KEY = 'migration-key';
  try {
    const user = path.join(root, 'users', '11111111-1111-4111-8111-111111111111');
    await fsp.mkdir(user, { recursive: true });
    await fsp.writeFile(path.join(root, 'config.json'), JSON.stringify({ ai: { apiKey: 'root-plain' } }));
    await fsp.writeFile(path.join(root, 'config.json.bak'), JSON.stringify({ ai: { apiKey: 'root-bak-plain' } }));
    await fsp.writeFile(path.join(user, 'config.json'), JSON.stringify({ ai: { apiKey: 'user-plain' } }));
    const result = await migrateStoredApiKeys(root);
    assert.equal(result.migrated, 3);
    for (const file of [path.join(root, 'config.json'), path.join(root, 'config.json.bak'), path.join(user, 'config.json')]) {
      const value = JSON.parse(await fsp.readFile(file, 'utf8')).ai.apiKey;
      assert.ok(value.startsWith('enc:v1:'));
      assert.ok(!value.includes('plain'));
    }
    process.env.VAULT_ENC_KEY = 'wrong-key';
    await assert.rejects(migrateStoredApiKeys(root), /无法解密/);
  } finally {
    if (previous === undefined) delete process.env.VAULT_ENC_KEY;
    else process.env.VAULT_ENC_KEY = previous;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
