const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('events');

test('地图状态接口只向浏览器暴露 JS Key，不暴露 WebService Key', async () => {
  const previous = { js: process.env.TENCENT_MAP_JS_KEY, web: process.env.TENCENT_MAP_WEBSERVICE_KEY };
  process.env.TENCENT_MAP_JS_KEY = 'js-public-key';
  process.env.TENCENT_MAP_WEBSERVICE_KEY = 'web-service-secret';
  const { geoRouter } = require('../src/routes/geo');
  const app = express();
  app.use('/api/geo', geoRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/geo/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      provider: 'tencent', configured: true, suggest: true, reverse: true, mapKey: 'js-public-key'
    });
    assert.equal(JSON.stringify(body).includes('web-service-secret'), false);
  } finally {
    server.close();
    await once(server, 'close');
    if (previous.js === undefined) delete process.env.TENCENT_MAP_JS_KEY; else process.env.TENCENT_MAP_JS_KEY = previous.js;
    if (previous.web === undefined) delete process.env.TENCENT_MAP_WEBSERVICE_KEY; else process.env.TENCENT_MAP_WEBSERVICE_KEY = previous.web;
  }
});