// AI 工具调用测试：记录工具真正落库 + 工具循环驱动 + 未知工具防护
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const { Collection } = require('../src/store');
const { executeTool, TOOLS } = require('../src/routes/ask');
const { chatCompletionWithTools } = require('../src/ai');

// 用一个临时目录构造最小 vault（只含 5 个记录集合）
async function makeVault() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ask-tool-test-'));
  const vault = {};
  for (const name of ['preferences', 'events', 'wishes', 'people', 'gifts']) {
    const col = new Collection(path.join(root, name + '.json'));
    await col.load();
    vault[name] = col;
  }
  return { root, vault };
}

test('TOOLS 定义了 5 个记录工具，schema 完整', () => {
  assert.equal(TOOLS.length, 5);
  const names = TOOLS.map((t) => t.function.name);
  assert.deepEqual(names, ['addPreference', 'addEvent', 'addWish', 'addPerson', 'addGift']);
  for (const t of TOOLS) {
    assert.equal(t.type, 'function');
    assert.ok(t.function.parameters.required.length >= 1);
  }
});

test('addPreference：模型传参落库，非法枚举回退默认值', async () => {
  const { root, vault } = await makeVault();
  try {
    // 合法：喜欢/吃/杨枝甘露/三分糖
    const r1 = await executeTool('addPreference', { polarity: '喜欢', category: '吃', title: '杨枝甘露', detail: '三分糖去冰' }, vault);
    assert.equal(r1.ok, true);
    assert.equal(r1.module, 'preferences');
    // 非法 category → 回退"其他"；非法 polarity → 回退"喜欢"
    const r2 = await executeTool('addPreference', { polarity: '随便', category: '不存在的分类', title: '深紫色' }, vault);
    assert.equal(r2.ok, true);
    const prefs = vault.preferences.list();
    assert.equal(prefs.length, 2);
    assert.equal(prefs[0].title, '杨枝甘露');
    assert.equal(prefs[0].detail, '三分糖去冰');
    assert.equal(prefs[1].category, '其他');
    assert.equal(prefs[1].polarity, '喜欢');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('addEvent：无日期用当前时间，非法类型回退，落库持久化', async () => {
  const { root, vault } = await makeVault();
  try {
    const before = Date.now();
    const r = await executeTool('addEvent', { title: '一起看海', type: '旅行', location: '青岛', date: '2026-08-19' }, vault);
    assert.equal(r.ok, true);
    assert.equal(r.module, 'events');
    const ev = vault.events.list()[0];
    assert.equal(ev.title, '一起看海');
    assert.equal(ev.type, '旅行');
    assert.equal(ev.location, '青岛');
    assert.equal(ev.date.slice(0, 10), '2026-08-19');
    // 无日期 → 现在
    await executeTool('addEvent', { title: '没日期的', type: '火星' }, vault);
    const ev2 = vault.events.list()[1];
    assert.equal(ev2.type, '其他');
    assert.ok(new Date(ev2.date).getTime() >= before);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('addWish / addPerson / addGift 默认值正确', async () => {
  const { root, vault } = await makeVault();
  try {
    await executeTool('addWish', { title: '胶片相机', note: '佳能 AE-1', source: 'TA随口说的' }, vault);
    const w = vault.wishes.list()[0];
    assert.equal(w.status, '想要');
    assert.equal(w.priority, '中');
    assert.equal(w.source, 'TA随口说的');

    await executeTool('addPerson', { name: '李阿姨', relation: '妈妈', group: '火星' }, vault);
    const p = vault.people.list()[0];
    assert.equal(p.group, '其他');
    assert.equal(p.relation, '妈妈');

    await executeTool('addGift', { title: '羊毛围巾', direction: '搞错方向' }, vault);
    const g = vault.gifts.list()[0];
    assert.equal(g.direction, '送给TA');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('chatCompletionWithTools：模型调两次工具后总结，工具结果回填给模型', async () => {
  // 用假实现模拟"模型第一轮调用 addWish + addPerson，第二轮纯文本总结"
  const calls = [];
  const fakeChat = async (resolved, messages, opts) => {
    calls.push(messages.map((m) => m.role).join(','));
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const hasToolResult = messages.some((m) => m.role === 'tool');
    if (hasToolResult) {
      // 第二轮：模型看到工具结果后纯文本总结
      return { content: '都记好了！', toolCalls: [] };
    }
    return {
      content: '',
      toolCalls: [
        { id: 'call-1', name: 'addWish', arguments: { title: '拍立得' } },
        { id: 'call-2', name: 'addPerson', arguments: { name: '小王' } }
      ],
      assistantMessage: { role: 'assistant', content: null, tool_calls: [] }
    };
  };
  const executed = [];
  const result = await chatCompletionWithTools(
    {},
    [{ role: 'user', content: '记一下' }],
    [{ type: 'function', function: { name: 'addWish' } }, { type: 'function', function: { name: 'addPerson' } }],
    async (name, args) => { executed.push(name); return 'ok'; },
    fakeChat
  );
  assert.equal(result.content, '都记好了！');
  assert.deepEqual(executed, ['addWish', 'addPerson']);
  // 第二轮消息应包含 tool 角色（工具结果回填）
  assert.ok(calls[1].includes('tool'));
});

test('chatCompletionWithTools：未知工具被标记失败并跳过，不会执行', async () => {
  const executed = [];
  const fakeChat = async () => ({
    content: '',
    toolCalls: [
      { id: 'bad', name: 'dropDatabase', arguments: {} },
      { id: 'good', name: 'addWish', arguments: { title: 'X' } }
    ],
    assistantMessage: { role: 'assistant', content: null, tool_calls: [] }
  });
  // 第二轮返回纯文本结束
  const fakeChat2 = async () => ({ content: '好了', toolCalls: [] });
  let n = 0;
  const fake = async (...a) => (++n === 1 ? fakeChat(...a) : fakeChat2(...a));
  const result = await chatCompletionWithTools(
    {}, [{ role: 'user', content: 'hi' }],
    [{ type: 'function', function: { name: 'addWish' } }],
    async (name, args) => { executed.push(name); return 'ok'; },
    fake
  );
  assert.equal(result.content, '好了');
  // 只有白名单内的工具被真正执行
  assert.deepEqual(executed, ['addWish']);
});