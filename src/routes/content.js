// 五个内容模块的清洗规则与路由装配
const express = require('express');
const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const media = require('../media');
const { collectionRouter, str, bool, dateStr, inEnum } = require('./collections');

// ---------- 偏好 ----------
const PREF_POLARITY = ['喜欢', '不喜欢'];
const PREF_CATEGORY = ['吃', '穿', '用', '玩', '其他'];
const preferencesRouter = (c) => collectionRouter(c, (b) => ({
  polarity: inEnum(b.polarity, PREF_POLARITY),
  category: inEnum(b.category, PREF_CATEGORY),
  title: str(b.title),
  detail: str(b.detail)
}));

// ---------- 人名关系 ----------
const PEOPLE_GROUP = ['家人', '朋友', '同事', '其他'];
const peopleRouter = (c) => collectionRouter(c, (b) => ({
  name: str(b.name),
  relation: str(b.relation),
  group: inEnum(b.group, PEOPLE_GROUP),
  birthday: str(b.birthday),           // 形如 03-14 或 1998-03-14
  howMet: str(b.howMet),               // 相识故事
  notes: str(b.notes)
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
  note: str(b.note)
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
function memoriesRouter(collection) {
  const r = express.Router();
  const resolve = (req) => typeof collection === 'function' ? collection(req) : collection;

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.vault.mediaDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, crypto.randomUUID() + ext);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } });

  const publicMem = (m) => ({
    ...m,
    url: '/media/' + encodeURIComponent(m.filename),
    thumb: '/thumbs/' + encodeURIComponent(m.id) + '.jpg'
  });

  r.get('/', (req, res) => {
    res.json(resolve(req).list()
      .slice()
      .sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '')));
  });

  r.post('/upload', upload.array('files'), async (req, res) => {
    const results = [];
    try {
      for (const file of req.files || []) {
        let filename = file.filename;
        let fullPath = file.path;
        if (media.HEIC_EXT.has(media.extOf(file.originalname))) {
          const conv = await media.convertHeic(fullPath, filename);
          filename = conv.filename; fullPath = conv.fullPath;
        }
        const id = filename.replace(/\.[^.]+$/, '');
        const mem = await media.indexFile(fullPath, filename, id, { thumbDir: req.vault.thumbDir });
        await resolve(req).add(mem); // add 会补 id/createdAt，用 mem 覆盖
        results.push(publicMem(mem));
      }
      res.json({ ok: true, items: results });
    } catch (e) {
      console.error('上传处理失败:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  r.patch('/:id', async (req, res) => {
    const mem = resolve(req).get(req.params.id);
    if (!mem) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    if (typeof b.note === 'string') mem.note = b.note.trim();
    if (typeof b.location === 'string') mem.location = b.location.trim();
    if (typeof b.eventId === 'string' || b.eventId === null) mem.eventId = b.eventId;
    if (Array.isArray(b.tags)) mem.tags = b.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
    if (typeof b.takenAt === 'string' && b.takenAt) mem.takenAt = new Date(b.takenAt).toISOString();
    await resolve(req).update(mem.id, {});
    res.json(publicMem(mem));
  });

  r.delete('/:id', async (req, res) => {
    const mem = resolve(req).get(req.params.id);
    if (!mem) return res.status(404).json({ error: 'not found' });
    await fsp.unlink(path.join(req.vault.mediaDir, mem.filename)).catch(() => {});
    await fsp.unlink(path.join(req.vault.thumbDir, mem.id + '.jpg')).catch(() => {});
    await resolve(req).remove(mem.id);
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
  preferencesRouter, peopleRouter, eventsRouter, wishesRouter, giftsRouter,
  profileRouter, memoriesRouter, ensureIndex, PROFILE_DEFAULT,
  PREF_POLARITY, PREF_CATEGORY, PEOPLE_GROUP, EVENT_TYPE, WISH_STATUS, WISH_PRIORITY, GIFT_DIRECTION
};
