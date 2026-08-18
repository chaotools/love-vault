// 媒体处理：EXIF 拍摄时间解析、缩略图、视频封面、HEIC 转换、文件夹自动索引
// 核心逻辑移植自 love-memory 项目并重构为可注入目录的形式
const sharp = require('sharp');
const { execFile } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');

let MEDIA_DIR = null;
let THUMB_DIR = null;

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mts', 'm2ts', '3gp']);
const HEIC_EXT = new Set(['heic', 'heif']);

function init(mediaDir, thumbDir) {
  MEDIA_DIR = mediaDir;
  THUMB_DIR = thumbDir;
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

const extOf = (name) => path.extname(name).toLowerCase().replace('.', '');

function parseDateValue(v) {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// 轻量 EXIF 解析：从 sharp 读到的 exif buffer 里提取拍摄时间
function readExifDate(exifBuf) {
  if (!exifBuf || exifBuf.length < 8) return null;
  const b = exifBuf;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 0;
  if (b.toString('latin1', 0, 6) === 'Exif\0\0') off = 6;
  const endian = (b.readUInt8(off) === 0x49) ? 'LE' : 'BE';
  const u16 = (a) => view.getUint16(a, endian === 'LE');
  const u32 = (a) => view.getUint32(a, endian === 'LE');
  if (u16(off + 2) !== 0x2a) return null;

  const ifd0 = off + u32(off + 4);

  const findEntry = (ifdPos, tag) => {
    try {
      const count = u16(ifdPos);
      for (let i = 0; i < count; i++) {
        const e = ifdPos + 2 + i * 12;
        if (u16(e) === tag) return e;
      }
    } catch (e) { /* ignore */ }
    return -1;
  };
  const readAscii = (e) => {
    try {
      const type = u16(e + 2);
      const count = u32(e + 4);
      let abs;
      if (type === 2 && count > 4) abs = off + u32(e + 8);
      else abs = e + 8;
      return b.toString('latin1', abs, abs + count).replace(/\0+$/, '').trim();
    } catch (err) { return null; }
  };

  const candidates = [];
  const e132 = findEntry(ifd0, 0x0132); // IFD0.DateTime
  if (e132 > 0) candidates.push(readAscii(e132));
  const eExif = findEntry(ifd0, 0x8769); // Exif 子 IFD 指针
  if (eExif > 0) {
    const exifIfd = off + u32(eExif + 8);
    const e9003 = findEntry(exifIfd, 0x9003); // DateTimeOriginal
    if (e9003 > 0) candidates.push(readAscii(e9003));
    const e9004 = findEntry(exifIfd, 0x9004); // DateTimeDigitized
    if (e9004 > 0) candidates.push(readAscii(e9004));
  }
  for (const s of candidates) {
    if (s) { const d = parseDateValue(s); if (d) return d; }
  }
  return null;
}

async function readImageDate(p) {
  try {
    const meta = await sharp(p, { failOn: 'none' }).metadata();
    if (meta.exif) {
      const d = readExifDate(meta.exif);
      if (d) return d;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function readVideoDate(p) {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_entries', 'format_tags', p
    ]);
    const data = JSON.parse(stdout);
    const tags = (data.format && data.format.tags) || {};
    const prefer = ['creation_time', 'DateTimeOriginal', 'DateTimeDigitized', 'DateTime'];
    for (const k of prefer) if (tags[k]) return parseDateValue(tags[k]);
    for (const k of Object.keys(tags)) if (/date|time/i.test(k) && tags[k]) return parseDateValue(tags[k]);
  } catch (e) { /* ignore */ }
  return null;
}

async function probeVideo(p) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p
  ]);
  const data = JSON.parse(stdout);
  const v = (data.streams || []).find((s) => s.codec_type === 'video');
  return {
    width: v ? v.width : null,
    height: v ? v.height : null,
    duration: data.format && data.format.duration ? parseFloat(data.format.duration) : null
  };
}

async function generateImageThumb(src, dest) {
  await sharp(src)
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 74 })
    .toFile(dest);
}

async function generateVideoCover(src, dest, duration) {
  const seek = duration && duration > 0 ? Math.min(Math.max(duration * 0.1, 0), 3) : 0;
  try {
    await execFileP('ffmpeg', [
      '-y', '-ss', String(seek), '-i', src, '-frames:v', '1',
      '-vf', "scale='min(960,iw)':-2", dest
    ]);
  } catch (e) {
    await execFileP('ffmpeg', ['-y', '-ss', '0', '-i', src, '-frames:v', '1', dest]);
  }
}

// 把一个媒体文件索引成记忆对象（location/eventId 由用户后续编辑补充）
async function indexFile(fullPath, filename, id, dirs = {}) {
  const ext = extOf(filename);
  const stat = await fsp.stat(fullPath);
  const isVideo = VIDEO_EXT.has(ext);
  const mem = {
    id, type: isVideo ? 'video' : 'photo',
    filename, ext,
    width: null, height: null, duration: null,
    takenAt: null, note: '', tags: [], eventId: null, location: '',
    uploadedAt: new Date().toISOString()
  };
  const thumbPath = path.join(dirs.thumbDir || THUMB_DIR, id + '.jpg');

  const takenAtOverride = dirs.takenAt || null;

  if (isVideo) {
    mem.takenAt = takenAtOverride || (await readVideoDate(fullPath)) || stat.mtime.toISOString();
    try { const info = await probeVideo(fullPath); mem.width = info.width; mem.height = info.height; mem.duration = info.duration; } catch (e) { /* ignore */ }
    try { await generateVideoCover(fullPath, thumbPath, mem.duration); } catch (e) { console.error('视频封面生成失败:', e.message); }
  } else {
    mem.takenAt = takenAtOverride || (await readImageDate(fullPath)) || stat.mtime.toISOString();
    try { const m = await sharp(fullPath).metadata(); mem.width = m.width; mem.height = m.height; } catch (e) { /* ignore */ }
    try { await generateImageThumb(fullPath, thumbPath); } catch (e) { console.error('缩略图生成失败:', e.message); }
  }
  return mem;
}

// HEIC/HEIF 转 jpg（浏览器才能直接显示）；返回新的文件名
async function convertHeic(fullPath, filename) {
  const jpgName = filename.replace(/\.[^.]+$/, '.jpg');
  const jpgPath = path.join(path.dirname(fullPath), jpgName);
  await execFileP('ffmpeg', ['-y', '-i', fullPath, '-q:v', '2', jpgPath]);
  await fsp.unlink(fullPath).catch(() => {});
  return { filename: jpgName, fullPath: jpgPath };
}

module.exports = {
  init, indexFile, convertHeic, extOf, VIDEO_EXT, HEIC_EXT,
  MEDIA_DIR: () => MEDIA_DIR, THUMB_DIR: () => THUMB_DIR
};
