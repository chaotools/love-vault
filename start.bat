@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
    echo 首次运行，正在安装依赖，请稍候...
    call npm install
)

echo 启动中，浏览器会自动打开...
node server.js
pause
