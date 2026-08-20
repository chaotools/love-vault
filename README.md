# 爱人记忆库 💕

> TA 的一切，都在这里 —— 身高体重尺码健康、爱吃的讨厌的、身边的人、大事记与承诺、愿望与礼物、照片视频，还有一个读得懂这一切的 AI。

一个私有优先的记忆库，支持两种使用方式：

- **本地单用户**：不配置认证环境变量即可使用，数据保存在 `data/`；复制该目录即可备份或搬家。
- **服务器多用户**：每个微信用户拥有一份彼此隔离的记忆库；小程序与网页读写同一份数据，网页通过小程序扫码确认登录。

线上部署默认不公开任何记忆数据：网页 API、媒体文件和用户目录都必须经过登录鉴权。

## 功能总览

| 模块 | 内容 |
|---|---|
| 🕰 **时间轴** | 照片/视频/文字大事记按月混排；EXIF 自动排序；HEIC 转换；视频自动封面；顶部一句话快速记录 |
| 🧸 **TA档案** | 基本信息、全身尺码（买衣服直接抄）、健康（过敏/用药）、生理期记录（默认关闭）、自定义字段、我们的故事 |
| 💗 **偏好** | 喜欢/不喜欢双栏，吃/喝/穿/用/玩分类，细节备注 |
| 👨‍👩‍👧 **人名关系库** | TA的家人朋友同事，关系、生日（30天内首页提醒）、相识故事 |
| 📖 **大事记** | 里程碑/约会/旅行/争吵与和解/承诺，可关联照片；承诺可勾选兑现 |
| 🎁 **愿望&礼物** | TA随口说想要的（三状态流转）、礼物双向记录防重复送、约会灵感抽卡（愿望+偏好+60张卡池） |
| 🔍 **全局搜索** | 顶栏一个框，搜全部模块，点击直达 |
| 🤖 **AI问答** | 自然语言问"TA对什么过敏？""送礼灵感？"；支持智谱GLM/OpenAI/DeepSeek/Kimi/通义千问/任意兼容接口，随时切换 |

## 快速开始（本机）

