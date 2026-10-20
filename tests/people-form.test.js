const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('人名编辑弹窗包含称呼输入框，并在保存时提交 name 字段', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/views/people.js'), 'utf8');
  assert.match(source, /field\('称呼', name\)/, '弹窗必须渲染称呼输入框');
  assert.match(source, /name:\s*name\.value\.trim\(\)/, '保存请求必须提交输入框中的称呼');
});