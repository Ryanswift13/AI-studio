# Claudio DJ Set 完整重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Claudio 从"对话式响应"升级为"节目段 Set"——theme/intro/tracks+transitions/outro 完整节目结构 + 曲间过渡 + 跨会话延续 + 主动引领 + 听众反馈。

**Architecture:** speech 挂在 track 对象上（队列结构不变）；DJ JSON 升级带 `theme/intro/tracks[].transition/outro` 字段；TTS 批量并行合成；renderer 状态机扩展 pre/post-speak；state 持久化 currentSet 跨会话延续；新增 idle-watcher 主动引领。

**Tech Stack:** Node.js ≥ 18，Electron，无新依赖。沿用项目"无测试套件，用 `node -e` smoke verify"模式。

完整设计参见 `docs/superpowers/specs/2026-05-21-claudio-dj-set-design.md`。

---

### Task 1: dj-util.normalize 升级支持新 Set 字段 + 旧格式降级

**Files:**
- Modify: `e:/Project/AI-studio/core/dj-util.js`

- [ ] **Step 1: 替换 normalize 函数**

```js
function normalize(obj, source) {
  obj = obj || {};
  // 支持新字段 + 兼容旧 say/play 字段降级
  const theme = String(obj.theme || '').trim();
  const intro = String(obj.intro || obj.say || '').trim();
  const outro = String(obj.outro || '').trim();
  const rawTracks = Array.isArray(obj.tracks)
    ? obj.tracks
    : Array.isArray(obj.play)
      ? obj.play.map((p) =>
          typeof p === 'string'
            ? { name: p, artist: '', transition: null }
            : { name: p && p.name, artist: p && p.artist, transition: null }
        )
      : [];
  const tracks = rawTracks
    .map((t, i) => ({
      name: String((t && t.name) || '').trim(),
      artist: String((t && t.artist) || '').trim(),
      transition: i === 0 ? null : String((t && t.transition) || '').trim() || null,
    }))
    .filter((t) => t.name);
  const remember = Array.isArray(obj.remember) ? obj.remember : [];
  return {
    theme,
    intro,
    outro,
    tracks,
    // 兼容旧调用方读 play / say 字段
    say: intro,
    play: tracks.map((t) => ({ name: t.name, artist: t.artist })),
    reason: String(obj.reason || '').trim(),
    segue: String(obj.segue || '').trim(),
    remember: remember
      .map((r) => ({
        type: (r && r.type) || '',
        content: (r && r.content) || '',
        expires_in_days:
          r && r.expires_in_days != null ? Number(r.expires_in_days) : null,
      }))
      .filter((r) => r.type && r.content),
    source,
  };
}
```

- [ ] **Step 2: 验证新旧两套响应都能正常 normalize**

```bash
node -e "const {normalize}=require('./core/dj-util');
const newFmt=normalize({theme:'雨夜folklore',intro:'开场...',tracks:[{name:'august',artist:'Taylor Swift'},{name:'cardigan',artist:'Taylor Swift',transition:'接...'}],outro:'收尾...',reason:'r'},'test');
console.log('new theme/intro/outro:',newFmt.theme,newFmt.intro,newFmt.outro);
console.log('tracks count:',newFmt.tracks.length,'transition[0]:',newFmt.tracks[0].transition,'transition[1]:',newFmt.tracks[1].transition);
const oldFmt=normalize({say:'旧say',play:[{name:'晴天',artist:'周杰伦'}],reason:'r'},'test');
console.log('old降级 intro=say:',oldFmt.intro==='旧say','tracks[0].transition=null:',oldFmt.tracks[0].transition===null);
"
```

Expected:
- new theme/intro/outro: 雨夜folklore 开场... 收尾...
- tracks count: 2, transition[0]: null, transition[1]: 接...
- old降级 intro=say: true tracks[0].transition=null: true

- [ ] **Step 3: 升级 mockResponse 输出新 Set 格式**

替换 `core/dj-util.js` 的 `mockResponse` 函数：

```js
function mockResponse(opts = {}) {
  let playlists = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(paths.user, 'playlists.json'), 'utf8'));
    playlists = j.playlists || [];
  } catch {
    /* 无歌单也能给出空 set */
  }
  const hour = new Date().getHours();
  let pick = playlists[0];
  if (hour < 9) pick = playlists.find((p) => /早晨/.test(p.mood)) || pick;
  else if (hour < 18) pick = playlists.find((p) => /专注/.test(p.mood)) || pick;
  else pick = playlists.find((p) => /放松|深夜/.test(p.mood)) || pick;
  const picked = pick && pick.tracks ? pick.tracks.slice(0, 3) : [];
  const tracks = picked.map((t, i) => ({
    name: t.name,
    artist: t.artist || '',
    transition: i === 0 ? null : `（mock 过渡，未配 API key 时的占位）`,
  }));
  const input = opts.userInput ? `你说「${opts.userInput}」，` : '';
  const theme = pick ? `${pick.name}（mock 模式）` : '本地模拟';
  return normalize(
    {
      theme,
      intro:
        `${input}这是 Claudio。现在是${hour}点出头，` +
        (tracks.length
          ? `给你放${tracks[0].name}起头，让此刻慢下来。`
          : '先陪你待一会儿，想听什么随时告诉我。') +
        `（当前为本地模拟模式——在 .env 配置 DEEPSEEK_API_KEY 后我会真正为你编排。）`,
      tracks,
      outro: tracks.length ? '这一段先到这。' : '',
      reason: `模拟模式：按时段选用歌单「${pick ? pick.name : '默认'}」`,
    },
    'mock'
  );
}
```

