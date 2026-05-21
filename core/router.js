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
  
  // 3. 匹配明确点歌
  const musicMatch = /^(?:播放|放一?首|来一?首|点歌|点一?首|搜索?|search)\s*[:：]?\s*(.+)$/i.exec(t);
  if (musicMatch && musicMatch[1].trim()) {
    const query = musicMatch[1].trim();
    
    // 【模糊词拦截器】拦截宽泛表达，交由大模型进行语义理解
    const fuzzyKeywords = /^(歌|歌曲|音乐|我喜欢的.*|我爱的.*|好听的.*|随便.*|日推|推荐.*)$/i;
    if (fuzzyKeywords.test(query)) {
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

// 自然语言 / 调度：走完整 6 片上下文 + 大脑。
async function djFlow({ text = '', trigger = 'chat' } = {}) {
  try {
    const ctx = await context.build({ trigger, userInput: text });
    const dj = await deepseek.orchestrate(ctx, { userInput: text });

    // 曲目解析（并行）与 TTS 合成相互独立，一并发起
    const [resolved, voice] = await Promise.all([
      Promise.all(
        (dj.play || []).map((p) =>
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
      if (written && written.length) log('router', `记忆新增 ${written.length} 条`);
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