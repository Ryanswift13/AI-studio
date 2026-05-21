'use strict';
// 一次性脚本：把网易云"喜欢的音乐"歌单合并进 user/playlists.json 的 favorites_all。
// 前置条件：
//   1) .env 里 NCM_COOKIE=MUSIC_U=xxx（浏览器 F12 复制），或已扫码登录留下了 data/ncm-cookie.json
//   2) NeteaseCloudMusicApi 服务在 localhost:3000；脚本会按需自动拉起（用项目内安装的版本）
// 跑：node scripts/import-ncm-favorites.js
//   或：npm run import-favorites

const fs = require('fs');
const path = require('path');
const config = require('../core/config');
const { paths } = require('../core/paths');
const ncmServer = require('../core/ncm-server');

const BASE = (config.ncm.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
const COOKIE = config.ncm.cookie || readCookieJson();
const PL_PATH = path.join(paths.user, 'playlists.json');

function readCookieJson() {
  try {
    const j = JSON.parse(fs.readFileSync(paths.ncmCookieFile, 'utf8'));
    return j.cookie || '';
  } catch {
    return '';
  }
}

async function ncmFetch(url, opts = {}) {
  const u = url + (url.includes('?') ? '&' : '?') + 'timestamp=' + Date.now();
  const headers = { ...(opts.headers || {}) };
  if (COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(u, { ...opts, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function reachable() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const res = await fetch(`${BASE}/search?keywords=ping&limit=1`, { signal: ac.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitReachable(maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await reachable()) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

// 归一化用于去重：去括号副标题、去空白与标点、小写；artist 只取第一位主唱
function normKey(name, artist) {
  const stripParens = (s) =>
    String(s || '').replace(/[\(\[（【][^)\]）】]*?[\)\]）】]/g, '');
  const clean = (s) =>
    stripParens(s)
      .toLowerCase()
      .replace(/[\s,，、.。\-_~`'"!！?？:：;；]/g, '')
      .trim();
  const firstArtist = String(artist || '').split(/[\/、,，&]/)[0];
  return clean(name) + '|' + clean(firstArtist);
}

async function main() {
  if (!COOKIE) {
    console.error('未找到 NCM cookie。请在 .env 设 NCM_COOKIE=MUSIC_U=xxx 或先扫码登录。');
    process.exit(1);
  }

  // 1. 确保 NCM API 可达；不通则尝试自动拉起一个子进程
  let weStartedIt = false;
  if (!(await reachable())) {
    console.log(`→ NCM API (${BASE}) 不可达，尝试自动启动…`);
    ncmServer.start();
    weStartedIt = true;
    if (!(await waitReachable())) {
      console.error('启动 NCM API 失败。请手动 `npx NeteaseCloudMusicApi` 后重试。');
      ncmServer.stop();
      process.exit(1);
    }
    console.log('✓ NCM API 已就绪');
  }

  try {
    // 2. 验证登录态、取 userId
    console.log('→ 检查登录状态…');
    const status = await ncmFetch(`${BASE}/login/status`, { method: 'POST' });
    const profile = status?.data?.profile || {};
    const account = status?.data?.account || {};
    const loggedIn = !!profile.userId && !account.anonimousUser;
    if (!loggedIn) {
      console.error('cookie 无效或已过期（被识别为匿名）。请到浏览器重新复制 MUSIC_U。');
      console.error('account=', account);
      process.exit(1);
    }
    console.log(`✓ 已登录 userId=${profile.userId} 昵称=${profile.nickname || ''}`);

    // 3. 找"喜欢的音乐"歌单（specialType=5）
    console.log('→ 拉取你的歌单列表…');
    const lists = await ncmFetch(`${BASE}/user/playlist?uid=${profile.userId}&limit=100`);
    const all = lists?.playlist || [];
    const liked =
      all.find((p) => p.specialType === 5) ||
      all.find((p) => /喜欢的音乐/.test(p.name));
    if (!liked) {
      console.error('找不到"我喜欢的音乐"歌单。可用歌单：');
      for (const p of all) console.error(`  - ${p.name} (id=${p.id} specialType=${p.specialType})`);
      process.exit(1);
    }
    console.log(`✓ 红心歌单：${liked.name} (id=${liked.id}, ${liked.trackCount} 首)`);

    // 4. 拉全部曲目
    console.log('→ 拉取曲目（可能要 10 秒）…');
    const tracks = await ncmFetch(
      `${BASE}/playlist/track/all?id=${liked.id}&limit=10000`
    );
    const songs = tracks?.songs || [];
    console.log(`✓ 拉到 ${songs.length} 首`);

    // 5. 标准化为 {name, artist}
    const incoming = songs
      .map((s) => ({
        name: s.name,
        artist: ((s.ar || []).map((a) => a.name).join(' / ')) || '未知歌手',
      }))
      .filter((t) => t.name);

    // 6. 读现有 playlists.json，去重合并
    const pl = JSON.parse(fs.readFileSync(PL_PATH, 'utf8'));
    pl.favorites_all = pl.favorites_all || [];
    const existing = new Set(pl.favorites_all.map((t) => normKey(t.name, t.artist)));
    let added = 0;
    let dup = 0;
    for (const t of incoming) {
      const k = normKey(t.name, t.artist);
      if (existing.has(k)) { dup++; continue; }
      existing.add(k);
      pl.favorites_all.push(t);
      added++;
    }

    // 7. 更新 meta 并落盘
    pl.meta = pl.meta || {};
    const stamp = new Date().toISOString().slice(0, 10);
    pl.meta.source =
      (pl.meta.source || '').replace(/\s*\+\s*网易云红心.*$/, '') +
      ` + 网易云红心 ${songs.length} 首（${stamp} 导入，新增 ${added}，去重 ${dup}）`;
    fs.writeFileSync(PL_PATH, JSON.stringify(pl, null, 2), 'utf8');

    console.log('');
    console.log(`完成：新增 ${added} 首，去重跳过 ${dup} 首。favorites_all 共 ${pl.favorites_all.length} 首。`);
    console.log('重启 Claudio 让 context.js 重读语料（首次读取后缓存）。');
  } finally {
    if (weStartedIt) {
      ncmServer.stop();
      console.log('→ 已关闭脚本自启的 NCM API。');
    }
  }
}

main().catch((e) => {
  console.error('失败：', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
