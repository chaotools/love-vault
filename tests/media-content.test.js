const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { once } = require('events');
const sharp = require('sharp');
const content = require('../src/routes/content');
const media = require('../src/media');

async function withApp(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function appFor(collection, vault) {
  const app = express();
  app.use((req, res, next) => { req.vault = vault; next(); });
  app.use('/', content.memoriesRouter(() => collection).router);
  return app;
}

test('持久化照片列表始终提供媒体 URL，并安全处理缺失缩略图', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-media-list-'));
  try {
    const vault = { mediaDir: path.join(root, 'media'), thumbDir: path.join(root, 'thumbs') };
    await fsp.mkdir(vault.thumbDir, { recursive: true });
    await fsp.writeFile(path.join(vault.thumbDir, 'photo.jpg'), 'thumb');
    const items = [
      { id: 'photo', filename: 'photo.jpg', type: 'photo', takenAt: '2026-01-02T00:00:00.000Z' },
      { id: 'missing-photo', filename: 'missing.jpg', type: 'photo', takenAt: '2026-01-01T00:00:00.000Z' },
      { id: 'video', filename: 'clip.mp4', type: 'video', takenAt: '2025-12-31T00:00:00.000Z' }
    ];
    const collection = { list: () => items };

    await withApp(appFor(collection, vault), async (origin) => {
      const body = await fetch(origin + '/').then((response) => response.json());
      assert.deepEqual(body.map((item) => item.url), ['/media/photo.jpg', '/media/missing.jpg', '/media/clip.mp4']);
      assert.equal(body[0].thumb, '/thumbs/photo.jpg');
      assert.equal(body[1].thumb, '/media/missing.jpg');
      assert.equal(body[2].thumb, null);
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('手动拍摄时间优先于文件元数据和上传时间', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-media-date-'));
  try {
    const mediaDir = path.join(root, 'media');
    const thumbDir = path.join(root, 'thumbs');
    await fsp.mkdir(mediaDir, { recursive: true });
    await fsp.mkdir(thumbDir, { recursive: true });
    const file = path.join(mediaDir, 'photo.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e87b8e' } }).png().toFile(file);

    const chosen = '2019-05-06T07:08:09.000Z';
    const item = await media.indexFile(file, 'photo.png', 'photo', { thumbDir, takenAt: chosen });
    assert.equal(item.takenAt, chosen);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
