'use strict';
// 日历集成 —— 读取 ICS 订阅（iCloud / Google / Outlook 公开日历），取今日日程。
// 未配置或拉取失败时返回 {ok:false, events:[]}，由 context/scheduler 各自降级。
const fs = require('fs');
const ical = require('node-ical');
const config = require('../config');
const { warn } = require('../util');

function configured() {
  return !!(config.calendar.icsUrl || config.calendar.icsFile);
}

// 日程一天内基本不变，缓存避免每轮 prompt 组装都拉一次 ICS。
let _cache = { at: 0, value: null };
const TTL = 10 * 60 * 1000;

async function rawEvents() {
  if (config.calendar.icsFile) {
    return ical.async.parseICS(fs.readFileSync(config.calendar.icsFile, 'utf8'));
  }
  // webcal:// 与 https:// 等价
  const url = config.calendar.icsUrl.replace(/^webcal:\/\//i, 'https://');
  return ical.async.fromURL(url);
}

// 返回今日（本地时间）日程数组，元素 { summary, start(ms), end(ms) }。
async function todayEvents() {
  if (!configured()) return { ok: false, events: [] };
  if (_cache.value && Date.now() - _cache.at < TTL) return _cache.value;
  try {
    const data = await rawEvents();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const events = [];
    for (const ev of Object.values(data)) {
      if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
      if (ev.rrule) {
        // 重复事件：展开今日内的发生（时区/EXDATE 为尽力而为）
        for (const dt of ev.rrule.between(dayStart, dayEnd, true)) {
          events.push({ summary: ev.summary || '(无标题)', start: dt.getTime(), end: 0 });
        }
      } else {
        const s = new Date(ev.start).getTime();
        if (s >= dayStart.getTime() && s < dayEnd.getTime()) {
          events.push({
            summary: ev.summary || '(无标题)',
            start: s,
            end: ev.end ? new Date(ev.end).getTime() : 0,
          });
        }
      }
    }
    events.sort((a, b) => a.start - b.start);
    const result = { ok: true, events };
    _cache = { at: Date.now(), value: result };
    return result;
  } catch (e) {
    warn('calendar', '取日程失败：', e.message);
    return { ok: false, events: [] };
  }
}

// 给提示词用的一句话日程摘要
async function summary() {
  const { ok, events } = await todayEvents();
  if (!ok || events.length === 0) return '';
  return events
    .map((e) => {
      const t = new Date(e.start);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      return `${hh}:${mm} ${e.summary}`;
    })
    .join('；');
}

async function status() {
  if (!configured()) {
    return { name: '日历（ICS）', ok: false, detail: '未配置 CALENDAR_ICS_URL' };
  }
  const { ok, events } = await todayEvents();
  return {
    name: '日历（ICS）',
    ok,
    detail: ok ? `今日 ${events.length} 个日程` : 'ICS 链接无效或拉取失败',
  };
}

module.exports = { todayEvents, summary, status, configured };
