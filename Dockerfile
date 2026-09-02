# 爱人记忆库 · Love Vault
# 任意服务器可复现：docker build -t love-vault . && docker compose up -d
FROM node:20-bookworm-slim

# ffmpeg：视频封面提取 + HEIC 转换
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（利用 Docker 层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production \
    OPEN_BROWSER=0 \
    HOST=0.0.0.0 \
    PORT=3000

# data 目录通过 volume 挂载持久化
VOLUME ["/app/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/auth/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
