// 运行时监听地址：默认只绑定本机，避免未配置认证时把数据暴露到局域网。
const DEFAULT_HOST = '127.0.0.1';

function resolveHost(value) {
  const host = typeof value === 'string' ? value.trim() : '';
  return host || DEFAULT_HOST;
}

function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1';
}

// 本地模式没有登录边界；若显式绑定到非回环地址，启动时给出醒目警告。
function shouldWarnUnauthExposure(host, authConfigured) {
  return !authConfigured && !isLoopbackHost(host);
}

module.exports = { DEFAULT_HOST, resolveHost, isLoopbackHost, shouldWarnUnauthExposure };
