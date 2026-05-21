'use strict';
// TTS.JS —— 声音管线：合成台词 → 缓存为 cache/tts/<hash>.mp3。
// 引擎优先级：Fish Audio（配了 key）→ Edge TTS（免费）→ 纯文本降级。
// 同一段文本 + 同一声音只合成一次（按 hash 复用）。
const fs = require('fs');
const path = require('path');
const config = require('./config');
const fish = require('./integrations/fish');
const edge = require('./integrations/edge-tts');
const { paths } = require('./paths');
const { sha1, log } = require('./util');

// 当前生效的声音标识，并入缓存 hash，避免换引擎后命中旧音频。
function voiceTag() {
  return config.fish.apiKey ? `fish:${config.fish.voiceId}` : `edge:${config.edge.voice}`;
}

// 把一段台词合成为语音。返回 { text, audio, hash }，audio 为 media:// URL 或 null。
async function speak(text) {
  const clean = (text || '').trim();
  if (!clean) return { text: '', audio: null, hash: null };

  const hash = sha1(`${clean}|${voiceTag()}`);
  const file = path.join(paths.cacheTts, `${hash}.mp3`);
  const url = `media://tts/${hash}.mp3`;

  if (fs.existsSync(file)) {
    return { text: clean, audio: url, hash };
  }
  const buf = (await fish.synthesize(clean)) || (await edge.synthesize(clean));
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

// 批量合成多段台词；并行；任一段失败该位置返回 {audio:null}；空字符串返回 null entry。
// 单段超 80 字截断（防 Edge TTS 长句问题）。
async function speakBatch(texts) {
  if (!Array.isArray(texts)) return [];
  return Promise.all(
    texts.map(async (raw) => {
      const t = String(raw || '').trim();
      if (!t) return null;
      const clipped = t.length > 80 ? t.slice(0, 77) + '...' : t;
      try {
        return await speak(clipped);
      } catch (e) {
        return { text: clipped, audio: null, hash: null, error: e.message };
      }
    })
  );
}

module.exports = { speak, speakBatch, fileForHash };
