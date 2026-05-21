# Claudio — 个人 AI 电台

> 读懂听歌习惯 → 编节目段 → 像深夜电台 DJ 那样开场、过渡、收尾

Claudio 是一个 Electron 桌面应用：以 DeepSeek 为大脑，结合你的品味语料、天气、日程、长期记忆，
像一位私人电台 DJ 那样为你**编节目段**——挑歌、写开场、写曲间过渡、合成语音播报。

## v1.1 "DJ 感" 新增

- **节目段（Set）抽象**：每次编排是 `{theme, intro, tracks[+transitions], outro}`，4-6 首歌组一段，曲间有过渡台词
- **跨会话 Set 延续**：6 小时内未收尾的 set，下次启动可被大脑接着续编
- **主动引领**：1 分钟无输入 + 音乐停 + set 已收尾 → DJ 自动启新 set（idle-chime）
- **听众反馈**：点心形按钮 → 当前曲目写入长期 feedback 记忆；可在 chat 框输入 `/记一下 ...` 任意写入
- **音乐知识库**：`user/music-context.md` 记录用户立场（艺人雷区、同名歌消歧、事件背景）
- **同名歌强匹配**：artist 必填，避免 Lana 的 White Dress 被解析成 Kanye 同名歌这种事故
- 一系列基础体验修复：单曲循环、点歌立即播、台词打断不重置进度、(Live)/(翻唱)/(Remix) 自动过滤

## 架构

四层结构：

1. **外部上下文** — 用户语料（`user/*.md` + `playlists.json`）、DeepSeek、网易云音乐 API、Edge TTS、open-meteo 天气、ICS 日历
2. **本地大脑** — `core/`：意图分流（含 `/记一下` / `我想听 X` / 模糊词降级）、提示词组装、Set 编排、TTS 批量合成、idle-watcher 主动引领
3. **运行时聚合** — 每次触发把 6 片上下文粘成 prompt，模型输出 Set JSON
4. **交互表层** — Electron 窗口（Player / Profile / Settings 三视图），渲染层经 IPC 与主进程通信

```
renderer/  ──IPC──▶  electron/  ──▶  core/  ──▶  integrations/
 (窗口)              (主进程)        (编排)       (ncm/fish/edge-tts/weather/calendar/upnp)
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
| DeepSeek（大脑） | `DEEPSEEK_API_KEY` | 缺 key → 返回内置模拟 DJ 响应 |
| NeteaseCloudMusicApi | `NCM_BASE_URL` / `NCM_AUTOSTART` | 随应用自动启动；服务不可达 → 返回模拟曲目 |
| TTS 语音 | `EDGE_TTS_VOICE`（免费）/ `FISH_API_KEY` | Fish → Edge TTS → 纯文本，逐级降级 |
| 天气 | `WEATHER_LAT/LON`（open-meteo 免 key）| 网络失败 → 省略天气注入 |
| 日历 | `CALENDAR_ICS_URL`（ICS 订阅链接）| 未配置 → 日程视为空 |
| UPnP / Naim | `UPNP_ENABLED` / `UPNP_DEVICE_LOCATION` | 未发现设备 → 仅记录日志 |

各集成的实时可用状态会显示在 Settings 视图中。

### 网易云音乐服务

Claudio 启动时会自动拉起本地 NeteaseCloudMusicApi 服务（`NCM_AUTOSTART=1`，默认开）。
如需自行管理，可设 `NCM_AUTOSTART=0`，再手动运行 `npx NeteaseCloudMusicApi`。

## 用户语料

`user/` 目录下的文件定义「Claudio 真正属于你」的部分，可随时编辑（改完重启生效，首次读取后缓存）：

- `taste.md` — 你的音乐品味
- `routines.md` — 作息与场景节律
- `playlists.json` — 场景化歌单 + favorites_all（绝对偏好库）
- `mood-rules.md` — 情绪 → 选曲规则
- `music-context.md` — 音乐世界观：艺人雷区 / 同名歌消歧 / 事件背景 / DJ 选曲自检清单
- `data/memory.json` — DJ 自动积累的长期记忆（事实/事件/反馈/偏好），可手改

## 工具

- `npm run import-favorites` — 一键把网易云"我喜欢的音乐"歌单合并到 `user/playlists.json` 的 favorites_all（去重）

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
