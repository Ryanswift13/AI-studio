'use strict';
// PLAYER —— 服务端持有的播放队列与 now-playing 状态（渲染层的 <audio> 只是输出设备）。
const bus = require('./bus');
const state = require('./state');
const upnp = require('./integrations/upnp');
const { log } = require('./util');

let queue = []; // 曲目对象数组
let index = -1; // 当前曲目下标

function snapshot() {
  return {
    track: queue[index] || null, // 完整曲目对象（含 url），供渲染层播放
    next: queue[index + 1] || null, // 下一首完整对象，供 prefetch
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
    if (track.url && /^https?:/.test(track.url)) {
      upnp.play(track.url, `${track.name} - ${track.artist}`).catch(() => {});
    }
  }
}

// 追加曲目到队列。replace=true 时整体替换。
function enqueue(tracks, replace = false) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    if (replace) {
      queue = [];
      index = -1;
      announce();
    }
    return snapshot();
  }
  if (replace) {
    queue = [...tracks];
    index = 0;
  } else {
    const wasEmpty = index < 0;
    queue.push(...tracks);
    if (wasEmpty) index = 0;
  }
  log('player', `队列 ${queue.length} 首，当前第 ${index + 1} 首`);
  bus.push('queue', snapshot());
  announce();
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
