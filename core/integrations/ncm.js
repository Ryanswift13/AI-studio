'use strict';
// NeteaseCloudMusicApi 客户端：search / song_url / lyric / recommend。
// 服务不可达时降级为模拟曲目（占位音频用柔和正弦音 WAV）。
const fs = require('fs');
const config = require('../config');
const { paths } = require('../paths');
const { fetchJson, log, warn, toneWav, sha1 } = require('../util');

const base = () => config.ncm.baseUrl.replace(/\/$/, '');

let _probe = { ok: false, at: 0 };
const PROBE_TTL = 30000;
let _sessionCookie = '';

function loadCookie() {
  if (config.ncm.cookie) return config.ncm.cookie;
  try {
    const j = JSON.parse(fs.readFileSync(paths.ncmCookieFile, 'utf8'));
    return j.cookie || '';
  } catch {
    return '';
  }
}

function saveCookie(cookie) {
  if (!cookie) return;
  _sessionCookie = cookie;
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(
      paths.ncmCookieFile,
      JSON.stringify({ cookie, savedAt: Date.now() }, null, 0),
      'utf8'
    );
    log('ncm', '已保存登录 Cookie');
  } catch (e) {
    warn('ncm', '保存 Cookie 失败：', e.message);
  }
}

function cookieHeader() {
  return _sessionCookie || config.ncm.cookie || loadCookie();
}

_sessionCookie = loadCookie();

function isPreview(item) {
  if (!item || !item.url) return true;
  if (item.freeTrialInfo) return true;
  // 约 30s 试听（time 单位 ms）
  if (item.time && item.time > 0 && item.time < 60000) return true;
  return false;
}

async function reachable() {
  const now = Date.now();
  if (now - _probe.at < PROBE_TTL) return _probe.ok;
  try {
    // 任意轻量接口都可用作探活
    await fetchJson(`${base()}/search?keywords=test&limit=1`, {}, 4000);
    _probe = { ok: true, at: now };
  } catch {
    _probe = { ok: false, at: now };
  }
  return _probe.ok;
}

async function ncmJson(path, opts = {}, timeoutMs = 8000) {
  if (!(await reachable())) {
    throw new Error('NeteaseCloudMusicApi 未启动，请先运行 npx NeteaseCloudMusicApi');
  }
  const url = `${base()}${path}${path.includes('?') ? '&' : '?'}timestamp=${Date.now()}`;
  const headers = { ...(opts.headers || {}) };
  const ck = cookieHeader();
  if (ck) headers.Cookie = ck;
  return fetchJson(url, { ...opts, headers }, timeoutMs);
}

// 扫码登录：生成 key + 二维码（base64）。
async function loginQrStart() {
  const keyRes = await ncmJson('/login/qr/key');
  const key = keyRes && keyRes.data && keyRes.data.unikey;
  if (!key) throw new Error('无法获取登录 key');
  let qrimg = '';
  try {
    const qrRes = await ncmJson(
      `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true`,
      {},
      12000
    );
    qrimg = (qrRes && qrRes.data && qrRes.data.qrimg) || '';
  } catch {
    const qrRes = await ncmJson(
      `/login/qr?key=${encodeURIComponent(key)}&qrimg=true`,
      {},
      12000
    );
    qrimg = (qrRes && qrRes.data && qrRes.data.qrimg) || '';
  }
  if (!qrimg) throw new Error('无法生成二维码');
  if (!qrimg.startsWith('data:')) qrimg = `data:image/png;base64,${qrimg}`;
  return { key, qrimg };
}

// 轮询扫码状态。code: 800 过期 / 801 待扫 / 802 待确认 / 803 成功
async function loginQrCheck(key) {
  const j = await ncmJson(`/login/qr/check?key=${encodeURIComponent(key)}`);
  const code = j && j.code;
  const map = {
    800: '二维码已过期，请刷新',
    801: '请使用网易云音乐 App 扫码',
    802: '已在手机扫码，请在手机上确认登录',
    803: '登录成功',
  };
  if (code === 803) {
    const ck = (j && j.cookie) || (j && j.data && j.data.cookie);
    if (ck) saveCookie(ck);
  }
  return {
    code,
    message: map[code] || (j && j.message) || '等待扫码…',
    ok: code === 803,
    profile:
      code === 803 && j && j.profile
        ? { nickname: j.profile.nickname, userId: j.profile.userId }
        : null,
  };
}

