# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

Claudio —— 个人 AI 电台，一个 Electron 桌面应用。读懂用户的听歌品味与此刻状态（天气、日程、对话），像深夜电台 DJ 那样选曲、写台词、合成语音并播报。

代码注释与 UI 文案均为中文。

## 命令

```bash
npm install        # 仅下载 Electron 二进制（无原生模块、无编译步骤）
npm start          # = electron .，打开桌面窗口
npm run dist       # electron-builder 打 Windows NSIS 安装包到 dist/
```

- 没有测试套件、没有 lint 配置。
- Node.js ≥ 18（依赖全局 `fetch`）。
- **国内网络**：Electron / electron-builder 二进制须走 npmmirror 镜像，否则 ECONNRESET。仓库 `.npmrc` 已配置 `electron_mirror` / `electron_builder_binaries_mirror`。
- **脱离 Electron 调试 core 逻辑**：`paths.js` 对 `require('electron')` 做了保护，因此 `core/` 下不依赖 electron 的模块可直接用 `node -e "require('./core/router')"` 加载、单测。`electron/*` 与 `core/tts` 等不可这样跑。

## 架构

三层，进程内逐层调用（无 HTTP/WS 服务）：

```
renderer/ ──IPC──▶ electron/ ──▶ core/ ──▶ core/integrations/
 (窗口 UI)         (主进程)      (编排)     (ncm/fish/edge-tts/weather/calendar/upnp)
```

`core/` 全部跑在 Electron **主进程**内。`electron/main.js` 在 app ready 后装配后端（`ipc.register` + `scheduler.start`）并建无边框窗口。

### 一次触发的数据流

`router.handle({text, trigger})` 是统一入口：

1. `classify()` 分流意图：
   - **command**（暂停/下一首/音量…）→ 直接操作 `player`，不走模型
   - **music**（"播放X"/"我想听 X"/"听一下 X"…）→ `musicFlow`：ncm.resolve（含 artist 强匹配）→ `enqueue({advance:true})` 立即播
   - **memo**（`/记一下 X`）→ 直接写 `memory.add`，不走大脑
   - **nl / 调度触发** → `djFlow`
2. `djFlow`：`context.build()` 组装 6 片上下文 → 大脑 `orchestrate()` → 并行（`ncm.resolve` + `tts.speakBatch`）→ 组装 **Set queue items**（speech 挂 track）→ `player.enqueue`
3. 结果落 `state`（含 `currentSet`），经 `bus` → `ipc` → `webContents.send('stream')` 推给渲染层

### DJ Set（节目段）抽象 —— v1.1 后的核心

DJ 大脑产出固定契约（在 `prompts/dj-persona.md` 强约束）：

```json
{
  "theme":  "段主题，10-25 字",
  "intro":  "段开场白，含具体音乐事实",
  "tracks": [
    { "name":"歌1", "artist":"歌手", "transition": null },
    { "name":"歌2", "artist":"歌手", "transition":"从上一首接到这首的过渡台词" }
  ],
  "outro":  "段收尾（可省）",
  "reason": "...", "segue":"...", "remember":[...]
}
```

**speech 挂 track**：第一首 `before_speak = intro`，后续 `before_speak = transitions[i]`，最后一首 `after_speak = outro`。queue 结构不变。

**渲染层状态机**：`mode = 'pre-speak' | 'music' | 'post-speak' | 'speaking' | 'idle'`。播 track 前先播 `before_speak`（若有），播完播 `after_speak`，再 next。

**Set 跨会话**：`state.currentSet = {theme, started_at, tracks_planned, tracks_played, outro_played, ended_at}`。重启 6 小时内未收尾的 set 可在提示词里被大脑延续。

**Set 续编规则**：`auto-continue` 触发时，若 `outro_played=false` → 续当前 set（`appendSetPlanned`，theme/已播数都不重置）；否则起新 set。

