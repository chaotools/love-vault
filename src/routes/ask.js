// AI 问答路由：支持大模型工具调用，把用户告诉 AI 的新信息真实写入记忆库
const express = require('express');
const ai = require('../ai');
const { resolveEventDate } = require('../date-resolution');
const { rateLimit } = require('../rate-limit');

const PREF_CATEGORIES = ['吃', '喝', '穿', '用', '玩', '其他'];
const EVENT_TYPES = ['里程碑', '约会', '旅行', '争吵与和解', '承诺', '其他'];
const PEOPLE_GROUPS = ['家人', '朋友', '同事', '其他'];
const WISH_STATUSES = ['想要', '计划', '已实现'];
const GIFT_DIRECTIONS = ['送给TA', 'TA送我'];

// 工具 schema（OpenAI function calling 格式）。category/type/group 等字段
// 由服务端白名单兜底，模型传错时回退默认值而不是报错。
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'addPreference',
      description: '记录TA的一条喜好或雷区（喜欢/不喜欢、吃/喝/穿/用/玩）；同态度同内容已记录时会被拒绝重复写入',
      parameters: {
        type: 'object',
        properties: {
          polarity: { type: 'string', enum: ['喜欢', '不喜欢'], description: '是喜欢还是不喜欢' },
          category: { type: 'string', enum: PREF_CATEGORIES, description: '所属分类' },
          title: { type: 'string', description: '内容，如：杨枝甘露' },
          detail: { type: 'string', description: '细节，如：三分糖去冰' }
        },
        required: ['polarity', 'title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'addEvent',
      description: '记录一件大事（第一次约会、旅行、争吵与和解、承诺等）',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期，ISO 8601，如 2026-08-19 或 2026-08-19T20:30' },
          dateText: { type: 'string', description: '用户原话中的日期片段，必须原样复制（如“今年7月31日”）；用户未提日期时留空' },
          title: { type: 'string', description: '事件标题' },
          type: { type: 'string', enum: EVENT_TYPES, description: '事件类型' },
          description: { type: 'string', description: '详情' },
          location: { type: 'string', description: '地点' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'addWish',
      description: '记录一个愿望（TA想要的东西或想去的地方）；若已记录过同名的，服务端会拒绝重复写入',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '愿望内容' },
          note: { type: 'string', description: '型号/颜色等备注' },
          source: { type: 'string', description: '来源，如：TA随口说的；AI 记录时统一为 AI 对话' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'addPerson',
      description: '记录TA身边的一个新人物（家人/朋友/同事）；同名已存在时会被拒绝重复写入。可选关联到已有的人物（relations）',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '称呼' },
          relation: { type: 'string', description: '与TA的关系，如：妈妈' },
          group: { type: 'string', enum: PEOPLE_GROUPS, description: '分组' },
          howMet: { type: 'string', description: '怎么认识/交集' },
          notes: { type: 'string', description: '备注' },
          relations: {
            type: 'array',
            description: '关联到已有的人物（可选）：每个元素 { toId: 已存在人物的 id, type: 关系如"同事" }',
            items: {
              type: 'object',
              properties: {
                toId: { type: 'string', description: '已有的人物 id' },
                type: { type: 'string', description: '关系类型，如：同事 / 表姐' }
              },
              required: ['toId', 'type']
            }
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'addGift',
      description: '记录一件礼物（送过或想送的）；同礼物同方向已记录时会被拒绝重复写入',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '礼物名' },
          direction: { type: 'string', enum: GIFT_DIRECTIONS, description: '是送给TA还是TA送的' },
          occasion: { type: 'string', description: '场合，如：生日' },
          date: { type: 'string', description: '日期，ISO 8601' },
          note: { type: 'string', description: '备注' }
        },
        required: ['title', 'direction']
      }
    }
  }
];

const inEnum = (v, values, fallback) => (values.includes(v) ? v : fallback);
const normalizeIdentity = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '');
const eventDay = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};
const eventIdentity = (date, title, type) => [eventDay(date), normalizeIdentity(title), type].join('\u0000');

