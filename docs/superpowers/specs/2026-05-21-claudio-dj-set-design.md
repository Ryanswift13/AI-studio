# Claudio "DJ 感" 完整重构 · 设计文档

> 目标：把 Claudio 从"对话式音乐播放器"升级为**真正的 DJ 电台**——节目结构、曲间过渡、主动引领、跨会话记忆、台词带音乐知识密度。
> 范围：本次按方案 3（完整 DJ 体验）。

## 用户原话与痛点

- "感觉不像一个 DJ 你懂吗 像一个音乐播放器"
- 戳中的四面：**选曲准头 + 听懂细节 + 台词写法 + 跨会话连贯感**

## 核心抽象：Set（节目段）

把 DJ 响应从 `{say, play[]}` 升级为带主题、带开场/收尾、带曲间过渡的**节目段**。

```js
// DJ 大脑返回的新结构
{
  theme:    "千禧华语男声的湿润午后",   // 段主题，跨会话可延续
  intro:    "段开场白 1-2 句（含具体音乐事实）",
  tracks: [
    { name: "晴天",     artist: "周杰伦", transition: null },     // 第一首无 transition
    { name: "稻香",     artist: "周杰伦", transition: "..." },   // 1-2 句
    { name: "搁浅",     artist: "周杰伦", transition: "..." }
  ],
  outro:    "段收尾 1-2 句，可省略（DJ 自判）",
  reason:   "(系统记录用)",
  remember: [...]
}
```

## 数据模型：speech 挂在 track 上

队列结构**不变**（仍是 track 数组），speech 作为 track 属性挂着。`player.next / prev` 仍按 track 推进。

```js
// player queue item
{
  name: "稻香",
  artist: "周杰伦",
  url: "<ncm 直链>",
  reason: "...",
  before_speak: {                       // 可选——播此曲前的台词
    audio: "media://tts/<hash>.mp3",
    text: "..."
  },
  after_speak: null                     // 可选——仅最后一首带 outro
}
```

映射规则：
- `tracks[0].before_speak = intro`
- `tracks[i].before_speak = transitions[i]` （i ≥ 1）
- `tracks[last].after_speak = outro` （若 outro 非空）

## 数据流（端到端）

```
用户 chat / startup / auto-continue / idle-chime
  ↓
router.djFlow
  ↓
context.build  (注入 state.currentSet.theme、用户语料、长期记忆、今日已播、music-context.md)
  ↓
deepseek.orchestrate → Set object
  ↓
并行：
  - ncm.resolve(tracks)       // artist 强匹配，错版本剔除
  - tts.speakBatch([intro, ...transitions, outro])
  ↓
组装 queue items (speech 挂 track)
  ↓
player.enqueue(items)
state.startSet({theme, planned})
  ↓
渲染层按队列播：
  audio.ended → 若 before_speak.audio → 播 speech → ended → 播 track.url
              → 播完 track → 若 after_speak.audio → 播 outro → ended → next
```

## 字段约束（dj-persona.md 强约束）

- `theme` 必填，10-25 字
- `intro` 必填，1-2 句，**含至少一条具体音乐事实**（年代/专辑/制作人/典故）
- `tracks` 1-6 首（除非纯闲聊为 `[]`）
- `tracks[0].transition` 必为 `null`（intro 替代）
- `tracks[i].transition` 必填（i ≥ 1），1-2 句默认，2-3 句限有料时
- `outro` 完整 set（≥4 首）建议必有；短 set / 闲聊可省（`""`）
- `play[i].artist` 必填具体歌手名（避免 § C 同名错版事故）

## 降级机制（dj-util.normalize）

`core/dj-util.js` 的 `normalize()` 升级，**兼容旧格式 + 处理 LLM 不听话**：

| LLM 实际输出 | 降级 |
|---|---|
| 给了旧字段 `say` 没 `intro` | `intro = say` |
| 给了旧字段 `play[]` 没 `tracks[]` | `tracks = play.map(p => ({...p, transition: null}))` |
| 没 `theme` | `theme = ''`（不影响播放） |
| 缺 `transition` (i≥1) | 该 track 跳过 transition，直接接下一首 |
| 缺 `outro` | `outro = ''`（最后一首播完直接续 set） |
| `tracks[i].artist` 缺失 | 同 § C：ncm.resolve 强匹配前已剔除，缺失则跳过该 track |

## TTS 批量合成

`core/tts.js` 新增 `speakBatch(texts: string[]) → Array<{audio, hash}>`：

- 并行调用 `tts.speak` 处理每段
- 缓存命中复用（`hash = sha1(voiceTag + text)`，同当前 `tts.js`）
- 任一段失败：返回 `{audio: null, hash: null}`
- 每段长度上限 80 字符（防 Edge TTS 长句问题），超长 truncate

