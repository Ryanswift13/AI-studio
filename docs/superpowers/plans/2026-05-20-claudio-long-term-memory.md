# Claudio 长期记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Claudio 加一层跨会话的长期记忆库——DJ 大脑每轮可在响应中附带 `remember` 字段写入，提示词在下一轮自动注入；用户通过手改 `data/memory.json` 维护，不加 UI。

**Architecture:** 新建 `core/memory.js`（沿用 `core/state.js` 的单文件 JSON 模式，零原生依赖）。DJ JSON 契约扩展可选 `remember[]` 字段；`router.js` 在 `djFlow` 收到大脑响应后调用 `memory.addMany()`；`context.js` 第 4 片"已检索记忆"前置一段"长期记忆"。条目按 `type`（fact / event / feedback / preference）分组，`event` 类带过期时间。

**Tech Stack:** Node.js ≥ 18（已用全局 fetch）、Electron 主进程、单文件 JSON 存储。无新依赖。项目无测试套件，每步用 `node -e` 内联脚本做 smoke verification。

---

## 文件结构

| 文件 | 角色 | 改动类型 |
|---|---|---|
| `core/paths.js` | 加 `memoryFile` 路径常量 | 改（1 行） |
| `core/memory.js` | 长期记忆模块：load / add / addMany / all / remove / prune | **新建**（~100 行） |
| `core/dj-util.js` | `normalize()` 透传 `remember` 字段 | 改（~10 行） |
| `prompts/dj-persona.md` | DJ 契约文档加 `remember` 字段说明 | 改（~30 行追加） |
| `core/router.js` | `djFlow` 调 `memory.addMany(dj.remember, trigger)` | 改（~4 行） |
| `core/context.js` | `pieceMemory()` 顶部插入"长期记忆"段 | 改（~15 行） |

## 数据格式

`data/memory.json`：

```json
{
  "version": 1,
  "seq": 7,
  "entries": [
    {
      "id": 1,
      "type": "fact",
      "content": "在湖南大学读书，住天马公寓",
      "trigger": "chat",
      "created_at": 1747700000000,
      "expires_at": null
    },
    {
      "id": 2,
      "type": "event",
      "content": "本周备考",
      "trigger": "chat",
      "created_at": 1747700000000,
      "expires_at": 1748304800000
    }
  ]
}
```

四类 type：
- **fact** —— 关于听众的客观事实，永久（无 `expires_at`）
- **event** —— 近期事件，必带 `expires_in_days`（大脑写入时给天数，模块转 ms 时间戳）
- **preference** —— 对 Claudio 工作方式的偏好，永久
- **feedback** —— 听众对刚刚选曲/台词的反应，永久

---

### Task 1: 在 paths.js 加 memoryFile 路径

**Files:**
- Modify: `e:/Project/AI-studio/core/paths.js:28-30`

- [ ] **Step 1: 在 paths 对象里加一行 memoryFile**

打开 `core/paths.js`，找到 `stateFile` 那一行后面（约第 28 行），新增一行：

```js
  stateFile: path.join(writableRoot, 'data', 'state.json'),
  memoryFile: path.join(writableRoot, 'data', 'memory.json'),
  ncmCookieFile: path.join(writableRoot, 'data', 'ncm-cookie.json'),
```

- [ ] **Step 2: 验证路径解析正确**

Run:
```bash
node -e "const {paths}=require('e:/Project/AI-studio/core/paths');console.log(paths.memoryFile)"
```

Expected output（精确到斜杠方向取决于平台，但末尾必须是 `data\memory.json` 或 `data/memory.json`）：
```
E:\Project\AI-studio\data\memory.json
```

- [ ] **Step 3: 提交**

```bash
git add core/paths.js
git commit -m "feat(memory): 在 paths 里登记 memoryFile 位置"
```

---

### Task 2: 实现 core/memory.js（数据层）

**Files:**
- Create: `e:/Project/AI-studio/core/memory.js`

