// 数据导出 / 导入：zip 打包用户数据与媒体。导入使用临时文件和流式解压，
// 防止大备份占满 Node 内存或利用 zip bomb 耗尽服务器资源。
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const multer = require('multer');
const archiver = require('archiver');
const unzipper = require('unzipper');
const content = require('./content');
const media = require('../media');

const KNOWN_JSON = ['config.json', 'profile.json', 'preferences.json', 'people.json', 'events.json', 'wishes.json', 'gifts.json', 'memories.json', 'albums.json'];
const MEDIA_DIRS = ['media', 'thumbs', 'music'];
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
const MUSIC_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac']);
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const importUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const dir = path.join(os.tmpdir(), 'love-vault-imports');
        await fsp.mkdir(dir, { recursive: true });
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + '.zip')
  }),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 }
});

function cleanConfigForTransfer(value) {
  const config = JSON.parse(JSON.stringify(value || {}));
  if (config.ai && typeof config.ai === 'object') config.ai.apiKey = '';
  delete config.auth;
  return config;
}

function normalizeEntryPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function entrySize(entry) {
  const size = Number(entry.uncompressedSize ?? entry.size ?? (entry.vars && entry.vars.uncompressedSize));
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('备份包含无效的文件大小');
  return size;
}

function mediaDestination(entryPath) {
  const normalized = normalizeEntryPath(entryPath);
  for (const dir of MEDIA_DIRS) {
    const prefix = dir + '/';
    if (!normalized.startsWith(prefix)) continue;
    const name = normalized.slice(prefix.length);
    // Love Vault 媒体目录是扁平布局；拒绝子目录与路径穿越。
    if (!name || name !== path.basename(name) || name.includes('\0')) throw new Error(`备份包含非法媒体路径: ${normalized}`);
    const ext = media.extOf(name);
    if (dir === 'media' && !(IMAGE_EXT.has(ext) || media.VIDEO_EXT.has(ext))) throw new Error(`备份包含不支持的媒体类型: ${name}`);
    if (dir === 'thumbs' && ext !== 'jpg' && ext !== 'jpeg') throw new Error(`备份包含不支持的缩略图类型: ${name}`);
    if (dir === 'music' && !MUSIC_EXT.has(ext)) throw new Error(`备份包含不支持的音乐类型: ${name}`);
    return { dir, name };
  }
  return null;
}

async function streamEntryToFile(entry, target, maxBytes) {
  let copied = 0;
  const limiter = new Transform({
    transform(chunk, enc, callback) {
      copied += chunk.length;
      if (copied > maxBytes) return callback(new Error('备份解压后的数据超过允许上限'));
      callback(null, chunk);
    }
  });
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await pipeline(entry.stream(), limiter, fs.createWriteStream(target, { flags: 'wx' }));
  return copied;
}

