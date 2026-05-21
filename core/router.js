'use strict';
// ROUTER.JS —— 意图分流 + 整轮编排入口。

const context = require('./context');
const deepseek = require('./deepseek');
const ncm = require('./integrations/ncm');
const tts = require('./tts');
const player = require('./player');
const state = require('./state');
const memory = require('./memory');
const { log } = require('./util');

// 提取基础控制指令的正则配置，方便后续维护
const INTENT_RULES = [
  { action: 'pause', pattern: /^(暂停|停一下|别放了|pause)\s*$/i },
  { action: 'play', pattern: /^(继续|恢复|接着放|resume|play)\s*$/i },
  { action: 'next', pattern: /(下一首|换一首|换首歌|跳过|next|skip)/i },
  { action: 'prev', pattern: /(上一首|前一首|previous|prev)/i },
  { action: 'stop', pattern: /(停止电台|关掉电台|关闭电台|stop)\s*$/i }
];

// 意图识别
function classify(raw) {
  const t = (raw || '').trim();
  
  // 1. 匹配基础命令
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(t)) return { kind: 'command', action: rule.action };
  }
  
  // 2. 匹配音量 (支持绝对值)
  const volMatch = /(?:音量|volume)\D*(\d{1,3})/i.exec(t);
  if (volMatch) {
    return { kind: 'command', action: 'volume', value: Math.max(0, Math.min(100, +volMatch[1])) };
  }
  
  // 3. 匹配明确点歌（含"我想听 X / 想听 X / 听一下 X"等口语化前缀）
  const musicMatch = /^(?:我想听|想听|听一下|放一下|放点|播放|放一?首|来一?首|点歌|点一?首|搜索?|search)\s*[:：]?\s*(.+)$/i.exec(t);
  if (musicMatch && musicMatch[1].trim()) {
    const query = musicMatch[1].trim();

    // 【模糊词拦截器】query 含抽象意图词（而非具体歌名/艺人）时交大模型语义理解
    const fuzzyKeywords =
      /(我喜欢|我爱|好听|随便|日推|推荐|慢歌|快歌|新歌|老歌|伤感|难过|开心|emo|轻松|放松|什么歌|哪首|某首|一首)/i;
    if (fuzzyKeywords.test(query) || /^(歌|歌曲|音乐)$/.test(query)) {
      return { kind: 'nl' };
    }

    return { kind: 'music', query };
  }
  
  // 4. 兜底进入自然语言处理
  return { kind: 'nl' };
}

// 明确点歌：直连 ncm，套用模板台词。
async function musicFlow(query) {
  try {
    const hits = await ncm.search(query, 5);
    const top = hits?.[0]; // 增加空安全操作符
    
    // 解析曲目
    const track = (top && top.id && top.source !== 'mock')
      ? await ncm.resolveHit(top)
      : await ncm.resolve(query);

    // 边界拦截：如果找不到这首歌
    if (!track) {
      const fallbackSay = `抱歉，我没能找到关于“${query}”的歌曲。`;
      const voice = await tts.speak(fallbackSay);
      state.addMessage('claudio', fallbackSay, { audio: voice.audio, hash: voice.hash });
      return { kind: 'music', say: fallbackSay, error: 'not_found' };
    }

    // 明确点歌：立即播，打断当前
    player.enqueue([{ ...track, reason: `点播：${query}` }], { advance: true });
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
  } catch (err) {
    log('router', `音乐流处理异常: ${err.message}`);
    const errorSay = '抱歉，点歌服务刚才出了点小问题。';
    const voice = await tts.speak(errorSay);
    return { kind: 'error', say: errorSay, audio: voice?.audio, error: err.message };
  }
}