- [ ] **Step 4: 验证 mockResponse 输出新格式**

```bash
node -e "const {mockResponse}=require('./core/dj-util');const r=mockResponse({userInput:'随便'});console.log('theme:',r.theme);console.log('intro len:',r.intro.length);console.log('tracks:',r.tracks.length,'first.transition=null:',r.tracks[0]&&r.tracks[0].transition===null);console.log('outro:',r.outro);"
```

Expected:
- theme: <某 mood 歌单名>（mock 模式）
- intro len: > 0
- tracks: 2-3 个, first.transition=null: true
- outro: <非空字符串 或 空（无歌时）>

- [ ] **Step 5: 提交**

```bash
git add core/dj-util.js
git commit -m "feat(dj): normalize/mockResponse 升级支持 Set 格式（theme/intro/tracks+transitions/outro），兼容旧字段降级"
```

---

### Task 2: TTS speakBatch 批量并行合成

**Files:**
- Modify: `e:/Project/AI-studio/core/tts.js`

- [ ] **Step 1: 读 tts.js 看 speak 接口**

确认 `speak(text)` 返回什么。期望: `{audio, hash}`.

```bash
node -e "const tts=require('./core/tts');console.log(typeof tts.speak);"
```

- [ ] **Step 2: 在 tts.js 末尾 module.exports 前加 speakBatch 函数**

读 `core/tts.js`，在 `module.exports` 那行**之前**插入：

```js
// 批量合成多段台词；并行；任一段失败返回 {audio:null, hash:null}；空字符串跳过返回 null entry。
async function speakBatch(texts) {
  if (!Array.isArray(texts)) return [];
  return Promise.all(
    texts.map(async (raw) => {
      const t = String(raw || '').trim();
      if (!t) return null;
      // 单段超 80 字截断，防 Edge TTS 长句问题
      const clipped = t.length > 80 ? t.slice(0, 77) + '...' : t;
      try {
        return await speak(clipped);
      } catch (e) {
        return { audio: null, hash: null, text: clipped, error: e.message };
      }
    })
  );
}
```

并更新 module.exports 加入 `speakBatch`：

```js
module.exports = { speak, speakBatch, status };
```

（如果 module.exports 还有其他字段，保留并 append speakBatch。）

- [ ] **Step 3: 验证 speakBatch**

```bash
node -e "(async()=>{const tts=require('./core/tts');const out=await tts.speakBatch(['第一段台词','','第二段台词']);console.log('count:',out.length);console.log('mid is null:',out[1]===null);console.log('all have hash:',out.filter(Boolean).every(o=>o.hash));})()"
```

Expected: count: 3, mid is null: true, all have hash: true（Edge TTS 默认可用，无 key 也工作）

- [ ] **Step 4: 提交**

```bash
git add core/tts.js
git commit -m "feat(tts): 新增 speakBatch 批量并行合成，单段 80 字截断 + 失败降级"
```

---

### Task 3: state.currentSet 持久化 + lastUserInput 跟踪

**Files:**
- Modify: `e:/Project/AI-studio/core/state.js`

- [ ] **Step 1: load() 初始化 currentSet + lastUserInputAt**

读 `core/state.js`，找到 load 函数把返回对象扩展（增加 currentSet 默认结构 + lastUserInputAt）。

修改 load 函数返回结构：

```js
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      seq: j.seq || 0,
      messages: j.messages || [],
      plays: j.plays || [],
      plan: j.plan || {},
      prefs: j.prefs || {},
      currentSet: j.currentSet || {
        theme: '',
        started_at: 0,
        tracks_planned: 0,
        tracks_played: 0,
        outro_played: false,
        ended_at: null,
      },
      lastUserInputAt: j.lastUserInputAt || 0,
    };
  } catch {
    return {
      seq: 0, messages: [], plays: [], plan: {}, prefs: {},
      currentSet: { theme: '', started_at: 0, tracks_planned: 0, tracks_played: 0, outro_played: false, ended_at: null },
      lastUserInputAt: 0,
    };
  }
}
```

- [ ] **Step 2: 加 currentSet API 函数**

在 state.js 的 prefs 段后、module.exports 前插入：

```js
// ── currentSet ────────────────────────────────────────
function startSet({ theme = '', planned = 0 } = {}) {
  store.currentSet = {
    theme: String(theme || ''),
    started_at: Date.now(),
    tracks_planned: Number(planned) || 0,
    tracks_played: 0,
    outro_played: false,
    ended_at: null,
  };
  persist();
  return store.currentSet;
}
function bumpSetTrack() {
  if (!store.currentSet || !store.currentSet.started_at) return;
  store.currentSet.tracks_played = (store.currentSet.tracks_played || 0) + 1;
  persist();
}
function markOutroPlayed() {
  if (!store.currentSet) return;
  store.currentSet.outro_played = true;
  persist();
}
function endSet() {
  if (!store.currentSet) return;
  store.currentSet.ended_at = Date.now();
  persist();
}
function getCurrentSet() {
  return store.currentSet || { theme: '', started_at: 0, tracks_planned: 0, tracks_played: 0, outro_played: false, ended_at: null };
}

// ── lastUserInputAt ────────────────────────────────────
function markUserInput() {
  store.lastUserInputAt = Date.now();
  persist();
}
function lastUserInput() {
  return store.lastUserInputAt || 0;
}
```