`core/dj-util.js`（`extractDjJson` / `normalize` / `mockResponse`）兼容**新 Set + 旧 say/play 降级**——大脑偶尔不听话时仍能跑。

- **当前默认大脑是 `core/deepseek.js`**（DeepSeek Chat Completions API）—— `router.js` require 的是它。
- `core/claude.js`（Claude Code CLI 子进程）是**可选/未启用**的备选大脑。README 里"以 Claude Code 为大脑"的描述已过时。
- 两个适配器接口一致（`orchestrate(ctx, opts)`），共用 `core/dj-util.js`（`extractDjJson` / `normalize` / `mockResponse`）。**切换大脑只需改 `router.js` 的 require。**

### 优雅降级（核心设计原则）

每个集成都有可用性探测 + 本地模拟回落。`.env` 全空也能完整跑通核心闭环（聊天 → DJ 响应 → 入队 → 播放）。改动集成时必须保留这一性质：

| 缺失 | 回落 |
|---|---|
| DeepSeek key | `dj-util.mockResponse`：按时段从 `playlists.json` 选曲 |
| NeteaseCloudMusicApi 不可达 | `ncm.mockTrack`：占位元数据 + 正弦音 WAV |
| TTS | `tts.speak`：Fish（有 key）→ Edge TTS（免费）→ `audio:null` 纯文本 |
| 天气 / 日历 / UPnP | 省略环境注入 / 日程空 / 仅记日志 |

### 关键模块约定

- `player.js` —— 服务端持有播放队列与 now-playing。queue item 可挂 `before_speak / after_speak`（Set 的 intro/transition/outro）。`snapshot()` 是渲染层唯一的播放状态来源；`enqueue(items, {advance?, replace?})` 三态。
- `bus.js` —— EventEmitter，替代 WebSocket。`bus.push(type, data)` → `ipc.js` 转发 `stream` 事件。
- `state.js` —— 单文件 JSON 存储（`data/state.json`），同步落盘，**刻意不用 SQLite / 任何原生模块**。除 messages/plays 外还存 `currentSet` + `lastUserInputAt`。
- `memory.js` —— 长期记忆（`data/memory.json`），DJ 输出的 `remember[]` 自动写入；用户可手改；`feedback` 类型在提示词优先展示。
- `tts.js` —— `speak(text)` 单段，`speakBatch(texts)` 批量并行（用于 Set 的 intro/transitions/outro）。mp3 缓存到 `cache/tts/<hash>.mp3`，`main.js` 注册 `media://` 协议读取。
- `idle-watcher.js` —— 30s 轮询；音乐 paused + 用户 ≥1 分钟无输入 + currentSet 已收尾 ≥30s → 触发 `idle-chime` 主动起新 set。
- `paths.js` —— 开发模式可写目录在项目根；打包后落到 `userData`，并从 `resources/user` 播种用户语料。
- `config.js` —— 零依赖手写 `.env` 解析；`config.features` 反映凭证是否齐备。
- `context.js` —— persona 与 `user/*` 语料**首次读取后缓存**，修改这些文件需重启应用才生效。

### 用户语料

`user/`（`taste.md` / `routines.md` / `mood-rules.md` / `music-context.md` / `playlists.json`）是"Claudio 属于这个人"的部分，作为上下文第 2 片注入提示词。`music-context.md` 含用户立场（艺人雷区/同名歌消歧/事件背景）。

## 配置

复制 `.env.example` 为 `.env`。注意 `.env.example` 可能落后于 `config.js` —— 以 `config.js` 为准，当前支持的键包括 `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `NCM_BASE_URL` / `NCM_LEVEL` / `NCM_COOKIE` / `NCM_AUTOSTART` / `EDGE_TTS_VOICE` / `FISH_API_KEY` / `FISH_VOICE_ID` / `WEATHER_LAT|LON|CITY` / `CALENDAR_ICS_URL` / `UPNP_ENABLED` / `DEVTOOLS` 等。
