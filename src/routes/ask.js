// AI 问答路由
const express = require('express');
const ai = require('../ai');

function askRouter(store, getData) {
  const r = express.Router();

  // 前端探测 AI 是否可用（决定是否显示入口）
  r.get('/status', (req, res) => {
    const resolved = ai.resolveConfig(store.data);
    res.json({
      configured: ai.isConfigured(resolved),
      provider: resolved.providerName,
      model: resolved.model,
      fromEnv: Boolean(process.env.AI_API_KEY)
    });
  });

  r.post('/', async (req, res) => {
    try {
      const resolved = ai.resolveConfig(store.data);
      const messages = (req.body && req.body.messages) || [];
      if (!Array.isArray(messages) || !messages.length || messages.length > 40) {
        return res.status(400).json({ error: '消息格式不对' });
      }
      const clean = messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!clean.length) return res.status(400).json({ error: '消息内容为空' });

      const answer = await ai.ask(resolved, clean, getData());
      res.json({ answer });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // 测试连接（需要已登录；Key 走 env 或 config）
  r.post('/test', async (req, res) => {
    try {
      const resolved = ai.resolveConfig(store.data);
      const reply = await ai.testConnection(resolved);
      res.json({ ok: true, reply, provider: resolved.providerName, model: resolved.model });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  return r;
}

module.exports = { askRouter };
