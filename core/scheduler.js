'use strict';
// SCHEDULER.JS —— 节律调度：启动时编排首批 + 日历 hook（07:00/09:00/整点已关闭，太吵）。
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
  // 关掉 07:00/09:00/整点 mood——晚睡晚起型作息下都是噪音。
  // 仅保留日历 hook（日程临近 15 分钟内提醒，有用）+ 启动时编排首批电台。
  timers.push(setInterval(checkCalendar, 5 * 60 * 1000));
  // 启动 3 秒后触发一次首批编排（让 NCM 自启进程先就位 + 窗口先渲染）
  const startupTimer = setTimeout(() => runTrigger('startup'), 3000);
  timers.push(startupTimer);
  log('scheduler', '节律调度已启动（启动编排 + 日历 hook；07:00/09:00/整点已关闭）');
}

function stop() {
  timers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
  timers = [];
}

module.exports = { start, stop, runTrigger };
