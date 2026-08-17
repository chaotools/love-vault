# 爱人记忆库 💕

> TA 的一切，都在这里 —— 身高体重尺码健康、爱吃的讨厌的、身边的人、大事记与承诺、愿望与礼物、照片视频，还有一个读得懂这一切的 AI。

本地优先的私人应用：数据全部存在自己机器上的 `data/` 目录，**复制这个目录 = 完整备份/搬家**。可在任何服务器复现部署。

## 功能总览

| 模块 | 内容 |
|---|---|
| 🕰 **时间轴** | 照片/视频/文字大事记按月混排；EXIF 自动排序；HEIC 转换；视频自动封面；顶部一句话快速记录 |
| 🧸 **TA档案** | 基本信息、全身尺码（买衣服直接抄）、健康（过敏/用药）、生理期记录（默认关闭）、自定义字段、我们的故事 |
| 💗 **偏好** | 喜欢/不喜欢双栏，吃穿用玩分类，细节备注 |
| 👨‍👩‍👧 **人名关系库** | TA的家人朋友同事，关系、生日（30天内首页提醒）、相识故事 |
| 📖 **大事记** | 里程碑/约会/旅行/争吵与和解/承诺，可关联照片；承诺可勾选兑现 |
| 🎁 **愿望&礼物** | TA随口说想要的（三状态流转）、礼物双向记录防重复送、约会灵感抽卡（愿望+偏好+60张卡池） |
| 🔍 **全局搜索** | 顶栏一个框，搜全部模块，点击直达 |
| 🤖 **AI问答** | 自然语言问"TA对什么过敏？""送礼灵感？"；支持智谱GLM/OpenAI/DeepSeek/Kimi/通义千问/任意兼容接口，随时切换 |

## 快速开始（本机）

要求：[Node.js](https://nodejs.org) ≥ 18（视频封面和 HEIC 转换建议装 [FFmpeg](https://ffmpeg.org)，不装也能用，自动降级）

```bash
npm install
npm start
# 打开 http://localhost:3000
```

Windows 双击 `start.bat` 即可。手机与电脑同一 WiFi 时，用 `http://电脑IP:3000` 访问，浏览器菜单里"添加到主屏幕"即得全屏 App 体验（PWA）。

## 部署到服务器（可复现）

### 方式一：Docker（推荐）

```bash
git clone <你的仓库> love-vault && cd love-vault
docker compose up -d          # 完事，访问 http://服务器IP:3000
```

数据在宿主机 `./data` 目录，升级版本只需 `git pull && docker compose up -d --build`。

### 方式二：裸跑 Node（PM2 守护）

```bash
npm ci
pm2 start server.js --name love-vault
pm2 save && pm2 startup
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 端口 |
| `HOST` | 0.0.0.0 | 监听地址（只本机用可设 127.0.0.1） |
| `DATA_DIR` | ./data | 数据目录（可指到独立磁盘/挂载卷） |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | - | AI 配置，优先级高于网页设置（Key 不落盘场景） |
| `TRUST_PROXY` | - | HTTPS 反向代理时设为 `1`，让会话 Cookie 正确标记为 Secure |
| `COOKIE_SECURE` | 自动 | `true` 强制 Secure，`false` 关闭；本机 HTTP 调试保持默认即可 |

### 安全（上服务器必读）

1. **设置访问密码**：网页右上 ⚙ 设置 → 安全 → 访问密码。密码 scrypt 哈希存储，媒体文件同样受保护。
2. **上 HTTPS**：公网部署强烈建议套一层反向代理，Caddy 示例：

```
love.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

反向代理部署时，请同时为服务设置 `TRUST_PROXY=1`；这样登录会话 Cookie 会带上 `Secure` 标记，避免被 HTTP 传输。

nginx 等价配置：`location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }`

## 备份与搬家

所有记忆（照片、视频、缩略图、各模块数据、配置）都在 `data/`（或你指定的 `DATA_DIR`）里。**定期复制这个目录**（网盘/移动硬盘均可），换机器时把它放回 `love-vault/data/` 直接继续用。

## 从旧版 love-memory 迁移

如果之前用过旧版照片时间轴（love-memory）：

```bash
npm run migrate-old          # 自动导入旧照片/视频/配置，旧项目原样不动
```

## 项目结构

```
server.js            入口（Express，零机器绑定）
src/store.js         JSON 原子持久化
src/media.js         EXIF/缩略图/视频封面/HEIC
src/ai.js            多供应商大模型（OpenAI 兼容协议单点封装）
src/auth.js          访问密码（scrypt + 会话）
src/routes/          REST API（memories/profile/preferences/people/events/wishes/gifts/search/ask/config）
public/              前端（原生 ES Modules，无构建）
data/                ★ 全部记忆
```

## 数据模型速览

- `config.json`：标题、名字、纪念日、AI 配置、密码哈希
- `profile.json`：basics（身高/体重/尺码…）+ health + period + 自定义字段 + story
- `preferences.json` / `people.json` / `events.json` / `wishes.json` / `gifts.json` / `memories.json`

均为带 `id/createdAt/updatedAt` 的 JSON 数组（profile 为对象），人可直接阅读，方便导出和二次利用。
