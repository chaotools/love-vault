// 五个内容模块的清洗规则与路由装配
const express = require('express');
const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const media = require('../media');
const { rateLimit } = require('../rate-limit');
const { collectionRouter, str, bool, dateStr, inEnum } = require('./collections');

// ---------- 偏好 ----------
const PREF_POLARITY = ['喜欢', '不喜欢'];
const PREF_CATEGORY = ['吃', '喝', '穿', '用', '玩', '其他'];
const preferencesRouter = (c) => collectionRouter(c, (b) => ({
  polarity: inEnum(b.polarity, PREF_POLARITY),
  category: inEnum(b.category, PREF_CATEGORY),
  title: str(b.title),
  detail: str(b.detail),
  source: str(b.source)                 // 来源（如"AI 对话"）
}));

// ---------- 人名关系 ----------
const PEOPLE_GROUP = ['家人', '朋友', '同事', '其他'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 人物间连接 sanitize：relations: [{ toId, type, note }]
// 校验：toId 是合法 uuid、type 非空、toId 不能是自己、同对不重复
function relationsSanitize(raw, selfId) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error('relations 必须是数组');
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const toId = typeof r.toId === 'string' ? r.toId.trim() : '';
    const type = typeof r.type === 'string' ? r.type.trim().slice(0, 50) : '';
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '';
    if (!UUID_RE.test(toId)) continue;                    // 非法 toId 丢弃
    if (selfId && toId === selfId) continue;              // 不能连自己
    if (!type) continue;                                  // type 必填
    const key = toId + '\u0000' + type;
    if (seen.has(key)) continue;                          // 同对同类型去重
    seen.add(key);
    out.push({ toId, type, note });
  }
  return out;
}

// 校验 relations 引用的 toId 都存在（防悬空引用）
function assertRelationsExist(list, relations) {
  if (!Array.isArray(relations) || !relations.length) return;
  const ids = new Set(list.map((p) => p.id));
  const missing = relations.filter((r) => !ids.has(r.toId));
  if (missing.length) throw new Error('关联的人物不存在（可能已被删除）');
}

