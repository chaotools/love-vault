# 生产部署（CNB 镜像）

服务器不会拉取 GitHub 代码或 Docker Hub 镜像；它只从 CNB 拉取已经构建好的应用镜像。

## 首次准备

1. 在 CNB 创建与 Love Vault 对应的仓库，在仓库「制品」中确认 Docker 镜像路径。
2. 创建**只读**部署令牌，授权该仓库的制品拉取权限。
3. 在服务器创建 `/srv/love-vault/.env`（权限 `600`）：

```dotenv
CNB_IMAGE=docker.cnb.cool/<你的-CNB-仓库路径>/love-vault
MOBILE_SERVICE_TOKEN=<至少32位随机字符串>
BACKUP_PASSPHRASE=<独立的高强度备份密码>
```

4. 登录 CNB（令牌不会写入 Git 仓库）：

```bash
echo '<只读-CNB-部署令牌>' | docker login docker.cnb.cool -u cnb --password-stdin
```

5. 上传 `docker-compose.yml`、`release.sh`、`backup.sh` 到 `/srv/love-vault/`，并执行 `chmod 700 /srv/love-vault/{release,backup}.sh`。
6. 将 `love.chaotools.tech` 的 A 记录指向服务器；安装 Nginx 配置并通过 Certbot 签发证书。

## GitHub Secrets

| 名称 | 用途 |
| --- | --- |
| `CNB_IMAGE` | 完整镜像名，不含标签 |
| `CNB_TOKEN` | 可推送该 CNB 制品的访问令牌 |
| `DEPLOY_HOST` / `DEPLOY_USER` | 服务器 SSH 地址和部署用户 |
| `DEPLOY_SSH_KEY` | 专用部署私钥 |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan` 得到的主机指纹 |

服务器上的 CNB 凭据只能拉取，GitHub Actions 中的 CNB 令牌才允许推送。

## 备份与恢复

用 root/部署用户添加每日定时任务：

```cron
17 3 * * * /srv/love-vault/backup.sh >> /srv/love-vault/backups/backup.log 2>&1
```

恢复时先停止容器，在隔离目录解密并检查备份内容，确认后再替换 `/srv/love-vault/data`；不要把未验证的备份直接覆盖在线数据。
