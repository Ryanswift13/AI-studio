'use strict';
// TTS.JS —— 声音管线：Fish Audio 合成 → 缓存为 cache/tts/<hash>.mp3。
// 同一段文本只合成一次（按 hash 复用）。Fish 不可用时返回 audio:null（文本降级）。
const fs = require('fs');
const path = require('path');
const config = require('./config');
const fish = require('./integrations/fish');
const { paths } = require('./paths');
const { sha1, log } = require('./util');

// 把一段台词合成为语音。返回 { text, audio, hash }，audio 为 media:// URL 或 null。
async function speak(text) {
  const clean = (text || '').trim();
  if (!clean) return { text: '', audio: null, hash: null };

  const hash = sha1(`${clean}|${config.fish.voiceId || ''}`);
  const file = path.join(paths.cacheTts, `${hash}.mp3`);
  const url = `media://tts/${hash}.mp3`;

  if (fs.existsSync(file)) {
    return { text: clean, audio: url, hash };
  }
  const buf = await fish.synthesize(clean);
  if (!buf) {
    return { text: clean, audio: null, hash: null };
  }
  fs.writeFileSync(file, buf);
  log('tts', `已缓存 ${hash}.mp3`);
  return { text: clean, audio: url, hash };
}

// 给定 hash 取回缓存文件路径（供 media:// 协议与 REPLAY 使用）。
function fileForHash(hash) {
  const safe = String(hash).replace(/[^a-f0-9]/gi, '');
  if (!safe) return null;
  const file = path.join(paths.cacheTts, `${safe}.mp3`);
  return fs.existsSync(file) ? file : null;
}

module.exports = { speak, fileForHash };