// 自然语言 / 调度：走完整 6 片上下文 + 大脑 + Set 编排。
async function djFlow({ text = '', trigger = 'chat' } = {}) {
  try {
    if (trigger === 'chat' && text) state.markUserInput();

    const ctx = await context.build({ trigger, userInput: text });
    const dj = await deepseek.orchestrate(ctx, { userInput: text });

    // 闲聊：tracks 为空时只播 intro 台词（如果有），不入队
    if (!dj.tracks || dj.tracks.length === 0) {
      const voice = dj.intro ? await tts.speak(dj.intro) : { audio: null, hash: null };
      if (dj.remember && dj.remember.length) {
        const written = memory.addMany(dj.remember, trigger);
        if (written && written.length) log('router', `记忆新增 ${written.length} 条`);
      }
      const msg = state.addMessage('claudio', dj.intro || '……', {
        audio: voice.audio,
        hash: voice.hash,
        source: dj.source,
      });
      return {
        kind: 'dj',
        say: dj.intro,
        audio: voice.audio,
        hash: voice.hash,
        reason: dj.reason,
        segue: dj.segue,
        source: dj.source,
        messageId: msg.id,
        tracks: [],
        snapshot: player.snapshot(),
      };
    }

    // 有 tracks：并行 ncm.resolve + tts.speakBatch（intro + transitions + outro）
    const ttsTexts = [
      dj.intro,
      ...dj.tracks.slice(1).map((t) => t.transition || ''),
      dj.outro || '',
    ];
    const [resolved, voices] = await Promise.all([
      Promise.all(
        dj.tracks.map((p) =>
          ncm.resolve(p.name, p.artist).catch((e) => {
            log('router', `解析曲目失败 ${p.name}：${e.message}`);
            return null;
          })
        )
      ),
      tts.speakBatch(ttsTexts),
    ]);

    // voices 顺序：[intro, transition[1], transition[2], ..., outro]
    const introVoice = voices[0] || { audio: null, hash: null };
    const transitionVoices = voices.slice(1, voices.length - 1);
    const outroVoice = voices[voices.length - 1] || { audio: null, hash: null };

    // 组装 queue items：speech 挂 track
    const items = [];
    for (let i = 0; i < dj.tracks.length; i++) {
      const tr = resolved[i];
      if (!tr) continue;
      let before_speak = null;
      if (i === 0 && dj.intro) {
        if (introVoice && introVoice.audio) {
          before_speak = { audio: introVoice.audio, hash: introVoice.hash, text: dj.intro };
        } else {
          before_speak = { audio: null, hash: null, text: dj.intro };
        }
      } else if (i > 0) {
        const tv = transitionVoices[i - 1];
        const text = dj.tracks[i].transition || '';
        if (text && tv && tv.audio) {
          before_speak = { audio: tv.audio, hash: tv.hash, text };
        } else if (text) {
          before_speak = { audio: null, hash: null, text };
        }
      }
      let after_speak = null;
      if (i === dj.tracks.length - 1 && dj.outro) {
        if (outroVoice && outroVoice.audio) {
          after_speak = { audio: outroVoice.audio, hash: outroVoice.hash, text: dj.outro };
        } else {
          after_speak = { audio: null, hash: null, text: dj.outro };
        }
      }
      items.push({
        ...tr,
        reason: dj.reason,
        before_speak,
        after_speak,
      });
    }

    if (items.length) player.enqueue(items);

    // 写长期记忆
    if (dj.remember && dj.remember.length) {
      const written = memory.addMany(dj.remember, trigger);
      if (written && written.length) log('router', `记忆新增 ${written.length} 条`);
    }

    // currentSet 决策：auto-continue + 未收尾 → 续编（appendSetPlanned）；其他 → 新 set
    const cur = state.getCurrentSet();
    const isContinuation =
      trigger === 'auto-continue' &&
      cur.started_at &&
      !cur.outro_played &&
      !cur.ended_at;
    if (isContinuation) {
      state.appendSetPlanned(items.length);
    } else {
      state.startSet({ theme: dj.theme || '', planned: items.length });
    }

    const meta = {
      audio: introVoice.audio || null,
      hash: introVoice.hash || null,
      source: dj.source,
      reason: dj.reason,
      segue: dj.segue,
      theme: dj.theme,
      outro: dj.outro,
      tracks: items.map((t) => ({ name: t.name, artist: t.artist })),
    };
    const msg = state.addMessage('claudio', dj.intro || '……', meta);
    return {
      kind: 'dj',
      say: dj.intro,
      audio: introVoice.audio || null,
      hash: introVoice.hash || null,
      reason: dj.reason,
      segue: dj.segue,
      source: dj.source,
      theme: dj.theme,
      outro: dj.outro,
      messageId: msg.id,
      tracks: meta.tracks,
      snapshot: player.snapshot(),
    };
  } catch (err) {
    log('router', `DJ流处理异常: ${err.stack || err.message}`);
    return { kind: 'error', say: '抱歉，我的大脑刚才短路了一下。', error: err.message };
  }
}

// 统一入口。opts: { text, trigger }
async function handle({ text = '', trigger = 'chat' } = {}) {
  try {
    text = (text || '').trim();
    
    if (trigger === 'chat' && text) {
      state.addMessage('user', text);
      const intent = classify(text);
      
      if (intent.kind === 'command') {
        if (intent.action === 'next') player.next();
        else if (intent.action === 'prev') player.prev();
        else if (intent.action === 'stop') player.clear();
        else if (intent.action === 'volume' && typeof player.setVolume === 'function') {
          player.setVolume(intent.value); // 如果你后续实现了 player.setVolume 就可以直接生效
        }
        return { kind: 'command', command: intent, snapshot: player.snapshot() };
      }
      
      if (intent.kind === 'music') {
        return await musicFlow(intent.query);
      }
    }
    
    // 如果不是 command 也不是 music，或者 trigger 不是 chat，走大模型流
    return await djFlow({ text, trigger });
    
  } catch (error) {
    log('router', `Handle 核心路由崩溃: ${error.stack}`);
    return { 
      kind: 'error', 
      say: '我脑子突然短路了一下，能再说一遍吗？',
      error: error.message
    };
  }
}

module.exports = { handle, classify };