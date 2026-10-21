const test = require('node:test');
const assert = require('node:assert/strict');
const { createTencentMapClient } = require('../src/tencent-map');

test('腾讯地点提示会规范化坐标并缓存相同查询', async () => {
  let calls = 0;
  const client = createTencentMapClient({
    key: 'test-key',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.pathname, '/ws/place/v1/suggestion');
      assert.equal(url.searchParams.get('key'), 'test-key');
      assert.equal(url.searchParams.get('keyword'), '栈桥');
      assert.equal(options.headers.Referer, 'https://love.chaotools.tech');
      return {
        ok: true,
        json: async () => ({
          status: 0,
          data: [{ id: 'p1', title: '栈桥景区', address: '青岛市市南区', category: '旅游景点', location: { lat: 36.060231, lng: 120.319859 } }]
        })
      };
    },
    referer: 'https://love.chaotools.tech'
  });
  const first = await client.suggest('栈桥', { region: '青岛' });
  assert.deepEqual(first.places[0], {
    id: 'p1', name: '栈桥景区', address: '青岛市市南区', category: '旅游景点',
    lat: 36.060231, lng: 120.319859, coordSystem: 'gcj02', provider: 'tencent'
  });
  await client.suggest('栈桥', { region: '青岛' });
  assert.equal(calls, 1);
});

test('腾讯逆地址解析返回地址和推荐名称', async () => {
  const client = createTencentMapClient({
    key: 'test-key',
    fetchImpl: async (url) => {
      assert.equal(url.pathname, '/ws/geocoder/v1/');
      assert.equal(url.searchParams.get('location'), '36.06,120.32');
      return {
        ok: true,
        json: async () => ({
          status: 0,
          result: { address: '山东省青岛市市南区', formatted_addresses: { recommend: '栈桥景区' }, location: { lat: 36.0601, lng: 120.3199 } }
        })
      };
    }
  });
  const result = await client.reverse(36.06, 120.32);
  assert.equal(result.name, '栈桥景区');
  assert.equal(result.address, '山东省青岛市市南区');
  assert.equal(result.lat, 36.0601);
  assert.equal(result.lng, 120.3199);
});

test('腾讯配额错误会转换成 429，便于前端提示', async () => {
  const client = createTencentMapClient({
    key: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: 121, message: '每日调用量已达到上限' }) })
  });
  await assert.rejects(() => client.suggest('栈桥'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.tencentStatus, 121);
    assert.match(error.message, /每日调用量/);
    return true;
  });
});

test('未配置 WebService Key 时给出明确错误', async () => {
  const client = createTencentMapClient({ key: '' });
  await assert.rejects(() => client.suggest('栈桥'), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /TENCENT_MAP_WEBSERVICE_KEY/);
    return true;
  });
});