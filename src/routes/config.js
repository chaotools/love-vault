// 配置路由：读写 config.json（AI / 密码等敏感项由 auth 路由单独处理）
const express = require('express');

const DEFAULT_CONFIG = {
  title: '爱人记忆库',
  names: '',
  anniversary: '',
  music: '',
  memorialDays: [],          // [{name, date}]
  periodEnabled: false,      // 生理期记录开关（首页提醒用）
  ai: { provider: 'zhipu', baseUrl: '', apiKey: '', model: '' },
  auth: undefined            // {salt, hash} 由 auth 路由维护
};

function configRouter(store, save) {
  const r = express.Router();

  // API Key 只用于服务器向模型供应商发请求；不要因打开设置页面而回传给浏览器。
  const publicConfig = (config) => {
    const { auth, ai = {}, ...safe } = config;
    return {
      ...DEFAULT_CONFIG,
      ...safe,
      ai: { ...DEFAULT_CONFIG.ai, ...ai, apiKey: '', hasApiKey: Boolean(ai.apiKey) },
      hasPassword: Boolean(auth)
    };
  };

  r.get('/', (req, res) => {
    res.json(publicConfig(store.data));
  });

  r.post('/', async (req, res) => {
    const config = store.data;
    const b = req.body || {};
    for (const k of ['title', 'names', 'anniversary', 'music']) {
      if (typeof b[k] === 'string') config[k] = b[k];
    }
    if (typeof b.periodEnabled === 'boolean') config.periodEnabled = b.periodEnabled;
    if (Array.isArray(b.memorialDays)) {
      config.memorialDays = b.memorialDays
        .filter((m) => m && typeof m.name === 'string' && typeof m.date === 'string')
        .map((m) => ({ name: m.name.trim(), date: m.date }));
    }
    if (b.ai && typeof b.ai === 'object') {
      config.ai = {
        provider: typeof b.ai.provider === 'string' ? b.ai.provider : (config.ai ? config.ai.provider : 'zhipu'),
        baseUrl: typeof b.ai.baseUrl === 'string' ? b.ai.baseUrl.trim() : '',
        // 空值表示“不修改”，使前端无需读取既有 Key；可通过环境变量替换。
        apiKey: typeof b.ai.apiKey === 'string' && b.ai.apiKey.trim()
          ? b.ai.apiKey.trim()
          : ((config.ai && config.ai.apiKey) || ''),
        model: typeof b.ai.model === 'string' ? b.ai.model.trim() : ''
      };
    }
    await save();
    res.json(publicConfig(config));
  });

  return r;
}

module.exports = { configRouter, DEFAULT_CONFIG };
