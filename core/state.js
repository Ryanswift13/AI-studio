'use strict';
// STATE.DB —— 状态与记忆持久化：messages / plays / plan / prefs，跨重启保留。
// 采用单文件 JSON 存储（data/state.json），零原生依赖，便于打包分发。
const fs = require('fs');
const { paths, ensureDirs } = require('./paths');

ensureDirs();
const FILE = paths.stateFile;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      seq: j.seq || 0,
      messages: j.messages || [],
      plays: j.plays || [],
      plan: j.plan || {},
      prefs: j.prefs || {},
    };
  } catch {
    return { seq: 0, messages: [], plays: [], plan: {}, prefs: {} };
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

module.exports = {
  addMessage,
  recentMessages,
  addPlay,
  recentPlays,
  topArtists,
  playHours,
  savePlan,
  getPlan,
  getPref,
  setPref,
};
