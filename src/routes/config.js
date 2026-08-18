// 配置路由：读写 config.json（AI Key 落盘前加密，见 src/secrets.js）
const express = require('express');
const { encryptApiKey } = require('../secrets');

const DEFAULT_CONFIG = {
  title: '爱人记忆库',
  names: '',
  anniversary: '',
  music: '',
  memorialDays: [],          // [{name, date}]
  periodEnabled: false,      // 生理期记录开关（首页提醒用）
  ai: { provider: 'zhipu', baseUrl: '', apiKey: '', model: '', privacy: { health: false, period: false } },
  auth: undefined            // 历史遗留字段，已无密码功能
};

function configRouter(store, save) {
  const r = express.Router();
  const resolve = (req) => typeof store === 'function' ? store(req) : store;

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
    res.json(publicConfig(resolve(req).data));
  });

  r.post('/', async (req, res) => {
    const currentStore = resolve(req);
    const config = currentStore.data;
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
          ? encryptApiKey(b.ai.apiKey.trim())
          : ((config.ai && config.ai.apiKey) || ''),
        model: typeof b.ai.model === 'string' ? b.ai.model.trim() : '',
        privacy: (b.ai.privacy && typeof b.ai.privacy === 'object')
          ? {
            health: b.ai.privacy.health === true,
            period: b.ai.privacy.period === true
          }
          : ((config.ai && config.ai.privacy) || { health: false, period: false })
      };
    }
    await (typeof save === 'function' ? save(req) : currentStore.save());
    res.json(publicConfig(config));
  });

  return r;
}

module.exports = { configRouter, DEFAULT_CONFIG };