// 执行一次工具调用：返回 { ok, module, title, detail }
// 去重：同一请求内的重复工具调用、以及库中已有的同一事实均拒绝写入。
// 大事记使用“日期（按天）+ 标题 + 类型”识别同一件事，因此同名但不同日期仍可记录。
async function executeTool(name, args, vault, { requestToolCalls, userDateText, now } = {}) {
  args = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const sanitize = (v) => (typeof v === 'string' ? v.trim().slice(0, 2000) : '');
  const fail = (detail) => ({ ok: false, module: '', title: '', detail });
  const dup = (module, title, requestDuplicate = false) => ({ ok: false, module, title, detail: '已存在，未重复写入', requestDuplicate });
  // 创建方式独立于 source：source 表示信息来自哪里，createdBy 表示谁写入了该记录。
  const AI_CREATED_BY = 'ai';

  const list = (col) => col.list();
  const repeatedInRequest = (key, module, title) => {
    if (!requestToolCalls) return null;
    if (requestToolCalls.has(key)) return dup(module, title, true);
    requestToolCalls.add(key);
    return null;
  };

  switch (name) {
    case 'addPreference': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少偏好内容');
      const polarity = inEnum(args.polarity, ['喜欢', '不喜欢'], '喜欢');
      const repeated = repeatedInRequest(`preference:${polarity}:${normalizeIdentity(title)}`, 'preferences', title);
      if (repeated) return repeated;
      if (list(vault.preferences).some((p) => p.title === title && p.polarity === polarity)) {
        return dup('preferences', title);
      }
      const item = await vault.preferences.add({
        polarity,
        category: inEnum(args.category, PREF_CATEGORIES, '其他'),
        title,
        detail: sanitize(args.detail),
        createdBy: AI_CREATED_BY
      });
      return { ok: true, module: 'preferences', title: item.title, detail: `${item.polarity} · ${item.category}` };
    }
    case 'addEvent': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少事件标题');
      // 正常路由会传入 userDateText；直接调用本函数的旧调用方保留 ISO 日期兼容。
      const resolution = typeof userDateText === 'string'
        ? resolveEventDate({ dateText: sanitize(args.dateText), userText: userDateText, now })
        : null;
      if (resolution && !resolution.ok) return fail(resolution.error);
      let legacyDate = null;
      if (!resolution && args.date) { const d = new Date(args.date); if (!isNaN(d.getTime())) legacyDate = d.toISOString(); }
      const eventDate = resolution ? `${resolution.date}T00:00:00.000Z` : (legacyDate || new Date().toISOString());
      const type = inEnum(args.type, EVENT_TYPES, '其他');
      const identity = eventIdentity(eventDate, title, type);
      const repeated = repeatedInRequest(`event:${identity}`, 'events', title);
      if (repeated) return repeated;
      if (list(vault.events).some((event) => eventIdentity(event.date, event.title, inEnum(event.type, EVENT_TYPES, '其他')) === identity)) {
        return dup('events', title);
      }
      const item = await vault.events.add({
        date: eventDate,
        title,
        type,
        description: sanitize(args.description),
        location: sanitize(args.location),
        dateSource: resolution ? resolution.source : 'legacy_model_date',
        dateText: resolution ? resolution.dateText : '',
        createdBy: AI_CREATED_BY
      });
      return { ok: true, module: 'events', title: item.title, detail: item.type, date: item.date.slice(0, 10) };
    }
    case 'addWish': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少愿望内容');
      const repeated = repeatedInRequest(`wish:${normalizeIdentity(title)}`, 'wishes', title);
      if (repeated) return repeated;
      if (list(vault.wishes).some((w) => w.title === title)) return dup('wishes', title);
      const item = await vault.wishes.add({
        title,
        note: sanitize(args.note),
        // source 仅记录事实的来源（如“TA 随口说的”），不承担创建方式标记。
        source: sanitize(args.source),
        status: '想要',
        priority: '中',
        createdBy: AI_CREATED_BY
      });
      return { ok: true, module: 'wishes', title: item.title, detail: '想要' };
    }
    case 'addPerson': {
      const personName = sanitize(args.name);
      if (!personName) return fail('缺少人物称呼');
      const repeated = repeatedInRequest(`person:${normalizeIdentity(personName)}`, 'people', personName);
      if (repeated) return repeated;
      if (list(vault.people).some((p) => p.name === personName)) return dup('people', personName);
      // 关联已有的人物（relations）：校验 toId 存在
      let relations = [];
      if (Array.isArray(args.relations)) {
        const validIds = new Set(list(vault.people).map((p) => p.id));
        const seen = new Set();
        for (const r of args.relations) {
          if (!r || typeof r !== 'object') continue;
          const toId = sanitize(r.toId);
          const type = sanitize(r.type);
          if (!validIds.has(toId) || !type) continue;
          const key = toId + '\u0000' + type;
          if (seen.has(key)) continue;
          seen.add(key);
          relations.push({ toId, type });
        }
      }
      const item = await vault.people.add({
        name: personName,
        relation: sanitize(args.relation),
        group: inEnum(args.group, PEOPLE_GROUPS, '其他'),
        howMet: sanitize(args.howMet),
        notes: sanitize(args.notes),
        relations,
        createdBy: AI_CREATED_BY
      });
      return { ok: true, module: 'people', title: item.name, detail: item.group };
    }
    case 'addGift': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少礼物名称');
      const direction = inEnum(args.direction, GIFT_DIRECTIONS, '送给TA');
      const repeated = repeatedInRequest(`gift:${direction}:${normalizeIdentity(title)}`, 'gifts', title);
      if (repeated) return repeated;
      if (list(vault.gifts).some((g) => g.title === title && g.direction === direction)) return dup('gifts', title);
      let date = null;
      if (args.date) { const d = new Date(args.date); if (!isNaN(d.getTime())) date = d.toISOString(); }
      const item = await vault.gifts.add({
        title,
        direction,
        occasion: sanitize(args.occasion),
        date,
        note: sanitize(args.note),
        createdBy: AI_CREATED_BY
      });
      return { ok: true, module: 'gifts', title: item.title, detail: item.direction };
    }
    default:
      return { ok: false, module: '', title: '', detail: `未知工具: ${name}` };
  }
}