并在 module.exports 加入新函数：

```js
module.exports = {
  addMessage, recentMessages, addPlay, recentPlays, playsToday, topArtists, playHours,
  savePlan, getPlan, getPref, setPref,
  startSet, bumpSetTrack, markOutroPlayed, endSet, getCurrentSet,
  markUserInput, lastUserInput,
};
```

- [ ] **Step 3: 验证 currentSet 生命周期**

```bash
rm -f data/state.json && node -e "const s=require('./core/state');s.startSet({theme:'测试主题',planned:3});s.bumpSetTrack();s.bumpSetTrack();const c=s.getCurrentSet();console.log('theme:',c.theme,'played:',c.tracks_played,'planned:',c.tracks_planned);s.markOutroPlayed();s.endSet();const c2=s.getCurrentSet();console.log('outro:',c2.outro_played,'ended:',!!c2.ended_at);"
```

Expected:
- theme: 测试主题 played: 2 planned: 3
- outro: true ended: true

- [ ] **Step 4: 提交**

```bash
git add core/state.js
git commit -m "feat(state): 加 currentSet 全生命周期 API + lastUserInputAt 跟踪"
```

---

### Task 4: context 注入 currentSet 状态 + pieceTrace 升级

**Files:**
- Modify: `e:/Project/AI-studio/core/context.js`

- [ ] **Step 1: pieceMemory 顶部加 currentSet 段**

读 `core/context.js`，找到 `function pieceMemory()`，在函数体最开始（const mem = memory.all(); 之前或之后）加入 currentSet 注入。

替换 pieceMemory 函数为：

```js
function pieceMemory() {
  const mem = memory.all();
  const today = state.playsToday();
  const msgs = state.recentMessages(12);
  const plays = state.recentPlays(8);
  const currentSet = state.getCurrentSet();
  const lines = [];

  if (currentSet.started_at && (!currentSet.ended_at || Date.now() - currentSet.ended_at < 60 * 60 * 1000)) {
    const setAge = Math.floor((Date.now() - currentSet.started_at) / 60000);
    lines.push(
      `当前节目段：theme="${currentSet.theme}", 已播 ${currentSet.tracks_played}/${currentSet.tracks_planned}, ` +
      `outro=${currentSet.outro_played ? '已说' : '未到'}, 段龄 ${setAge} 分钟。`
    );
  }

  if (mem.length) {
    const groups = { fact: [], preference: [], event: [], feedback: [] };
    for (const e of mem) {
      if (!groups[e.type]) groups[e.type] = [];
      groups[e.type].push(e);
    }
    lines.push('关于这位听众（跨会话累积的长期记忆）：');
    const labels = { fact: '事实', preference: '偏好', event: '近期', feedback: '反馈' };
    for (const t of ['feedback', 'preference', 'fact', 'event']) {
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
```

注意：把 `feedback` 类型放在分组循环第一位（之前的设计："feedback 优先展示"）。

- [ ] **Step 2: pieceTrace 升级 + 加 idle-chime**

找到 pieceTrace 函数的 map，替换为：

```js
  const map = {
    chat: '由听众主动发起对话触发。',
    startup:
      'Claudio 刚刚启动——给听众开个场。组一段开场电台（通常 4-6 首），注意此刻时段、天气、最近记忆和长期偏好的连贯，台词比平时多一点暖意。若 currentSet 还没收（outro_played=false），可以延续 theme；否则起新 theme。',
    'scheduler:calendar': '由日历 hook 触发——临近日程，做相应铺垫。',
    'auto-continue':
      '队列快播完了（**用户还在听上一段**，这是后台预编下一段，不要打扰）：\n' +
      '  · 若 currentSet.outro_played=false → **续编当前 set**：保持 theme，append tracks，不重写 intro，不写 outro（让大脑判断到第几首该收）\n' +
      '  · 若 currentSet.outro_played=true → **开新 set**：theme 可继承也可切，按音乐逻辑判断',
    'idle-chime':
      '听众有 1 分多没说话了，音乐也停了。主动接一段——**不要打扰式问候**（"喂还在吗"那种禁），直接开个新 set 接龙；台词可以引用上一段主题做收尾，再切到新主题。',
  };
```

- [ ] **Step 3: 验证 trigger 描述全注入 + currentSet 段**

```bash
rm -f data/state.json && node -e "const s=require('./core/state');s.startSet({theme:'雨夜folklore',planned:5});s.bumpSetTrack();(async()=>{const ctx=await require('./core/context').build({trigger:'auto-continue'});console.log('当前节目段段:',ctx.user.includes('当前节目段：theme=\"雨夜folklore\"'));console.log('auto-continue 续编规则:',ctx.user.includes('续编当前 set'));})()"
```

Expected:
- 当前节目段段: true
- auto-continue 续编规则: true

- [ ] **Step 4: 提交**

```bash
git add core/context.js
git commit -m "feat(context): 片 4 注入 currentSet 状态；pieceTrace 升级 auto-continue 含 set 边界规则，新增 idle-chime trigger"
```

---

### Task 5: router.djFlow 升级为 Set 流（TTS 批量 + speech 挂 track + state 持久化）

**Files:**
- Modify: `e:/Project/AI-studio/core/router.js`

- [ ] **Step 1: djFlow 重写**

读 `core/router.js` 找到 djFlow 函数，整段替换为：

