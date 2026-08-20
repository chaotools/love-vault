const test = require('node:test');
const assert = require('node:assert/strict');

const layoutPromise = import('../public/js/relation-layout.mjs');

test('双圈放射布局在手机画布内保留节点与标签安全边距', async () => {
  const { radialRingRadii } = await layoutPromise;
  const layout = radialRingRadii(320, 400, 3, 2);
  assert.equal(layout.maxRadius, 112);
  assert.ok(layout.directRadius > 0);
  assert.ok(layout.directRadius < layout.extendedRadius);
  assert.ok(layout.extendedRadius <= layout.maxRadius);
  assert.ok(layout.extendedRadius + 48 <= 320 / 2);
});

test('单圈和空数据不会生成超出画布的半径', async () => {
  const { radialRingRadii } = await layoutPromise;
  const directOnly = radialRingRadii(768, 400, 8, 0);
  assert.ok(directOnly.directRadius <= directOnly.maxRadius);
  assert.equal(directOnly.extendedRadius, 0);
  const empty = radialRingRadii(320, 400, 0, 0);
  assert.deepEqual(empty, { directRadius: 0, extendedRadius: 0, maxRadius: 112 });
});
