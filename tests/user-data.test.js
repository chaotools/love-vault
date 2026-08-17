const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { UserDataManager, migrateLegacyTo } = require('../src/user-data');
const { requireAuth, LOCAL_USER_ID } = require('../src/auth');

test('不同用户获得相互隔离的存储，且重复请求复用同一保险库', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-test-'));
  try {
    const users = new UserDataManager(root);
    const a = await users.get('11111111-1111-4111-8111-111111111111');
    const b = await users.get('22222222-2222-4222-8222-222222222222');

    assert.notEqual(a.preferences, b.preferences);
    assert.equal(a.mediaDir, path.join(root, 'users', '11111111-1111-4111-8111-111111111111', 'media'));

    await a.preferences.add({ polarity: '喜欢', category: '吃', title: '只有 A 看得到' });
    await b.preferences.add({ polarity: '喜欢', category: '吃', title: '只有 B 看得到' });
    assert.equal(a.preferences.list().length, 1);
    assert.equal(b.preferences.list().length, 1);
    assert.equal(a.preferences.list()[0].title, '只有 A 看得到');
    assert.equal(b.preferences.list()[0].title, '只有 B 看得到');

    assert.equal(await users.get('11111111-1111-4111-8111-111111111111'), a);

    const userDirs = await fsp.readdir(path.join(root, 'users'));
    assert.equal(userDirs.length, 2);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('旧版根目录数据迁移到指定用户目录，且不覆盖已有目录', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-migrate-'));
  try {
    await fsp.writeFile(path.join(root, 'config.json'), JSON.stringify({ title: '旧数据' }));
    await fsp.mkdir(path.join(root, 'media'));
    await fsp.writeFile(path.join(root, 'media', 'a.jpg'), 'fake');

    const moved = await migrateLegacyTo(root, '33333333-3333-4333-8333-333333333333');
    assert.equal(moved, true);
    const dst = path.join(root, 'users', '33333333-3333-4333-8333-333333333333');
    assert.equal(JSON.parse(await fsp.readFile(path.join(dst, 'config.json'), 'utf8')).title, '旧数据');
    assert.equal(await fsp.readFile(path.join(dst, 'media', 'a.jpg'), 'utf8'), 'fake');

    // 目标已存在 → 不再迁移；根目录已无旧数据 → 无操作
    await fsp.writeFile(path.join(root, 'config.json'), JSON.stringify({ title: '新数据' }));
    assert.equal(await migrateLegacyTo(root, '33333333-3333-4333-8333-333333333333'), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('未配置认证环境变量时以本地模式放行', () => {
  const prevSecret = process.env.WEB_SESSION_SECRET;
  const prevToken = process.env.MOBILE_SERVICE_TOKEN;
  delete process.env.WEB_SESSION_SECRET;
  delete process.env.MOBILE_SERVICE_TOKEN;
  try {
    let nextCalled = false;
    const req = { headers: {}, get: () => undefined };
    requireAuth(req, { status() { return this; }, json() {} }, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.vaultUserId, LOCAL_USER_ID);
  } finally {
    if (prevSecret === undefined) delete process.env.WEB_SESSION_SECRET;
    else process.env.WEB_SESSION_SECRET = prevSecret;
    if (prevToken === undefined) delete process.env.MOBILE_SERVICE_TOKEN;
    else process.env.MOBILE_SERVICE_TOKEN = prevToken;
  }
});