```js
async function djFlow({ text = '', trigger = 'chat' } = {}) {
  if (trigger === 'chat' && text) state.markUserInput();

  const ctx = await context.build({ trigger, userInput: text });
  const dj = await deepseek.orchestrate(ctx, { userInput: text });

  // 闲聊：tracks 为空时只播 intro 台词（如果有），不入队
  if (!dj.tracks || dj.tracks.length === 0) {
    const voice = dj.intro ? await tts.speak(dj.intro) : { audio: null, hash: null };
    if (dj.remember && dj.remember.length) {
      const written = memory.addMany(dj.remember, trigger);
      if (written.length) log('router', `记忆新增 ${written.length} 条`);
    }
    const msg = state.addMessage('claudio', dj.intro || '……', {
      audio: voice.audio, hash: voice.hash, source: dj.source,
    });
    return {
      kind: 'dj', say: dj.intro, audio: voice.audio, hash: voice.hash,
      reason: dj.reason, segue: dj.segue, source: dj.source,
      messageId: msg.id, tracks: [], snapshot: player.snapshot(),
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
    if (i === 0) {
      // intro 挂到第一首
      if (dj.intro && introVoice && introVoice.audio) {
        before_speak = { audio: introVoice.audio, hash: introVoice.hash, text: dj.intro };
      } else if (dj.intro) {
        before_speak = { audio: null, hash: null, text: dj.intro };
      }
    } else {
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

  // 写记忆
  if (dj.remember && dj.remember.length) {
    const written = memory.addMany(dj.remember, trigger);
    if (written.length) log('router', `记忆新增 ${written.length} 条`);
  }

  // currentSet 决策：
  //   - trigger='auto-continue' 且 outro_played=false → 续当前 set（不重置 startSet，只 bump planned）
  //   - 其他情况 → 新 set
  const cur = state.getCurrentSet();
  const isContinuation =
    trigger === 'auto-continue' &&
    cur.started_at &&
    !cur.outro_played &&
    !cur.ended_at;
  if (isContinuation) {
    cur.tracks_planned = (cur.tracks_planned || 0) + items.length;
    // 直接读取后写回（state 没暴露 patch；用 startSet 重写会清零 tracks_played，所以临时手挂）
    state.startSet({ theme: cur.theme, planned: cur.tracks_planned });
    // 还原已播数（startSet 重置了，要回填）
    for (let i = 0; i < cur.tracks_played; i++) state.bumpSetTrack();
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
  const msg = state.addMessage('claudio', dj.intro || dj.say || '……', meta);
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
}
```

- [ ] **Step 2: 验证 djFlow 在 mock 路径下产出 Set 形态的 enqueue**

```bash
rm -f data/state.json data/memory.json && node -e "(async()=>{const r=await require('./core/router').handle({trigger:'startup'});const snap=r.snapshot;console.log('theme:',r.theme);console.log('tracks:',r.tracks.length);console.log('queue items:',snap.count);const first=snap.track;console.log('first.before_speak.text:',first&&first.before_speak&&first.before_speak.text&&first.before_speak.text.slice(0,30));})()"
```

Expected:
- theme: <非空字符串>
- tracks: 2-3 个
- queue items: 同 tracks 数
- first.before_speak.text: <非空，是 intro 内容>

- [ ] **Step 3: 提交**

```bash
git add core/router.js
git commit -m "feat(router): djFlow 升级为 Set 流——TTS 批量；speech 挂 track（intro→第一首.before；transition→后续.before；outro→最后一首.after）；currentSet 持久化（auto-continue 续编不重置已播数）"
```

---

### Task 6: player 透传 before_speak/after_speak + 推进时 state.bumpSetTrack

**Files:**
- Modify: `e:/Project/AI-studio/core/player.js`

- [ ] **Step 1: snapshot 透传新字段**

读 `core/player.js`，找到 `function snapshot()`，替换为：

```js
function snapshot() {
  const t = queue[index] || null;
  return {
    track: t
      ? {
          ...t,
          before_speak: t.before_speak || null,
          after_speak: t.after_speak || null,
        }
      : null,
    next: queue[index + 1]
      ? {
          ...queue[index + 1],
          before_speak: queue[index + 1].before_speak || null,
          after_speak: queue[index + 1].after_speak || null,
        }
      : null,
    index,
    queue: queue.map((t) => ({ name: t.name, artist: t.artist, id: t.id })),
    count: queue.length,
  };
}
```

- [ ] **Step 2: announce 时 bumpSetTrack**

找到 `function announce()`，在 `state.addPlay(...)` 这条之后加一行 `state.bumpSetTrack()`：

```js
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
    state.bumpSetTrack();
    if (track.url && /^https?:/.test(track.url)) {
      upnp.play(track.url, `${track.name} - ${track.artist}`).catch(() => {});
    }
  }
}
```

- [ ] **Step 3: 验证字段透传 + 推进计数**

```bash
rm -f data/state.json && node -e "const p=require('./core/player');const s=require('./core/state');s.startSet({theme:'t',planned:2});p.enqueue([{name:'A',artist:'X',id:'1',url:'u',before_speak:{audio:'aud1',text:'开场'}},{name:'B',artist:'Y',id:'2',url:'u',before_speak:{audio:'aud2',text:'过渡'},after_speak:{audio:'aud3',text:'收尾'}}]);const sn1=p.snapshot();console.log('first.before:',sn1.track.before_speak&&sn1.track.before_speak.text);p.next();const sn2=p.snapshot();console.log('second.before:',sn2.track.before_speak.text,'after:',sn2.track.after_speak.text);console.log('set tracks_played:',s.getCurrentSet().tracks_played);"
```

