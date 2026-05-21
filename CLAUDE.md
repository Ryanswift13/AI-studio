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
   - **music**（"播放X"/"搜索X"）→ `musicFlow`：`ncm.search` → `ncm.resolveHit` → 入队
   - **nl / 调度触发** → `djFlow`
2. `djFlow`：`context.build()` 组装 6 片上下文 → 大脑 `orchestrate()` → 并行（`ncm.resolve` 各曲目 + `tts.speak` 台词）→ `player.enqueue`
3. 结果落 `state`，并经 `bus` → `ipc` → `webContents.send('stream')` 推给渲染层

### 大脑适配层（重要）

DJ 大脑产出固定契约 `{say, play[], reason, segue, source}`，由 `prompts/dj-persona.md` 强约束模型只输出该 JSON。

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

- `player.js` —— 服务端持有播放队列与 now-playing；渲染层的 `<audio>` 只是输出设备。`snapshot()` 是渲染层唯一的播放状态来源。
- `bus.js` —— EventEmitter，替代 WebSocket。`bus.push(type, data)` → `ipc.js` 转发 `stream` 事件。
- `state.js` —— 单文件 JSON 存储（`data/state.json`），同步落盘，**刻意不用 SQLite / 任何原生模块**以便零编译打包。
- `tts.js` —— Fish 合成的 mp3 缓存到 `cache/tts/<hash>.mp3`，经 `main.js` 注册的自定义 `media://` 协议读取（`media://tts/<hash>.mp3`）。
- `paths.js` —— 开发模式可写目录在项目根；打包后落到 `userData`，并从 `resources/user` 播种用户语料。
- `config.js` —— 零依赖手写 `.env` 解析；`config.features` 反映凭证是否齐备。
- `context.js` —— persona 与 `user/*` 语料**首次读取后缓存**，修改这些文件需重启应用才生效。

### 用户语料

`user/`（`taste.md` / `routines.md` / `mood-rules.md` / `playlists.json`）是"Claudio 属于这个人"的部分，作为上下文第 2 片注入提示词。

## 配置

复制 `.env.example` 为 `.env`。注意 `.env.example` 可能落后于 `config.js` —— 以 `config.js` 为准，当前支持的键包括 `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `NCM_BASE_URL` / `NCM_LEVEL` / `NCM_COOKIE` / `NCM_AUTOSTART` / `EDGE_TTS_VOICE` / `FISH_API_KEY` / `FISH_VOICE_ID` / `WEATHER_LAT|LON|CITY` / `CALENDAR_ICS_URL` / `UPNP_ENABLED` / `DEVTOOLS` 等。
