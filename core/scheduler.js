'use strict';
// SCHEDULER.JS —— 节律调度：07:00 规划 / 09:00 早间 / 整点情绪检查 / 日历 hook。
const router = require('./router');
const state = require('./state');
const calendar = require('./integrations/calendar');
const bus = require('./bus');
const { log, warn, todayStr } = require('./util');

let timers = [];
const announcedEvents = new Set();

// 执行一次触发，结果经 bus 推送给渲染层。
async function runTrigger(trigger) {
  log('scheduler', '触发', trigger);
  bus.push('scheduler', { trigger });
  try {
    const result = await router.handle({ trigger });
    bus.push('dj', result);
    if (trigger === 'scheduler:plan') {
      state.savePlan(todayStr(), {
        say: result.say,
        tracks: result.tracks || [],
        reason: result.reason || '',
      });
    }
    return result;
  } catch (e) {
    warn('scheduler', `${trigger} 执行失败：`, e.message);
    return null;
  }
}

// 在 nextTime() 给出的时刻执行 fn，执行后自动重新排程。
function scheduleAt(nextTime, fn) {
  const arm = () => {
    const t = setTimeout(async () => {
      await fn();
      arm();
    }, nextTime() - new Date());
    timers.push(t);
  };
  arm();
}

function nextDaily(hh, mm) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

function nextHour() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
}

// 日历 hook：临近日程（15 分钟内）做一次铺垫播报。
async function checkCalendar() {
  try {
    const { ok, events } = await calendar.todayEvents();
    if (!ok) return;
    const now = Date.now();
    // 清掉已过去的日程，避免 Set 无界增长
    for (const ts of announcedEvents) {
      if (ts < now) announcedEvents.delete(ts);
    }
    for (const e of events) {
      const lead = e.start - now;
      if (lead > 0 && lead < 15 * 60 * 1000 && !announcedEvents.has(e.start)) {
        announcedEvents.add(e.start);
        await runTrigger('scheduler:calendar');
      }
    }
  } catch (e) {
    warn('scheduler', '日历检查失败：', e.message);
  }
}

function start() {
  scheduleAt(() => nextDaily(7, 0), () => runTrigger('scheduler:plan'));
  scheduleAt(() => nextDaily(9, 0), () => runTrigger('scheduler:morning'));
  scheduleAt(nextHour, () => runTrigger('scheduler:mood'));
  timers.push(setInterval(checkCalendar, 5 * 60 * 1000));
  log('scheduler', '节律调度已启动（07:00 规划 / 09:00 早间 / 整点情绪 / 日历 hook）');
}

function stop() {
  timers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
  timers = [];
}

module.exports = { start, stop, runTrigger };
