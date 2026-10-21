const express = require('express');
const { rateLimit } = require('../rate-limit');
const { normalizeNotificationSettings, buildTestEmail } = require('../email-notifications');

function notificationsRouter(vaultResolver, emailService) {
  const r = express.Router();
  const resolve = (req) => typeof vaultResolver === 'function' ? vaultResolver(req) : vaultResolver;

  r.get('/status', (req, res) => res.json({
    configured: emailService.isConfigured(),
    sender: emailService.config.from,
    host: emailService.config.host
  }));

  r.post('/test', rateLimit({ windowMs: 10 * 60_000, max: 3, name: '测试邮件' }), async (req, res) => {
    try {
      const vault = resolve(req);
      const settings = normalizeNotificationSettings(vault && vault.config && vault.config.data && vault.config.data.notifications);
      if (!settings.emails.length) return res.status(400).json({ error: '请先在设置里填写接收邮箱' });
      if (!emailService.isConfigured()) {
        return res.status(503).json({ error: '邮件服务未配置：请在服务器设置 SMTP_PASS 邮箱授权码' });
      }
      await emailService.send({ to: settings.emails, ...buildTestEmail(settings.emails) });
      res.json({ ok: true, to: settings.emails });
    } catch (error) {
      res.status(error.status || 502).json({ error: '测试邮件发送失败：' + error.message });
    }
  });

  return r;
}

module.exports = { notificationsRouter };