要求：[Node.js](https://nodejs.org) ≥ 20.9。照片功能开箱即用；视频上传（封面/拍摄时间提取）和 iPhone HEIC 照片转换需要安装 [FFmpeg](https://ffmpeg.org)，未安装时这两类文件会校验失败，其余功能不受影响。

```bash
npm install
npm start
# 打开 http://localhost:3000
```

Windows 双击 `start.bat` 即可。手机与电脑同一 WiFi 时，用 `http://电脑IP:3000` 访问，浏览器菜单里"添加到主屏幕"即得全屏 App 体验（PWA）。

本地模式不需要密码或服务令牌，适合个人电脑离线使用；请不要把这个未配置认证的本地模式直接暴露到公网。

## 部署到服务器

当前生产方案使用 CNB 容器镜像、Nginx HTTPS 和小程序后端的登录桥接：

```text
小程序 ──微信登录──> 小程序后端 ──内部服务令牌 + user_id──> Love Vault
网页 ──扫码确认──> 小程序后端 ──一次性凭证──> Love Vault 会话 Cookie
```

每个 OpenID 只映射到一个随机内部 `user_id`。OpenID 不会写入媒体目录或暴露给网页；用户之间不能查看、搜索或猜测读取对方的内容。

生产环境的 CNB、Nginx、自动发布、回滚与备份步骤见 [deploy/README.md](deploy/README.md)。当前线上入口为 [love.chaotools.tech](https://love.chaotools.tech)。

### 本地 Docker 试运行

```bash
git clone <你的仓库> love-vault && cd love-vault
docker compose up --build     # 访问 http://localhost:3000
```

默认只监听 `127.0.0.1:3000`，数据在宿主机 `./data`。公网部署请使用 `deploy/docker-compose.yml` 和反向代理，不要直接暴露容器端口。

### 裸跑 Node（本地开发）

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
| `MOBILE_SERVICE_TOKEN` | - | 小程序后端与 Love Vault 之间的内部服务令牌；仅存于服务器环境变量，绝不能发送给小程序 |
| `WEB_SESSION_SECRET` | - | 用于签发网页扫码登录会话的高强度密钥；生产环境必须设置 |
| `AUTH_BROKER_URL` | - | 小程序后端的 Love Vault 登录桥接地址；网页扫码登录需要它 |
| `LEGACY_USER_ID` | - | 可选。将旧版 `data/` 根目录数据迁移至指定 UUID 用户目录；迁移可恢复且不会覆盖已有文件 |
| `PUBLIC_ORIGIN` | - | 公网网页地址，例如 `https://love.chaotools.tech`；生产环境用于严格 CSRF Origin 校验 |
| `VAULT_ENC_KEY` | - | 生产环境必须设置的高熵密钥。网页保存的 AI API Key 会以 AES-256-GCM 加密落盘，启动时自动迁移已有明文配置与 `.bak` 备份；丢失或更换该密钥会使既有 Key 无法使用 |

### 小程序接入

小程序不直接访问 Love Vault，也不持有网页 Cookie 或内部服务令牌。它先由现有后端验证微信
登录 Token，后端将 OpenID 映射为内部 UUID，再以内部服务令牌代理必要的文字、照片、搜索和
媒体请求。任意有效微信用户首次使用时都会得到一个空的独立记忆库，不使用 OpenID 白名单。

网页端只支持小程序扫码确认登录：登录挑战 5 分钟过期、只能兑换一次；成功后浏览器获得仅限
`love.chaotools.tech` 的 `HttpOnly`、`Secure` 会话 Cookie。不会显示配对码，也没有全站通用密码。

### 安全（上服务器必读）

1. **设置并保管密钥**：`MOBILE_SERVICE_TOKEN`、`WEB_SESSION_SECRET` 与 `VAULT_ENC_KEY` 必须是不同的高强度随机值，只放在服务器环境变量和 GitHub Secrets。迁移前先完成加密备份，之后不要随意轮换 `VAULT_ENC_KEY`。
2. **只开放 Nginx 必要端口**：Love Vault 容器仅绑定 `127.0.0.1:3000`；小程序后端负责鉴权和媒体代理。
3. **上 HTTPS**：公网部署必须套一层反向代理。Nginx 示例配置见 [deploy/love.chaotools.tech.conf](deploy/love.chaotools.tech.conf)；反向代理部署时设 `TRUST_PROXY=1`，让登录 Cookie 保持 `Secure`。

未登录访问网页 API 或媒体将返回 `401`；持有服务令牌但缺少合法内部 UUID 的请求同样会被拒绝。

其他加固：

- **CSRF**：浏览器写请求必须与 `PUBLIC_ORIGIN` 完整一致（协议、主机与端口），跨域写操作返回 `403`；持有内部服务令牌的后端代理不受影响
- **AI 隐私**：健康/生理期数据默认不发送给第三方大模型，可在 ⚙ 设置 → AI 隐私中显式开启
- **上传校验**：扩展名、MIME 与真实媒体内容必须一致；照片最大 10 MB、视频最大 200 MB，拒绝可执行文件、SVG、伪造媒体与超限文件
- **写时备份**：每个 JSON 文件写入前保留上一版为同名 `.bak`，误删误改可回滚

## 备份与搬家

所有记忆（照片、视频、缩略图、各模块数据、配置）都在 `data/`（或你指定的 `DATA_DIR`）里；多用户部署时位于 `data/users/<内部 UUID>/`。**定期备份整个目录**，换机器时恢复该目录即可。生产环境可使用 `deploy/backup.sh` 生成加密备份包。

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
src/auth.js          小程序服务令牌、扫码网页登录会话与本地模式边界
src/user-data.js     按用户隔离的 JSON 存储、媒体目录与旧数据迁移
src/routes/          REST API（memories/profile/preferences/people/events/wishes/gifts/search/ask/config）
public/              前端（原生 ES Modules，无构建）
data/                ★ 全部记忆（多用户时为 users/<内部 UUID>/）
```

## 数据模型速览

- `config.json`：标题、名字、纪念日、AI 配置、密码哈希
- `profile.json`：basics（身高/体重/尺码…）+ health + period + 自定义字段 + story
- `preferences.json` / `people.json` / `events.json` / `wishes.json` / `gifts.json` / `memories.json`

人物关系方向约定：`people.relation` 表示“当前人物 → TA”的关系；`people.relations` 中的
`{ toId, type, note }` 表示“当前人物 → 目标人物”的关系。关系图箭头指向目标人物，关系清单
会用“来源 → 关系 → 目标”完整显示方向；程序不会根据“妈妈”等关系自动推导反向关系。

均为带 `id/createdAt/updatedAt` 的 JSON 数组（profile 为对象），人可直接阅读，方便导出和二次利用。
