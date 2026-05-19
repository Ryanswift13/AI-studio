'use strict';
// 读取 .env（零依赖手写解析），导出配置对象与各集成的 feature flags。
const fs = require('fs');
const { paths } = require('./paths');

function parseEnv(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const file = parseEnv(paths.env);
// .env 文件优先，其次进程环境变量。
const get = (key, fallback = '') => {
  const v = file[key] !== undefined ? file[key] : process.env[key];
  return v === undefined || v === '' ? fallback : v;
};
const num = (key, fallback) => {
  const raw = get(key, '');
  if (raw === '') return fallback; // 缺省时返回 fallback，而非 Number('')→0
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const config = {
  deepseek: {
    apiKey: get('DEEPSEEK_API_KEY', ''),
    baseUrl: get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    model: get('DEEPSEEK_MODEL', 'deepseek-v4-pro'),
    timeoutMs: num('DEEPSEEK_TIMEOUT_MS', 90000),
  },
  claude: {
    bin: get('CLAUDE_BIN', 'claude'),
    timeoutMs: num('CLAUDE_TIMEOUT_MS', 90000),
  },
  ncm: {
    baseUrl: get('NCM_BASE_URL', 'http://localhost:3000'),
    // 音质：standard | higher | exhigh | lossless（黑胶 VIP 可试 lossless）
    level: get('NCM_LEVEL', 'exhigh'),
    // 可选：手动粘贴浏览器 Cookie（含 MUSIC_U），登录接口未写入时兜底
    cookie: get('NCM_COOKIE', ''),
    // 1 = Claudio 启动时自动拉起本地 NeteaseCloudMusicApi 服务
    autostart: get('NCM_AUTOSTART', '1') === '1',
  },
  fish: {
    apiKey: get('FISH_API_KEY', ''),
    voiceId: get('FISH_VOICE_ID', ''),
    baseUrl: get('FISH_BASE_URL', 'https://api.fish.audio'),
  },
  edge: {
    // 微软 Edge 免费神经语音；未配 Fish 时作为默认 TTS
    voice: get('EDGE_TTS_VOICE', 'zh-CN-XiaoxiaoNeural'),
  },
  weather: {
    lat: num('WEATHER_LAT', 31.23),
    lon: num('WEATHER_LON', 121.47),
    city: get('WEATHER_CITY', 'Shanghai'),
  },
  feishu: {
    appId: get('FEISHU_APP_ID', ''),
    appSecret: get('FEISHU_APP_SECRET', ''),
    calendarId: get('FEISHU_CALENDAR_ID', ''),
  },
  upnp: {
    enabled: get('UPNP_ENABLED', '1') === '1',
    deviceLocation: get('UPNP_DEVICE_LOCATION', ''),
  },
  app: {
    devtools: get('DEVTOOLS', '0') === '1',
  },
};

// feature flags：仅反映「凭证是否齐备」，运行时实际可达性由各集成探测。
config.features = {
  deepseek: !!config.deepseek.apiKey,
  fish: !!config.fish.apiKey,
  feishu: !!(config.feishu.appId && config.feishu.appSecret),
  upnp: config.upnp.enabled,
  weather: true, // open-meteo 免 key，默认可用
};

module.exports = config;
