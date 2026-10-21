// 邮件提醒：配置校验、每日摘要、SMTP 发送和服务器端定时调度。
const path = require('path');
const fsp = require('fs/promises');
const nodemailer = require('nodemailer');
const { JsonStore } = require('./store');
const { computeReminders } = require('./reminders');
const { shanghaiParts, formatDate } = require('./date-resolution');

const DEFAULT_NOTIFICATIONS = Object.freeze({
  emailEnabled: false,
  emailTo: '',
  time: '09:00'
});
const DEFAULT_SENDER = 'chaotools2026@163.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseRecipients(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  return [...new Set(raw.split(/[,;，；\s]+/).map((item) => item.trim()).filter(Boolean))];
}

function normalizeNotificationSettings(value = {}) {
  const settings = value && typeof value === 'object' ? value : {};
  const recipients = parseRecipients(settings.emailTo);
  const time = typeof settings.time === 'string' && TIME_PATTERN.test(settings.time) ? settings.time : DEFAULT_NOTIFICATIONS.time;
  return {
    emailEnabled: settings.emailEnabled === true,
    emailTo: recipients.join(', '),
    emails: recipients,
    time
  };
}

function validateNotificationSettings(value = {}) {
  const settings = normalizeNotificationSettings(value);
  if (settings.emailEnabled && !settings.emails.length) {
    return { ok: false, error: '开启邮件提醒时必须填写接收邮箱' };
  }
  if (settings.emails.some((email) => !EMAIL_PATTERN.test(email))) {
    return { ok: false, error: '接收邮箱格式不正确' };
  }
  return { ok: true, settings };
}

function smtpConfig(env = process.env) {
  const user = String(env.SMTP_USER || DEFAULT_SENDER).trim();
  const pass = String(env.SMTP_PASS || '');
  return {
    host: String(env.SMTP_HOST || 'smtp.163.com').trim(),
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE || 'true') !== 'false',
    user,
    pass,
    from: String(env.SMTP_FROM || user).trim() || DEFAULT_SENDER
  };
}

function createEmailService({ env = process.env, transport = null } = {}) {
  const config = smtpConfig(env);
  const activeTransport = transport || ((config.user && config.pass)
    ? nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass }
    })
    : null);
  return {
    config: { host: config.host, port: config.port, secure: config.secure, user: config.user, from: config.from },
    isConfigured: () => Boolean(activeTransport),
    async send({ to, subject, text, html }) {
      if (!activeTransport) {
        const error = new Error('邮件服务未配置：请在服务器设置 SMTP_PASS 邮箱授权码');
        error.status = 503;
        throw error;
      }
      return activeTransport.sendMail({
        from: config.from,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        text,
        html
      });
    }
  };
}

const emailService = createEmailService();

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function digestWhen(item) {
  if (item.active) return '正在进行';
  if (item.inDays === 0) return '今天';
  return `${item.inDays} 天后`;
}

function buildDailyDigest(data, { now = new Date(), daysAhead = 7 } = {}) {
  const reminders = computeReminders(data, { now, daysAhead });
  const items = (reminders.items || []).filter((item) => item.active || (item.inDays >= 0 && item.inDays <= daysAhead));
  if (!items.length) return null;

  const dateLabel = reminders.today.date;
  const subject = `💕 ${dateLabel.slice(5).replace('-', '月')}日 爱人记忆库提醒`;
  const lines = [
    `Love Vault · ${dateLabel}`,
    `农历：${reminders.today.lunar}`,
    '',
    '今天与近期提醒：',
    ...items.map((item) => `- ${digestWhen(item)}｜${item.title}${item.sub ? '（' + item.sub + '）' : ''}`),
    '',
    '这封邮件由 Love Vault 自动发送。'
  ];
  const rows = items.map((item) => `<li><strong>${escapeHtml(digestWhen(item))}</strong>｜${escapeHtml(item.title)}${item.sub ? '<span>（' + escapeHtml(item.sub) + '）</span>' : ''}</li>`).join('');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#2c2024"><h2 style="color:#b84a65">💕 爱人记忆库提醒</h2><p>${escapeHtml(dateLabel)} · ${escapeHtml(reminders.today.lunar)}</p><h3>今天与近期提醒</h3><ul>${rows}</ul><p style="color:#7f6a70;font-size:12px">这封邮件由 Love Vault 自动发送。</p></div>`;
  return { subject, text: lines.join('\n'), html, items, today: reminders.today };
}

