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
    const bak = this.file + '.bak';
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    // 保留上一版：误删/误改时可回滚；首次写入没有旧文件，忽略失败
    await fsp.copyFile(this.file, bak).catch(() => {});
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

  // 多文件上传要么全部写入，要么一个也不写，避免半成功记录指向已清理的媒体文件。
  async addMany(fieldsList) {
    const now = new Date().toISOString();
    const items = fieldsList.map((fields) => ({
      ...fields,
      id: fields.id || crypto.randomUUID(),
      createdAt: fields.createdAt || now,
      updatedAt: now
    }));
    this.store.data.push(...items);
    try {
      await this.store.save();
      return items;
    } catch (e) {
      this.store.data.splice(-items.length, items.length);
      throw e;
    }
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
