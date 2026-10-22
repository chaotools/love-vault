const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotVault } = require('../src/vault-snapshot');

test('保险库快照统一包含全部集合并按拍摄时间倒序排列', () => {
  const list = (items) => ({ list: () => items });
  const vault = {
    config: { data: { title: 'x' } },
    profile: { data: { story: 'y' } },
    preferences: list([{ id: 'pref' }]),
    people: list([{ id: 'person' }]),
    events: list([{ id: 'event' }]),
    wishes: list([{ id: 'wish' }]),
    gifts: list([{ id: 'gift' }]),
    albums: list([{ id: 'album' }]),
    memories: list([{ id: 'old', takenAt: '2026-01-01' }, { id: 'new', takenAt: '2026-02-01' }])
  };
  const snapshot = snapshotVault(vault);
  assert.deepEqual(Object.keys(snapshot).sort(), ['albums', 'config', 'events', 'gifts', 'memories', 'people', 'preferences', 'profile', 'wishes']);
  assert.deepEqual(snapshot.memories.map((m) => m.id), ['new', 'old']);
  assert.equal(snapshot.config, vault.config.data);
  assert.equal(snapshot.profile, vault.profile.data);
});