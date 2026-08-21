# 生产部署（CNB 镜像）

服务器不会拉取 GitHub 代码或 Docker Hub 镜像；它只从 CNB 拉取已经构建好的应用镜像。

## 首次准备

1. 在 CNB 创建与 Love Vault 对应的仓库，在仓库「制品」中确认 Docker 镜像路径。
2. 当前发布工作流使用同一个 GitHub Secret `CNB_TOKEN` 完成镜像推送，并在部署时通过 SSH 标准输入临时交给服务器拉取镜像；因此该 Token 目前需要该仓库制品的**读写**权限。服务器不会把它持久化到磁盘。
3. 在服务器创建 `/srv/love-vault/.env`（权限 `600`）：

```dotenv
CNB_IMAGE=docker.cnb.cool/chaotools/love-vault
MOBILE_SERVICE_TOKEN=<至少32位随机字符串>
WEB_SESSION_SECRET=<至少32位随机字符串>
BACKUP_PASSPHRASE=<独立的高强度备份密码>
PUBLIC_ORIGIN=https://love.chaotools.tech
VAULT_ENC_KEY=<独立的高强度随机密钥>
```

公开多用户模式下，小程序后端还需设置 `LOVE_VAULT_BASE_URL` 与 `LOVE_VAULT_SERVICE_TOKEN`；不再使用 `LOVE_VAULT_ALLOWED_OPENIDS`。容器默认经 `host.docker.internal:8899` 向该后端兑换扫码登录凭证。

4. 上传 `docker-compose.yml`、`release.sh`、`release-from-stdin.sh`、`backup.sh` 到 `/srv/love-vault/`，并执行 `chmod 700 /srv/love-vault/{release,release-from-stdin,backup}.sh`。
   发布工作流通过 SSH 标准输入临时登录 CNB，拉取后立即退出登录，因此服务器不保存 CNB 凭据。
5. 将 `love.chaotools.tech` 的 A 记录指向服务器；安装 Nginx 配置并通过 Certbot 签发证书。

## GitHub Secrets

| 名称 | 用途 |
| --- | --- |
| `CNB_IMAGE` | 完整镜像名，不含标签 |
| `CNB_TOKEN` | 可推送 `chaotools/love-vault` Docker 制品的访问令牌（需启用 `registry-package` 读写权限） |
| `DEPLOY_HOST` / `DEPLOY_USER` | 服务器 SSH 地址和部署用户 |
| `DEPLOY_SSH_KEY` | 专用部署私钥 |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan` 得到的主机指纹 |

CNB 的 Docker 制品随代码仓库提供；同名镜像路径为 `docker.cnb.cool/chaotools/love-vault`。应使用仅授权该制品库读写权限的专用 Token。若以后将推送与服务器拉取拆成两个 Secret，前者需要读写权限，后者只需要读取权限，同时也要相应修改发布工作流。

## 发布健康检查的边界

发布脚本会轮询 `http://127.0.0.1:3000/api/auth/status`：它确认容器启动、Node 路由可响应，并在失败时回滚到上一镜像标签。该检查**不**会验证微信扫码登录、小程序桥接、第三方 AI 服务或实际上传；这些依赖外部凭据和服务，应在发布后按业务场景手动验证。

## 备份与恢复

用 root/部署用户添加每日定时任务：

```cron
17 3 * * * /srv/love-vault/backup.sh >> /srv/love-vault/backups/backup.log 2>&1
```

恢复时先停止容器，在隔离目录解密并检查备份内容，确认后再替换 `/srv/love-vault/data`；不要把未验证的备份直接覆盖在线数据。
