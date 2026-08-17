// 一键迁移：从旧版 love-memory 项目导入照片/视频与配置
// 用法：node migrate-old.js [旧项目路径]（默认尝试 ../love-memory）
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const NEW_ROOT = __dirname;
const OLD_ROOT = path.resolve(process.argv[2] || path.join(NEW_ROOT, '..', 'love-memory'));

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message)); else resolve({ stdout, stderr });
    });
  });
}

async function main() {
  const oldData = path.join(OLD_ROOT, 'data');
  const oldMetaFile = path.join(oldData, 'metadata.json');
  const oldConfigFile = path.join(OLD_ROOT, 'config.json');

  console.log('旧项目:', OLD_ROOT);
  let oldMeta = [];
  try { oldMeta = JSON.parse(await fsp.readFile(oldMetaFile, 'utf8')); } catch (e) {
    console.log('没有找到旧数据（metadata.json），无需迁移。');
    return;
  }

  const newData = path.join(NEW_ROOT, 'data');
  const newMedia = path.join(newData, 'media');
  const newThumbs = path.join(newData, 'thumbs');
  const newMusic = path.join(newData, 'music');
  for (const d of [newData, newMedia, newThumbs, newMusic]) await fsp.mkdir(d, { recursive: true });

  // 迁移媒体文件 + 缩略图
  let copied = 0, missing = 0;
  for (const m of oldMeta) {
    const src = path.join(oldData, 'media', m.filename);
    const dst = path.join(newMedia, m.filename);
    try {
      await fsp.copyFile(src, dst);
      copied++;
    } catch (e) { missing++; continue; }
    const oldThumb = path.join(oldData, 'thumbs', m.id + '.jpg');
    try { await fsp.copyFile(oldThumb, path.join(newThumbs, m.id + '.jpg')); } catch (e) { /* 启动时会重新生成 */ }
  }
  console.log(`照片/视频: 复制 ${copied} 个${missing ? `，跳过缺失 ${missing} 个` : ''}`);

  // 旧 metadata.json → 新 memories.json（字段兼容：event → eventId 置空，新增 location）
  const memories = oldMeta.map((m) => ({
    ...m,
    note: m.note || '', tags: m.tags || [], event: undefined, eventId: null, location: ''
  }));
  await fsp.writeFile(path.join(newData, 'memories.json'), JSON.stringify(memories, null, 2));
  console.log('记忆索引: memories.json 已生成');

  // 配置迁移（标题/名字/纪念日/音乐 + 音乐文件）
  try {
    const oldCfg = JSON.parse(await fsp.readFile(oldConfigFile, 'utf8'));
    const newCfg = {
      title: oldCfg.title || '爱人记忆库',
      names: oldCfg.names || '',
      anniversary: oldCfg.anniversary || '',
      music: oldCfg.music || '',
      memorialDays: oldCfg.memorialDays || []
    };
    await fsp.writeFile(path.join(newData, 'config.json'), JSON.stringify(newCfg, null, 2));
    if (oldCfg.music) {
      try { await fsp.copyFile(path.join(oldData, 'music', oldCfg.music), path.join(newMusic, oldCfg.music)); } catch (e) { /* 没有就算了 */ }
    }
    console.log('配置: 已迁移', JSON.stringify(newCfg));
  } catch (e) { console.log('配置: 旧配置缺失或不可读，使用默认值'); }

  console.log('\n迁移完成！运行 npm start 启动新版，旧项目原样未动。');
}

main().catch((e) => { console.error('迁移失败:', e.message); process.exit(1); });