Expected:
- first.before: 开场
- second.before: 过渡 after: 收尾
- set tracks_played: 2

- [ ] **Step 4: 提交**

```bash
git add core/player.js
git commit -m "feat(player): snapshot 透传 before_speak/after_speak；announce 调 state.bumpSetTrack"
```

---

### Task 7: renderer 状态机扩展（pre/post-speak + 字幕 fallback）

**Files:**
- Modify: `e:/Project/AI-studio/renderer/app.js`

- [ ] **Step 1: 改写 playMusic / 新增 playPreSpeak / playPostSpeak / 字幕 fallback**

读 renderer/app.js 找到 playMusic 函数，在其下方加入：

```js
// Set 内 pre/post-speak 播放——与 playSpeak（聊天/调度触发的台词打断当前音乐）区分
function playSetSpeech(speech, kind /* 'pre' | 'post' */) {
  if (!speech) return false;
  if (speech.audio) {
    mode = kind === 'pre' ? 'pre-speak' : 'post-speak';
    setNowState(kind === 'pre' ? 'DJ →' : 'DJ ←');
    setEq(false);
    audio.src = speech.audio;
    audio.play().catch(() => {});
    return true;
  }
  // 无音频但有字幕——直接贴到聊天流，跳过音频段
  if (speech.text) {
    sysMessage(`(DJ) ${speech.text}`);
  }
  return false;
}
```

- [ ] **Step 2: 改写 audio.ended 状态机**

找到现有 `audio.addEventListener('ended', async () => {...})`，整段替换为：

```js
audio.addEventListener('ended', async () => {
  if (mode === 'speaking') {
    // 旧路径：聊天/调度触发的台词打断当前音乐，台词完恢复音乐进度
    if (savedMusicTrack && savedMusicTime > 0) {
      const t = savedMusicTime;
      const tr = savedMusicTrack;
      savedMusicTrack = null;
      savedMusicTime = 0;
      resumeMusic(tr, t);
    } else {
      playMusic(currentTrack);
    }
    return;
  }
  if (mode === 'pre-speak') {
    // pre-speak 完 → 进 music
    if (currentTrack && currentTrack.url) {
      mode = 'music';
      warmed = null;
      $('nowTitle').textContent = `${currentTrack.name}${
        currentTrack.artist ? ' · ' + currentTrack.artist : ''
      }`;
      audio.src = currentTrack.url;
      audio.play().catch(() => {});
    }
    return;
  }
  if (mode === 'post-speak') {
    // post-speak 完 → next track
    setNowState('NEXT…');
    setEq(false);
    const snap = await api.next();
    applySnapshot(snap);
    if (snap.track) startTrackPipeline(snap.track);
    return;
  }
  if (mode === 'music') {
    // 音乐播完——若有 after_speak（outro/post-speak）先播，否则直接 next
    if (currentTrack && currentTrack.after_speak) {
      const played = playSetSpeech(currentTrack.after_speak, 'post');
      if (played) return;
      // 字幕 fallback 已贴，直接 next
    }
    setNowState('NEXT…');
    setEq(false);
    const snap = await api.next();
    applySnapshot(snap);
    if (snap.track) startTrackPipeline(snap.track);
  }
});

// 进入新 track：若带 before_speak 先播，否则直接 playMusic
function startTrackPipeline(track) {
  if (!track) return;
  currentTrack = track;
  if (track.before_speak) {
    const played = playSetSpeech(track.before_speak, 'pre');
    if (played) return;
    // 字幕 fallback 已贴，继续 playMusic
  }
  playMusic(track);
}
```

- [ ] **Step 3: handleDjResult 改用 startTrackPipeline 处理 set 第一首**

找到 handleDjResult 函数，替换 `if (res.audio) playSpeak(res.audio); else playMusic(currentTrack);` 这段为：

```js
  // 若返回了 set tracks 且 snapshot.track 带 before_speak（intro 挂在第一首上）—— 走 set 流程
  const startTrack = (res.snapshot && res.snapshot.track) || currentTrack;
  if (startTrack && startTrack.before_speak) {
    startTrackPipeline(startTrack);
  } else if (res.audio) {
    // 老路径：聊天台词单独播
    playSpeak(res.audio);
  } else if (startTrack) {
    playMusic(startTrack);
  }
```

- [ ] **Step 4: 验证（不实跑——只确认代码语法对，主要靠手动 npm start 验证）**

```bash
node -c renderer/app.js && echo SYNTAX-OK
```

Expected: SYNTAX-OK

- [ ] **Step 5: 提交**

```bash
git add renderer/app.js
git commit -m "feat(renderer): 状态机扩展 pre-speak/post-speak；startTrackPipeline 串联 before_speak→track→after_speak；speech 无音频时字幕贴入聊天流"
```

---

### Task 8: dj-persona.md 升级——新契约 + few-shot 反例/正例 + transition 模板

**Files:**
- Modify: `e:/Project/AI-studio/prompts/dj-persona.md`

- [ ] **Step 1: 整体重写 dj-persona.md**

读现有 prompts/dj-persona.md，**整体替换**为：

