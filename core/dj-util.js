'use strict';
// DJ 输出解析与模拟响应（大脑适配器共用）。
const fs = require('fs');
const path = require('path');
const { paths } = require('./paths');

function extractDjJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalize(obj, source) {
  obj = obj || {};
  // 新 Set 格式 (theme/intro/tracks+transition/outro) 优先；兼容旧 say/play 降级
  const theme = String(obj.theme || '').trim();
  const intro = String(obj.intro || obj.say || '').trim();
  const outro = String(obj.outro || '').trim();
  const rawTracks = Array.isArray(obj.tracks)
    ? obj.tracks
    : Array.isArray(obj.play)
      ? obj.play.map((p) =>
          typeof p === 'string'
            ? { name: p, artist: '', transition: null }
            : { name: p && p.name, artist: p && p.artist, transition: null }
        )
      : [];
  const tracks = rawTracks
    .map((t, i) => ({
      name: String((t && t.name) || '').trim(),
      artist: String((t && t.artist) || '').trim(),
      transition:
        i === 0 ? null : String((t && t.transition) || '').trim() || null,
    }))
    .filter((t) => t.name);
  const remember = Array.isArray(obj.remember) ? obj.remember : [];
  return {
    theme,
    intro,
    outro,
    tracks,
    // 向后兼容老调用方读 say/play
    say: intro,
    play: tracks.map((t) => ({ name: t.name, artist: t.artist })),
    reason: String(obj.reason || '').trim(),
    segue: String(obj.segue || '').trim(),
    remember: remember
      .map((r) => ({
        type: (r && r.type) || '',
        content: (r && r.content) || '',
        expires_in_days:
          r && r.expires_in_days != null ? Number(r.expires_in_days) : null,
      }))
      .filter((r) => r.type && r.content),
    source,
  };
}

function mockResponse(opts = {}) {
  let playlists = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(paths.user, 'playlists.json'), 'utf8'));
    playlists = j.playlists || [];
  } catch {
    /* 无歌单也能给出空 set */
  }
  const hour = new Date().getHours();
  let pick = playlists[0];
  if (hour < 9) pick = playlists.find((p) => /早晨/.test(p.mood)) || pick;
  else if (hour < 18) pick = playlists.find((p) => /专注/.test(p.mood)) || pick;
  else pick = playlists.find((p) => /放松|深夜/.test(p.mood)) || pick;

  const picked = pick && pick.tracks ? pick.tracks.slice(0, 3) : [];
  const tracks = picked.map((t, i) => ({
    name: t.name,
    artist: t.artist || '',
    transition: i === 0 ? null : `（mock 过渡，未配 API key 时的占位）`,
  }));
  const input = opts.userInput ? `你说「${opts.userInput}」，` : '';
  const theme = pick ? `${pick.name}（mock 模式）` : '本地模拟';
  return normalize(
    {
      theme,
      intro:
        `${input}这是 Claudio。现在是${hour}点出头，` +
        (tracks.length
          ? `给你放${tracks[0].name}起头，让此刻慢下来。`
          : '先陪你待一会儿，想听什么随时告诉我。') +
        `（当前为本地模拟模式——在 .env 配置 DEEPSEEK_API_KEY 后我会真正为你编排。）`,
      tracks,
      outro: tracks.length ? '这一段先到这。' : '',
      reason: `模拟模式：按时段选用歌单「${pick ? pick.name : '默认'}」`,
    },
    'mock'
  );
}

// 把 (voice, text) 组装成 speech 对象；text 空返回 null；voice 没合成成功就只带文字。
function makeSpeech(voice, text) {
  if (!text) return null;
  if (voice && voice.audio) {
    return { audio: voice.audio, hash: voice.hash, text };
  }
  return { audio: null, hash: null, text };
}

module.exports = { extractDjJson, normalize, mockResponse, makeSpeech };
