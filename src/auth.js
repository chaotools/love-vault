// 访问密码门：scrypt 哈希存储，内存会话（重启后需重新登录，对私人应用足够）
const express = require('express');
const crypto = require('crypto');

const sessions = new Set(); // token 集合，进程内存
const COOKIE = 'vault_session';

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

const isEnabled = (config) => Boolean(config && config.auth && config.auth.hash);

// Express 中间件：未设密码直接放行；有密码则校验会话 cookie
// 注意：必须传 store 而非 store.data——load() 会把 data 整个对象换掉，捕获旧引用会读到陈旧数据
function requireAuth(store) {
  return (req, res, next) => {
    if (!isEnabled(store.data)) return next();
    const token = (req.headers.cookie || '').split(/;\s*/)
      .map((c) => c.split('=')).find(([k]) => k === COOKIE);
    if (token && sessions.has(decodeURIComponent(token[1]))) return next();
    res.status(401).json({ error: 'unauthorized', needLogin: true });
  };
}

function router(store, saveConfig) {
  const r = express.Router();

  r.get('/status', (req, res) => res.json({ enabled: isEnabled(store.data) }));

  r.post('/login', async (req, res) => {
    if (!isEnabled(store.data)) return res.json({ ok: true });
    const { password } = req.body || {};
    await new Promise((resolve) => setTimeout(resolve, 600)); // 减缓暴力尝试
    if (!password || !verifyPassword(password, store.data.auth.salt, store.data.auth.hash)) {
      return res.status(401).json({ ok: false, error: '密码不对' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    const token = (req.headers.cookie || '').split(/;\s*/)
      .map((c) => c.split('=')).find(([k]) => k === COOKIE);
    if (token) sessions.delete(decodeURIComponent(token[1]));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // 设置/修改/取消密码（需要当前会话已登录，或从未设过密码）
  r.post('/password', requireAuth(store), async (req, res) => {
    const { newPassword } = req.body || {};
    if (newPassword === undefined) return res.status(400).json({ error: '缺少参数' });
    if (newPassword === '') {
      delete store.data.auth;
    } else {
      if (String(newPassword).length < 4) return res.status(400).json({ error: '密码至少 4 位' });
      const { salt, hash } = hashPassword(newPassword);
      store.data.auth = { salt, hash };
    }
    await saveConfig();
    res.json({ ok: true, enabled: Boolean(store.data.auth) });
  });

  return r;
}

module.exports = { requireAuth, router, isEnabled };
