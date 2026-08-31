// 爱人记忆库 · Love Vault
// 环境变量：PORT(默认3000) / HOST(默认0.0.0.0，服务器可用) / DATA_DIR(默认./data)
// 反向代理 HTTPS：TRUST_PROXY=1（让安全 Cookie 识别 X-Forwarded-Proto）
// AI 覆盖：AI_BASE_URL / AI_API_KEY / AI_MODEL
// 多用户模式：WEB_SESSION_SECRET / MOBILE_SERVICE_TOKEN（均未配置时退回本地单用户模式，数据用 data/ 根目录）
// 旧版数据迁移：LEGACY_USER_ID=<用户ID>，启动时把 data/ 根目录的旧布局移入该用户目录（只执行一次）
const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

const auth = require('./src/auth');
const media = require('./src/media');
const { configRouter } = require('./src/routes/config');
const content = require('./src/routes/content');
const { searchRouter } = require('./src/routes/search');
const { askRouter } = require('./src/routes/ask');
const { statsRouter } = require('./src/routes/stats');
const { transferRouter } = require('./src/routes/transfer');
const { calendarRouter } = require('./src/routes/calendar');
const { computeReminders } = require('./src/reminders');
const { UserDataManager, buildVault, loadVault, migrateLegacyTo } = require('./src/user-data');
const { migrateStoredApiKeys } = require('./src/secrets');
const { rateLimit } = require('./src/rate-limit');
const { securityHeaders, validateRuntimeConfig } = require('./src/security');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');

const PUBLIC_DIR = path.join(ROOT, 'public');

// 本地单用户模式沿用 data/ 根目录的旧布局；多用户模式按用户隔离到 data/users/<userId>/
const legacyVault = buildVault(DATA_DIR);
const users = new UserDataManager(DATA_DIR);

const getData = (req) => {
  const v = req.vault;
  return { config: v.config.data, profile: v.profile.data, preferences: v.preferences.list(), people: v.people.list(), events: v.events.list(), wishes: v.wishes.list(), gifts: v.gifts.list(), albums: v.albums.list(), memories: v.memories.list().slice().sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '')) };
};

// 认证之后挂载当前请求对应的保险库（本地模式 → data/ 根目录；多用户 → 各自目录）
async function attachVault(req, res, next) {
  try {
    req.vault = req.vaultUserId === auth.LOCAL_USER_ID
      ? legacyVault
      : await users.get(req.vaultUserId);
    next();
  } catch (e) { next(e); }
}
const serveVaultDir = (key) => (req, res, next) => express.static(req.vault[key], {
  setHeaders: (response) => response.setHeader('X-Content-Type-Options', 'nosniff')
})(req, res, next);

// ---------- 应用 ----------
const app = express();
// 仅在明确配置时信任反向代理传来的协议头，避免直接暴露端口时信任伪造头。
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json({ limit: '4mb' }));

// 认证：静态壳文件可访问，/api/auth/* 开放，其余 API 与媒体需要登录
// 路由一律持有 store（每次请求动态读 .data）；直接传 .data 会因 load() 重赋值而失效
app.use('/api/auth', auth.csrfProtect, auth.router());
app.use('/api', auth.csrfProtect, auth.requireAuth, attachVault,
  rateLimit({ windowMs: 60_000, max: 60, name: '写入', skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) }));

app.use('/api/config', configRouter((req) => req.vault.config, (req) => req.vault.config.save()));
app.use('/api/profile', content.profileRouter((req) => req.vault.profile));
app.use('/api/preferences', content.preferencesRouter((req) => req.vault.preferences));
app.use('/api/people', content.peopleRouter((req) => req.vault.people));
app.use('/api/events', content.eventsRouter((req) => req.vault.events));
app.use('/api/wishes', content.wishesRouter((req) => req.vault.wishes));
app.use('/api/gifts', content.giftsRouter((req) => req.vault.gifts));
app.use('/api/albums', content.albumsRouter((req) => req.vault.albums));
app.use('/api/search', searchRouter(getData));
app.use('/api/ask', askRouter((req) => req.vault.config, getData));
app.use('/api/stats', statsRouter(getData));
app.use('/api/calendar', calendarRouter(getData));
app.use('/api/transfer', transferRouter((req) => req.vault));

// 提醒：把当前保险库快照交给纯计算模块
app.get('/api/reminders', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 1), 365);
  res.json(computeReminders(getData(req), { daysAhead: days }));
});

const memoriesApi = content.memoriesRouter((req) => req.vault.memories);
app.use('/api/memories', memoriesApi.router);
app.use('/api/upload', memoriesApi.router); // 兼容旧版上传路径

// 媒体文件随当前用户隔离，同样受登录保护
app.use('/media', auth.requireAuth, attachVault, serveVaultDir('mediaDir'));
app.use('/thumbs', auth.requireAuth, attachVault, serveVaultDir('thumbDir'));
app.use('/music', auth.requireAuth, attachVault, serveVaultDir('musicDir'));

// PWA 与静态资源（协商缓存，改动即时生效）
app.use(express.static(PUBLIC_DIR, { etag: true, lastModified: true, setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'))); // SPA 兜底

// 统一错误出口：multer 文件校验失败等中间件错误也返回 JSON
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('请求处理失败:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '单个文件不能超过 200 MB' });
  res.status(err.status || 500).json({ error: err.message });
});

// ---------- 启动 ----------
async function init() {
  const runtime = validateRuntimeConfig();
  console.log(`运行模式: ${runtime.mode === 'multi-user' ? '服务器多用户' : '本地单用户'}`);
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const legacyId = process.env.LEGACY_USER_ID || '';
  if (legacyId) await migrateLegacyTo(DATA_DIR, legacyId);
  const keyMigration = await migrateStoredApiKeys(DATA_DIR);
  if (keyMigration.migrated) console.log(`已加密 ${keyMigration.migrated} 份保存的 AI API Key`);
  // 本地模式预加载根目录保险库；多用户保险库在首次请求时懒加载
  await loadVault(legacyVault);
  media.init(legacyVault.mediaDir, legacyVault.thumbDir); // 兼容 migrate-old 等旧调用
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