TTS 失败降级：
- speech.audio = null，speech.text 保留
- 渲染层只**贴字幕到聊天流**，**不播音频**，立刻跳到下一段（参考"字幕电台"风格）

## Player / Renderer 改造

### Player（最小改动）
- queue item 多挂 `before_speak?` / `after_speak?` 字段
- `snapshot()` 透传给渲染层
- 核心 next/prev/enqueue 逻辑不变

### Renderer 状态机
新增 mode：`'pre-speak' | 'music' | 'post-speak' | 'idle' | 'speaking'`
（保留旧 `'speaking'` 给"聊天/调度触发的台词打断"那条路径）

播放序列（per track）：
```
audio.ended →
  if track.before_speak.audio:
    mode='pre-speak'; audio.src=before_speak.audio; play
    ↓ ended
  mode='music'; audio.src=track.url; play
    ↓ ended
  if track.after_speak.audio:
    mode='post-speak'; audio.src=after_speak.audio; play
    ↓ ended
  api.next() → applySnapshot → 重复
```

`before_speak.audio == null` → 跳过音频但贴字幕到聊天流 + 立即进 music。

UI 显示：
- pre/post-speak 时 `nowState = 'DJ →'` + speech text 滚动
- 当前 track 名仍显示（让用户知道下一首是什么）

### 与 § "台词打断时不重置音乐进度"（已实现）的关系
旧的 `playSpeak / savedMusicTrack / resumeMusic` 是**用户聊天 / 调度触发**台词打断当前音乐的路径，要保留。新的 set 内 pre/post-speak 是**正常排队播放**，不打断、不需要 resume。两条路径用 mode 区分。

## state.currentSet 持久化 + 跨会话延续

### state 新增字段
```js
currentSet: {
  theme: "...",
  started_at: 1748000000000,
  tracks_planned: 5,
  tracks_played: 0,
  outro_played: false,
  ended_at: null            // set 收尾后填
}
```

### 写入时机
- `router.djFlow` 拿到大脑响应 → `state.startSet({theme, planned})`
- player.next 推进 track（不含 speech 段）→ `state.bumpSetTrack()` （或经 bus 信号）
- outro 播完 → `state.endSet()`

### context 注入
`piecePersona / pieceMemory` 中插入 currentSet 状态描述：
```
当前节目段：theme="...", 已播 3/5, outro 未到。
auto-continue 时：保持主题继续 4-6 首，或在恰当处 outro 切新主题。
chat/startup 时：可延续主题，也可开新主题，按听众输入判断。
```

### 跨会话恢复规则
启动时：
- 如果 `currentSet.ended_at == null && started_at < 6 小时前` → 视为"上次没收"，startup trigger 继承该 theme
- 否则 → 起新 set

### Set 边界：prefetch / auto-continue 决策
- 队列剩 ≤1 首触发 prefetch 时：
  - 若 `currentSet.outro_played == false` → 续编**当前 set**（保持 theme，append tracks，不重写 intro，不写新 outro 直到大脑判断该收）
  - 若 `currentSet.outro_played == true` → 开**新 set**（theme 可继承也可切，大脑判断）
- 这条规则编进 `auto-continue` trigger 的 pieceTrace 描述里，让大脑知道哪种语境

## music-context 强制引用 + few-shot prompt

### dj-persona.md 加 **台词风格** 段（含反例 / 正例）

```
台词必须含具体音乐事实——专辑年代/制作人/曲目典故/艺人背景之一。
"湿度 / 棉被 / 心慢下来" 这种空气感修辞**单独**用不够 DJ；要叠音乐知识。

[反例] 热水蒸得皮肤还微微发着热，再抹一层 Lana 的 White Dress...
       —— 纯气氛，没音乐内容。

[正例] Lana Del Rey 2021 年那张 Chemtrails Over the Country Club，
       她离开 "Hollywood Sadgirl" 标签往内走的一张——
       White Dress 是 opener，全曲只用假音和钢琴线，像在自己房间录的。

[正例] Taylor 2020 突然转向 indie folk 那一手——folklore 是和 The
       National 的 Aaron Dessner 远程合作的——august 是这张里
       副歌最绕梁的一首。
```

### transition 模板
```
"上一首 X 之后接 Y——理由是 [音乐上的连接]"

例："上一首晴天是 2003 年叶惠美的封神之作，接稻香就跳到 2008
     年魔杰座——五年间他从青春情怀走到了田野感。"
```

## 听众反馈链路

### UI（renderer 改动）
- 现有 `btnFav`（心形按钮）接业务：点击 = 当前 track 写 `memory.add({type:'feedback', content:'喜欢《X · 艺人》'})`，按钮变填充心态 + sysMessage "记下了"
- 新增"跳过"语义：renderer.classify 增加 "跳过 / 换 / 这个不对 / 不喜欢这首" 关键词 → 写 `memory.add({type:'feedback', content:'不喜欢《X · 艺人》'})` + 触发 `player.next` 立即下一首

