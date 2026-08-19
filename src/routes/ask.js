// AI 问答路由：支持大模型工具调用，把用户告诉 AI 的新信息真实写入记忆库
const express = require('express');
const ai = require('../ai');

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
      description: '记录TA身边的一个新人物（家人/朋友/同事）；同名已存在时会被拒绝重复写入',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '称呼' },
          relation: { type: 'string', description: '与TA的关系，如：妈妈' },
          group: { type: 'string', enum: PEOPLE_GROUPS, description: '分组' },
          howMet: { type: 'string', description: '怎么认识/交集' },
          notes: { type: 'string', description: '备注' }
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

// 执行一次工具调用：返回 { ok, module, title, detail }
// 去重：偏好/愿望/人名/礼物在写入前按关键字段查重，已存在则拒绝（不产生重复记录）；
// 大事记允许同名不同日期，不查重。
async function executeTool(name, args, vault) {
  args = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const sanitize = (v) => (typeof v === 'string' ? v.trim().slice(0, 2000) : '');
  const fail = (detail) => ({ ok: false, module: '', title: '', detail });
  const dup = (module, title) => ({ ok: false, module, title, detail: '已存在，未重复写入' });
  // 写入来源标记：AI 对话写入的记录可被识别，便于用户区分手记与 AI 记
  const AI_SOURCE = 'AI 对话';

  const list = (col) => col.list();

  switch (name) {
    case 'addPreference': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少偏好内容');
      const polarity = inEnum(args.polarity, ['喜欢', '不喜欢'], '喜欢');
      if (list(vault.preferences).some((p) => p.title === title && p.polarity === polarity)) {
        return dup('preferences', title);
      }
      const item = await vault.preferences.add({
        polarity,
        category: inEnum(args.category, PREF_CATEGORIES, '其他'),
        title,
        detail: sanitize(args.detail),
        source: AI_SOURCE
      });
      return { ok: true, module: 'preferences', title: item.title, detail: `${item.polarity} · ${item.category}` };
    }
    case 'addEvent': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少事件标题');
      let date = null;
      if (args.date) { const d = new Date(args.date); if (!isNaN(d.getTime())) date = d.toISOString(); }
      const item = await vault.events.add({
        date: date || new Date().toISOString(),
        title,
        type: inEnum(args.type, EVENT_TYPES, '其他'),
        description: sanitize(args.description),
        location: sanitize(args.location)
      });
      return { ok: true, module: 'events', title: item.title, detail: item.type };
    }
    case 'addWish': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少愿望内容');
      if (list(vault.wishes).some((w) => w.title === title)) return dup('wishes', title);
      const item = await vault.wishes.add({
        title,
        note: sanitize(args.note),
        // 模型/用户若提供了来源（如"TA随口说的"）则保留；没提供才标 AI 对话
        source: sanitize(args.source) || AI_SOURCE,
        status: '想要',
        priority: '中'
      });
      return { ok: true, module: 'wishes', title: item.title, detail: '想要' };
    }
    case 'addPerson': {
      const personName = sanitize(args.name);
      if (!personName) return fail('缺少人物称呼');
      if (list(vault.people).some((p) => p.name === personName)) return dup('people', personName);
      const item = await vault.people.add({
        name: personName,
        relation: sanitize(args.relation),
        group: inEnum(args.group, PEOPLE_GROUPS, '其他'),
        howMet: sanitize(args.howMet),
        notes: sanitize(args.notes),
        source: AI_SOURCE
      });
      return { ok: true, module: 'people', title: item.name, detail: item.group };
    }
    case 'addGift': {
      const title = sanitize(args.title);
      if (!title) return fail('缺少礼物名称');
      const direction = inEnum(args.direction, GIFT_DIRECTIONS, '送给TA');
      if (list(vault.gifts).some((g) => g.title === title && g.direction === direction)) return dup('gifts', title);
      let date = null;
      if (args.date) { const d = new Date(args.date); if (!isNaN(d.getTime())) date = d.toISOString(); }
      const item = await vault.gifts.add({
        title,
        direction,
        occasion: sanitize(args.occasion),
        date,
        note: sanitize(args.note),
        source: AI_SOURCE
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

  r.post('/', async (req, res) => {
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

      const written = [];
      const answered = await ai.chatCompletionWithTools(
        resolved,
        ai.buildBaseMessages(resolveData(req), clean),
        TOOLS,
        async (name, args) => {
          const result = await executeTool(name, args, vault);
          // 成功与去重拒绝都记入 written（带 ok 标记），供前端区分展示；
          // 其他失败（缺参等）只回填给模型，不进 written
          if (result.ok) written.push(result);
          else if (result.detail === '已存在，未重复写入') written.push(result);
          return result.ok ? JSON.stringify({ ok: true, saved: result.title, module: result.module }) : JSON.stringify({ ok: false, error: result.detail });
        }
      );

      res.json({
        answer: answered.content || '好的，已经记下来了。',
        written
      });
    } catch (e) {
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