// 当前是否已登录（依赖 NCM 服务端保存的 cookie）。
async function loginStatus() {
  if (!(await reachable())) {
    return { loggedIn: false, reachable: false, nickname: '' };
  }
  try {
    const j = await ncmJson('/login/status', { method: 'POST' });
    const data = (j && j.data) || {};
    const account = data.account || {};
    const profile = data.profile || {};
    // 网易云会给未登录会话发匿名 token（account.anonimousUser，userName 形如 1000_xxx）——不算登录
    const loggedIn = !!profile.userId && !account.anonimousUser;
    return {
      loggedIn,
      reachable: true,
      nickname: loggedIn ? profile.nickname || '' : '',
      userId: loggedIn ? profile.userId : null,
    };
  } catch {
    return { loggedIn: false, reachable: true, nickname: '' };
  }
}

function mockTrack(name, artist) {
  const h = sha1(name);
  // 由歌名摘要派生略微不同的占位音高
  const freq = 196 * Math.pow(2, (parseInt(h.slice(0, 2), 16) % 12) / 12);
  return {
    id: `mock-${h.slice(0, 8)}`,
    name,
    artist: artist || '未知歌手',
    album: '本地模拟',
    duration: 12000,
    url: toneWav(freq, 12),
    source: 'mock',
  };
}

// 副标题里含「(Live)」「(翻唱)」「(伴奏)」「(Remix)」等的版本——用户明确表达过不喜欢，默认过滤掉。
const COVER_LIVE_RE =
  /[\(\[（【][^)\]）】]*?(?:live|现场|翻唱|cover|演唱会|不插电|remix|混音|伴奏|纯音乐|instrumental|karaoke|demo)[^)\]）】]*?[\)\]）】]/i;
function isCoverOrLive(name) {
  return !!name && COVER_LIVE_RE.test(name);
}
// 当用户的 query 本身就在找翻唱/现场时，关闭过滤
function queryWantsLive(keyword) {
  return /live|现场|翻唱|cover|演唱会|不插电|remix|混音|伴奏|karaoke|demo/i.test(keyword || '');
}

// 搜索曲目，返回标准化列表。
async function search(keyword, limit = 6) {
  if (!(await reachable())) {
    return [mockTrack(keyword, '')];
  }
  try {
    // 多拿一些再过滤，避免过滤后命中数太少
    const fetchLimit = queryWantsLive(keyword) ? limit : Math.max(limit, 10);
    const j = await fetchJson(
      `${base()}/search?keywords=${encodeURIComponent(keyword)}&limit=${fetchLimit}`,
      {},
      6000
    );
    const songs = (j && j.result && j.result.songs) || [];
    const all = songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.artists || s.ar || []).map((a) => a.name).join(' / ') || '未知歌手',
      album: (s.album && s.album.name) || (s.al && s.al.name) || '',
      duration: s.duration || s.dt || 0,
      source: 'ncm',
    }));
    if (queryWantsLive(keyword)) return all.slice(0, limit);
    const studio = all.filter((s) => !isCoverOrLive(s.name));
    // 全是 live/cover 时保留原列表，避免出现「找不到」
    return (studio.length ? studio : all).slice(0, limit);
  } catch (e) {
    warn('ncm', 'search 失败，降级模拟：', e.message);
    return [mockTrack(keyword, '')];
  }
}

// 取直链（VIP 需 /song/url/v1 + 登录 Cookie，旧版 /song/url 常只返回 30s 试听）。
async function songUrl(id) {
  const prefer = config.ncm.level || 'exhigh';
  const levels = [...new Set([prefer, 'exhigh', 'higher', 'lossless', 'standard'])];

  for (const level of levels) {
    try {
      const j = await ncmJson(
        `/song/url/v1?id=${encodeURIComponent(id)}&level=${encodeURIComponent(level)}`,
        {},
        12000
      );
      const item = j && j.data && j.data[0];
      if (item && item.url && !isPreview(item)) {
        log('ncm', `完整直链 id=${id} level=${level} payed=${item.payed}`);
        return item.url;
      }
      if (item && item.url && isPreview(item)) {
        warn('ncm', `id=${id} level=${level} 仍为试听，尝试下一档音质`);
      }
    } catch (e) {
      warn('ncm', `song/url/v1 level=${level} 失败：`, e.message);
    }
  }

  try {
    const j = await ncmJson(`/song/url?id=${encodeURIComponent(id)}&br=320000`, {}, 8000);
    const item = j && j.data && j.data[0];
    if (item && item.url && !isPreview(item)) return item.url;
  } catch (e) {
    warn('ncm', 'song/url 降级失败：', e.message);
  }
  return null;
}

