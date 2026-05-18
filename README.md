# Claudio — 个人 AI 电台

> 读懂听歌习惯 → 规划声音 → 像 DJ 那样播报

Claudio 是一个 Electron 桌面应用：以 Claude Code 为大脑，结合你的品味语料、天气日程，
像一位私人电台 DJ 那样为你选曲、写台词、合成语音并播报。

## 架构

四层结构（见 `Structure.jpg`）：

1. **外部上下文** — 用户语料（`user/*.md`）、Claude Code、网易云音乐 API、声音/天气/日程 I/O
2. **本地大脑** — `core/`：意图分流、提示词组装、大脑适配器、节律调度、声音管线、状态库
3. **运行时聚合** — 每次触发把 6 片上下文粘成 prompt，模型输出 `{say, play, reason, segue}`
4. **交互表层** — Electron 窗口（Player / Profile / Settings 三视图），渲染层经 IPC 与主进程通信

```
renderer/  ──IPC──▶  electron/  ──▶  core/  ──▶  integrations/
 (窗口)              (主进程)        (编排)       (ncm/fish/weather/feishu/upnp)
```

## 快速开始

```bash
npm install        # 仅需下载 Electron（无原生模块，无需编译）
cp .env.example .env   # Windows: copy .env.example .env
npm start          # 打开 Claudio 桌面窗口
```

> 需要 Node.js ≥ 18。`.env` 全部留空也能启动 —— 各集成会降级为本地模拟，核心闭环（聊天 → DJ
> 响应 → 入队 → 播放）依然跑通。

## 外部依赖与降级

| 集成 | 配置 | 未配置时的行为 |
|---|---|---|
| Claude Code CLI | `CLAUDE_BIN`（默认 `claude`）| 找不到 CLI → 返回内置模拟 DJ 响应 |
| NeteaseCloudMusicApi | `NCM_BASE_URL` | 服务不可达 → 返回模拟曲目与示例音频 |
| Fish Audio TTS | `FISH_API_KEY` / `FISH_VOICE_ID` | 缺 key → 仅显示台词文本，不合成音频 |
| 天气 | `WEATHER_LAT/LON`（open-meteo 免 key）| 网络失败 → 省略天气注入 |
| 飞书日历 | `FEISHU_APP_ID/SECRET` | 缺凭证 → 日历视为空 |
| UPnP / Naim | `UPNP_ENABLED` / `UPNP_DEVICE_LOCATION` | 未发现设备 → 仅记录日志 |

各集成的实时可用状态会显示在 Settings 视图中。

### 启动 NeteaseCloudMusicApi（可选）

```bash
npx NeteaseCloudMusicApi   # 默认监听 http://localhost:3000
```

## 用户语料

`user/` 目录下的文件定义「Claudio 真正属于你」的部分，可随时编辑：

- `taste.md` — 你的音乐品味
- `routines.md` — 作息与场景节律
- `playlists.json` — 常听歌单
- `mood-rules.md` — 情绪 → 选曲规则

## 打包

```bash
npm run dist       # electron-builder 产出 Windows 安装包到 dist/
```

## 目录

```
electron/   Electron 主进程、preload、IPC
core/       后端编排逻辑与集成
prompts/    DJ 系统提示词
user/       用户品味语料
renderer/   桌面窗口 UI（三视图）
data/       状态库 state.json（运行时生成）
cache/tts/  合成的语音 mp3（运行时生成）
```
