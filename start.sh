#!/usr/bin/env bash
# Linux/macOS 启动脚本
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
    echo "首次运行，正在安装依赖，请稍候..."
    npm install
fi

echo "启动中: http://localhost:3000"
OPEN_BROWSER=0 exec node server.js
