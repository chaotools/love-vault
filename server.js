// 爱人记忆库 · Love Vault
// 环境变量：PORT(默认3000) / HOST(默认0.0.0.0，服务器可用) / DATA_DIR(默认./data)
// 反向代理 HTTPS：TRUST_PROXY=1（让安全 Cookie 识别 X-Forwarded-Proto）
// AI 覆盖：AI_BASE_URL / AI_API_KEY / AI_MODEL
const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

const auth = require('./src/auth');
const ai = require('./src/ai');
const { configRouter } = require('./src/routes/config');
const content = require('./src/routes/content');
const { searchRouter } = require('./src/routes/search');
const { askRouter } = require('./src/routes/ask');
const { UserDataManager } = require('./src/user-data');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');

const PUBLIC_DIR = path.join(ROOT, 'public');

const users = new UserDataManager(DATA_DIR);
const getData = (req) => {
  const v = req.vault;
  return { config: v.config.data, profile: v.profile.data, preferences: v.preferences.list(), people: v.people.list(), events: v.events.list(), wishes: v.wishes.list(), gifts: v.gifts.list(), memories: v.memories.list().slice().sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '')) };
};

// ---------- 应用 ----------
const app = express();
// 仅在明确配置时信任反向代理传来的协议头，避免直接暴露端口时信任伪造头。
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));

// 认证：静态壳文件可访问，/api/auth/* 开放，其余 API 与媒体需要登录
// 路由一律持有 store（每次请求动态读 .data）；直接传 .data 会因 load() 重赋值而失效
app.use('/api/auth', auth.router());
app.use('/api', auth.requireAuth);
app.use('/api', async (req, res, next) => {
  try { req.vault = await users.get(req.vaultUserId); next(); }
  catch (e) { next(e); }
});

app.use('/api/config', configRouter((req) => req.vault.config));
app.use('/api/profile', content.profileRouter((req) => req.vault.profile));
app.use('/api/preferences', content.preferencesRouter((req) => req.vault.preferences));
app.use('/api/people', content.peopleRouter((req) => req.vault.people));
app.use('/api/events', content.eventsRouter((req) => req.vault.events));
app.use('/api/wishes', content.wishesRouter((req) => req.vault.wishes));
app.use('/api/gifts', content.giftsRouter((req) => req.vault.gifts));
app.use('/api/search', searchRouter(getData));
app.use('/api/ask', askRouter((req) => req.vault.config, getData));

const memoriesApi = content.memoriesRouter((req) => req.vault.memories);
app.use('/api/memories', memoriesApi.router);
app.use('/api/upload', memoriesApi.router); // 兼容旧版上传路径

// 媒体文件也受密码保护
app.use('/media', auth.requireAuth, async (req, res, next) => { req.vault = await users.get(req.vaultUserId); express.static(req.vault.mediaDir)(req, res, next); });
app.use('/thumbs', auth.requireAuth, async (req, res, next) => { req.vault = await users.get(req.vaultUserId); express.static(req.vault.thumbDir)(req, res, next); });
app.use('/music', auth.requireAuth, async (req, res, next) => { req.vault = await users.get(req.vaultUserId); express.static(req.vault.musicDir)(req, res, next); });

// PWA 与静态资源（协商缓存，改动即时生效）
app.use(express.static(PUBLIC_DIR, { etag: true, lastModified: true, setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'))); // SPA 兜底

// ---------- 启动 ----------
async function init() {
  await fsp.mkdir(path.join(DATA_DIR, 'users'), { recursive: true });
}

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === '0') return;
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function listen(port) {
  const server = app.listen(port, HOST, () => {
    console.log('\n  💕 爱人记忆库已启动');
    console.log('  本机访问:  http://localhost:' + port);
    if (HOST === '0.0.0.0') {
      console.log('  局域网/服务器: 用本机 IP 访问同一端口（手机同 WiFi 可打开）');
    }
    console.log('  数据目录:  ' + DATA_DIR + '  （复制此目录 = 完整备份）\n');
    if (process.env.NODE_ENV !== 'production') openBrowser('http://localhost:' + port);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < PORT + 20) {
      console.log('  端口 ' + port + ' 被占用，尝试 ' + (port + 1) + ' ...');
      listen(port + 1);
    } else {
      console.error('启动失败:', e.message);
      process.exit(1);
    }
  });
}

init()
  .then(() => listen(PORT))
  .catch((e) => { console.error('初始化失败:', e); process.exit(1); });
