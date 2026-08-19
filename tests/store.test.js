const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { JsonStore, Collection } = require('../src/store');

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

test('addMany 只写入一次集合，并在写入失败时恢复内存数据', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-many-'));
  try {
    const collection = new Collection(path.join(dir, 'items.json'));
    await collection.load();
    const saved = await collection.addMany([{ title: 'a' }, { title: 'b' }]);
    assert.equal(saved.length, 2);
    assert.equal(collection.list().length, 2);
    collection.store.save = async () => { throw new Error('disk full'); };
    await assert.rejects(collection.addMany([{ title: 'c' }]), /disk full/);
    assert.equal(collection.list().length, 2);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