### memory 注入升级
`context.pieceMemory` 中"长期记忆"段——`feedback` 类型条目**优先展示**且加引导："参考听众的明确好恶选曲"。

## 主动引领（idle chime-in）

### 新模块 `core/idle-watcher.js`

```js
setInterval(check, 30 * 1000);

function check() {
  const audio = window.audioState || {};  // 渲染层经 IPC 上报：paused?
  const lastInput = state.lastUserInput();
  const lastEnded = state.currentSet.ended_at;
  if (
    audio.paused &&
    Date.now() - lastInput > 60 * 1000 &&
    lastEnded && Date.now() - lastEnded > 30 * 1000 &&
    !router.isPrefetching()
  ) {
    router.handle({ trigger: 'idle-chime' });
  }
}
```

### pieceTrace 加 idle-chime 描述
"听众有 1 分多没说话了，音乐也停了。主动接一段——不要打扰式问候，直接开个新 set 接龙；台词可以引用上一段主题做收尾，再切到新主题。"

### IPC 上报
renderer 在 audio play/pause/idle 时通过新 IPC `audio:state` 通知主进程，主进程缓存到模块变量供 idle-watcher 读。

## 错误处理总览

| 失败点 | 降级 |
|---|---|
| LLM 输出不是合法 Set JSON | `extractDjJson` + `normalize` 降级到旧格式映射 |
| TTS 整段挂 (单条 speech) | `speech.audio = null`；UI 贴字幕、跳过音频 |
| ncm.resolve 跳过某 track | 对应位置的 transition 也跳过（防止"过渡到 X" 但 X 没出现的不连贯） |
| state.currentSet 写入失败 | warn + 继续；下次启动按"新 set" 处理 |
| idle-chime trigger 失败 | warn + 30 秒后重试，不影响主播放 |
| 整个 djFlow timeout / 大脑挂 | mockResponse 升级支持新 Set 格式，离线兜底 |

## 测试策略

项目无测试套件，沿用 smoke pattern。每个实施 task 含 `node -e` smoke 验证：
- `normalize` 在新旧两套 LLM 输出下都能产生合法 Set
- `tts.speakBatch` 并发 + 失败降级
- `state.startSet / endSet` 一致性 + 跨进程持久化（清 require cache 后再读）
- player 模拟 set 队列推进，验证 pre/post-speak 标记正确透传
- `mockResponse` 产出符合新格式
- `idle-watcher` 在模拟时间快进下触发条件正确

UI 行为靠手动 `npm start` 后验证（沿项目惯例）。

## 实施清单（概览，writing-plans 阶段细化）

| Phase | 改动 | 依赖 |
|---|---|---|
| **1. 数据契约** | dj-persona.md 升级（含 few-shot）；dj-util.normalize 升级（含降级映射）；mockResponse 升级 | — |
| **2. TTS 批量** | tts.speakBatch | Phase 1 |
| **3. State Set** | state.currentSet / startSet / bumpSetTrack / endSet；context 注入 currentSet | Phase 1 |
| **4. Router 编排** | djFlow 升级为 Set 流；prefetch / auto-continue 适配 | Phase 1,2,3 |
| **5. Player 字段** | queue item 透传 before/after_speak | Phase 4 |
| **6. Renderer 状态机** | mode 扩展为 pre/post-speak；audio.ended 状态转换；字幕 fallback | Phase 5 |
| **7. 听众反馈** | btnFav 接业务；"跳过" classify；feedback 注入提示词 | Phase 3 |
| **8. Idle chime** | idle-watcher + audio:state IPC + idle-chime trigger | Phase 4,6 |

## YAGNI（不在本设计内）

- 不引入"播完整段评分" / 推荐算法 / ML 模型
- 不做"DJ 个性配置"（先用统一 prompt）
- 不做"听众语音输入"（仍走文本聊天）
- 不引入 Web Audio API 复杂音频处理（保持单 `<audio>` 元素）
- 不引入"歌曲间 crossfade"（先实现基本曲间台词；crossfade 是单独优化）

## 旧路径迁移 / 兼容

- `playSpeak / savedMusicTrack / resumeMusic`（聊天/调度触发台词打断时的恢复）：**保留**，跟新 pre/post-speak 路径用 mode 区分
- 旧 `{say, play[]}` LLM 响应：normalize 降级映射，能跑但 DJ 感降一档
- 旧 mockResponse：升级到新格式
- `auto-continue` / `startup` trigger 描述：升级到含 Set 语义

---

**估计工作量：8 Phase / 12-15 个 commit / 1-2 天**。
