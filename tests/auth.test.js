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

test('internal requests need both the service token and a valid opaque user id', () => {
  const previous = process.env.MOBILE_SERVICE_TOKEN;
  process.env.MOBILE_SERVICE_TOKEN = 'test-service-token';
  assert.deepEqual(run(requireAuth, { 'x-love-vault-service-token': 'test-service-token', 'x-love-vault-user-id': '3aa6dbfc-a08c-4f27-9b13-96ee1891cb7c' }), {
    nextCalled: true, statusCode: null
  });
  assert.deepEqual(run(requireAuth, { 'x-love-vault-service-token': 'wrong', 'x-love-vault-user-id': '3aa6dbfc-a08c-4f27-9b13-96ee1891cb7c' }), {
    nextCalled: false, statusCode: 401
  });
  assert.deepEqual(run(requireAuth, { 'x-love-vault-service-token': 'test-service-token' }), { nextCalled: false, statusCode: 401 });

  if (previous === undefined) delete process.env.MOBILE_SERVICE_TOKEN;
  else process.env.MOBILE_SERVICE_TOKEN = previous;
});