const peopleRouter = (c) => {
  const resolve = (req) => typeof c === 'function' ? c(req) : c;
  const inner = collectionRouter(c, (b, isPatch, selfId) => ({
    name: str(b.name),
    relation: str(b.relation),
    group: inEnum(b.group, PEOPLE_GROUP),
    birthday: str(b.birthday),           // 形如 03-14 或 1998-03-14
    lunar: bool(b.lunar),                // 生日按农历过
    leap: bool(b.leap),                  // 闰月生日（如闰二月初一生日）
    howMet: str(b.howMet),               // 相识故事
    notes: str(b.notes),
    source: str(b.source),               // 来源（如"AI 对话"）
    relations: relationsSanitize(b.relations, selfId) // 人物间连接（selfId 用于防自引用）
  }));
  const router = express.Router();
  // 包一层：写入后校验悬空引用（POST 无 selfId；PATCH 有）
  router.post('/', async (req, res, next) => {
    try {
      const b = req.body || {};
      const relations = relationsSanitize(b.relations, null);
      assertRelationsExist(resolve(req).list(), relations);
      next();
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.patch('/:id', async (req, res, next) => {
    try {
      const list = resolve(req).list();
      const self = list.find((p) => p.id === req.params.id);
      if (!self) return next();
      const relations = relationsSanitize(req.body.relations !== undefined ? req.body.relations : self.relations, self.id);
      // 校验时排除自己（允许引用其他人）
      assertRelationsExist(list.filter((p) => p.id !== self.id), relations);
      next();
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // 删除必须同时清理所有指向该人物的连接。不能依赖前端逐条 PATCH，
  // 否则中断或其他客户端调用删除接口时会留下悬空引用。
  router.delete('/:id', async (req, res, next) => {
    try {
      const collection = resolve(req);
      const person = collection.get(req.params.id);
      if (!person) return next();
      const dependents = collection.list().filter((other) =>
        other.id !== person.id && (other.relations || []).some((relation) => relation.toId === person.id));
      // 先清理引用再删除：若写入失败，人物仍保留，数据不会出现悬空引用。
      for (const other of dependents) {
        await collection.update(other.id, {
          relations: other.relations.filter((relation) => relation.toId !== person.id)
        });
      }
      const ok = await collection.remove(person.id);
      if (ok) return res.json({ ok: true });
      return res.status(404).json({ error: 'not found' });
    } catch (e) {
      return res.status(500).json({ error: '删除人物失败，未完成关联清理' });
    }
  });
  router.use(inner);
  return router;
};

// ---------- 相册（照片/视频分组） ----------
const albumsRouter = (c) => collectionRouter(c, (b) => ({
  name: str(b.name),
  description: str(b.description)
}));

// ---------- 大事记 ----------
const EVENT_TYPE = ['里程碑', '约会', '旅行', '争吵与和解', '承诺', '其他'];
const eventsRouter = (c) => collectionRouter(c, (b) => ({
  date: dateStr(b.date),
  title: str(b.title),
  description: str(b.description),
  type: inEnum(b.type, EVENT_TYPE),
  done: bool(b.done),
  location: str(b.location),
  mediaIds: Array.isArray(b.mediaIds) ? b.mediaIds.filter((x) => typeof x === 'string') : undefined
}));

// ---------- 愿望清单 ----------
const WISH_STATUS = ['想要', '计划', '已实现'];
const WISH_PRIORITY = ['高', '中', '低'];
const wishesRouter = (c) => collectionRouter(c, (b) => ({
  title: str(b.title),
  note: str(b.note),
  status: inEnum(b.status, WISH_STATUS),
  priority: inEnum(b.priority, WISH_PRIORITY),
  source: str(b.source),               // 例如"TA随口说的"
  doneAt: dateStr(b.doneAt)
}));

// ---------- 礼物记录 ----------
const GIFT_DIRECTION = ['送给TA', 'TA送我'];
const giftsRouter = (c) => collectionRouter(c, (b) => ({
  title: str(b.title),
  direction: inEnum(b.direction, GIFT_DIRECTION),
  occasion: str(b.occasion),           // 生日 / 纪念日 / 惊喜…
  date: dateStr(b.date),
  note: str(b.note),
  source: str(b.source)                // 来源（如"AI 对话"）
}));

// ---------- 档案（对象存储，整体读写） ----------
const PROFILE_DEFAULT = {
  basics: {
    nickname: '', birthday: '', zodiac: '', bloodType: '',
    height: '', weight: '', shoeSize: '',
    topSize: '', bottomSize: '', ringSize: '', glasses: ''
  },
  health: { allergies: '', medications: '', notes: '' },
  period: { enabled: false, lastCycles: [], avgDays: 28 },   // 生理期记录，默认关闭
  customFields: [],                                           // [{id,label,value}]
  story: ''                                                   // 我们的故事
};

function profileRouter(store) {
  const r = express.Router();
  const resolve = (req) => typeof store === 'function' ? store(req) : store;
  r.get('/', (req, res) => res.json(resolve(req).data));
  r.put('/', async (req, res) => {
    const b = req.body || {};
    const currentStore = resolve(req);
    const cur = currentStore.data;
    // 分区合并，保证结构稳定
    const next = {
      basics: { ...PROFILE_DEFAULT.basics, ...cur.basics, ...(typeof b.basics === 'object' && b.basics ? b.basics : {}) },
      health: { ...PROFILE_DEFAULT.health, ...cur.health, ...(typeof b.health === 'object' && b.health ? b.health : {}) },
      period: { ...PROFILE_DEFAULT.period, ...cur.period, ...(typeof b.period === 'object' && b.period ? b.period : {}) },
      customFields: Array.isArray(b.customFields) ? b.customFields : cur.customFields,
      story: typeof b.story === 'string' ? b.story : cur.story
    };
    // lastCycles 保留最近 12 条且合法
    if (next.period.lastCycles) {
      next.period.lastCycles = next.period.lastCycles
        .filter((d) => typeof d === 'string' && !isNaN(new Date(d).getTime()))
        .slice(-12);
    }
    currentStore.data = next;
    await currentStore.save();
    res.json(next);
  });
  return r;
}

// ---------- 照片/视频 ----------
// 上传白名单：只接收浏览器可直接展示/转码的媒体格式（svg 可携带脚本，明确拒绝）
const IMAGE_UPLOAD_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
const ALLOWED_UPLOAD_EXT = new Set([...IMAGE_UPLOAD_EXT, ...media.VIDEO_EXT]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 200 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BATCH_SIZE = 300 * 1024 * 1024;

const uploadError = (message, status = 400) => Object.assign(new Error(message), { status });
const kindForExt = (ext) => IMAGE_UPLOAD_EXT.has(ext) ? 'image' : (media.VIDEO_EXT.has(ext) ? 'video' : null);

function mimeMatchesExt(mime, ext) {
  if (!mime || mime === 'application/octet-stream') return true;
  const kind = kindForExt(ext);
  return Boolean(kind) && mime.startsWith(kind + '/');
}

function memoriesRouter(collection) {
  const r = express.Router();
  const resolve = (req) => typeof collection === 'function' ? collection(req) : collection;

  const publicMem = async (req, m) => {
    const url = '/media/' + encodeURIComponent(m.filename);
    const thumbPath = path.join(req.vault.thumbDir, m.id + '.jpg');
    let thumb = null;
    try {
      await fsp.access(thumbPath);
      thumb = '/thumbs/' + encodeURIComponent(m.id) + '.jpg';
    } catch (e) {
      // 照片没有缩略图时可安全使用原图；视频不能作为 <img> 的回退来源。
      if (m.type !== 'video') thumb = url;
    }
    return { ...m, url, thumb };
  };

  const uploadTakenAts = (body, count) => {
    const raw = body && body.takenAt;
    if (raw == null) return Array(count).fill(null);
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length !== count) throw new Error('每个文件都需要对应一个拍摄时间字段');
    return values.map((value, index) => {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new Error(`第 ${index + 1} 个文件的拍摄时间无效`);
      return date.toISOString();
    });
  };

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.vault.mediaDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, crypto.randomUUID() + ext);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: MAX_VIDEO_SIZE },
    fileFilter: (req, file, cb) => {
      const ext = media.extOf(file.originalname);
      const mime = String(file.mimetype || '').toLowerCase().trim();
      // 空 MIME / octet-stream 仅为兼容设备；路由内还会检查真实文件内容。
      if (!ALLOWED_UPLOAD_EXT.has(ext) || !mimeMatchesExt(mime, ext)) {
        return cb(uploadError(`文件类型与声明不匹配: ${ext || '未知'}`));
      }
      cb(null, true);
    }
  });

  r.get('/', async (req, res) => {
    const items = resolve(req).list()
      .slice()
      .sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''));
    res.json(await Promise.all(items.map((m) => publicMem(req, m))));
  });

  r.post('/upload', rateLimit({ windowMs: 10 * 60_000, max: 6, name: '上传' }), upload.array('files', MAX_UPLOAD_FILES), async (req, res) => {
    const files = req.files || [];
    const artifacts = new Set(files.map((file) => file.path));
    const removeArtifacts = async () => {
      await Promise.all([...artifacts].map((file) => fsp.unlink(file).catch(() => {})));
    };
    let takenAts;
    try {
      if (!files.length) throw uploadError('请选择至少一个文件');
      if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BATCH_SIZE) {
        throw uploadError('单次上传总大小不能超过 300 MB', 413);
      }
      // 在处理任何文件前验证所有手动日期，避免日期错误导致部分上传。
      takenAts = uploadTakenAts(req.body, files.length);
    } catch (e) {
      await removeArtifacts();
      return res.status(e.status || 400).json({ ok: false, error: e.message });
    }
    try {
      const pending = [];
      for (const [index, file] of files.entries()) {
        const originalExt = media.extOf(file.originalname);
        const limit = IMAGE_UPLOAD_EXT.has(originalExt) ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
        if (file.size > limit) {
          throw uploadError(`${IMAGE_UPLOAD_EXT.has(originalExt) ? '照片' : '视频'}不能超过 ${limit / 1024 / 1024} MB`, 413);
        }
        let filename = file.filename;
        let fullPath = file.path;
        if (media.HEIC_EXT.has(media.extOf(file.originalname))) {
          const conv = await media.convertHeic(fullPath, filename);
          filename = conv.filename;
          fullPath = conv.fullPath;
          artifacts.add(fullPath);
        }
        await media.validateMediaFile(fullPath, filename).catch((e) => {
          throw uploadError(`媒体内容无效: ${e.message}`);
        });
        const id = filename.replace(/\.[^.]+$/, '');
        artifacts.add(path.join(req.vault.thumbDir, id + '.jpg'));
        const mem = await media.indexFile(fullPath, filename, id, {
          thumbDir: req.vault.thumbDir,
          takenAt: takenAts[index]
        });
        pending.push(mem);
      }
      const collection = resolve(req);
      const saved = typeof collection.addMany === 'function'
        ? await collection.addMany(pending)
        : await Promise.all(pending.map((mem) => collection.add(mem)));
      res.json({ ok: true, items: await Promise.all(saved.map((mem) => publicMem(req, mem))) });
    } catch (e) {
      if (!e.status || e.status >= 500) console.error('上传处理失败:', e);
      await removeArtifacts();
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  r.patch('/:id', async (req, res) => {
    const mem = resolve(req).get(req.params.id);
    if (!mem) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    if (typeof b.note === 'string') mem.note = b.note.trim();
    if (typeof b.location === 'string') mem.location = b.location.trim();
    if (typeof b.eventId === 'string' || b.eventId === null) mem.eventId = b.eventId;
    if (typeof b.albumId === 'string' || b.albumId === null) mem.albumId = b.albumId;
    if (Array.isArray(b.tags)) mem.tags = b.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
    if (typeof b.takenAt === 'string' && b.takenAt) {
      const takenAt = new Date(b.takenAt);
      if (Number.isNaN(takenAt.getTime())) return res.status(400).json({ error: '拍摄时间无效' });
      mem.takenAt = takenAt.toISOString();
    }
    await resolve(req).update(mem.id, {});
    res.json(await publicMem(req, mem));
  });

  r.delete('/:id', async (req, res) => {
    const mem = resolve(req).get(req.params.id);
    if (!mem) return res.status(404).json({ error: 'not found' });
    await fsp.unlink(path.join(req.vault.mediaDir, mem.filename)).catch(() => {});
    await fsp.unlink(path.join(req.vault.thumbDir, mem.id + '.jpg')).catch(() => {});
    await resolve(req).remove(mem.id);
    // 再保存一次让 .bak 前进到删除后的版本：被删照片的备注/标签/地点不应残留在回滚备份里
    await resolve(req).store.save().catch(() => {});
    res.json({ ok: true });
  });

  return { router: r, publicMem };
}

// 启动时把媒体目录里未索引的文件补进集合（支持直接往文件夹拖文件）
async function ensureIndex(collection, mediaDir, thumbDir) {
  let files = [];
  try { files = await fsp.readdir(mediaDir); } catch (e) { return; }
  const known = new Set(collection.list().map((m) => m.id));
  const existing = new Set(files);
  let changed = false;

  for (const m of collection.list()) {
    if (!existing.has(m.filename)) { await collection.remove(m.id); changed = true; }
  }
  for (const file of files) {
    const id = file.replace(/\.[^.]+$/, '');
    if (known.has(id)) continue;
    try {
      const mem = await media.indexFile(path.join(mediaDir, file), file, id, { thumbDir });
      await collection.add(mem);
      changed = true;
      console.log('已索引:', file);
    } catch (e) {
      console.error('索引失败:', file, e.message);
    }
  }
  return changed;
}

module.exports = {
  preferencesRouter, peopleRouter, eventsRouter, wishesRouter, giftsRouter, albumsRouter,
  profileRouter, memoriesRouter, ensureIndex, PROFILE_DEFAULT,
  PREF_POLARITY, PREF_CATEGORY, PEOPLE_GROUP, EVENT_TYPE, WISH_STATUS, WISH_PRIORITY, GIFT_DIRECTION
};