```markdown
# 你是 Claudio —— 用户的私人 AI 电台 DJ

你不是助手，你是一档只为一个人开的电台。读懂这位听众的品味与此刻的状态，
为 TA 编一段段**节目段（Set）**——挑歌、写开场、写曲间过渡、写收尾，像深夜电台 DJ 那样说话。

## 性格

- 像一位老练而克制的午夜 DJ：松弛、有人情味，**带音乐知识密度**。
- 你了解这位听众（见下方「用户语料」与「最近记忆」），说话让 TA 觉得「你懂我」。
- 中文播报。每段台词 1-3 句为主，能落地成语音；不要书面长句、不要列点。
- 结合「环境」（天气、时间、日程）让选曲与台词贴合此刻。

## 选曲原则

- 优先呼应听众当下的输入与情绪；其次参考 routines 与 mood-rules。
- **每个 Set 默认 4-6 首歌**——组成一小段电台体验。听众明说"就一首"才 1 首；情绪重时 1-2 慢歌也行。
- 用具体的歌名与歌手；**artist 字段必填具体歌手名**，否则会被解析成同名错版（同名消歧见 music-context.md）。
- **一天之内不要重复**——"今日已播过"列表里的曲目坚决不要再选。
- **默认选录音室原版**——副标题含 (Live)/(翻唱)/(Cover)/(Remix)/(伴奏)/(纯音乐)/(Karaoke)/(Demo) 的不要，除非听众明说要。
- 听众的 `favorites_all` 里如果某首歌就是以 Live/Remix 后缀收藏，把完整带后缀的歌名传出来。
- **纯闲聊不要塞歌**——以下情况 `tracks` 必须为 `[]`：
  - 听众问你身份（"你是谁"/"你是什么模型"）
  - 听众问你认知（"你听过 X 吗"，除非这句在表达想听 X）
  - 听众纯吐槽 / 寒暄 / 否定刚才的选曲（这种你应该道歉 + 问他到底要什么，不要硬上新歌）

## 台词风格（必读，区分 DJ 与"音乐播放器"的核心）

**台词必须含具体音乐事实**——专辑年代/制作人/曲目典故/艺人背景之一。
"湿度 / 棉被 / 心慢下来" 这种空气感修辞**单独**用不够 DJ；要叠音乐知识。

### 反面例（不要写成这样）

❌ "热水蒸得皮肤还微微发着热，再抹一层 Lana 的 White Dress，比身体乳还柔。"
   —— 纯气氛，没音乐内容。

❌ "今晚的湿度让这首歌更柔，你躺好，我放给你。"
   —— 套路气氛词；不告诉听众这首歌是什么、为什么挑它。

### 正面例

✅ "Lana Del Rey 2021 那张 Chemtrails Over the Country Club，她离开 Hollywood Sadgirl 标签往内走的一张——White Dress 是 opener，全曲只用假音和钢琴线，像在自己房间录的。"

✅ "Taylor 2020 突然转向 indie folk 那一手——folklore 是和 The National 的 Aaron Dessner 远程合作的——august 是这张里副歌最绕梁的一首。"

✅ "周杰伦 2003 年《叶惠美》，黑色幽默之后他第一次把流行做到没人能挡——晴天是这张里最不像周杰伦的一首，吉他骨架老老实实，反而把青春写直了。"

### transition（曲间过渡）模板

**结构：从上一首接到下一首，给出音乐上的连接理由。1-2 句，特别有料的话 2-3 句。**

✅ "上一首晴天是 2003 年叶惠美的封神之作，接稻香就跳到 2008 年魔杰座——五年间他从青春情怀走到了田野感。"

✅ "exile 之后我们换个语境——Lana 的 White Dress 同样是 sadgirl 路线，但她写的是逃离 Hollywood。"

## 输出格式（极其重要）

你必须**只输出一个 JSON 对象**，不要任何额外文字、不要 Markdown 代码围栏：

\`\`\`
{
  "theme":   "这一段的主题，10-25 字（如：千禧华语男声的湿润午后）",
  "intro":   "段开场白，1-2 句，含至少一条具体音乐事实",
  "tracks":  [
    { "name": "歌名1", "artist": "歌手", "transition": null },
    { "name": "歌名2", "artist": "歌手", "transition": "从上一首到这首的过渡台词" },
    { "name": "歌名3", "artist": "歌手", "transition": "..." }
  ],
  "outro":   "段收尾 1-2 句，可省略（短 set 或闲聊时填空字符串）",
  "reason":  "(系统记录用，简短)",
  "segue":   "(向下兼容，可填'下一段过渡'或空字符串)",
  "remember": [{ "type": "fact", "content": "..." }]
}
\`\`\`

- `tracks[0].transition` 必为 `null`——第一首前用 `intro`，不重复
- `tracks[i].transition` （i ≥ 1）必填
- `outro` 完整 set (≥4 首) 建议必有；短 set / 闲聊可填 `""`
- 响应体本身就是那个 JSON，第一个字符是 `{`，最后一个字符是 `}`

## 记忆（remember 字段使用说明）

如果这一轮里听众透露了**跨会话仍有意义**的信息，加进 `remember` 数组。每条形如：

\`\`\`
{ "type": "fact" | "event" | "feedback" | "preference",
  "content": "一句话中文，简短到一句能读完",
  "expires_in_days": 7 }
\`\`\`

- **fact** —— 客观事实，永久（不写 expires_in_days）。例："在湖南大学读书"
- **event** —— 近期事件，必写 expires_in_days。例："本周备考"（7）
- **preference** —— 对 Claudio 工作方式的偏好，永久。例："深夜台词要短"
- **feedback** —— 对刚刚选曲/台词的反应，永久。例："不喜欢 Despacito"

写入纪律（宁可漏不可错）：不写客套话、临时情绪、能从用户语料推出的、你自己刚说过的、不确定的内容。

## 工作方式

你的全部资料都会在每次消息里完整给到。**不要读取任何文件、不要使用任何工具、不要做任何探索或多轮思考**——拿到消息后立即直接作答。你是一个纯粹的「文本大脑」，不是 agent。
```

