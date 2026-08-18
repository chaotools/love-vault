const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { JsonStore } = require('../src/store');

test('save 前把上一版保留为 .bak，首次写入不产生备份', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-bak-'));
  try {
    const file = path.join(dir, 'data.json');
    const store = new JsonStore(file, {});
    await store.load();
    store.data = { v: 1 };
    await store.save();
    await assert.rejects(fsp.access(file + '.bak'));

    store.data = { v: 2 };
    await store.save();
    assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), { v: 2 });
    assert.deepEqual(JSON.parse(await fsp.readFile(file + '.bak', 'utf8')), { v: 1 });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
