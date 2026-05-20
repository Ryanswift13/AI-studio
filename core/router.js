'use strict';
// ROUTER.JS —— 意图分流 + 整轮编排入口。
//  · 简单指令（暂停/下一首/音量…）→ 直接命令，不走模型
//  · 明确点歌（播放X/搜索X）       → 直接走 ncm
//  · 自然语言 / 调度触发           → context → deepseek → ncm → tts
const context = require('./context');
const deepseek = require('./deepseek');
const ncm = require('./integrations/ncm');
const tts = require('./tts');
const player = require('./player');
const state = require('./state');
const memory = require('./memory');
const { log } = require('./util');

// 意图识别
function classify(raw) {
  const t = (raw || '').trim();
  if (/^(暂停|停一下|别放了|pause)\s*$/i.test(t)) return { kind: 'command', action: 'pause' };
  if (/^(继续|恢复|接着放|resume|play)\s*$/i.test(t)) return { kind: 'command', action: 'play' };
  if (/(下一首|换一首|换首歌|跳过|next|skip)/i.test(t)) return { kind: 'command', action: 'next' };
  if (/(上一首|前一首|previous|prev)/i.test(t)) return { kind: 'command', action: 'prev' };
  if (/(停止电台|关掉电台|关闭电台|stop)\s*$/i.test(t)) return { kind: 'command', action: 'stop' };
  const vol = /(?:音量|volume)\D*(\d{1,3})/i.exec(t);
  if (vol) {
    return { kind: 'command', action: 'volume', value: Math.max(0, Math.min(100, +vol[1])) };
  }
  const music = /^(?:播放|放一?首|来一?首|点歌|点一?首|搜索?|search)\s*[:：]?\s*(.+)$/i.exec(t);
  if (music && music[1].trim()) return { kind: 'music', query: music[1].trim() };
  return { kind: 'nl' };
}

// 明确点歌：直连 ncm，套用模板台词。
async function musicFlow(query) {
  const hits = await ncm.search(query, 5);
  const top = hits[0];
  const track =
    top && top.id && top.source !== 'mock'
      ? await ncm.resolveHit(top)
      : await ncm.resolve(query);
  player.enqueue([{ ...track, reason: `点播：${query}` }]);
  const say = `好，这就为你放《${track.name}》${track.artist ? ' · ' + track.artist : ''}。`;
  const voice = await tts.speak(say);
  const msg = state.addMessage('claudio', say, { audio: voice.audio, hash: voice.hash });
  return {
    kind: 'music',
    say,
    audio: voice.audio,
    hash: voice.hash,
    reason: `点播：${query}`,
    segue: '',
    source: 'ncm',
    messageId: msg.id,
    tracks: [{ name: track.name, artist: track.artist }],
    snapshot: player.snapshot(),
  };
}

// 自然语言 / 调度：走完整 6 片上下文 + 大脑。
async function djFlow({ text = '', trigger = 'chat' } = {}) {
  const ctx = await context.build({ trigger, userInput: text });
  const dj = await deepseek.orchestrate(ctx, { userInput: text });

  // 曲目解析（并行）与 TTS 合成相互独立，一并发起
  const [resolved, voice] = await Promise.all([
    Promise.all(
      dj.play.map((p) =>
        ncm.resolve(p.name, p.artist).catch((e) => {
          log('router', `解析曲目失败 ${p.name}：${e.message}`);
          return null;
        })
      )
    ),
    tts.speak(dj.say),
  ]);
  const tracks = resolved.filter(Boolean).map((tr) => ({ ...tr, reason: dj.reason }));
  if (tracks.length) player.enqueue(tracks);

  if (dj.remember && dj.remember.length) {
    const written = memory.addMany(dj.remember, trigger);
    if (written.length) log('router', `记忆新增 ${written.length} 条`);
  }

  const meta = {
    audio: voice.audio,
    hash: voice.hash,
    source: dj.source,
    reason: dj.reason,
    segue: dj.segue,
    tracks: tracks.map((t) => ({ name: t.name, artist: t.artist })),
  };
  const msg = state.addMessage('claudio', dj.say, meta);
  return {
    kind: 'dj',
    say: dj.say,
    audio: voice.audio,
    hash: voice.hash,
    reason: dj.reason,
    segue: dj.segue,
    source: dj.source,
    messageId: msg.id,
    tracks: meta.tracks,
    snapshot: player.snapshot(),
  };
}

// 统一入口。opts: { text, trigger }
async function handle({ text = '', trigger = 'chat' } = {}) {
  text = (text || '').trim();
  if (trigger === 'chat' && text) {
    state.addMessage('user', text);
    const intent = classify(text);
    if (intent.kind === 'command') {
      if (intent.action === 'next') player.next();
      else if (intent.action === 'prev') player.prev();
      else if (intent.action === 'stop') player.clear();
      return { kind: 'command', command: intent, snapshot: player.snapshot() };
    }
    if (intent.kind === 'music') {
      return musicFlow(intent.query);
    }
  }
  return djFlow({ text, trigger });
}

module.exports = { handle, classify };
