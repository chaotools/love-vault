// 数据导出 / 导入：zip 打包全部 JSON + 媒体目录，或从 zip 恢复
// 导出为完整备份；导入会覆盖同名 JSON，媒体文件"缺则补、有则跳过"，导入后重建索引。
const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const content = require('./content');

const KNOWN_JSON = ['config.json', 'profile.json', 'preferences.json', 'people.json', 'events.json', 'wishes.json', 'gifts.json', 'memories.json', 'albums.json'];
const MEDIA_DIRS = ['media', 'thumbs', 'music'];

function transferRouter(vaultResolver) {
  const r = express.Router();
  const resolve = (req) => typeof vaultResolver === 'function' ? vaultResolver(req) : vaultResolver;

  // ---------- 导出 ----------
  r.get('/export', async (req, res) => {
    const vault = resolve(req);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      res.attachment(`love-vault-backup-${stamp}.zip`);
      const archive = archiver('zip', { zlib: { level: 8 } });
      archive.on('error', (e) => { console.error('导出失败:', e.message); });
      archive.pipe(res);
      for (const file of KNOWN_JSON) {
        try {
          await fsp.access(path.join(vault.root, file));
          archive.file(path.join(vault.root, file), { name: file });
        } catch (e) { /* 文件不存在则跳过 */ }
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
      res.status(500).json({ error: '导出失败：' + e.message });
    }
  });

  // ---------- 导入 ----------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
  r.post('/import', upload.single('file'), async (req, res) => {
    const vault = resolve(req);
    if (!req.file) return res.status(400).json({ error: '请上传备份 zip 文件' });
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch (e) {
      return res.status(400).json({ error: '文件不是有效的 zip 备份' });
    }
    const entries = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));

    // 合法性：至少要有一个已知 JSON
    const jsonInZip = entries.filter((n) => KNOWN_JSON.includes(n));
    if (!jsonInZip.length) {
      return res.status(400).json({ error: '这个 zip 里没有找到记忆库数据（缺少 config.json 等）' });
    }

    try {
      const applied = [];
      for (const name of jsonInZip) {
        const raw = zip.readAsText(name);
        JSON.parse(raw); // 提前校验，任何一个坏 JSON 都中止，不写半截
      }
      for (const name of jsonInZip) {
        const raw = zip.readAsText(name);
        await fsp.writeFile(path.join(vault.root, name), raw, 'utf8');
        applied.push(name);
      }

      // 媒体：缺则补、有则跳过（文件名是 UUID，同名即同一文件）
      let mediaCopied = 0;
      for (const dir of MEDIA_DIRS) {
        const prefix = dir + '/';
        for (const entryName of entries.filter((n) => n.startsWith(prefix) && !n.endsWith('/'))) {
          const base = path.basename(entryName);
          if (!base || base === entryName) continue; // 防止路径穿越
          const target = path.join(vault.root, dir, base);
          if (await fsp.access(target).then(() => true).catch(() => false)) continue;
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.writeFile(target, zip.readFile(entryName));
          mediaCopied++;
        }
      }

      // 先重载内存 store（否则导入的 JSON 会被下面的索引流程覆盖），再重建媒体索引
      await Promise.all([vault.config, vault.profile, vault.preferences, vault.people, vault.events, vault.wishes, vault.gifts, vault.memories, vault.albums].map((s) => s.load()));
      await content.ensureIndex(vault.memories, vault.mediaDir, vault.thumbDir);

      res.json({ ok: true, dataFiles: applied, mediaCopied });
    } catch (e) {
      console.error('导入失败:', e);
      res.status(500).json({ error: '导入失败：' + e.message });
    }
  });

  return r;
}

module.exports = { transferRouter, KNOWN_JSON };
