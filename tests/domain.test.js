const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../src/domain');
const providers = require('../public/js/ai-providers.json');

test('服务端领域枚举集中维护', () => {
  assert.ok(domain.EVENT_TYPES.includes('旅行'));
  assert.deepEqual(domain.WISH_STATUSES, ['想要', '计划', '已实现']);
  assert.deepEqual(domain.PREF_POLARITIES, ['喜欢', '不喜欢']);
  assert.deepEqual(domain.PEOPLE_GROUPS, ['家人', '朋友', '同事', '其他']);
});

test('AI 供应商配置前后端共用同一份 JSON', () => {
  const ai = require('../src/ai');
  assert.deepEqual(ai.PROVIDERS, providers);
  assert.equal(ai.PROVIDERS.custom.name, providers.custom.name);
});