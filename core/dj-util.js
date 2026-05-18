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
  const play = Array.isArray(obj && obj.play) ? obj.play : [];
  return {
    say: (obj && obj.say) || '……',
    play: play
      .map((p) =>
        typeof p === 'string'
          ? { name: p, artist: '' }
          : { name: (p && p.name) || '', artist: (p && p.artist) || '' }
      )
      .filter((p) => p.name),
    reason: (obj && obj.reason) || '',
    segue: (obj && obj.segue) || '',
    source,
  };
}

function mockResponse(opts = {}) {
  let playlists = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(paths.user, 'playlists.json'), 'utf8'));
    playlists = j.playlists || [];
  } catch {
    /* 无歌单也能给出空 play */
  }
  const hour = new Date().getHours();
  let pick = playlists[0];
  if (hour < 9) pick = playlists.find((p) => /早晨/.test(p.mood)) || pick;
  else if (hour < 18) pick = playlists.find((p) => /专注/.test(p.mood)) || pick;
  else pick = playlists.find((p) => /放松|深夜/.test(p.mood)) || pick;

  const tracks = pick && pick.tracks ? pick.tracks.slice(0, 2) : [];
  const input = opts.userInput ? `你说「${opts.userInput}」，` : '';
  const say =
    `${input}这是 Claudio。现在是${hour}点出头，` +
    (tracks.length
      ? `给你放一首${tracks[0].name}，让此刻慢下来。`
      : '先陪你待一会儿，想听什么随时告诉我。') +
    `（当前为本地模拟模式——在 .env 配置 DEEPSEEK_API_KEY 后我会真正为你编排。）`;

  return normalize(
    {
      say,
      play: tracks,
      reason: `模拟模式：按时段选用歌单「${pick ? pick.name : '默认'}」`,
      segue: '我就在这条频率上，不走开。',
    },
    'mock'
  );
}

module.exports = { extractDjJson, normalize, mockResponse };
