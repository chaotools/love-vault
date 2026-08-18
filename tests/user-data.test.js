const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { UserDataManager, migrateLegacyTo } = require('../src/user-data');
const { requireAuth, LOCAL_USER_ID } = require('../src/auth');

test('不同用户获得相互隔离的存储，且并发请求复用同一保险库', async () => {
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

    const [againA, againB] = await Promise.all([
      users.get('11111111-1111-4111-8111-111111111111'),
      users.get('11111111-1111-4111-8111-111111111111'),
    ]);
    assert.equal(againA, a);
    assert.equal(againB, a);

    const [first, second] = await Promise.all([
      users.get('33333333-3333-4333-8333-333333333333'),
      users.get('33333333-3333-4333-8333-333333333333'),
    ]);
    assert.equal(first, second);

    const userDirs = await fsp.readdir(path.join(root, 'users'));
    assert.equal(userDirs.length, 3);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('旧版根目录数据迁移到指定用户目录，可恢复且不覆盖已有文件', async () => {
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

    // 已迁移后根目录已无旧数据 → 无操作
    assert.equal(await migrateLegacyTo(root, '33333333-3333-4333-8333-333333333333'), false);

    // 目标同名文件已存在时中止，保留源文件，避免覆盖用户数据。
    await fsp.writeFile(path.join(root, 'config.json'), JSON.stringify({ title: '新数据' }));
    await assert.rejects(
      migrateLegacyTo(root, '33333333-3333-4333-8333-333333333333'),
      /目标已存在/
    );
    assert.equal(JSON.parse(await fsp.readFile(path.join(root, 'config.json'), 'utf8')).title, '新数据');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('旧数据迁移在已移动部分项目后可继续完成', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-resume-'));
  try {
    const userId = '44444444-4444-4444-8444-444444444444';
    const dst = path.join(root, 'users', userId);
    await fsp.mkdir(dst, { recursive: true });
    await fsp.writeFile(path.join(root, 'config.json'), JSON.stringify({ title: '旧配置' }));
    await fsp.writeFile(path.join(root, 'profile.json'), JSON.stringify({ story: '旧档案' }));

    // 模拟上次迁移已经移动 config，随后进程中断。
    await fsp.rename(path.join(root, 'config.json'), path.join(dst, 'config.json'));
    assert.equal(await migrateLegacyTo(root, userId), true);
    assert.equal(JSON.parse(await fsp.readFile(path.join(dst, 'profile.json'), 'utf8')).story, '旧档案');
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