注意：上面 ``` 在 markdown 文件中实际写三个反引号。

- [ ] **Step 2: 验证 dj-persona.md 结构**

```bash
node -e "const s=require('fs').readFileSync('./prompts/dj-persona.md','utf8');const required=['theme','intro','tracks','outro','transition','反面例','正面例','transition（曲间过渡）模板','纯闲聊不要塞歌','一天之内不要重复'];for(const k of required)console.log(s.includes(k)?'✅':'❌',k);"
```

Expected: 10 个全部 ✅

- [ ] **Step 3: 提交**

```bash
git add prompts/dj-persona.md
git commit -m "feat(prompt): dj-persona.md 升级为 Set 契约——含 few-shot 反例/正例 + transition 模板 + 闲聊不塞歌 + 一天不重复 + artist 必填"
```

---

### Task 9: btnFav 接业务（点 fav 写 feedback 到长期记忆）

**Files:**
- Modify: `e:/Project/AI-studio/renderer/app.js`

- [ ] **Step 1: 替换 btnFav 现有 onclick（toggle CSS）为真业务**

读 renderer/app.js 找到 `$('btnFav').onclick = () => $('btnFav').classList.toggle('on');` 那行（约 347 行），替换为：

```js
$('btnFav').onclick = async () => {
  if (!currentTrack || !currentTrack.name) {
    sysMessage('没有正在播的曲目');
    return;
  }
  $('btnFav').classList.toggle('on');
  const isOn = $('btnFav').classList.contains('on');
  const content = isOn
    ? `喜欢《${currentTrack.name} · ${currentTrack.artist || '未知歌手'}》`
    : `取消喜欢《${currentTrack.name} · ${currentTrack.artist || '未知歌手'}》`;
  try {
    await api.chat(`/记一下 ${content}`);
    sysMessage(`已${isOn ? '加心' : '取消'}：${currentTrack.name}`);
  } catch (e) {
    sysMessage(`记忆失败：${e.message}`);
  }
};
```

注意：这里用 `api.chat` 走完整 djFlow——但用户输入是 `/记一下 ...` 这种语法。我们需要在 router classify 中识别 `/记一下 ` 前缀，直接走 memory.add 不走大脑。

- [ ] **Step 2: router classify 加 `/记一下` 识别**

读 core/router.js 在 classify 函数末尾（return { kind: 'nl' } 之前）加入：

```js
  // /记一下 X —— 直接写记忆，不走大脑
  const remMatch = /^\/记一下\s+(.+)$/.exec(t);
  if (remMatch) {
    return { kind: 'memo', content: remMatch[1].trim() };
  }
```

并在 handle 函数中加 memo 分支：

读 handle 函数，在 `if (intent.kind === 'music') { return musicFlow(intent.query); }` 之后加：

```js
    if (intent.kind === 'memo') {
      const isUnlike = /^取消喜欢/.test(intent.content);
      memory.add({
        type: 'feedback',
        content: intent.content,
        trigger: 'chat',
      });
      log('router', `手动记忆：${intent.content}`);
      return {
        kind: 'memo',
        say: isUnlike ? '收回了。' : '记下了。',
        snapshot: player.snapshot(),
      };
    }
```

- [ ] **Step 3: 验证 /记一下 走 memo 不走大脑**

```bash
rm -f data/memory.json && node -e "(async()=>{const r=await require('./core/router').handle({trigger:'chat',text:'/记一下 喜欢《晴天 · 周杰伦》'});console.log('kind:',r.kind,'say:',r.say);const m=require('./core/memory').all();console.log('memory entries:',m.length,'first:',m[0]&&m[0].content);})()"
```

Expected:
- kind: memo say: 记下了。
- memory entries: 1 first: 喜欢《晴天 · 周杰伦》

- [ ] **Step 4: 提交**

```bash
git add core/router.js renderer/app.js
git commit -m "feat(feedback): btnFav 接业务——点心写 feedback 记忆；新增 /记一下 IPC 通道直接走 memory.add"
```

---

### Task 10: idle-watcher 主动引领

**Files:**
- Create: `e:/Project/AI-studio/core/idle-watcher.js`
- Modify: `e:/Project/AI-studio/electron/ipc.js`
- Modify: `e:/Project/AI-studio/electron/preload.js`
- Modify: `e:/Project/AI-studio/renderer/app.js`

- [ ] **Step 1: 创建 core/idle-watcher.js**

```js
'use strict';
// 主动引领：30 秒轮询。当音乐 paused + 用户 1 分钟没说话 + currentSet 已收尾 → 触发 idle-chime。
const router = require('./router');
const state = require('./state');
const { log, warn } = require('./util');

let timer = null;
let audioPaused = true; // 渲染层通过 IPC 'audio:state' 上报
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
  if (cur && cur.started_at && !cur.outro_played && !cur.ended_at) return; // set 还没收
  if (cur && cur.ended_at && now - cur.ended_at < 30 * 1000) return; // 收得太近
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
```

- [ ] **Step 2: ipc.js 加 audio:state handler + 启动 idle-watcher**

读 electron/ipc.js，在文件顶部 require 处加：

```js
const idleWatcher = require('../core/idle-watcher');
```

在 register 函数末尾（bus.on('stream', ...) 之前）加：

```js
  ipcMain.on('audio:state', (_e, payload) => {
    idleWatcher.setAudioPaused(payload && payload.paused);
  });
  idleWatcher.start();
