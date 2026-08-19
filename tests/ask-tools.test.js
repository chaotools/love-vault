// AI 工具调用测试：记录工具真正落库 + 工具循环驱动 + 未知工具防护
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const express = require('express');
const { Collection } = require('../src/store');
const ai = require('../src/ai');
const { askRouter, executeTool, TOOLS } = require('../src/routes/ask');
const { chatCompletionWithTools } = ai;

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

test('去重：同内容重复记录被拒绝，不产生重复数据', async () => {
  const { root, vault } = await makeVault();
  try {
    const r1 = await executeTool('addPreference', { polarity: '喜欢', category: '吃', title: '杨枝甘露', detail: '三分糖' }, vault);
    const r2 = await executeTool('addPreference', { polarity: '喜欢', category: '吃', title: '杨枝甘露', detail: '三分糖' }, vault);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, false);
    assert.match(r2.detail, /已存在/);
    assert.equal(vault.preferences.list().length, 1);

    await executeTool('addWish', { title: '胶片相机' }, vault);
    const dupWish = await executeTool('addWish', { title: '胶片相机' }, vault);
    assert.equal(dupWish.ok, false);
    assert.equal(vault.wishes.list().length, 1);

    await executeTool('addGift', { title: '围巾', direction: '送给TA' }, vault);
    const dupGift = await executeTool('addGift', { title: '围巾', direction: '送给TA' }, vault);
    assert.equal(dupGift.ok, false);
    assert.equal(vault.gifts.list().length, 1);
    // 同礼物不同方向不算重复
    const otherDir = await executeTool('addGift', { title: '围巾', direction: 'TA送我' }, vault);
    assert.equal(otherDir.ok, true);
    assert.equal(vault.gifts.list().length, 2);

    await executeTool('addPerson', { name: '李阿姨' }, vault);
    const dupPerson = await executeTool('addPerson', { name: '李阿姨' }, vault);
    assert.equal(dupPerson.ok, false);
    assert.equal(vault.people.list().length, 1);

    // 大事记允许同名不同日期，但同一天、同标题、同类型是同一事实；
    // 模型即使带着不同详情重试，也不能重复落库。
    await executeTool('addEvent', { date: '2024-07-31', title: '拿到驾驶证', type: '里程碑', description: '第一次记录' }, vault);
    const dupEvent = await executeTool('addEvent', { date: '2024-07-31T12:00:00+08:00', title: '拿到驾驶证', type: '里程碑', description: '模型重试时补充的详情' }, vault);
    assert.equal(dupEvent.ok, false);
    assert.equal(vault.events.list().length, 1);
    const anotherDay = await executeTool('addEvent', { date: '2025-07-31', title: '拿到驾驶证', type: '里程碑' }, vault);
    assert.equal(anotherDay.ok, true);
    assert.equal(vault.events.list().length, 2);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('同一次 AI 请求重复调用同一大事记只写入一次', async () => {
  const { root, vault } = await makeVault();
  try {
    const requestToolCalls = new Set();
    const args = { date: '2024-07-31', title: '拿到驾驶证', type: '里程碑', description: '成功考取驾驶证' };
    const first = await executeTool('addEvent', args, vault, { requestToolCalls });
    const repeated = await executeTool('addEvent', { ...args, description: '' }, vault, { requestToolCalls });
    assert.equal(first.ok, true);
    assert.equal(repeated.ok, false);
    assert.match(repeated.detail, /已存在/);
    assert.equal(vault.events.list().length, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('溯源：AI 写入的条目用 createdBy 标记，source 仍保留事实来源', async () => {
  const { root, vault } = await makeVault();
  try {
    // 用与其他测试不同的标题，避免去重拦截导致断言落空
    await executeTool('addPreference', { polarity: '不喜欢', title: '香菜' }, vault);
    await executeTool('addPerson', { name: '溯源同学' }, vault);
    await executeTool('addGift', { title: '溯源香水', direction: '送给TA' }, vault);
    await executeTool('addWish', { title: '溯源露营', source: 'TA 随口说的' }, vault);
    await executeTool('addEvent', { title: '溯源约会' }, vault);
    assert.equal(vault.preferences.list()[0].createdBy, 'ai');
    assert.equal(vault.people.list()[0].createdBy, 'ai');
    assert.equal(vault.gifts.list()[0].createdBy, 'ai');
    assert.equal(vault.wishes.list()[0].createdBy, 'ai');
    assert.equal(vault.events.list()[0].createdBy, 'ai');
    assert.equal(vault.wishes.list()[0].source, 'TA 随口说的');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('缺少必填内容或工具参数不是对象时拒绝写入', async () => {
  const { root, vault } = await makeVault();
  try {
    const empty = await executeTool('addPreference', { polarity: '喜欢' }, vault);
    const malformed = await executeTool('addPerson', null, vault);
    assert.equal(empty.ok, false);
    assert.equal(malformed.ok, false);
    assert.equal(vault.preferences.list().length, 0);
    assert.equal(vault.people.list().length, 0);
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

test('chatCompletionWithTools：不支持工具的供应商降级为纯文本问答', async () => {
  const unsupported = async () => {
    const err = new Error('tools unsupported');
    err.providerStatus = 400;
    throw err;
  };
  const plain = async () => '纯文本回答';
  const result = await chatCompletionWithTools(
    {}, [{ role: 'user', content: '你好' }], TOOLS, async () => '不应执行', unsupported, plain
  );
  assert.equal(result.content, '纯文本回答');
  assert.deepEqual(result.toolCalls, []);
});

test('chatCompletionWithTools：单轮工具调用过多时不执行写入', async () => {
  const tooManyCalls = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: 'addWish', arguments: { title: String(i) } }));
  const reply = await chatCompletionWithTools(
    {}, [{ role: 'user', content: '记一下' }], TOOLS,
    async () => { throw new Error('不应执行'); },
    async () => ({ content: '', toolCalls: tooManyCalls, assistantMessage: { role: 'assistant', tool_calls: [] } })
  );
  assert.match(reply.content, /最多 8 项/);
});

test('chatCompletionWithTools：跨轮工具调用总数超过 8 时不执行超额写入', async () => {
  let round = 0;
  const executed = [];
  const reply = await chatCompletionWithTools(
    {}, [{ role: 'user', content: '记一下' }], TOOLS,
    async (name) => { executed.push(name); return 'ok'; },
    async () => {
      round++;
      const toolCalls = Array.from({ length: 5 }, (_, index) => ({ id: `${round}-${index}`, name: 'addWish', arguments: { title: `${round}-${index}` } }));
      return { content: '', toolCalls, assistantMessage: { role: 'assistant', tool_calls: [] } };
    }
  );
  assert.match(reply.content, /最多 8 项/);
  assert.equal(executed.length, 5);
});

test('AI 空响应自动重试一次', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => ({
    ok: true,
    json: async () => {
      calls++;
      return calls === 1
        ? { choices: [] }
        : { choices: [{ message: { content: '重试成功' } }] };
    }
  });
  try {
    const reply = await ai.chatCompletion(
      { baseUrl: 'https://ai.example', apiKey: 'test-key', model: 'test-model' },
      [{ role: 'user', content: '你好' }]
    );
    assert.equal(reply, '重试成功');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('AI 写入成功后确认回复为空时仍返回已保存结果', async () => {
  const { root, vault } = await makeVault();
  vault.config = { data: { ai: { provider: 'custom', baseUrl: 'https://ai.example', apiKey: 'test-key', model: 'test-model' } } };
  const original = ai.chatCompletionWithTools;
  const app = express();
  const data = { config: vault.config.data, profile: {}, preferences: [], people: [], events: [], wishes: [], gifts: [], memories: [] };
  app.use(express.json());
  app.use((req, res, next) => { req.vault = vault; next(); });
  app.use('/', askRouter(vault.config, () => data));
  const server = await new Promise((resolve) => {
    const value = app.listen(0, () => resolve(value));
  });
  try {
    ai.chatCompletionWithTools = async (resolved, messages, tools, execute) => {
      await execute('addEvent', { date: '2024-07-31', title: '拿到驾驶证', type: '里程碑' });
      throw new Error('AI 返回内容为空');
    };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '记下拿到驾驶证' }] })
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.match(body.answer, /已成功记下 1 条记录/);
    assert.equal(body.written.length, 1);
    assert.equal(vault.events.list().length, 1);
  } finally {
    ai.chatCompletionWithTools = original;
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('测试连接路由使用当前配置存储', async () => {
  const original = ai.testConnection;
  const app = express();
  app.use(express.json());
  app.use('/', askRouter({ data: { ai: { provider: 'custom', baseUrl: 'https://ai.example', apiKey: 'test-key', model: 'test-model' } } }, () => ({})));
  const server = await new Promise((resolve) => {
    const value = app.listen(0, () => resolve(value));
  });
  try {
    ai.testConnection = async (resolved) => {
      assert.equal(resolved.model, 'test-model');
      return '连接成功';
    };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/test`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, '连接成功');
  } finally {
    ai.testConnection = original;
    await new Promise((resolve) => server.close(resolve));
  }
});
