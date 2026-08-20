const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { PassThrough } = require('stream');
const sharp = require('sharp');
const unzipper = require('unzipper');
const archiver = require('archiver');
const { buildVault, loadVault } = require('../src/user-data');
const { transferRouter } = require('../src/routes/transfer');

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

function appFor(vault) {
  const app = express();
  app.use((req, res, next) => { req.vault = vault; next(); });
  app.use('/', transferRouter((req) => req.vault));
  return app;
}

async function zipBuffer(files) {
  const archive = archiver('zip');
  const sink = new PassThrough();
  const chunks = [];
  sink.on('data', (chunk) => chunks.push(chunk));
  const done = once(sink, 'end');
  archive.pipe(sink);
  for (const [name, value] of Object.entries(files)) archive.append(value, { name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

async function makeVault(extra = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-transfer-'));
  const vault = buildVault(root);
  await loadVault(vault);
  await vault.config.save();
  await vault.albums.add({ name: '旅行', description: '' });
  if (extra.memory) {
    await fsp.mkdir(vault.mediaDir, { recursive: true });
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e87b8e' } }).png().toFile(path.join(vault.mediaDir, 'abc.png'));
    await vault.memories.add({ id: 'abc', type: 'photo', filename: 'abc.png', takenAt: '2026-01-01T00:00:00.000Z', albumId: extra.albumId || null });
  }
  return { root, vault };
}

test('导出 zip 后可导入到另一个空保险库', async () => {
  const src = await makeVault({ memory: true, albumId: 'album-1' });
  try {
    src.vault.config.data.ai = { apiKey: 'enc:v1:never-export-this' };
    await src.vault.config.save();
    let zipBuf;
    await withApp(appFor(src.vault), async (origin) => {
      const resp = await fetch(origin + '/export');
      assert.equal(resp.status, 200);
      assert.match(resp.headers.get('content-type') || '', /zip/);
      zipBuf = Buffer.from(await resp.arrayBuffer());
    });
    assert.ok(zipBuf.length > 100, 'zip 应有内容');
    const zip = await unzipper.Open.buffer(zipBuf);
    const exportedConfig = JSON.parse((await zip.files.find((f) => f.path === 'config.json').buffer()).toString('utf8'));
    assert.equal(exportedConfig.ai.apiKey, '');

    const dst = await makeVault();
    try {
      dst.vault.config.data.ai = { apiKey: 'enc:v1:keep-target-key' };
      await dst.vault.config.save();
      await withApp(appFor(dst.vault), async (origin) => {
        const fd = new FormData();
        fd.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'backup.zip');
        const resp = await fetch(origin + '/import', { method: 'POST', body: fd });
        const body = await resp.json();
        assert.equal(resp.status, 200, JSON.stringify(body));
        assert.ok(body.dataFiles.includes('config.json'));
        assert.ok(body.dataFiles.includes('albums.json'));
        assert.equal(body.mediaCopied, 1);
      });
      // 导入后内存 store 已重载：相册与照片都在
      assert.equal(dst.vault.albums.list().length, 1);
      assert.equal(dst.vault.albums.list()[0].name, '旅行');
      assert.equal(dst.vault.memories.list().length, 1);
      assert.equal(dst.vault.memories.list()[0].albumId, 'album-1');
      assert.equal(dst.vault.config.data.ai.apiKey, 'enc:v1:keep-target-key');
    } finally {
      await fsp.rm(dst.root, { recursive: true, force: true });
    }
  } finally {
    await fsp.rm(src.root, { recursive: true, force: true });
  }
});

test('导入非法 zip 被拒绝', async () => {
  const dst = await makeVault();
  try {
    await withApp(appFor(dst.vault), async (origin) => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('这不是zip')], { type: 'application/zip' }), 'bad.zip');
      const resp = await fetch(origin + '/import', { method: 'POST', body: fd });
      assert.equal(resp.status, 400);
    });
  } finally {
    await fsp.rm(dst.root, { recursive: true, force: true });
  }
});

test('导入的 zip 里没有数据文件也被拒绝', async () => {
  const dst = await makeVault();
  try {
    const buf = await zipBuffer({ 'readme.txt': 'hello' });
    await withApp(appFor(dst.vault), async (origin) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'application/zip' }), 'empty.zip');
      const resp = await fetch(origin + '/import', { method: 'POST', body: fd });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /没有找到/);
    });
  } finally {
    await fsp.rm(dst.root, { recursive: true, force: true });
  }
});

test('导入拒绝伪装在媒体目录中的 HTML 文件', async () => {
  const dst = await makeVault();
  try {
    const buf = await zipBuffer({ 'config.json': '{}', 'media/evil.html': '<script>alert(1)</script>' });
    await withApp(appFor(dst.vault), async (origin) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'application/zip' }), 'unsafe.zip');
      const resp = await fetch(origin + '/import', { method: 'POST', body: fd });
      assert.equal(resp.status, 400);
      assert.match((await resp.json()).error, /不支持的媒体类型/);
    });
  } finally {
    await fsp.rm(dst.root, { recursive: true, force: true });
  }
});

test('导入拒绝错误的集合 JSON 结构，避免损坏当前保险库', async () => {
  const dst = await makeVault();
  try {
    const buf = await zipBuffer({ 'config.json': '{}', 'preferences.json': '{"not":"an array"}' });
    await withApp(appFor(dst.vault), async (origin) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'application/zip' }), 'bad-shape.zip');
      const resp = await fetch(origin + '/import', { method: 'POST', body: fd });
      assert.equal(resp.status, 400);
      assert.match((await resp.json()).error, /preferences\.json/);
    });
    assert.deepEqual(dst.vault.preferences.list(), []);
  } finally {
    await fsp.rm(dst.root, { recursive: true, force: true });
  }
});