- [ ] **Step 1: 创建 memory.js 主体**

写入 `core/memory.js`：

```js
'use strict';
// MEMORY.JS —— 长期记忆：跨会话累积关于听众的事实、近期事件、反馈与偏好。
// 由 DJ 大脑在每轮响应里通过可选字段 remember[] 写入；用户可手改 data/memory.json。
// 沿用 state.js 风格：单文件 JSON，同步落盘，零依赖。
const fs = require('fs');
const { paths, ensureDirs } = require('./paths');

ensureDirs();
const FILE = paths.memoryFile;
const TYPES = new Set(['fact', 'event', 'feedback', 'preference']);
const DAY_MS = 86400000;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      version: 1,
      seq: j.seq || 0,
      entries: Array.isArray(j.entries) ? j.entries : [],
    };
  } catch {
    return { version: 1, seq: 0, entries: [] };
  }
}

const store = load();

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.warn('[memory] 写入失败：', e.message);
  }
}

// 归一化用于去重：去空白、去标点、小写
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、,.!！?？:：;；""''""()（）\-—_~`'"]/g, '');
}

function isExpired(e, now = Date.now()) {
  return e.expires_at != null && e.expires_at < now;
}

// 删除已过期条目；如有变化触发持久化。
function prune() {
  const now = Date.now();
  const before = store.entries.length;
  store.entries = store.entries.filter((e) => !isExpired(e, now));
  if (store.entries.length !== before) persist();
  return before - store.entries.length;
}

// 添加单条；非法 type 或空 content 直接忽略；与已有条目内容归一化相等则跳过（去重）。
function add({ type, content, expires_in_days = null, trigger = 'chat' }) {
  if (!TYPES.has(type)) return null;
  const text = String(content || '').trim();
  if (!text) return null;
  const key = normKey(text);
  if (store.entries.some((e) => normKey(e.content) === key)) return null;
  const now = Date.now();
  const days = Number(expires_in_days);
  const entry = {
    id: ++store.seq,
    type,
    content: text,
    trigger,
    created_at: now,
    expires_at: days > 0 ? now + days * DAY_MS : null,
  };
  store.entries.push(entry);
  persist();
  return entry;
}

function addMany(items, trigger = 'chat') {
  if (!Array.isArray(items)) return [];
  return items.map((it) => add({ ...it, trigger })).filter(Boolean);
}

// 返回当前所有有效条目（先自动 prune）。
function all() {
  prune();
  return store.entries.slice();
}

function remove(id) {
  const i = store.entries.findIndex((e) => e.id === id);
  if (i === -1) return false;
  store.entries.splice(i, 1);
  persist();
  return true;
}

