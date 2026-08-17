// 大模型调用：所有供应商统一走 OpenAI 兼容 Chat Completions 协议
// 优先级：环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL > config.json 里的 ai 配置
const PROVIDERS = {
  zhipu:    { name: '智谱 GLM',   baseUrl: 'https://open.bigmodel.cn/api/paas/v4',            models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'] },
  openai:   { name: 'OpenAI',     baseUrl: 'https://api.openai.com/v1',                        models: ['gpt-4o-mini', 'gpt-4o'] },
  deepseek: { name: 'DeepSeek',   baseUrl: 'https://api.deepseek.com',                         models: ['deepseek-chat', 'deepseek-reasoner'] },
  moonshot: { name: 'Kimi 月之暗面', baseUrl: 'https://api.moonshot.cn/v1',                    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  qwen:     { name: '通义千问',    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  custom:   { name: '自定义（任意 OpenAI 兼容接口）', baseUrl: '', models: [] }
};

// 解析出实际生效的 AI 配置
function resolveConfig(config) {
  const ai = (config && config.ai) || {};
  const provider = ai.provider || 'zhipu';
  const preset = PROVIDERS[provider] || PROVIDERS.custom;
  return {
    provider,
    providerName: preset.name,
    baseUrl: (process.env.AI_BASE_URL || ai.baseUrl || preset.baseUrl || '').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || ai.apiKey || '',
    model: process.env.AI_MODEL || ai.model || (preset.models && preset.models[0]) || ''
  };
}

const isConfigured = (resolved) => Boolean(resolved.baseUrl && resolved.apiKey && resolved.model);

// 底层请求：messages 为 OpenAI 格式 [{role, content}]
async function chatCompletion(resolved, messages, { temperature = 0.7, timeoutMs = 90000 } = {}) {
  if (!isConfigured(resolved)) {
    const err = new Error('AI 未配置：请在设置里选择供应商并填写 API Key');
    err.status = 503;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(resolved.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + resolved.apiKey },
      body: JSON.stringify({ model: resolved.model, messages, temperature }),
      signal: controller.signal
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error((data.error && data.error.message) || ('AI 接口返回 ' + resp.status));
      err.status = 502;
      throw err;
    }
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) { const err = new Error('AI 返回内容为空'); err.status = 502; throw err; }
    return content;
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('AI 请求超时'); err.status = 504; throw err; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 把整个记忆库打包成给 AI 的上下文
function buildDataContext({ config, profile, preferences, people, events, wishes, gifts, memories }) {
  const parts = [];
  const push = (title, obj) => parts.push('## ' + title + '\n' + JSON.stringify(obj, null, 1));

  const cfg = {
    标题: config.title, 我们: config.names, 在一起的日子: config.anniversary,
    纪念日: config.memorialDays
  };
  push('基本配置', cfg);
  push('TA的档案（含健康/尺码/生理期）', profile || {});
  push('喜好与雷区', (preferences || []).map((p) => ({ 类型: p.polarity, 分类: p.category, 内容: p.title, 详情: p.detail || '' })));
  push('TA身边的人', (people || []).map((p) => ({ 姓名: p.name, 关系: p.relation, 分组: p.group, 生日: p.birthday || '', 相识: p.howMet || '', 备注: p.notes || '' })));
  push('大事记与承诺', (events || []).map((e) => ({ 日期: (e.date || '').slice(0, 10), 标题: e.title, 类型: e.type, 完成: e.type === '承诺' ? !!e.done : undefined, 地点: e.location || '', 详情: e.description || '' })));
  push('愿望清单', (wishes || []).map((w) => ({ 愿望: w.title, 状态: w.status, 来源: w.source || '', 备注: w.note || '' })));
  push('礼物记录', (gifts || []).map((g) => ({ 礼物: g.title, 方向: g.direction, 场合: g.occasion || '', 日期: (g.date || '').slice(0, 10) })));
  push('照片视频（按时间倒序，最多80条）', (memories || []).slice(0, 80).map((m) => ({ 时间: (m.takenAt || '').slice(0, 10), 类型: m.type, 备注: m.note || '', 标签: (m.tags || []).join('/'), 地点: m.location || '' })));
  return parts.join('\n\n');
}

const SYSTEM_PROMPT = `你是"爱人记忆库"的专属助手，帮助用户回忆和查询关于TA爱人的一切信息。
你掌握的资料会在后续消息中以 JSON 形式给出，回答时：
1. 优先依据资料回答，引用具体细节（日期、数字、原话）；资料里没有的信息，明确说"记忆库里还没有记录"，可以建议用户去对应模块补充。
2. 涉及送礼建议时，结合愿望清单、喜好、尺码、已送礼物（避免重复送）给出具体建议。
3. 涉及健康（过敏、用药、生理期）时格外严谨，提醒以医生意见为准。
4. 语气温暖亲密，像了解他们故事的共同好友。回答简洁，用中文。`;

// 问答主入口：userMessages 为最近几轮对话 [{role, content}]
async function ask(resolved, userMessages, allData) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: '以下是记忆库全部资料：\n\n' + buildDataContext(allData) },
    ...userMessages
  ];
  return chatCompletion(resolved, messages, { temperature: 0.7 });
}

// 设置里的"测试连接"
async function testConnection(resolved) {
  const reply = await chatCompletion(resolved, [
    { role: 'user', content: '回复"连接成功"四个字即可。' }
  ], { temperature: 0, timeoutMs: 30000 });
  return reply.trim();
}

module.exports = { PROVIDERS, resolveConfig, isConfigured, ask, testConnection, chatCompletion };
