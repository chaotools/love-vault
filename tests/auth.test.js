const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAuth } = require('../src/auth');

function run(middleware, headers = {}) {
  let nextCalled = false;
  let statusCode = null;
  const req = { headers, get: (name) => headers[name.toLowerCase()] };
  const res = {
    status(code) { statusCode = code; return this; },
    json() {}
  };
  middleware(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode };
}

test('service token bypasses the browser session check only when it matches', () => {
  const previous = process.env.MOBILE_SERVICE_TOKEN;
  process.env.MOBILE_SERVICE_TOKEN = 'test-service-token';
  const middleware = requireAuth({ data: { auth: { hash: 'enabled' } } });

  assert.deepEqual(run(middleware, { 'x-love-vault-service-token': 'test-service-token' }), {
    nextCalled: true, statusCode: null
  });
  assert.deepEqual(run(middleware, { 'x-love-vault-service-token': 'wrong' }), {
    nextCalled: false, statusCode: 401
  });

  if (previous === undefined) delete process.env.MOBILE_SERVICE_TOKEN;
  else process.env.MOBILE_SERVICE_TOKEN = previous;
});
