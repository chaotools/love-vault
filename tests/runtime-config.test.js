const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_HOST, resolveHost, isLoopbackHost, shouldWarnUnauthExposure } = require('../src/runtime-config');

test('HOST 默认只绑定回环地址，显式配置仍可开放监听', () => {
  assert.equal(DEFAULT_HOST, '127.0.0.1');
  assert.equal(resolveHost(undefined), '127.0.0.1');
  assert.equal(resolveHost(''), '127.0.0.1');
  assert.equal(resolveHost('  '), '127.0.0.1');
  assert.equal(resolveHost('0.0.0.0'), '0.0.0.0');
  assert.equal(resolveHost('192.168.1.10'), '192.168.1.10');
});

test('无认证本地模式绑定非回环地址时给出暴露警告', () => {
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);

  assert.equal(shouldWarnUnauthExposure('127.0.0.1', false), false);
  assert.equal(shouldWarnUnauthExposure('localhost', false), false);
  assert.equal(shouldWarnUnauthExposure('0.0.0.0', false), true);
  assert.equal(shouldWarnUnauthExposure('0.0.0.0', true), false);
});
