const express = require('express');
const { rateLimit } = require('../rate-limit');
const { createTencentMapClient } = require('../tencent-map');

function geoRouter() {
  const r = express.Router();
  const mapKey = String(process.env.TENCENT_MAP_JS_KEY || '').trim();
  const webServiceKey = String(process.env.TENCENT_MAP_WEBSERVICE_KEY || '').trim();
  const client = createTencentMapClient({
    key: webServiceKey,
    referer: String(process.env.TENCENT_MAP_REFERER || '').trim()
  });

  r.get('/status', (req, res) => {
    res.json({
      provider: 'tencent',
      configured: Boolean(webServiceKey && mapKey),
      suggest: Boolean(webServiceKey),
      reverse: Boolean(webServiceKey),
      mapKey
    });
  });

  r.get('/suggest', rateLimit({ windowMs: 60_000, max: 30, name: '地点提示' }), async (req, res) => {
    const q = String(req.query.q || '').trim();
    const region = String(req.query.region || '').trim().slice(0, 30);
    if (!q) return res.status(400).json({ error: '请输入地点关键词' });
    if (q.length > 80) return res.status(400).json({ error: '地点关键词太长' });
    try {
      const result = await client.suggest(q, { region });
      res.json(result);
    } catch (error) {
      res.status(error.status || 502).json({ error: error.message });
    }
  });

  r.get('/reverse', rateLimit({ windowMs: 60_000, max: 20, name: '逆地址解析' }), async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: '坐标无效' });
    }
    try {
      res.json(await client.reverse(lat, lng));
    } catch (error) {
      res.status(error.status || 502).json({ error: error.message });
    }
  });

  return r;
}

module.exports = { geoRouter };