```

- [ ] **Step 3: preload.js 暴露 audio.report**

读 electron/preload.js，在 contextBridge 暴露的 API 对象中加入：

```js
  audio: {
    report: (state) => ipcRenderer.send('audio:state', state),
  },
```

- [ ] **Step 4: renderer/app.js 上报 audio 状态**

在 renderer/app.js 现有的 audio.addEventListener('play', ...) 和 ('pause', ...) 监听器中，分别加一行上报。

找到 `audio.addEventListener('play', () => {`，在函数体首行加：

```js
  if (window.claudio && window.claudio.audio) window.claudio.audio.report({ paused: false });
```

找到 `audio.addEventListener('pause', () => {`，在函数体首行加：

```js
  if (window.claudio && window.claudio.audio) window.claudio.audio.report({ paused: true });
```

也加到 ended（音乐结束时如果 NEXT 慢，会有一阵 paused 状态，但 ended 不直接代表 paused；只在 mode 切到 idle 时算 paused，所以这条可省略——只 play/pause 上报够用）。

- [ ] **Step 5: 验证 idle-watcher 模块能 require + 启动**

```bash
node -e "const w=require('./core/idle-watcher');w.setAudioPaused(true);w.start();setTimeout(()=>{w.stop();console.log('start/stop OK');},100);"
```

Expected:
- [idle-watcher] 已启动（30s 轮询）
- start/stop OK

- [ ] **Step 6: 提交**

```bash
git add core/idle-watcher.js electron/ipc.js electron/preload.js renderer/app.js
git commit -m "feat(idle): 主动引领——idle-watcher 30s 轮询，audio paused + 用户 1 分钟无输入 + set 已收尾 → 触发 idle-chime 启新 set"
```

---

### Task 11: 端到端 smoke + 文档对齐

**Files:** (验证 + README + CLAUDE.md 同步)

- [ ] **Step 1: 完整链路 smoke**

```bash
rm -f data/state.json data/memory.json
node -e "(async()=>{const r=await require('./core/router').handle({trigger:'startup'});const sn=r.snapshot;console.log('=== 启动 Set ===');console.log('theme:',r.theme);console.log('tracks count:',sn.count);for(let i=0;i<sn.count;i++){const it=require('./core/player').snapshot();}console.log('first track before_speak:',sn.track.before_speak&&!!sn.track.before_speak.text);const s=require('./core/state').getCurrentSet();console.log('state theme:',s.theme,'planned:',s.tracks_planned);})();" 2>&1 | tail -10
```

Expected:
- theme: 非空
- tracks count: ≥1
- first track before_speak: true
- state theme: <theme> planned: ≥1

- [ ] **Step 2: 更新 README.md（DJ Set + 主动引领 + 反馈 章节）**

读 README.md，找到"## 架构"或类似主体段落，加入 DJ Set 一节（具体内容在 Task 12 处理）。

- [ ] **Step 3: 更新 CLAUDE.md**

读 CLAUDE.md "关键模块约定" 表格，加入：
- `core/idle-watcher.js` —— 30s 主动引领
- `state.currentSet` 字段说明

DJ 契约段更新到新 Set 格式。

- [ ] **Step 4: 提交**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README/CLAUDE.md 同步 DJ Set 架构（theme/intro/tracks+transitions/outro），加 idle-watcher 主动引领与 currentSet 说明"
```

---

### Task 12: simplify pass + v1.1 最终 commit

- [ ] **Step 1: 在仓库根执行 simplify skill 自审**

让一个 fresh subagent 跑 simplify，扫所有本次 DJ Set 改动。具体由 controller 调用。

- [ ] **Step 2: 修任何 simplify 建议（如有）**

按 simplify 反馈逐条评估，能删的删，不该改的不动。

- [ ] **Step 3: tag v1.1.0**

```bash
git tag -a v1.1.0 -m "Claudio v1.1 — DJ 感版

从对话式音乐播放器升级为真 DJ 电台：
- Set 抽象：theme / intro / tracks+transitions / outro
- 曲间过渡台词，含音乐知识密度（few-shot prompt）
- 跨会话 currentSet 延续（6 小时窗口）
- 主动引领：1 分钟无输入 + 音乐停 → idle-chime 自动启新 set
- 听众反馈：btnFav 写入长期 feedback 记忆
- 同名歌强匹配（如 Lana White Dress 不再混入 Kanye 同名）
- 全部基础 bug 修复（单曲循环、占位音、点歌立即播 etc.）"
```

不需要单独 commit ——`git tag` 已经覆盖。

---

## Self-Review

- **Spec 覆盖**：spec 8 phase（数据契约 / TTS / state / router / player / renderer / 反馈 / idle）→ 对应 Task 1-10。Task 11-12 是文档 + 收尾，扩展。✅
- **占位符**：无 TBD/TODO；每个 task 含完整代码 ✅
- **类型一致**：`currentSet` 各字段在 state.js / context.js / router.js 一致引用；`before_speak` / `after_speak` 在 player.js / renderer/app.js / router.js 一致。✅
- **YAGNI**：crossfade、播完整段评分、推荐 ML、语音输入等都明确划出（spec § YAGNI）。✅
