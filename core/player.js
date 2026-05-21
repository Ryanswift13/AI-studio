'use strict';
// PLAYER —— 服务端持有的播放队列与 now-playing 状态（渲染层的 <audio> 只是输出设备）。
const bus = require('./bus');
const state = require('./state');
const upnp = require('./integrations/upnp');
const { log } = require('./util');

let queue = []; // 曲目对象数组
let index = -1; // 当前曲目下标

function snapshot() {
  const t = queue[index] || null;
  const n = queue[index + 1] || null;
  return {
    // 完整曲目对象（含 url、before_speak、after_speak），供渲染层播放
    track: t
      ? { ...t, before_speak: t.before_speak || null, after_speak: t.after_speak || null }
      : null,
    next: n
      ? { ...n, before_speak: n.before_speak || null, after_speak: n.after_speak || null }
      : null,
    index,
    queue: queue.map((t) => ({ name: t.name, artist: t.artist, id: t.id })),
    count: queue.length,
  };
}

// 当前曲目变化时：记录播放、推送 now-playing、尝试推送到功放。
function announce() {
  const track = queue[index] || null;
  bus.push('now', snapshot());
  if (track) {
    state.addPlay({
      name: track.name,
      artist: track.artist,
      song_id: track.id,
      reason: track.reason || '',
    });
    state.bumpSetTrack();
    if (track.url && /^https?:/.test(track.url)) {
      upnp.play(track.url, `${track.name} - ${track.artist}`).catch(() => {});
    }
  }
}

// 追加曲目到队列。
// opts 兼容历史的 boolean（true = replace）和对象形式 { replace?, advance? }：
//   - replace: 整体替换，从第 0 首开始播
//   - advance: 追加后立即跳到刚加进来的第一首（用于"明确点歌"语义）
//   - 都不传 = 默认 append，不打断当前正在播的曲目
function enqueue(tracks, opts = false) {
  let replace = false;
  let advance = false;
  if (typeof opts === 'boolean') replace = opts;
  else if (opts && typeof opts === 'object') {
    replace = !!opts.replace;
    advance = !!opts.advance;
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    if (replace) {
      queue = [];
      index = -1;
      announce();
    }
    return snapshot();
  }
  let currentChanged = false;
  if (replace) {
    queue = [...tracks];
    index = 0;
    currentChanged = true;
  } else {
    const wasEmpty = index < 0;
    const insertAt = queue.length;
    queue.push(...tracks);
    if (wasEmpty) {
      index = 0;
      currentChanged = true;
    } else if (advance) {
      // 明确点歌：立即跳到刚追加的第一首，打断当前
      index = insertAt;
      currentChanged = true;
    }
  }
  log('player', `队列 ${queue.length} 首，当前第 ${index + 1} 首`);
  bus.push('queue', snapshot());
  if (currentChanged) announce();
  return snapshot();
}

function now() {
  return snapshot();
}

function next() {
  if (index < queue.length - 1) {
    index += 1;
    announce();
  }
  return snapshot();
}

function prev() {
  if (index > 0) {
    index -= 1;
    announce();
  }
  return snapshot();
}

function clear() {
  queue = [];
  index = -1;
  bus.push('queue', snapshot());
  announce();
  return snapshot();
}

module.exports = { enqueue, now, next, prev, clear, snapshot };
