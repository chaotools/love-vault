// 通用集合路由：为 preferences / people / events / wishes / gifts 生成 CRUD API
// sanitize 负责白名单过滤字段并做类型清洗
const express = require('express');

const str = (v) => (typeof v === 'string' ? v.trim() : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const dateStr = (v) => {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

function collectionRouter(collection, sanitize) {
  const r = express.Router();
  const resolve = (req) => typeof collection === 'function' ? collection(req) : collection;

  r.get('/', (req, res) => res.json(resolve(req).list()));

  r.post('/', async (req, res) => {
    try {
      const fields = sanitize(req.body || {}, false, null);
      const item = await resolve(req).add(fields);
      res.json(item);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.patch('/:id', async (req, res) => {
    const item = resolve(req).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const patch = sanitize(req.body || {}, true, item.id);
    // 过滤掉未传的字段，避免把已有值覆盖成 undefined
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(clean).length) return res.status(400).json({ error: '没有可更新的字段' });
    const updated = await resolve(req).update(req.params.id, clean);
    res.json(updated);
  });

  r.delete('/:id', async (req, res) => {
    const ok = await resolve(req).remove(req.params.id);
    ok ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' });
  });

  return r;
}

const inEnum = (v, values) => (values.includes(v) ? v : undefined);

module.exports = { collectionRouter, str, bool, dateStr, inEnum };
