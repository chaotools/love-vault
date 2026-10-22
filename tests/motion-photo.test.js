const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { findMotionPhotoPayload } = require('../src/media');

function motionJpeg(video) {
  const xmp = Buffer.from(`<x:xmpmeta><rdf:Description Camera:MotionPhoto="1" MZCamera:LivePhoto="id"><Container:Directory><rdf:li><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/></rdf:li><rdf:li><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${video.length}"/></rdf:li></Container:Directory></rdf:Description></x:xmpmeta>`, 'latin1');
  return Buffer.concat([Buffer.from([0xff, 0xd8]), xmp, Buffer.from([0xff, 0xd9]), video]);
}

test('识别 Meizu/Google Motion Photo 的内嵌 MP4 偏移', () => {
  const video = Buffer.from('00000018667479706d70343200000000', 'hex');
  const buffer = motionJpeg(video);
  const result = findMotionPhotoPayload(buffer);
  assert.deepEqual(result, { offset: buffer.length - video.length, length: video.length });
});

test('普通 JPEG 不会被误判为动态照片', () => {
  assert.equal(findMotionPhotoPayload(Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])), null);
});

test('缺少视频长度或 ftyp 头时拒绝提取', () => {
  const xmp = Buffer.from('<x:xmpmeta Camera:MotionPhoto="1"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto"/></x:xmpmeta>', 'latin1');
  assert.equal(findMotionPhotoPayload(Buffer.concat([Buffer.from([0xff, 0xd8]), xmp])), null);
  const fake = Buffer.concat([Buffer.from([0xff, 0xd8]), xmp, Buffer.from('0000000000000000')]);
  assert.equal(findMotionPhotoPayload(fake), null);
});
test('实况照片接口与前端播放入口已接线', () => {
  const root = path.join(__dirname, '..');
  const content = fs.readFileSync(path.join(root, 'src/routes/content.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'public/js/core.js'), 'utf8');
  const timeline = fs.readFileSync(path.join(root, 'public/js/views/timeline.js'), 'utf8');
  assert.match(content, /motionUrl/);
  assert.match(content, /-motion\.mp4/);
  assert.match(core, /lb-live-play/);
  assert.match(core, /m\.motionUrl/);
  assert.match(timeline, /live-badge/);
});