// 取歌词。
async function lyric(id) {
  try {
    const j = await fetchJson(`${base()}/lyric?id=${encodeURIComponent(id)}`, {}, 6000);
    return (j && j.lrc && j.lrc.lyric) || '';
  } catch {
    return '';
  }
}

// 推荐新歌（无需登录）。
async function recommend(limit = 6) {
  if (!(await reachable())) {
    return [];
  }
  try {
    const j = await fetchJson(`${base()}/personalized/newsong?limit=${limit}`, {}, 6000);
    const list = (j && j.result) || [];
    return list.map((it) => ({
      id: String(it.id),
      name: it.name,
      artist: ((it.song && it.song.artists) || []).map((a) => a.name).join(' / '),
      source: 'ncm',
    }));
  } catch (e) {
    warn('ncm', 'recommend 失败：', e.message);
    return [];
  }
}

// 把一个搜索命中（含 id）解析为可播放曲目，省去重复搜索。
async function resolveHit(hit) {
  const url = await songUrl(hit.id);
  if (!url) {
    // 命中元数据但无直链（常因版权）→ 用占位音频，保留真实曲目信息
    log('ncm', `「${hit.name}」无直链，使用占位音频`);
    return { ...hit, url: toneWav(220, 12), source: 'ncm-nourl' };
  }
  return { ...hit, url };
}

// 歌手强匹配：hit 的 artist 字符串里至少包含 wanted 的一个 ≥2 字符 token。
// 防止"White Dress (Lana Del Rey)"被解析成同名的 Kanye West 版本这类事故。
function artistMatch(hitArtist, wanted) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s.,&/、·]/g, '');
  const h = norm(hitArtist);
  const tokens = String(wanted || '')
    .toLowerCase()
    .split(/[\s.,&/、·]+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return true; // 没指定 wanted 则不约束
  return tokens.some((t) => h.includes(t));
}

// 把「歌名 + 歌手」解析为可播放曲目（含直链）。
// top 命中常因版权/VIP 仅返回试听，逐个候选尝试，全部受限才回落占位音频。
// 若指定了 artist：hit 的歌手不匹配则跳过，避免错版本（如同名 cover/不同艺人）。
async function resolve(name, artist = '') {
  const query = artist ? `${name} ${artist}` : name;
  const hits = await search(query, 6);
  if (!hits.length || hits[0].source === 'mock') return mockTrack(name, artist);
  const candidates = artist
    ? hits.filter((h) => artistMatch(h.artist, artist))
    : hits;
  if (artist && candidates.length === 0) {
    warn('ncm', `「${name}」找不到歌手为「${artist}」的版本，放弃避免错版`);
    return null; // djFlow 会过滤掉 null，避免放出错版本
  }
  for (const hit of candidates.slice(0, 3)) {
    const url = await songUrl(hit.id);
    if (url) return { ...hit, url };
  }
  log('ncm', `「${name}」候选均无完整直链，使用占位音频`);
  return { ...candidates[0], url: toneWav(220, 12), source: 'ncm-nourl' };
}

async function status() {
  const up = await reachable();
  const login = up ? await loginStatus() : { loggedIn: false, nickname: '' };
  const hasCookie = !!cookieHeader();
  const detail = !up
    ? `未连接 ${base()}，请运行 npx NeteaseCloudMusicApi`
    : login.loggedIn
      ? `已登录：${login.nickname || '网易云用户'}${hasCookie ? ' · VIP 直链已启用' : ' · 请重新扫码以保存 Cookie'}`
      : '服务已连接，未登录（可点顶栏 LOGIN 扫码）';
  return { name: 'NeteaseCloudMusicApi', ok: up, baseUrl: base(), loggedIn: login.loggedIn, detail };
}

module.exports = {
  search,
  songUrl,
  lyric,
  recommend,
  resolve,
  resolveHit,
  reachable,
  loginQrStart,
  loginQrCheck,
  loginStatus,
  status,
};
