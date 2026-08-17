const path = require('path');
const fsp = require('fs/promises');
const { JsonStore, Collection } = require('./store');
const content = require('./routes/content');
const { DEFAULT_CONFIG } = require('./routes/config');

// 按目录构造一个完整的"保险库"（所有模块的 store + 媒体目录）
function buildVault(root) {
  return {
    root,
    mediaDir: path.join(root, 'media'),
    thumbDir: path.join(root, 'thumbs'),
    musicDir: path.join(root, 'music'),
    config: new JsonStore(path.join(root, 'config.json'), { ...DEFAULT_CONFIG }),
    profile: new JsonStore(path.join(root, 'profile.json'), content.PROFILE_DEFAULT),
    preferences: new Collection(path.join(root, 'preferences.json')),
    people: new Collection(path.join(root, 'people.json')),
    events: new Collection(path.join(root, 'events.json')),
    wishes: new Collection(path.join(root, 'wishes.json')),
    gifts: new Collection(path.join(root, 'gifts.json')),
    memories: new Collection(path.join(root, 'memories.json')),
  };
}

// 建目录、载入全部 JSON、把媒体目录里未索引的文件补进集合
async function loadVault(vault) {
  await Promise.all([
    fsp.mkdir(vault.mediaDir, { recursive: true }),
    fsp.mkdir(vault.thumbDir, { recursive: true }),
    fsp.mkdir(vault.musicDir, { recursive: true }),
  ]);
  await Promise.all([
    vault.config.load(), vault.profile.load(),
    vault.preferences.load(), vault.people.load(), vault.events.load(),
    vault.wishes.load(), vault.gifts.load(), vault.memories.load(),
  ]);
  await content.ensureIndex(vault.memories, vault.mediaDir, vault.thumbDir);
  return vault;
}

class UserDataManager {
  constructor(root) { this.root = root; this.cache = new Map(); }
  async get(userId) {
    if (!this.cache.has(userId)) {
      const vault = await loadVault(buildVault(path.join(this.root, 'users', userId)));
      this.cache.set(userId, vault);
    }
    return this.cache.get(userId);
  }
}

const LEGACY_FILES = ['config.json', 'profile.json', 'preferences.json', 'people.json', 'events.json', 'wishes.json', 'gifts.json', 'memories.json'];
const LEGACY_DIRS = ['media', 'thumbs', 'music'];

// 把旧版单用户布局（data/ 根目录）迁移到 data/users/<userId>/。
// 目标目录已存在时绝不触碰，避免覆盖任何已有数据。
async function migrateLegacyTo(root, userId) {
  const dst = path.join(root, 'users', userId);
  const exists = (p) => fsp.access(p).then(() => true).catch(() => false);
  if (await exists(dst)) return false;

  const candidates = [
    ...LEGACY_FILES.map((f) => path.join(root, f)),
    ...LEGACY_DIRS.map((d) => path.join(root, d)),
  ];
  const found = [];
  for (const c of candidates) if (await exists(c)) found.push(c);
  if (!found.length) return false;

  await fsp.mkdir(dst, { recursive: true });
  for (const s of found) {
    await fsp.rename(s, path.join(dst, path.basename(s)));
  }
  console.log(`已把 ${found.length} 项旧版数据迁移到 users/${userId}/`);
  return true;
}

module.exports = { UserDataManager, buildVault, loadVault, migrateLegacyTo };