function askRouter(configStore, getData) {
  const r = express.Router();
  const resolveConfigStore = (req) => typeof configStore === 'function' ? configStore(req) : configStore;
  const resolveData = (req) => typeof getData === 'function' ? getData(req) : getData;
  // attachVault 中间件把当前请求的完整保险库挂在 req.vault 上
  const resolveVault = (req) => req.vault;

  // 前端探测 AI 是否可用（决定是否显示入口）
  r.get('/status', (req, res) => {
    const resolved = ai.resolveConfig(resolveConfigStore(req).data);
    res.json({
      configured: ai.isConfigured(resolved),
      provider: resolved.providerName,
      model: resolved.model,
      fromEnv: Boolean(process.env.AI_API_KEY)
    });
  });

  r.post('/', rateLimit({ windowMs: 10 * 60_000, max: 12, name: 'AI 问答' }), async (req, res) => {
    const written = [];
    try {
      const vault = resolveVault(req);
      const resolved = ai.resolveConfig(vault ? vault.config.data : resolveConfigStore(req).data);
      const messages = (req.body && req.body.messages) || [];
      if (!Array.isArray(messages) || !messages.length || messages.length > 40) {
        return res.status(400).json({ error: '消息格式不对' });
      }
      const clean = messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!clean.length) return res.status(400).json({ error: '消息内容为空' });
      if (!clean.some((message) => message.role === 'user')) return res.status(400).json({ error: '至少需要一条用户消息' });

      const requestToolCalls = new Set();
      const latestUser = [...clean].reverse().find((message) => message.role === 'user');
      const requestNow = new Date();
      const answered = await ai.chatCompletionWithTools(
        resolved,
        ai.buildBaseMessages(resolveData(req), clean, { now: requestNow }),
        TOOLS,
        async (name, args) => {
          const result = await executeTool(name, args, vault, { requestToolCalls, userDateText: latestUser.content, now: requestNow });
          // 成功与去重拒绝都记入 written（带 ok 标记），供前端区分展示；
          // 其他失败（缺参等）只回填给模型，不进 written
          if (result.ok) written.push(result);
          else if (result.detail === '已存在，未重复写入' && !result.requestDuplicate) written.push(result);
          return result.ok ? JSON.stringify({ ok: true, saved: result.title, module: result.module }) : JSON.stringify({ ok: false, error: result.detail });
        }
      );

      const savedDates = written.filter((entry) => entry.ok && entry.date).map((entry) => `已记为：${entry.date}`);
      res.json({
        answer: [answered.content || '好的，已经记下来了。', ...savedDates].join('\n\n'),
        written
      });
    } catch (e) {
      const saved = written.filter((entry) => entry.ok);
      // 工具调用已经成功落库时，不应因为模型最后的确认文字缺失而误导用户“整次失败”。
      if (saved.length) {
        return res.json({
          answer: `已成功记下 ${saved.length} 条记录，但 AI 暂时没能生成确认回复。`,
          written,
          warning: 'AI_CONFIRMATION_UNAVAILABLE'
        });
      }
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // 测试连接（需要已登录；Key 走 env 或 config）
  r.post('/test', async (req, res) => {
    try {
      const resolved = ai.resolveConfig(resolveConfigStore(req).data);
      const reply = await ai.testConnection(resolved);
      res.json({ ok: true, reply, provider: resolved.providerName, model: resolved.model });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  return r;
}

module.exports = { askRouter, TOOLS, executeTool };