function buildTestEmail(to) {
  const recipient = Array.isArray(to) ? to.join(', ') : String(to || '');
  return {
    subject: '💕 爱人记忆库测试邮件',
    text: `这是一封 Love Vault 测试邮件。\n\n接收地址：${recipient}\n如果你收到这封邮件，说明 SMTP 配置正常。`,
    html: `<div style="font-family:sans-serif;line-height:1.7;color:#2c2024"><h2 style="color:#b84a65">💕 爱人记忆库测试邮件</h2><p>接收地址：${escapeHtml(recipient)}</p><p>如果你收到这封邮件，说明 SMTP 配置正常。</p></div>`
  };
}

function snapshotVault(vault) {
  return {
    config: vault.config.data,
    profile: vault.profile.data,
    preferences: vault.preferences.list(),
    people: vault.people.list(),
    events: vault.events.list(),
    wishes: vault.wishes.list(),
    gifts: vault.gifts.list(),
    albums: vault.albums.list(),
    memories: vault.memories.list().slice().sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''))
  };
}

function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { hour: get('hour'), minute: get('minute') };
}

function minutesOf(time) {
  const [hour, minute] = String(time || '09:00').split(':').map(Number);
  return hour * 60 + minute;
}

async function runScheduledEmailDigests({ vaults, email, state, now = new Date(), catchUpMinutes = 180 } = {}) {
  const sent = [];
  if (!email || typeof email.isConfigured !== 'function' || !email.isConfigured()) return sent;
  const today = formatDate(shanghaiParts(now));
  const clock = shanghaiClock(now);
  const currentMinutes = clock.hour * 60 + clock.minute;

  for (const entry of vaults || []) {
    const settings = normalizeNotificationSettings(entry.vault && entry.vault.config && entry.vault.config.data && entry.vault.config.data.notifications);
    if (!settings.emailEnabled || !settings.emails.length) continue;
    if (settings.emails.some((address) => !EMAIL_PATTERN.test(address))) continue;
    const dueMinutes = minutesOf(settings.time);
    if (currentMinutes < dueMinutes || currentMinutes > dueMinutes + catchUpMinutes) continue;

    const stateKey = `${entry.scope}:${today}:${settings.emails.join(',')}`;
    if (state && state[stateKey]) continue;
    const digest = buildDailyDigest(snapshotVault(entry.vault), { now, daysAhead: 7 });
    if (!digest) continue;

    await email.send({ to: settings.emails, ...digest });
    if (state) state[stateKey] = new Date().toISOString();
    sent.push({ scope: entry.scope, to: settings.emails, subject: digest.subject });
  }
  return sent;
}

function startEmailScheduler({ dataDir, legacyVault, users, localMode, email = emailService, intervalMs = 60_000 } = {}) {
  const stateStore = new JsonStore(path.join(dataDir, 'email-notification-state.json'), {});
  let timer = null;
  let running = false;
  let warnedMissingSmtp = false;

  const collectVaults = async () => {
    if (localMode) return [{ scope: 'local', vault: legacyVault }];
    const usersDir = path.join(dataDir, 'users');
    const entries = await fsp.readdir(usersDir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const vaults = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        vaults.push({ scope: entry.name, vault: await users.get(entry.name) });
      } catch (error) {
        console.error('读取邮件提醒用户失败:', entry.name, error.message);
      }
    }
    return vaults;
  };

  const tick = async () => {
    if (running) return [];
    running = true;
    try {
      const vaults = await collectVaults();
      const enabled = vaults.some(({ vault }) => normalizeNotificationSettings(vault.config.data.notifications).emailEnabled);
      if (!enabled) return [];
      if (!email.isConfigured()) {
        if (!warnedMissingSmtp) {
          warnedMissingSmtp = true;
          console.warn('邮件提醒已开启，但 SMTP_PASS 未配置，暂时无法发送。');
        }
        return [];
      }
      await stateStore.load();
      const sent = await runScheduledEmailDigests({ vaults, email, state: stateStore.data, now: new Date() });
      if (sent.length) await stateStore.save();
      return sent;
    } finally {
      running = false;
    }
  };

  return {
    tick,
    start: async () => {
      await tick();
      timer = setInterval(() => tick().catch((error) => console.error('邮件提醒发送失败:', error.message)), intervalMs);
      if (timer.unref) timer.unref();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SENDER,
  parseRecipients,
  normalizeNotificationSettings,
  validateNotificationSettings,
  smtpConfig,
  createEmailService,
  emailService,
  buildDailyDigest,
  buildTestEmail,
  runScheduledEmailDigests,
  startEmailScheduler
};