// 全局搜索：跨全部模块，返回分组结果供前端跳转
const express = require('express');

function searchRouter(getData) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ q: '', groups: [] });
    const d = getData(req);
    const hits = [];
    const push = (module, id, title, subtitle) => hits.push({ module, id, title, subtitle });

    for (const m of d.memories) {
      const hay = [m.note, (m.tags || []).join(' '), m.location, m.filename].join(' ').toLowerCase();
      if (hay.includes(q)) push('memories', m.id, m.note || m.tags.join('/') || m.filename, (m.takenAt || '').slice(0, 10) + ' · ' + (m.type === 'video' ? '视频' : '照片'));
    }
    const p = d.profile;
    if (p) {
      const scan = (obj, prefix) => {
        for (const [k, v] of Object.entries(obj || {})) {
          if (typeof v === 'string' && v.toLowerCase().includes(q)) push('profile', k, prefix + k + '：' + v, 'TA的档案');
        }
      };
      scan(p.basics, ''); scan(p.health, '健康·');
      for (const f of p.customFields || []) {
        if ((f.label + ' ' + f.value).toLowerCase().includes(q)) push('profile', f.id, f.label + '：' + f.value, 'TA的档案·自定义');
      }
      if ((p.story || '').toLowerCase().includes(q)) push('profile', 'story', '我们的故事', 'TA的档案');
    }
    for (const it of d.preferences) {
      if ([it.title, it.detail, it.category].join(' ').toLowerCase().includes(q))
        push('preferences', it.id, it.title, it.polarity + ' · ' + it.category);
    }
    for (const it of d.people) {
      if ([it.name, it.relation, it.notes, it.howMet, it.group].join(' ').toLowerCase().includes(q))
        push('people', it.id, it.name, [it.relation, it.group, it.birthday].filter(Boolean).join(' · '));
    }
    for (const it of d.events) {
      if ([it.title, it.description, it.location, it.type].join(' ').toLowerCase().includes(q))
        push('events', it.id, it.title, (it.date || '').slice(0, 10) + ' · ' + it.type);
    }
    for (const it of d.wishes) {
      if ([it.title, it.note, it.source].join(' ').toLowerCase().includes(q))
        push('wishes', it.id, it.title, '愿望 · ' + it.status);
    }
    for (const it of d.gifts) {
      if ([it.title, it.occasion, it.note].join(' ').toLowerCase().includes(q))
        push('gifts', it.id, it.title, '礼物 · ' + it.direction);
    }
    for (const md of (d.config.memorialDays || [])) {
      if ((md.name + ' ' + md.date).toLowerCase().includes(q)) push('config', md.name, md.name, '纪念日 · ' + md.date);
    }

    // 按模块分组，组内最多 8 条
    const order = ['memories', 'profile', 'preferences', 'people', 'events', 'wishes', 'gifts', 'config'];
    const names = { memories: '照片视频', profile: 'TA的档案', preferences: '喜好', people: '人名', events: '大事记', wishes: '愿望', gifts: '礼物', config: '纪念日' };
    const groups = order
      .map((mod) => ({ module: mod, name: names[mod], items: hits.filter((h) => h.module === mod).slice(0, 8) }))
      .filter((g) => g.items.length);
    res.json({ q: req.query.q, groups });
  });

  return r;
}

module.exports = { searchRouter };
