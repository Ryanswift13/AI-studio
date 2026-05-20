'use strict';
// MEMORY.JS —— 长期记忆：跨会话累积关于听众的事实、近期事件、反馈与偏好。
// 由 DJ 大脑在每轮响应里通过可选字段 remember[] 写入；用户可手改 data/memory.json。
// 沿用 state.js 风格：单文件 JSON，同步落盘，零依赖。
const fs = require('fs');
const { paths, ensureDirs } = require('./paths');

ensureDirs();
const FILE = paths.memoryFile;
const TYPES = new Set(['fact', 'event', 'feedback', 'preference']);
const DAY_MS = 86400000;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      version: 1,
      seq: j.seq || 0,
      entries: Array.isArray(j.entries) ? j.entries : [],
    };
  } catch {
    return { version: 1, seq: 0, entries: [] };
  }
}

const store = load();

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.warn('[memory] 写入失败：', e.message);
  }
}

// 归一化用于去重：去空白、去标点、小写
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、,.!！?？:：;；""''""()（）\-—_~\`'"]/g, '');
}

function isExpired(e, now = Date.now()) {
  return e.expires_at != null && e.expires_at < now;
}

// 删除已过期条目；如有变化触发持久化。
function prune() {
  const now = Date.now();
  const before = store.entries.length;
  store.entries = store.entries.filter((e) => !isExpired(e, now));
  if (store.entries.length !== before) persist();
  return before - store.entries.length;
}

// 添加单条；非法 type 或空 content 直接忽略；与已有条目内容归一化相等则跳过（去重）。
function add({ type, content, expires_in_days = null, trigger = 'chat' }) {
  if (!TYPES.has(type)) return null;
  const text = String(content || '').trim();
  if (!text) return null;
  const key = normKey(text);
  if (store.entries.some((e) => normKey(e.content) === key)) return null;
  const now = Date.now();
  const days = Number(expires_in_days);
  const entry = {
    id: ++store.seq,
    type,
    content: text,
    trigger,
    created_at: now,
    expires_at: days > 0 ? now + days * DAY_MS : null,
  };
  store.entries.push(entry);
  persist();
  return entry;
}

function addMany(items, trigger = 'chat') {
  if (!Array.isArray(items)) return [];
  return items.map((it) => add({ ...it, trigger })).filter(Boolean);
}

// 返回当前所有有效条目（先自动 prune）。
function all() {
  prune();
  return store.entries.slice();
}

function remove(id) {
  const i = store.entries.findIndex((e) => e.id === id);
  if (i === -1) return false;
  store.entries.splice(i, 1);
  persist();
  return true;
}

module.exports = { add, addMany, all, remove, prune };
