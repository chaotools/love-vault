const test = require('node:test');
const assert = require('node:assert/strict');
const { securityHeaders, validateRuntimeConfig } = require('../src/security');

const valid = () => ({
  MOBILE_SERVICE_TOKEN: 'a'.repeat(32),
  WEB_SESSION_SECRET: 'b'.repeat(32),
  VAULT_ENC_KEY: 'c'.repeat(32),
  AUTH_BROKER_URL: 'http://host.docker.internal:8899/api/love-vault',
  PUBLIC_ORIGIN: 'https://love.example.com'
});

test('runtime config keeps the explicit no-auth local mode', () => {
  assert.deepEqual(validateRuntimeConfig({}), { mode: 'local' });
});

test('runtime config rejects partial or weak multi-user configuration', () => {
  assert.throws(() => validateRuntimeConfig({ MOBILE_SERVICE_TOKEN: 'x' }), /配置不完整/);
  assert.throws(() => validateRuntimeConfig({ ...valid(), WEB_SESSION_SECRET: 'short' }), /至少需要 32/);
  assert.throws(() => validateRuntimeConfig({
    ...valid(),
    WEB_SESSION_SECRET: 'a'.repeat(32)
  }), /必须使用不同密钥/);
  assert.throws(() => validateRuntimeConfig({ ...valid(), PUBLIC_ORIGIN: 'http://love.example.com' }), /HTTPS origin/);
  assert.throws(() => validateRuntimeConfig({ ...valid(), WEB_SESSION_MAX_AGE_DAYS: '31' }), /1 到 30/);
});

test('runtime config accepts a complete multi-user configuration', () => {
  assert.deepEqual(validateRuntimeConfig(valid()), { mode: 'multi-user', sessionMaxAgeDays: 7 });
  assert.equal(validateRuntimeConfig({ ...valid(), WEB_SESSION_MAX_AGE_DAYS: '14' }).sessionMaxAgeDays, 14);
});

test('security middleware sets a strict script policy and HSTS on HTTPS', () => {
  const headers = {};
  let called = false;
  securityHeaders({ secure: true }, { setHeader: (key, value) => { headers[key] = value; } }, () => { called = true; });
  assert.equal(called, true);
  assert.match(headers['Content-Security-Policy'], /script-src 'self'/);
  assert.ok(!headers['Content-Security-Policy'].includes("script-src 'self' 'unsafe-inline'"));
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Strict-Transport-Security'], /max-age=31536000/);
});
