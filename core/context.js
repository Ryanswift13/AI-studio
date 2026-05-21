'use strict';
// CONTEXT.JS —— 提示词组装：每次触发把 6 片上下文粘成一个 prompt。
//  1 系统提示词  2 用户语料  3 环境注入  4 已检索记忆  5 用户输入/工具结果  6 执行轨迹
const fs = require('fs');
const path = require('path');
const { paths } = require('./paths');
const state = require('./state');
const memory = require('./memory');
const weather = require('./integrations/weather');
const calendar = require('./integrations/calendar');

function readSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

// 片 1、2 的内容运行期不变（改后需重启），首次读取即缓存。
let _persona = null;
let _corpus = null;

// 片 1：系统提示词
function piecePersona() {
  if (_persona == null) _persona = readSafe(path.join(paths.prompts, 'dj-persona.md'));
  return _persona;
}

// 片 2：用户语料（user/*.md + playlists.json）
function pieceUserCorpus() {
  if (_corpus != null) return _corpus;
  const parts = [];
  for (const f of ['taste.md', 'routines.md', 'mood-rules.md', 'music-context.md']) {
    const txt = readSafe(path.join(paths.user, f));
    if (txt) parts.push(`### ${f}\n${txt}`);
  }
  const pl = readSafe(path.join(paths.user, 'playlists.json'));
  if (pl) parts.push(`### playlists.json\n${pl}`);
  _corpus = parts.join('\n\n');
  return _corpus;
}

// 片 3：环境注入（天气 + 日程 + 此刻）
async function pieceEnvironment() {
  const now = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  const lines = [`当前时间：${now.toLocaleDateString('zh-CN')} ${week} ${hhmm}`];
  const [w, cal] = await Promise.all([
    weather.summary().catch(() => ''),
    calendar.summary().catch(() => ''),
  ]);
  if (w) lines.push(`天气：${w}`);
  if (cal) lines.push(`今日日程：${cal}`);
  return lines.join('\n');
}

// 片 4：已检索记忆（长期记忆 + 今日已播 + 近期对话 + 最近 8 条播放）
function pieceMemory() {
  const mem = memory.all();
  const today = state.playsToday();
  const msgs = state.recentMessages(12);
  const plays = state.recentPlays(8);
  const lines = [];

  if (mem.length) {
    const groups = { fact: [], preference: [], event: [], feedback: [] };
    for (const e of mem) {
      if (!groups[e.type]) groups[e.type] = [];
      groups[e.type].push(e);
    }
    lines.push('关于这位听众（跨会话累积的长期记忆）：');
    const labels = { fact: '事实', preference: '偏好', event: '近期', feedback: '反馈' };
    for (const t of ['fact', 'preference', 'event', 'feedback']) {
      for (const e of groups[t]) lines.push(`  [${labels[t]}] ${e.content}`);
    }
  }

  if (today.length) {
    lines.push('今日已播过（**绝对避免再选**，除非听众明确说要再听）：');
    for (const p of today) lines.push(`  ${p.name} — ${p.artist}`);
  }

  if (msgs.length) {
    lines.push('最近对话：');
    for (const m of msgs) {
      const who = m.role === 'user' ? '听众' : m.role === 'claudio' ? 'Claudio' : '系统';
      lines.push(`  ${who}：${m.content}`);
    }
  }
  if (plays.length) {
    lines.push('最近播放（接续/避免立即重复）：');
    for (const p of plays) lines.push(`  ${p.name} — ${p.artist}`);
  }
  return lines.join('\n');
}

// 片 6：执行轨迹（本次触发来源）
function pieceTrace(trigger) {
  const map = {
    chat: '由听众主动发起对话触发。',
    startup:
      'Claudio 刚刚启动——给听众开个场。组一段开场电台（通常 4-6 首比较舒服，但你自己判断），注意此刻时段、天气、最近记忆和长期偏好的连贯，台词比平时多一点暖意。',
    'scheduler:calendar': '由日历 hook 触发——临近日程，做相应铺垫。',
    'auto-continue':
      '队列快播完了（**用户还在听上一段**，这是后台预编下一段，不要打扰），接着挑几首继续——和当前这段语气连贯，避免突兀切情绪。尽量从听众 favorites_all 里选，"今日已播过"列表里的坚决不要。',
  };
  return map[trigger] || `触发来源：${trigger}`;
}

// 组装。opts: { trigger, userInput, toolResults }
async function build(opts = {}) {
  const { trigger = 'chat', userInput = '', toolResults = '' } = opts;

  const system = [piecePersona(), '\n## 用户语料\n', pieceUserCorpus()].join('\n');

  const env = await pieceEnvironment();
  const memPiece = pieceMemory();

  // 片 5：用户输入 / 工具结果
  const piece5 = [];
  if (userInput) piece5.push(`听众说：${userInput}`);
  if (toolResults) piece5.push(`工具结果：\n${toolResults}`);

  const user = [
    '## 环境',
    env,
    '',
    '## 最近记忆',
    memPiece || '（暂无）',
    '',
    '## 本轮输入',
    piece5.length ? piece5.join('\n') : '（无具体输入，请主动发起这一段电台）',
    '',
    '## 触发',
    pieceTrace(trigger),
    '',
    '重要：你的全部资料都已包含在以上消息中。不要读取任何文件、不要使用任何工具、不要做任何探索。',
    '现在作为 Claudio 立即作答——只输出那个 JSON 对象，第一个字符是 {，最后一个字符是 }。',
  ].join('\n');

  return { system, user, full: `${system}\n\n${user}` };
}

module.exports = { build };
