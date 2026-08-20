// 轻量、无依赖的固定窗口限流。按已认证 user_id 限制，匿名登录流程按 IP 限制。
function rateLimit({ windowMs, max, name = '操作', key = (req) => req.vaultUserId || req.ip || req.socket?.remoteAddress || 'anonymous', skip = () => false }) {
  const buckets = new Map();
  let operations = 0;
  return (req, res, next) => {
    if (skip(req)) return next();
    const now = Date.now();
    if (++operations % 128 === 0) {
      for (const [bucketKey, value] of buckets) if (now >= value.resetAt) buckets.delete(bucketKey);
    }
    const id = String(key(req));
    const current = buckets.get(id);
    const bucket = !current || now >= current.resetAt
      ? { count: 0, resetAt: now + windowMs }
      : current;
    bucket.count++;
    buckets.set(id, bucket);
    if (bucket.count <= max) return next();
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({ error: `${name}过于频繁，请稍后再试` });
  };
}

module.exports = { rateLimit };
