// Production configuration checks and browser-facing security headers.
const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' https: data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'"
].join('; ');

const MULTI_USER_KEYS = [
  'MOBILE_SERVICE_TOKEN',
  'WEB_SESSION_SECRET',
  'AUTH_BROKER_URL',
  'PUBLIC_ORIGIN',
  'VAULT_ENC_KEY'
];

function parseUrl(value, protocols) {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function validateRuntimeConfig(env = process.env) {
  const configured = MULTI_USER_KEYS.filter((key) => Boolean(String(env[key] || '').trim()));
  if (!configured.length) return { mode: 'local' };

  const missing = MULTI_USER_KEYS.filter((key) => !String(env[key] || '').trim());
  if (missing.length) {
    throw new Error(`多用户模式配置不完整，缺少: ${missing.join(', ')}`);
  }

  const secretKeys = ['MOBILE_SERVICE_TOKEN', 'WEB_SESSION_SECRET', 'VAULT_ENC_KEY'];
  const secrets = secretKeys.map((key) => String(env[key]));
  for (const [index, value] of secrets.entries()) {
    if (value.length < 32) throw new Error(`${secretKeys[index]} 至少需要 32 个字符`);
  }
  if (new Set(secrets).size !== secrets.length) {
    throw new Error('MOBILE_SERVICE_TOKEN、WEB_SESSION_SECRET 与 VAULT_ENC_KEY 必须使用不同密钥');
  }

  const publicOrigin = parseUrl(env.PUBLIC_ORIGIN, ['https:']);
  if (!publicOrigin || publicOrigin.origin !== String(env.PUBLIC_ORIGIN).replace(/\/$/, '')) {
    throw new Error('PUBLIC_ORIGIN 必须是无路径、无凭据的 HTTPS origin');
  }
  if (!parseUrl(env.AUTH_BROKER_URL, ['http:', 'https:'])) {
    throw new Error('AUTH_BROKER_URL 必须是有效的 HTTP(S) URL');
  }

  const rawDays = String(env.WEB_SESSION_MAX_AGE_DAYS || '7');
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new Error('WEB_SESSION_MAX_AGE_DAYS 必须是 1 到 30 的整数');
  }
  return { mode: 'multi-user', sessionMaxAgeDays: days };
}

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

module.exports = { CSP, MULTI_USER_KEYS, validateRuntimeConfig, securityHeaders };
