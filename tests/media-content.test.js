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
  app.use((err, req, res, next) => { res.status(err.status || 400).json({ error: err.message }); });
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

test('上传白名单：拒绝非媒体文件，接受图片', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-upload-'));
  try {
    const vault = { mediaDir: path.join(root, 'media'), thumbDir: path.join(root, 'thumbs') };
    await fsp.mkdir(vault.mediaDir, { recursive: true });
    await fsp.mkdir(vault.thumbDir, { recursive: true });
    const items = [];
    const collection = {
      list: () => items,
      add: async (m) => { items.push(m); return m; },
      get: () => null,
      update: async () => {},
      remove: async () => {}
    };

    await withApp(appFor(collection, vault), async (origin) => {
      const bad = new FormData();
      bad.append('files', new Blob(['#!/bin/sh'], { type: 'text/plain' }), 'evil.sh');
      const badRes = await fetch(origin + '/upload', { method: 'POST', body: bad });
      assert.equal(badRes.status, 400);
      const badBody = await badRes.json();
      assert.match(badBody.error, /文件类型与声明不匹配/);

      const pngBuf = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e87b8e' } }).png().toBuffer();
      const good = new FormData();
      good.append('files', new Blob([pngBuf], { type: 'image/png' }), 'photo.png');
      const goodRes = await fetch(origin + '/upload', { method: 'POST', body: good });
      assert.equal(goodRes.status, 200);
      const goodBody = await goodRes.json();
      assert.equal(goodBody.items.length, 1);
      assert.equal(goodBody.items[0].type, 'photo');
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('上传校验拒绝 MIME/扩展名不符、伪造图片和超限照片，并清理同批已处理媒体', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-strict-upload-'));
  try {
    const vault = { mediaDir: path.join(root, 'media'), thumbDir: path.join(root, 'thumbs') };
    await fsp.mkdir(vault.mediaDir, { recursive: true });
    await fsp.mkdir(vault.thumbDir, { recursive: true });
    const items = [];
    const collection = {
      list: () => items,
      add: async (m) => { items.push(m); return m; },
      get: () => null,
      update: async () => {},
      remove: async () => {}
    };
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e87b8e' } }).png().toBuffer();

    await withApp(appFor(collection, vault), async (origin) => {
      const mismatch = new FormData();
      mismatch.append('files', new Blob([png], { type: 'video/mp4' }), 'photo.png');
      assert.equal((await fetch(origin + '/upload', { method: 'POST', body: mismatch })).status, 400);

      const atomic = new FormData();
      atomic.append('files', new Blob([png], { type: 'image/png' }), 'good.png');
      atomic.append('files', new Blob(['not an image'], { type: 'image/jpeg' }), 'fake.jpg');
      assert.equal((await fetch(origin + '/upload', { method: 'POST', body: atomic })).status, 400);
      assert.deepEqual(items, []);
      assert.deepEqual(await fsp.readdir(vault.mediaDir), []);
      assert.deepEqual(await fsp.readdir(vault.thumbDir), []);

      const tooLarge = new FormData();
      tooLarge.append('files', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), 'large.jpg');
      assert.equal((await fetch(origin + '/upload', { method: 'POST', body: tooLarge })).status, 413);
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
