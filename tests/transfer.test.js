const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { once } = require('events');
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

async function makeVault(extra = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'love-vault-transfer-'));
  const vault = buildVault(root);
  await loadVault(vault);
  await vault.config.save();
  await vault.albums.add({ name: '旅行', description: '' });
  if (extra.memory) {
    await fsp.mkdir(vault.mediaDir, { recursive: true });
    await fsp.writeFile(path.join(vault.mediaDir, 'abc.jpg'), 'FAKE-JPEG');
    await vault.memories.add({ id: 'abc', type: 'photo', filename: 'abc.jpg', takenAt: '2026-01-01T00:00:00.000Z', albumId: extra.albumId || null });
  }
  return { root, vault };
}

test('导出 zip 后可导入到另一个空保险库', async () => {
  const src = await makeVault({ memory: true, albumId: 'album-1' });
  try {
    let zipBuf;
    await withApp(appFor(src.vault), async (origin) => {
      const resp = await fetch(origin + '/export');
      assert.equal(resp.status, 200);
      assert.match(resp.headers.get('content-type') || '', /zip/);
      zipBuf = Buffer.from(await resp.arrayBuffer());
    });
    assert.ok(zipBuf.length > 100, 'zip 应有内容');

    const dst = await makeVault();
    try {
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
  const AdmZip = require('adm-zip');
  const dst = await makeVault();
  try {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('hello'));
    const buf = zip.toBuffer();
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