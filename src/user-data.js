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
    albums: new Collection(path.join(root, 'albums.json')),
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
    vault.wishes.load(), vault.gifts.load(), vault.memories.load(), vault.albums.load(),
  ]);
  await content.ensureIndex(vault.memories, vault.mediaDir, vault.thumbDir);
  return vault;
}

class UserDataManager {
  constructor(root) { this.root = root; this.cache = new Map(); }
  async get(userId) {
    const existing = this.cache.get(userId);
    if (existing) return existing;

    // 在加载完成前先缓存同一个 Promise。否则同一新用户的并发请求会各自
    // 创建一套 store，后写入的一套可能覆盖先写入的一套。
    const pending = loadVault(buildVault(path.join(this.root, 'users', userId)));
    this.cache.set(userId, pending);
    try {
      const vault = await pending;
      this.cache.set(userId, vault);
      return vault;
    } catch (e) {
      // 初始化失败不能缓存失败的 Promise，让下次请求能够重新尝试。
      if (this.cache.get(userId) === pending) this.cache.delete(userId);
      throw e;
    }
  }
}

const LEGACY_FILES = ['config.json', 'profile.json', 'preferences.json', 'people.json', 'events.json', 'wishes.json', 'gifts.json', 'memories.json'];
const LEGACY_DIRS = ['media', 'thumbs', 'music'];

// 把旧版单用户布局（data/ 根目录）迁移到 data/users/<userId>/。
// 每项文件都是原子移动；若进程在中途退出，下次启动会继续移动剩余项目。
// 目标同名项目已存在时明确失败，绝不覆盖任何已有数据。
async function migrateLegacyTo(root, userId) {
  const dst = path.join(root, 'users', userId);
  const exists = (p) => fsp.access(p).then(() => true).catch(() => false);

  const candidates = [
    ...LEGACY_FILES.map((f) => path.join(root, f)),
    ...LEGACY_DIRS.map((d) => path.join(root, d)),
  ];
  const found = [];
  for (const c of candidates) if (await exists(c)) found.push(c);
  if (!found.length) return false;

  await fsp.mkdir(dst, { recursive: true });
  for (const s of found) {
    const target = path.join(dst, path.basename(s));
    if (await exists(target)) {
      throw new Error(`旧数据迁移已停止：目标已存在 ${target}`);
    }
  }
  for (const s of found) {
    await fsp.rename(s, path.join(dst, path.basename(s)));
  }
  console.log(`已把 ${found.length} 项旧版数据迁移到 users/${userId}/`);
  return true;
}

module.exports = { UserDataManager, buildVault, loadVault, migrateLegacyTo };
