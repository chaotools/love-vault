const test = require('node:test');
const assert = require('node:assert/strict');

test('singleFlight 在上一次异步提交完成前忽略重复触发，并在结束后恢复', async () => {
  const pendingStates = [];
  let calls = 0;
  let complete;
  const work = new Promise((resolve) => { complete = resolve; });
  const submit = (await import('../public/js/single-flight.mjs')).singleFlight(
    async () => { calls++; await work; return 'saved'; },
    (pending) => pendingStates.push(pending)
  );

  const first = submit();
  const second = submit();
  assert.equal(calls, 1);
  assert.equal(await second, undefined);
  complete();
  assert.equal(await first, 'saved');
  assert.deepEqual(pendingStates, [true, false]);

  await submit();
  assert.equal(calls, 2);
});
