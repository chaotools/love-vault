const path = require('path');
const fsp = require('fs/promises');
const { JsonStore, Collection } = require('./store');
const content = require('./routes/content');
const { DEFAULT_CONFIG } = require('./routes/config');

class UserDataManager {
  constructor(root) { this.root = root; this.cache = new Map(); }
  async get(userId) {
    if (!this.cache.has(userId)) this.cache.set(userId, this.create(userId));
    return this.cache.get(userId);
  }
  async create(userId) {
    const root = path.join(this.root, 'users', userId);
    const mediaDir = path.join(root, 'media'); const thumbDir = path.join(root, 'thumbs');
    await Promise.all([fsp.mkdir(mediaDir, { recursive: true }), fsp.mkdir(thumbDir, { recursive: true }), fsp.mkdir(path.join(root, 'music'), { recursive: true })]);
    const vault = {
      root, mediaDir, thumbDir, musicDir: path.join(root, 'music'),
      config: new JsonStore(path.join(root, 'config.json'), { ...DEFAULT_CONFIG }),
      profile: new JsonStore(path.join(root, 'profile.json'), content.PROFILE_DEFAULT),
      preferences: new Collection(path.join(root, 'preferences.json')),
      people: new Collection(path.join(root, 'people.json')),
      events: new Collection(path.join(root, 'events.json')),
      wishes: new Collection(path.join(root, 'wishes.json')),
      gifts: new Collection(path.join(root, 'gifts.json')),
      memories: new Collection(path.join(root, 'memories.json')),
    };
    await Promise.all([vault.config.load(), vault.profile.load(), vault.preferences.load(), vault.people.load(), vault.events.load(), vault.wishes.load(), vault.gifts.load(), vault.memories.load()]);
    return vault;
  }
}

module.exports = { UserDataManager };
