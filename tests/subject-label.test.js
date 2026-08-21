const test = require('node:test');
const assert = require('node:assert/strict');

test('前端主角称呼 helper 对旧配置、空值和超长输入安全回退', async () => {
  const { normalizeSubjectLabel, subjectLabelFromConfig, quickWishSourceFromConfig } = await import('../public/js/subject-label.mjs');
  assert.equal(subjectLabelFromConfig({}), 'TA');
  assert.equal(subjectLabelFromConfig({ subjectName: '  小鹿  ' }), '小鹿');
  assert.equal(subjectLabelFromConfig({ subjectName: '   ' }), 'TA');
  assert.equal(normalizeSubjectLabel('a'.repeat(40)).length, 30);
  assert.equal(quickWishSourceFromConfig({ subjectName: '小鹿' }), '小鹿随口说的');
  assert.equal(quickWishSourceFromConfig({}), 'TA随口说的');
});
