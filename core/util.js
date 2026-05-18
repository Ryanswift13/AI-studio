'use strict';
// 通用工具：带超时的 fetch、日志、哈希。
const crypto = require('crypto');

// 带超时的 fetch（Node ≥18 全局 fetch）。
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}, timeoutMs = 8000) {
  const res = await fetchWithTimeout(url, opts, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchBuffer(url, opts = {}, timeoutMs = 20000) {
  const res = await fetchWithTimeout(url, opts, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// 本地日期 YYYY-MM-DD。
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function log(scope, ...args) {
  console.log(`[${scope}]`, ...args);
}

function warn(scope, ...args) {
  console.warn(`[${scope}]`, ...args);
}

// 生成一段柔和正弦音的 WAV data URI —— 网易云不可达时作占位音频。
function toneWav(freqHz = 220, seconds = 8, sampleRate = 22050) {
  const n = Math.floor(sampleRate * seconds);
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  const fade = sampleRate * 0.05;
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade) * Math.min(1, (n - i) / fade);
    // 叠加一个五度音，听感更像「音乐占位」而非测试音
    const s =
      (Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 0.6 +
        Math.sin((2 * Math.PI * freqHz * 1.5 * i) / sampleRate) * 0.4) *
      0.12 *
      env;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

module.exports = {
  fetchWithTimeout,
  fetchJson,
  fetchBuffer,
  sha1,
  todayStr,
  log,
  warn,
  toneWav,
};
