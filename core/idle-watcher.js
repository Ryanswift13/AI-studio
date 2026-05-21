'use strict';
// IDLE-WATCHER —— 主动引领：30 秒轮询。
// 触发条件：音乐 paused + 用户 ≥1 分钟没说话 + currentSet 已收尾 ≥30s → 调 router auto-start 一段 idle-chime。
const router = require('./router');
const state = require('./state');
const { log, warn } = require('./util');

let timer = null;
let audioPaused = true; // 渲染层经 IPC 'audio:state' 上报
let isFiring = false;

function setAudioPaused(paused) {
  audioPaused = !!paused;
}

async function check() {
  if (isFiring) return;
  if (!audioPaused) return;
  const lastInput = state.lastUserInput();
  const now = Date.now();
  if (lastInput && now - lastInput < 60 * 1000) return;
  const cur = state.getCurrentSet();
  // set 还没收尾（outro 未播）→ 不抢话
  if (cur && cur.started_at && !cur.outro_played && !cur.ended_at) return;
  // 收得太近（30 秒内）→ 给用户喘口气
  if (cur && cur.ended_at && now - cur.ended_at < 30 * 1000) return;
  isFiring = true;
  try {
    log('idle-watcher', '触发 idle-chime');
    await router.handle({ trigger: 'idle-chime' });
  } catch (e) {
    warn('idle-watcher', 'idle-chime 失败:', e.message);
  } finally {
    isFiring = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(check, 30 * 1000);
  log('idle-watcher', '已启动（30s 轮询）');
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, setAudioPaused };
