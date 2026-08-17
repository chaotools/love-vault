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

COPY server.js ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    OPEN_BROWSER=0 \
    HOST=0.0.0.0 \
    PORT=3000

# data 目录通过 volume 挂载持久化
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