module.exports = { add, addMany, all, remove, prune };
```

- [ ] **Step 2: 验证 add / 去重 / 过期**

Run（确保 data 目录干净——先删除 memory.json 以保证从空开始）：

```bash
rm -f e:/Project/AI-studio/data/memory.json && node -e "const m=require('e:/Project/AI-studio/core/memory');console.log('add1',m.add({type:'fact',content:'住天马公寓'}));console.log('add2-dup',m.add({type:'fact',content:'住天马公寓'}));console.log('add3-event',m.add({type:'event',content:'本周备考',expires_in_days:7}));console.log('add4-bad-type',m.add({type:'note',content:'x'}));console.log('all:',m.all().length);"
```

Expected output（id 数字可不同，但形态如此）：
```
add1 { id: 1, type: 'fact', content: '住天马公寓', ... expires_at: null }
add2-dup null
add3-event { id: 2, type: 'event', content: '本周备考', ... expires_at: <number> }
add4-bad-type null
all: 2
```

- [ ] **Step 3: 验证 prune 过期**

Run：
```bash
node -e "const fs=require('fs');const f='e:/Project/AI-studio/data/memory.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.entries[1].expires_at=Date.now()-1000;fs.writeFileSync(f,JSON.stringify(j));delete require.cache[require.resolve('e:/Project/AI-studio/core/memory')];const m=require('e:/Project/AI-studio/core/memory');console.log('after prune count:',m.all().length);console.log('remaining types:',m.all().map(e=>e.type));"
```

Expected output：
```
after prune count: 1
remaining types: [ 'fact' ]
```

- [ ] **Step 4: 验证 remove**

Run：
```bash
node -e "const m=require('e:/Project/AI-studio/core/memory');const id=m.all()[0].id;console.log('removing id',id);console.log('removed:',m.remove(id));console.log('count:',m.all().length);"
```

Expected output：
```
removing id 1
removed: true
count: 0
```

- [ ] **Step 5: 提交**

```bash
git add core/memory.js
git commit -m "feat(memory): 新增长期记忆模块（add/all/remove/prune + 去重 + 过期）"
```

---

### Task 3: dj-util.normalize 透传 remember

**Files:**
- Modify: `e:/Project/AI-studio/core/dj-util.js:22-37`

- [ ] **Step 1: 改 normalize 函数**

把 `core/dj-util.js` 里的 `normalize` 函数替换为：

```js
function normalize(obj, source) {
  const play = Array.isArray(obj && obj.play) ? obj.play : [];
  const remember = Array.isArray(obj && obj.remember) ? obj.remember : [];
  return {
    say: (obj && obj.say) || '……',
    play: play
      .map((p) =>
        typeof p === 'string'
          ? { name: p, artist: '' }
          : { name: (p && p.name) || '', artist: (p && p.artist) || '' }
      )
      .filter((p) => p.name),
    reason: (obj && obj.reason) || '',
    segue: (obj && obj.segue) || '',
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

- [ ] **Step 2: 验证字段透传**

Run：
```bash
node -e "const {normalize}=require('e:/Project/AI-studio/core/dj-util');const out=normalize({say:'hi',play:[{name:'X'}],reason:'r',segue:'s',remember:[{type:'fact',content:'A'},{type:'event',content:'B',expires_in_days:5},{type:'bad'},{content:''},'junk']},'test');console.log(JSON.stringify(out.remember,null,2));"
```

Expected output（顺序与字段如此；非法项被 filter 掉）：
```
[
  {
    "type": "fact",
    "content": "A",
    "expires_in_days": null
  },
  {
    "type": "event",
    "content": "B",
    "expires_in_days": 5
  }
]
```

- [ ] **Step 3: 提交**

```bash
git add core/dj-util.js
git commit -m "feat(memory): normalize 透传大脑响应里的 remember 字段"
```

---

### Task 4: router.djFlow 把 remember 写入 memory

**Files:**
- Modify: `e:/Project/AI-studio/core/router.js:1-12`（顶部 require）
- Modify: `e:/Project/AI-studio/core/router.js:58-85`（djFlow 体）

- [ ] **Step 1: 顶部加 memory 引用**

把 `core/router.js` 第 11 行 `const state = require('./state');` 下面加一行：

```js
const state = require('./state');
const memory = require('./memory');
```

- [ ] **Step 2: 在 djFlow 拿到 dj 之后、构造 meta 之前调 addMany**

找到 `djFlow` 里 `const tracks = resolved.filter(Boolean)...` 那一行（约第 74 行），在其后、`const meta = {...}` 之前插入：

```js
  if (dj.remember && dj.remember.length) {
    const written = memory.addMany(dj.remember, trigger);
    if (written.length) log('router', `记忆新增 ${written.length} 条`);
  }
```

最终 `djFlow` 中段应当看起来像：

```js
  const tracks = resolved.filter(Boolean).map((tr) => ({ ...tr, reason: dj.reason }));
  if (tracks.length) player.enqueue(tracks);

  if (dj.remember && dj.remember.length) {
    const written = memory.addMany(dj.remember, trigger);
    if (written.length) log('router', `记忆新增 ${written.length} 条`);
  }

  const meta = {
```

- [ ] **Step 3: 验证整合（mock 大脑响应路径）**

由于 router 默认走 deepseek，没有 key 会回落 `mockResponse`——而 mockResponse 不带 remember，所以我们做一个直接的单元化验证：用 dj-util 模拟整套链路。

Run（先清空 memory.json 保证干净）：
```bash
rm -f e:/Project/AI-studio/data/memory.json && node -e "const {normalize}=require('e:/Project/AI-studio/core/dj-util');const memory=require('e:/Project/AI-studio/core/memory');const fakeRaw={say:'测试',play:[{name:'august',artist:'Taylor Swift'}],reason:'r',segue:'s',remember:[{type:'fact',content:'测试事实A'},{type:'event',content:'测试事件B',expires_in_days:3}]};const dj=normalize(fakeRaw,'test');const written=memory.addMany(dj.remember,'chat');console.log('written:',written.length);console.log('store:',JSON.stringify(memory.all().map(e=>({type:e.type,content:e.content,has_expiry:!!e.expires_at})),null,2));"
```

Expected output：
```
written: 2
store: [
  {
    "type": "fact",
    "content": "测试事实A",
    "has_expiry": false
  },
  {
    "type": "event",
    "content": "测试事件B",
    "has_expiry": true
  }
]
```

- [ ] **Step 4: 提交**

```bash
git add core/router.js
git commit -m "feat(memory): djFlow 把大脑响应里的 remember 写入长期记忆"
```

---

### Task 5: context.pieceMemory 注入长期记忆

**Files:**
- Modify: `e:/Project/AI-studio/core/context.js:1-10`（顶部 require）
- Modify: `e:/Project/AI-studio/core/context.js:60-77`（pieceMemory 体）

- [ ] **Step 1: 顶部加 memory 引用**

把 `core/context.js` 第 8 行后面加一行：

```js
const state = require('./state');
const memory = require('./memory');
const weather = require('./integrations/weather');
```

- [ ] **Step 2: 替换 pieceMemory 函数**

把 `core/context.js` 里 `pieceMemory()` 整个函数替换为：

```js
// 片 4：已检索记忆（长期记忆 + 近期对话 + 播放记录）
function pieceMemory() {
  const mem = memory.all();
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

  if (msgs.length) {
    lines.push('最近对话：');
    for (const m of msgs) {
      const who = m.role === 'user' ? '听众' : m.role === 'claudio' ? 'Claudio' : '系统';
      lines.push(`  ${who}：${m.content}`);
    }
  }
  if (plays.length) {
    lines.push('最近播放（避免立即重复）：');
    for (const p of plays) lines.push(`  ${p.name} — ${p.artist}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: 验证注入**

接续 Task 4 的 memory.json（含 2 条），跑：

```bash
node -e "(async()=>{const ctx=await require('e:/Project/AI-studio/core/context').build({trigger:'chat',userInput:'随便放点'});console.log('--- pieceMemory 片段 ---');const idx=ctx.user.indexOf('## 最近记忆');const end=ctx.user.indexOf('## 本轮输入');console.log(ctx.user.slice(idx,end));})()"
```

Expected output（包含两条 memory entry，类型标签为中文）：
```
## 最近记忆
关于这位听众（跨会话累积的长期记忆）：
  [事实] 测试事实A
  [近期] 测试事件B
...
```

- [ ] **Step 4: 提交**

```bash
git add core/context.js
git commit -m "feat(memory): context 片 4 注入长期记忆（fact/preference/event/feedback 分组）"
```

---

### Task 6: dj-persona.md 加 remember 字段契约

**Files:**
- Modify: `e:/Project/AI-studio/prompts/dj-persona.md:19-39`

- [ ] **Step 1: 把"输出格式"一节扩展为支持 remember**

打开 `prompts/dj-persona.md`，把 `## 输出格式（极其重要）` 整节替换为：

```markdown
## 输出格式（极其重要）

你必须**只输出一个 JSON 对象**，不要任何额外文字、不要 Markdown 代码围栏：

```
{
  "say":      "要播报的 DJ 台词，会被合成成语音",
  "play":     [{ "name": "歌名", "artist": "歌手" }],
  "reason":   "这一轮为什么这样选曲（简短，给系统记录用）",
  "segue":    "过渡到下一段的一句话",
  "remember": [{ "type": "fact", "content": "..." }]
}
```

- `play` 至少一首、至多三首。若听众只是闲聊、不需要换歌，`play` 可为空数组 `[]`。
- `say` / `reason` / `segue` 必须存在且用中文。
- `remember` **可选**字段，没东西可记就**不要写**或写成 `[]`——大多数轮次都不需要写。
- 再次强调：响应体本身就是那个 JSON，第一个字符是 `{`，最后一个字符是 `}`。

## 记忆（remember 字段使用说明）

如果这一轮里听众透露了**跨会话仍有意义**的信息，把它加进 `remember` 数组。每条形如：

```
{ "type": "fact" | "event" | "feedback" | "preference",
  "content": "一句话中文，简短到一句能读完",
  "expires_in_days": 7 }
```

- **fact** —— 听众的客观事实，永久。**不写** `expires_in_days`。
  例：「在湖南大学读书」「家在长沙」「哥哥姓 X」
- **event** —— 近期发生 / 短期内有效的事。**必写** `expires_in_days`。
  例：「本周备考」（7）「下周日生日」（10）「上周和室友吵架了」（30）
- **preference** —— 对 Claudio 工作方式的偏好。永久。
  例：「深夜台词要短」「emo 时不要主动哄」「不喜欢被叫"听众"」
- **feedback** —— 听众对刚刚选曲/台词的具体反应。永久。
  例：「不喜欢 Despacito」「marjorie 是命中曲」「上一段台词太啰嗦」

**写入纪律**（宁可漏，不可错）：
- 不要写客套话、临时情绪、听众没明说的推断。
- 不要写能从「用户语料」（taste.md / routines.md / mood-rules.md）已知的内容。
- 不要写你自己刚说过的话。
- 不确定就不写。
- 一条记忆 ≤ 一句话，越具体越好。
```

- [ ] **Step 2: 验证 markdown 没被破坏**

Run：
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('e:/Project/AI-studio/prompts/dj-persona.md','utf8');console.log('lines:',s.split(/\r?\n/).length,'has remember:', /remember/.test(s),'has 写入纪律:',/写入纪律/.test(s));"
```

Expected output：
```
lines: <数字> has remember: true has 写入纪律: true
```

- [ ] **Step 3: 提交**

```bash
git add prompts/dj-persona.md
git commit -m "feat(memory): DJ 契约加 remember 字段说明（fact/event/preference/feedback + 写入纪律）"
```

---

### Task 7: 端到端 smoke test

**Files:**（不改动代码，纯验证）

- [ ] **Step 1: 清空记忆并模拟一次完整 djFlow（不走真大脑）**

我们绕过 deepseek 的远端调用，直接调 router 内部跑一遍 mock + 手工注入 remember。

Run：
```bash
rm -f e:/Project/AI-studio/data/memory.json && node -e "(async()=>{const {normalize}=require('e:/Project/AI-studio/core/dj-util');const memory=require('e:/Project/AI-studio/core/memory');const fake=normalize({say:'好的，给你放 august。',play:[{name:'august',artist:'Taylor Swift'}],reason:'夜半放空',segue:'我就在这频率上',remember:[{type:'preference',content:'凌晨 1 点后台词不超过两句'},{type:'event',content:'本周备考研究生',expires_in_days:7}]},'mock');console.log('dj.remember:',fake.remember.length);const w=memory.addMany(fake.remember,'chat');console.log('written:',w.map(e=>e.type+':'+e.content));})()"
```

Expected output：
```
dj.remember: 2
written: [ 'preference:凌晨 1 点后台词不超过两句', 'event:本周备考研究生' ]
```

- [ ] **Step 2: 验证下一轮 context 能把记忆带入提示词**

Run：
```bash
node -e "(async()=>{const ctx=await require('e:/Project/AI-studio/core/context').build({trigger:'chat',userInput:'继续放'});const ok=ctx.user.includes('凌晨 1 点后台词不超过两句')&&ctx.user.includes('本周备考研究生');console.log('memory injected into prompt:',ok);})()"
```

Expected output：
```
memory injected into prompt: true
```

- [ ] **Step 3: 验证去重（重复写入同一条）**

Run：
```bash
node -e "const memory=require('e:/Project/AI-studio/core/memory');const before=memory.all().length;const w=memory.add({type:'event',content:'本周备考研究生',expires_in_days:7});console.log('dup add return:',w);console.log('count before/after:',before,memory.all().length);"
```

Expected output：
```
dup add return: null
count before/after: 2 2
```

- [ ] **Step 4: 验证手动编辑 data/memory.json 后重启进程能读到**

Run（脚本里"重启"用 `delete require.cache` 模拟重新 `require`）：
```bash
node -e "const fs=require('fs');const p='e:/Project/AI-studio/data/memory.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.entries.push({id:999,type:'fact',content:'手动加的事实',trigger:'manual',created_at:Date.now(),expires_at:null});fs.writeFileSync(p,JSON.stringify(j,null,2));delete require.cache[require.resolve('e:/Project/AI-studio/core/memory')];const m=require('e:/Project/AI-studio/core/memory');const hit=m.all().find(e=>e.content==='手动加的事实');console.log('manual edit visible:',!!hit);"
```

Expected output：
```
manual edit visible: true
```

- [ ] **Step 5: 启动应用、看启动日志、确认无报错**

Run（5 秒后人工 Ctrl+C 关掉）：
```bash
npm start
```

Expected：窗口正常打开，控制台没有 `[memory] 写入失败` 或相关 require 报错。如果有 DeepSeek 真实 API key，可以试着发一句"今天有点累，给我放首慢的，记一下我今晚不想被哄"——观察控制台是否出现 `记忆新增 1 条` 之类的 log。无 key 也能跑通，只是 mockResponse 不写 remember。

- [ ] **Step 6: 关闭、清理验证用的测试 memory，并提交计划完成标记**

Run（可选清空 data/memory.json，让用户用真实大脑从头积累）：
```bash
rm -f e:/Project/AI-studio/data/memory.json
```

不需要再 commit——前 6 个 task 已经各自提交。最后做一次总览：

```bash
git log --oneline -7
```

Expected output：能看到从 paths 到 dj-persona 共 6 条 `feat(memory):` commit，加上本次 plan 文件本身（如果它在更早 commit 过）。

---

## 完成后的形态

- 应用一旦运行，DJ 大脑每轮可在 JSON 响应里附 `remember[]`，写入 `data/memory.json`。
- 用户随时可以 `code e:/Project/AI-studio/data/memory.json` 手改/删条目；下次启动生效（CLAUDE.md 的 `[[user-corpus-cache-restart]]` 同例外——`memory` 模块顶层 `load()` 仅在 require 时跑，热修改需重启 Claudio）。
- `data/memory.json` 已经在 `.gitignore` 里（整个 `data/` 都被忽略），不会被误提交。

## 留待将来的（不在本计划范围）

- UI 记忆视图（用户明确说"不要 UI"，跳过）。
- 记忆压缩 / 归并（条目越积越多时把同主题合并）——当前去重已足够，等真的膨胀再说。
- IPC 暴露给渲染层（`memory:list` / `memory:remove`）——目前文件可编辑就行，等 UI 需求出现再加。
