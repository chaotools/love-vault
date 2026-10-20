const test = require('node:test');
const assert = require('node:assert/strict');

const historyPromise = import('../public/js/chat-history.mjs');
const authStatePromise = import('../public/js/auth-state.mjs');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); }
  };
}

test('聊天记录按登录作用域隔离，且能容忍损坏的 localStorage 内容', async () => {
  const { chatHistoryKey, loadChatHistory, saveChatHistory, clearChatHistory } = await historyPromise;
  const storage = memoryStorage();
  saveChatHistory(storage, 'user-a', [{ role: 'user', content: 'A 的秘密' }]);
  saveChatHistory(storage, 'user-b', [{ role: 'user', content: 'B 的秘密' }]);

  assert.notEqual(chatHistoryKey('user-a'), chatHistoryKey('user-b'));
  assert.deepEqual(loadChatHistory(storage, 'user-a'), [{ role: 'user', content: 'A 的秘密' }]);
  assert.deepEqual(loadChatHistory(storage, 'user-b'), [{ role: 'user', content: 'B 的秘密' }]);

  storage.setItem(chatHistoryKey('broken'), '{not-json');
  assert.deepEqual(loadChatHistory(storage, 'broken'), []);

  clearChatHistory(storage, 'user-a');
  assert.deepEqual(loadChatHistory(storage, 'user-a'), []);
});

test('本地模式迁移旧聊天记录；多用户模式删除无法归属的旧记录', async () => {
  const { initializeChatHistoryStorage, loadChatHistory } = await historyPromise;
  const local = memoryStorage();
  local.setItem('vault_chat_history', JSON.stringify([{ role: 'user', content: '旧记录' }]));
  initializeChatHistoryStorage(local, 'local');
  assert.deepEqual(loadChatHistory(local, 'local'), [{ role: 'user', content: '旧记录' }]);
  assert.equal(local.getItem('vault_chat_history'), null);

  const sharedBrowser = memoryStorage();
  sharedBrowser.setItem('vault_chat_history', JSON.stringify([{ role: 'user', content: '上一个人的记录' }]));
  initializeChatHistoryStorage(sharedBrowser, 'opaque-user-scope');
  assert.deepEqual(loadChatHistory(sharedBrowser, 'opaque-user-scope'), []);
  assert.equal(sharedBrowser.getItem('vault_chat_history'), null);
});

test('登录流程只在确认未认证时申请二维码', async () => {
  const { shouldStartWebLogin, authScopeFromStatus } = await authStatePromise;
  assert.equal(shouldStartWebLogin({ enabled: true, authenticated: false }), true);
  assert.equal(shouldStartWebLogin({ enabled: true, authenticated: true, scope: 'abc' }), false);
  assert.equal(shouldStartWebLogin({ enabled: false, authenticated: true, scope: 'local' }), false);
  assert.equal(shouldStartWebLogin(null), false);

  assert.equal(authScopeFromStatus({ authenticated: true, enabled: true, scope: 'abc' }), 'abc');
  assert.equal(authScopeFromStatus({ authenticated: true, enabled: false }), 'local');
  assert.equal(authScopeFromStatus({ authenticated: false }), 'anonymous');
});
