// 爱人记忆库 · Love Vault
// 环境变量：PORT(默认3000) / HOST(默认0.0.0.0，服务器可用) / DATA_DIR(默认./data)
// AI 覆盖：AI_BASE_URL / AI_API_KEY / AI_MODEL
const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

const { JsonStore, Collection } = require('./src/store');
const media = require('./src/media');
const auth = require('./src/auth');
const ai = require('./src/ai');
const { configRouter, DEFAULT_CONFIG } = require('./src/routes/config');
const content = require('./src/routes/content');
const { searchRouter } = require('./src/routes/search');
const { askRouter } = require('./src/routes/ask');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const MUSIC_DIR = path.join(DATA_DIR, 'music');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------- 存储 ----------
const configStore = new JsonStore(path.join(DATA_DIR, 'config.json'), { ...DEFAULT_CONFIG });
const profileStore = new JsonStore(path.join(DATA_DIR, 'profile.json'), content.PROFILE_DEFAULT);
const preferences = new Collection(path.join(DATA_DIR, 'preferences.json'));
const people = new Collection(path.join(DATA_DIR, 'people.json'));
const events = new Collection(path.join(DATA_DIR, 'events.json'));
const wishes = new Collection(path.join(DATA_DIR, 'wishes.json'));
const gifts = new Collection(path.join(DATA_DIR, 'gifts.json'));
const memories = new Collection(path.join(DATA_DIR, 'memories.json'));

const saveConfig = () => configStore.save();
const getData = () => ({
  config: configStore.data,
  profile: profileStore.data,
  preferences: preferences.list(),
  people: people.list(),
  events: events.list(),
  wishes: wishes.list(),
  gifts: gifts.list(),
  memories: memories.list().slice().sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''))
});

// ---------- 应用 ----------
const app = express();
app.use(express.json({ limit: '4mb' }));

// 认证：静态壳文件可访问，/api/auth/* 开放，其余 API 与媒体需要登录
// 路由一律持有 store（每次请求动态读 .data）；直接传 .data 会因 load() 重赋值而失效
app.use('/api/auth', auth.router(configStore, saveConfig));
app.use('/api', auth.requireAuth(configStore));

app.use('/api/config', configRouter(configStore, saveConfig));
app.use('/api/profile', content.profileRouter(profileStore));
app.use('/api/preferences', content.preferencesRouter(preferences));
app.use('/api/people', content.peopleRouter(people));
app.use('/api/events', content.eventsRouter(events));
app.use('/api/wishes', content.wishesRouter(wishes));
app.use('/api/gifts', content.giftsRouter(gifts));
app.use('/api/search', searchRouter(getData));
app.use('/api/ask', askRouter(configStore, getData));

const memoriesApi = content.memoriesRouter(memories);
app.use('/api/memories', memoriesApi.router);
app.use('/api/upload', memoriesApi.router); // 兼容旧版上传路径

// 媒体文件也受密码保护
app.use('/media', auth.requireAuth(configStore.data), express.static(MEDIA_DIR));
app.use('/thumbs', auth.requireAuth(configStore.data), express.static(THUMB_DIR));
app.use('/music', auth.requireAuth(configStore.data), express.static(MUSIC_DIR));

// PWA 与静态资源（协商缓存，改动即时生效）
app.use(express.static(PUBLIC_DIR, { etag: true, lastModified: true, setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'))); // SPA 兜底

// ---------- 启动 ----------
async function init() {
  for (const d of [DATA_DIR, MEDIA_DIR, THUMB_DIR, MUSIC_DIR]) {
    await fsp.mkdir(d, { recursive: true });
  }
  await Promise.all([
    configStore.load(), profileStore.load(),
    preferences.load(), people.load(), events.load(),
    wishes.load(), gifts.load(), memories.load()
  ]);
  media.init(MEDIA_DIR, THUMB_DIR);
  await content.ensureIndex(memories);
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
