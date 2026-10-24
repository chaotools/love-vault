const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { requireAuth, router, mintSession } = require('../src/auth');

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
  const previous = process.env.MOONBOX_SERVICE_TOKEN;
  process.env.MOONBOX_SERVICE_TOKEN = 'test-service-token';
  assert.deepEqual(run(requireAuth, { 'x-moonbox-service-token': 'test-service-token', 'x-moonbox-user-id': '3aa6dbfc-a08c-4f27-9b13-96ee1891cb7c' }), {
    nextCalled: true, statusCode: null
  });
  assert.deepEqual(run(requireAuth, { 'x-moonbox-service-token': 'wrong', 'x-moonbox-user-id': '3aa6dbfc-a08c-4f27-9b13-96ee1891cb7c' }), {
    nextCalled: false, statusCode: 401
  });
  assert.deepEqual(run(requireAuth, { 'x-moonbox-service-token': 'test-service-token' }), { nextCalled: false, statusCode: 401 });

  if (previous === undefined) delete process.env.MOONBOX_SERVICE_TOKEN;
  else process.env.MOONBOX_SERVICE_TOKEN = previous;
});

test('web login status forwards its secret in a JSON POST body, never in the broker URL', async () => {
  const previousBroker = process.env.AUTH_BROKER_URL;
  const originalFetch = global.fetch;
  const calls = [];
  const app = express();
  app.use('/api/auth', router());
  const server = await new Promise((resolve) => {
    const value = app.listen(0, () => resolve(value));
  });

  try {
    process.env.AUTH_BROKER_URL = 'https://broker.example/api/moonbox';
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/auth/web-login/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'login-id', secret: 'secret-value' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'pending' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://broker.example/api/moonbox/web-login/status');
    assert.ok(!calls[0].url.includes('secret'));
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { id: 'login-id', secret: 'secret-value' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    if (previousBroker === undefined) delete process.env.AUTH_BROKER_URL;
    else process.env.AUTH_BROKER_URL = previousBroker;
  }
});
test('auth status exposes an opaque, stable per-user cache scope', async () => {
  const previous = process.env.WEB_SESSION_SECRET;
  process.env.WEB_SESSION_SECRET = 'scope-test-secret';
  const app = express();
  app.use('/api/auth', router());
  const server = await new Promise((resolve) => {
    const value = app.listen(0, () => resolve(value));
  });
  const userA = '3aa6dbfc-a08c-4f27-9b13-96ee1891cb7c';
  const userB = '4bb7ecfd-b19d-4a38-8c24-a7ff2902dc8d';
  const statusFor = async (userId) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/status`, {
      headers: { Cookie: `moonbox_session=${encodeURIComponent(mintSession(userId))}` }
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  try {
    const first = await statusFor(userA);
    const again = await statusFor(userA);
    const other = await statusFor(userB);
    assert.equal(first.enabled, true);
    assert.equal(first.authenticated, true);
    assert.equal(typeof first.scope, 'string');
    assert.ok(first.scope.length > 0);
    assert.ok(!first.scope.includes(userA));
    assert.equal(first.scope, again.scope);
    assert.notEqual(first.scope, other.scope);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WEB_SESSION_SECRET;
    else process.env.WEB_SESSION_SECRET = previous;
  }
});
