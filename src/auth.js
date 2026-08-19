// Love Vault 身份边界：网页会话来自小程序扫码，服务端代理必须同时提供用户 ID。
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');

const COOKIE = 'vault_session';
const SERVICE_TOKEN_HEADER = 'x-love-vault-service-token';
const USER_HEADER = 'x-love-vault-user-id';
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 本地单用户模式：未配置任何认证环境变量时直接放行，数据仍用 data/ 根目录的旧布局
const LOCAL_USER_ID = 'local';
function authConfigured() {
  return Boolean(process.env.WEB_SESSION_SECRET) || Boolean(process.env.MOBILE_SERVICE_TOKEN);
}

function secret() { return process.env.WEB_SESSION_SECRET || ''; }
function serviceMatches(req) {
  const expected = process.env.MOBILE_SERVICE_TOKEN || '';
  const actual = req.get(SERVICE_TOKEN_HEADER) || '';
  const userId = req.get(USER_HEADER) || '';
  if (!expected || !actual || !USER_ID.test(userId)) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
function mintSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 30 * 86400_000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readSession(req) {
  if (!secret()) return null;
  const raw = ((req.headers && req.headers.cookie) || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice(COOKIE.length + 1));
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const a = Buffer.from(signature); const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return USER_ID.test(data.userId || '') && Number(data.exp) > Date.now() ? data.userId : null;
  } catch { return null; }
}
function cookie(value, maxAge) { return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`; }

function requireAuth(req, res, next) {
  if (!authConfigured()) { req.vaultUserId = LOCAL_USER_ID; return next(); }
  if (serviceMatches(req)) { req.vaultUserId = req.get(USER_HEADER); return next(); }
  const userId = readSession(req);
  if (userId) { req.vaultUserId = userId; return next(); }
  return res.status(401).json({ error: 'unauthorized', needLogin: true });
}

// 写请求只接受严格同源的浏览器 Origin。生产环境使用 PUBLIC_ORIGIN，
// 避免仅比较 hostname 时放行错误的协议或端口；内部服务令牌请求不受影响。
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'POST').toUpperCase())) return next();
  if (serviceMatches(req)) return next();
  const origin = req.get('Origin');
  // 没有 Cookie 的无 Origin 请求是后端代理或未登录请求，交由认证层处理；
  // 有网页会话 Cookie 的浏览器写请求则必须携带可信 Origin。
  if (!origin) {
    if (readSession(req)) return res.status(403).json({ error: 'missing origin for browser write request' });
    return next();
  }
  try {
    const expected = new URL(process.env.PUBLIC_ORIGIN || `${req.protocol || 'http'}://${req.get('Host') || req.hostname}`).origin;
    if (new URL(origin).origin === expected) return next();
  } catch (e) { /* 非法 Origin 头按拒绝处理 */ }
  return res.status(403).json({ error: 'cross-origin request rejected' });
}

function router() {
  const r = express.Router();
  r.get('/status', (req, res) => res.json({
    enabled: authConfigured(),
    authenticated: !authConfigured() || Boolean(readSession(req))
  }));
  r.post('/logout', (req, res) => { res.setHeader('Set-Cookie', cookie('', 0)); res.json({ ok: true }); });
  r.post('/web-login/start', async (req, res) => {
    const broker = process.env.AUTH_BROKER_URL || '';
    if (!broker) return res.status(503).json({ error: '网页登录尚未配置' });
    try {
      const response = await fetch(broker.replace(/\/$/, '') + '/web-login/start', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) return res.status(response.status).json(body);
      body.qr = await QRCode.toDataURL(body.scanValue, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
      delete body.scanValue;
      res.json(body);
    } catch { res.status(503).json({ error: '登录服务暂时不可用' }); }
  });
  r.get('/web-login/status', async (req, res) => {
    const broker = process.env.AUTH_BROKER_URL || '';
    const id = encodeURIComponent(String(req.query.id || '')); const secretValue = encodeURIComponent(String(req.query.secret || ''));
    if (!broker || !id || !secretValue) return res.status(400).json({ error: '登录会话无效' });
    try {
      const response = await fetch(broker.replace(/\/$/, '') + `/web-login/status?loginId=${id}&secret=${secretValue}`);
      const body = await response.json(); res.status(response.status).json(body);
    } catch { res.status(503).json({ error: '登录服务暂时不可用' }); }
  });
  r.post('/web-exchange', express.json(), async (req, res) => {
    const ticket = String((req.body || {}).ticket || '');
    const broker = process.env.AUTH_BROKER_URL || '';
    if (!ticket || !broker || !process.env.MOBILE_SERVICE_TOKEN || !secret()) return res.status(503).json({ error: '网页登录尚未配置' });
    try {
      const response = await fetch(broker.replace(/\/$/, '') + '/internal/web-login/consume', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [SERVICE_TOKEN_HEADER]: process.env.MOBILE_SERVICE_TOKEN },
        body: JSON.stringify({ ticket })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !USER_ID.test(body.userId || '')) return res.status(401).json({ error: body.detail || '登录凭证已失效' });
      res.setHeader('Set-Cookie', cookie(mintSession(body.userId), 30 * 86400));
      res.json({ ok: true });
    } catch { res.status(503).json({ error: '登录服务暂时不可用' }); }
  });
  return r;
}

module.exports = { requireAuth, router, readSession, serviceMatches, authConfigured, csrfProtect, LOCAL_USER_ID, COOKIE, SERVICE_TOKEN_HEADER, USER_HEADER };
