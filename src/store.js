// JSON 持久化层：原子写入（临时文件 + rename），断电不损坏数据
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class JsonStore {
  constructor(file, defaultValue) {
    this.file = file;
    this.defaultValue = defaultValue;
    this.data = defaultValue;
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      this.data = JSON.parse(raw);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('读取失败:', this.file, e.message);
      this.data = this.defaultValue;
    }
    return this.data;
  }

  async save() {
    const tmp = this.file + '.tmp';
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fsp.rename(tmp, this.file);
  }
}

// 数组集合：每条记录自动带 id / createdAt / updatedAt
class Collection {
  constructor(file) {
    this.store = new JsonStore(file, []);
  }

  load() { return this.store.load(); }
  list() { return this.store.data; }
  get(id) { return this.store.data.find((x) => x.id === id) || null; }

  async add(fields) {
    const now = new Date().toISOString();
    // 调用方已提供 id（如媒体文件名 id）时必须保留，否则外键关系会断裂
    const item = {
      ...fields,
      id: fields.id || crypto.randomUUID(),
      createdAt: fields.createdAt || now,
      updatedAt: now
    };
    this.store.data.push(item);
    await this.store.save();
    return item;
  }

  async update(id, patch) {
    const item = this.get(id);
    if (!item) return null;
    Object.assign(item, patch, { id: item.id, updatedAt: new Date().toISOString() });
    await this.store.save();
    return item;
  }

  async remove(id) {
    const data = this.store.data;
    const idx = data.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    data.splice(idx, 1);
    await this.store.save();
    return true;
  }
}

module.exports = { JsonStore, Collection };
