const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('focus trap cycles forward, backward and recovers from outside focus', async () => {
  const { nextFocusIndex } = await import('../public/js/focus-trap.mjs');
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 2, false), 0);
  assert.equal(nextFocusIndex(3, 0, true), 2);
  assert.equal(nextFocusIndex(3, 2, true), 1);
  assert.equal(nextFocusIndex(3, -1, false), 0);
  assert.equal(nextFocusIndex(3, -1, true), 2);
  assert.equal(nextFocusIndex(0, 0, false), -1);
});

test('modal and global search include accessibility wiring', () => {
  const core = fs.readFileSync(path.join(__dirname, '../public/js/core.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(core, /role: 'dialog'/);
  assert.match(core, /'aria-modal': 'true'/);
  assert.match(core, /event\.key === 'Escape'/);
  assert.match(core, /nextFocusIndex/);
  assert.match(app, /setAttribute\('aria-current', 'page'\)/);
  assert.match(app, /role: 'button', tabindex: '0'/);
  assert.match(html, /class="skip-link"/);
  assert.match(app, /skipLink\.addEventListener\('click'/);
});
