'use strict';
// 飞书日历 —— 取今日日程供环境注入。缺凭证时 {ok:false, events:[]}。
const config = require('../config');
const { fetchJson, warn } = require('../util');

const HOST = 'https://open.feishu.cn';

function configured() {
  return !!(config.feishu.appId && config.feishu.appSecret);
}

let _token = { value: '', exp: 0 };

async function token() {
  if (_token.value && Date.now() < _token.exp) return _token.value;
  const j = await fetchJson(
    `${HOST}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret,
      }),
    },
    7000
  );
  if (!j.tenant_access_token) throw new Error('未取得 tenant_access_token');
  _token = {
    value: j.tenant_access_token,
    exp: Date.now() + (j.expire - 120) * 1000,
  };
  return _token.value;
}

let _primaryCalId = null;

async function primaryCalendarId(tk) {
  if (config.feishu.calendarId) return config.feishu.calendarId;
  if (_primaryCalId) return _primaryCalId;
  const j = await fetchJson(
    `${HOST}/open-apis/calendar/v4/calendars`,
    { headers: { Authorization: `Bearer ${tk}` } },
    7000
  );
  const list = (j.data && j.data.calendar_list) || [];
  const primary = list.find((c) => c.type === 'primary') || list[0];
  _primaryCalId = primary ? primary.calendar_id : null;
  return _primaryCalId;
}

// 日程一天内基本不变，缓存以避免每轮 prompt 组装都拉接口。
let _eventsCache = { at: 0, value: null };
const EVENTS_TTL = 5 * 60 * 1000;

// 返回今日（本地时间）日程数组。
async function todayEvents() {
  if (!configured()) return { ok: false, events: [] };
  if (_eventsCache.value && Date.now() - _eventsCache.at < EVENTS_TTL) {
    return _eventsCache.value;
  }
  try {
    const tk = await token();
    const calId = await primaryCalendarId(tk);
    if (!calId) return { ok: true, events: [] };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const j = await fetchJson(
      `${HOST}/open-apis/calendar/v4/calendars/${calId}/events` +
        `?start_time=${Math.floor(start / 1000)}&end_time=${Math.floor(end / 1000)}`,
      { headers: { Authorization: `Bearer ${tk}` } },
      7000
    );
    const items = (j.data && j.data.items) || [];
    const events = items
      .map((it) => ({
        summary: it.summary || '(无标题)',
        start: Number((it.start_time && it.start_time.timestamp) || 0) * 1000,
        end: Number((it.end_time && it.end_time.timestamp) || 0) * 1000,
      }))
      .sort((a, b) => a.start - b.start);
    const result = { ok: true, events };
    _eventsCache = { at: Date.now(), value: result };
    return result;
  } catch (e) {
    warn('feishu', '取日程失败：', e.message);
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
    return { name: '飞书日历', ok: false, detail: '未配置 FEISHU_APP_ID/SECRET' };
  }
  const { ok, events } = await todayEvents();
  return {
    name: '飞书日历',
    ok,
    detail: ok ? `今日 ${events.length} 个日程` : '凭证无效或网络失败',
  };
}

module.exports = { todayEvents, summary, configured, status };