async function writeJsonWithBackup(file, raw) {
  const tmp = `${file}.import-${process.pid}-${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp, raw, 'utf8');
  await fsp.copyFile(file, file + '.bak').catch(() => {});
  await fsp.rename(tmp, file);
}

function uploadMiddleware(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      err.status = 413;
      err.message = '备份压缩包不能超过 1 GB';
    }
    next(err);
  });
}

function transferRouter(vaultResolver) {
  const r = express.Router();
  const resolve = (req) => typeof vaultResolver === 'function' ? vaultResolver(req) : vaultResolver;

  r.get('/export', async (req, res) => {
    const vault = resolve(req);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      res.attachment(`love-vault-backup-${stamp}.zip`);
      const archive = archiver('zip', { zlib: { level: 8 } });
      archive.on('error', (e) => res.destroy(e));
      archive.pipe(res);
      for (const file of KNOWN_JSON) {
        try {
          const fullPath = path.join(vault.root, file);
          if (file === 'config.json') {
            const raw = JSON.parse(await fsp.readFile(fullPath, 'utf8'));
            archive.append(JSON.stringify(cleanConfigForTransfer(raw), null, 2), { name: file });
          } else {
            await fsp.access(fullPath);
            archive.file(fullPath, { name: file });
          }
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      for (const dir of MEDIA_DIRS) {
        const abs = path.join(vault.root, dir);
        try {
          await fsp.access(abs);
          archive.directory(abs, dir);
        } catch (e) { /* 目录不存在则跳过 */ }
      }
      await archive.finalize();
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: '导出失败：' + e.message });
      else res.destroy(e);
    }
  });

  r.post('/import', uploadMiddleware, async (req, res) => {
    const vault = resolve(req);
    if (!req.file) return res.status(400).json({ error: '请上传备份 zip 文件' });
    const stage = path.join(vault.root, `.import-${crypto.randomUUID()}`);
    try {
      const directory = await unzipper.Open.file(req.file.path);
      const files = directory.files.filter((entry) => entry.type === 'File');
      if (files.length > MAX_ARCHIVE_ENTRIES) throw Object.assign(new Error('备份文件数量超过 5000 个'), { status: 413 });

      let declaredSize = 0;
      const entries = new Map();
      for (const entry of files) {
        const name = normalizeEntryPath(entry.path);
        if (entries.has(name)) throw Object.assign(new Error(`备份包含重复文件: ${name}`), { status: 400 });
        declaredSize += entrySize(entry);
        if (declaredSize > MAX_UNCOMPRESSED_BYTES) throw Object.assign(new Error('备份解压后的数据超过 2 GB'), { status: 413 });
        entries.set(name, entry);
      }

      const jsonEntries = KNOWN_JSON.filter((name) => entries.has(name));
      if (!jsonEntries.length) return res.status(400).json({ error: '这个 zip 里没有找到记忆库数据（缺少 config.json 等）' });
      const jsonData = new Map();
      for (const name of jsonEntries) {
        const entry = entries.get(name);
        if (entrySize(entry) > MAX_JSON_BYTES) throw Object.assign(new Error(`${name} 超过 4 MB`), { status: 413 });
        const value = JSON.parse((await entry.buffer()).toString('utf8'));
        // API Key 属于当前服务器秘密：备份中的 Key 一律丢弃，目标库已有 Key 则保留。
        if (name === 'config.json') {
          const config = cleanConfigForTransfer(value);
          const currentKey = vault.config.data && vault.config.data.ai && vault.config.data.ai.apiKey;
          if (currentKey) config.ai = { ...(config.ai || {}), apiKey: currentKey };
          jsonData.set(name, JSON.stringify(config, null, 2));
        } else {
          jsonData.set(name, JSON.stringify(value, null, 2));
        }
      }

      await fsp.mkdir(stage, { recursive: true });
      const stagedMedia = [];
      let extracted = 0;
      for (const [entryPath, entry] of entries) {
        const destination = mediaDestination(entryPath);
        if (!destination) continue;
        const stagedPath = path.join(stage, destination.dir, destination.name);
        extracted += await streamEntryToFile(entry, stagedPath, MAX_UNCOMPRESSED_BYTES - extracted);
        if (destination.dir === 'media' || destination.dir === 'thumbs') {
          const type = await media.validateMediaFile(stagedPath, destination.name);
          if (destination.dir === 'thumbs' && type !== 'photo') throw new Error(`缩略图不是有效图片: ${destination.name}`);
        }
        stagedMedia.push({ ...destination, stagedPath });
      }

      const applied = [];
      for (const [name, raw] of jsonData) {
        await writeJsonWithBackup(path.join(vault.root, name), raw);
        applied.push(name);
      }

      let mediaCopied = 0;
      for (const item of stagedMedia) {
        const target = path.join(vault.root, item.dir, item.name);
        if (await fsp.access(target).then(() => true).catch(() => false)) continue;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.rename(item.stagedPath, target);
        mediaCopied++;
      }

      await Promise.all([vault.config, vault.profile, vault.preferences, vault.people, vault.events, vault.wishes, vault.gifts, vault.memories, vault.albums].map((s) => s.load()));
      await content.ensureIndex(vault.memories, vault.mediaDir, vault.thumbDir);
      res.json({ ok: true, dataFiles: applied, mediaCopied });
    } catch (e) {
      console.error('导入失败:', e.message);
      res.status(e.status || 400).json({ error: '导入失败：' + e.message });
    } finally {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      await fsp.unlink(req.file.path).catch(() => {});
    }
  });

  return r;
}

module.exports = { transferRouter, KNOWN_JSON, cleanConfigForTransfer };
