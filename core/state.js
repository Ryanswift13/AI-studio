'use strict';
// STATE.DB —— 状态与记忆持久化：messages / plays / plan / prefs，跨重启保留。
// 采用单文件 JSON 存储（data/state.json），零原生依赖，便于打包分发。
const fs = require('fs');
const { paths, ensureDirs } = require('./paths');

ensureDirs();
const FILE = paths.stateFile;

const EMPTY_SET = {
  theme: '',
  started_at: 0,
  tracks_planned: 0,
  tracks_played: 0,
  outro_played: false,
  ended_at: null,
};

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      seq: j.seq || 0,
      messages: j.messages || [],
      plays: j.plays || [],
      plan: j.plan || {},
      prefs: j.prefs || {},
      currentSet: j.currentSet || { ...EMPTY_SET },
      lastUserInputAt: j.lastUserInputAt || 0,
    };
  } catch {
    return {
      seq: 0, messages: [], plays: [], plan: {}, prefs: {},
      currentSet: { ...EMPTY_SET },
      lastUserInputAt: 0,
    };
  }
}

const store = load();

// 同步落盘（数据量小，保证跨重启与异常退出不丢）。
function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store));
  } catch (e) {
    console.warn('[state] 写入失败：', e.message);
  }
}

// 控制内存与文件膨胀。
const LIMITS = { messages: 500, plays: 500 };
function trim() {
  for (const k of Object.keys(LIMITS)) {
    if (store[k].length > LIMITS[k]) store[k] = store[k].slice(-LIMITS[k]);
  }
}

// ── messages ──────────────────────────────────────────
function addMessage(role, content, meta = null) {
  const m = { id: ++store.seq, role, content, meta: meta || null, ts: Date.now() };
  store.messages.push(m);
  trim();
  persist();
  return m;
}
function recentMessages(limit = 20) {
  return store.messages.slice(-limit); // 时间正序
}

// ── plays ─────────────────────────────────────────────
function addPlay({ name, artist = '', song_id = '', reason = '' }) {
  const p = {
    id: ++store.seq,
    name,
    artist,
    song_id: String(song_id),
    reason,
    played_at: Date.now(),
  };
  store.plays.push(p);
  trim();
  persist();
  return p;
}
function recentPlays(limit = 30) {
  return store.plays.slice(-limit).reverse(); // 最近在前
}
// 本地自然日（00:00 起）的播放，用于避免一天内重复选曲。
function playsToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const ts = start.getTime();
  return store.plays.filter((p) => p.played_at >= ts);
}
function topArtists(limit = 8) {
  const count = {};
  for (const p of store.plays) {
    if (p.artist) count[p.artist] = (count[p.artist] || 0) + 1;
  }
  return Object.entries(count)
    .map(([artist, n]) => ({ artist, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}
function playHours() {
  const buckets = {};
  for (const p of store.plays) {
    const h = new Date(p.played_at).getHours();
    buckets[h] = (buckets[h] || 0) + 1;
  }
  return Object.entries(buckets).map(([hour, n]) => ({ hour: Number(hour), n }));
}

// ── plan ──────────────────────────────────────────────
function savePlan(date, payload) {
  store.plan[date] = { ...payload, created_at: Date.now() };
  persist();
}
function getPlan(date) {
  const p = store.plan[date];
  return p ? { date, ...p } : null;
}

// ── prefs ─────────────────────────────────────────────
function getPref(key, fallback = null) {
  return key in store.prefs ? store.prefs[key] : fallback;
}
function setPref(key, value) {
  store.prefs[key] = String(value);
  persist();
}

// ── currentSet ────────────────────────────────────────
// Set 抽象：theme + 总曲数 + 已播数 + outro 标志 + 收尾时间，跨重启可恢复。
function startSet({ theme = '', planned = 0 } = {}) {
  store.currentSet = {
    theme: String(theme || ''),
    started_at: Date.now(),
    tracks_planned: Number(planned) || 0,
    tracks_played: 0,
    outro_played: false,
    ended_at: null,
  };
  persist();
  return store.currentSet;
}
function appendSetPlanned(n) {
  if (!store.currentSet || !store.currentSet.started_at) return;
  store.currentSet.tracks_planned = (store.currentSet.tracks_planned || 0) + Number(n || 0);
  persist();
}
function bumpSetTrack() {
  if (!store.currentSet || !store.currentSet.started_at) return;
  store.currentSet.tracks_played = (store.currentSet.tracks_played || 0) + 1;
  persist();
}
function markOutroPlayed() {
  if (!store.currentSet) return;
  store.currentSet.outro_played = true;
  persist();
}
function endSet() {
  if (!store.currentSet) return;
  store.currentSet.ended_at = Date.now();
  persist();
}
function getCurrentSet() {
  return store.currentSet || { ...EMPTY_SET };
}

// ── lastUserInputAt ────────────────────────────────────
function markUserInput() {
  store.lastUserInputAt = Date.now();
  persist();
}
function lastUserInput() {
  return store.lastUserInputAt || 0;
}

module.exports = {
  addMessage,
  recentMessages,
  addPlay,
  recentPlays,
  playsToday,
  topArtists,
  playHours,
  savePlan,
  getPlan,
  getPref,
  setPref,
  startSet,
  appendSetPlanned,
  bumpSetTrack,
  markOutroPlayed,
  endSet,
  getCurrentSet,
  markUserInput,
  lastUserInput,
};
