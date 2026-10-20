// 登录流程的纯判断，方便测试且避免认证状态判断散落在 DOM 代码里。
export function shouldStartWebLogin(status) {
  return Boolean(status && status.authenticated === false);
}

export function authScopeFromStatus(status) {
  if (status && typeof status.scope === 'string' && status.scope.trim()) return status.scope.trim();
  if (status && status.authenticated === true && status.enabled === false) return 'local';
  return 'anonymous';
}
