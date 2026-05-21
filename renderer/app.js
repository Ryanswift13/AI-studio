'use strict';
/* Claudio 渲染层 —— 单 <audio>、点阵时钟、IPC 聊天、stream 订阅、prefetch。 */

const $ = (id) => document.getElementById(id);
const api = window.claudio;

/* ───────── 窗口控制 ───────── */
$('winMin').onclick = () => api.minimize();
$('winClose').onclick = () => api.close();

/* ───────── 主题 ───────── */
async function initTheme() {
  const saved = (await api.getPref('theme')) || 'dark';
  applyTheme(saved);
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  for (const b of $('themeToggle').children) {
    b.classList.toggle('active', b.dataset.themeSet === theme);
  }
  clockColors = null; // 主题变更后让时钟下次绘制重新取色
}
$('themeToggle').addEventListener('click', (e) => {
  const t = e.target.dataset.themeSet;
  if (!t) return;
  applyTheme(t);
  api.setPref('theme', t);
});
/* ───────── 网易云扫码登录 ───────── */
let ncmLoginKey = '';
let ncmPollTimer = null;

async function refreshNcmLoginBtn() {
  try {
    const st = await api.ncmLoginStatus();
    const btn = $('loginBtn');
    if (st.loggedIn) {
      btn.textContent = st.nickname ? `♪ ${st.nickname}` : '已登录';
      btn.classList.add('logged-in');
      btn.title = '网易云已登录，点击可重新扫码';
    } else {
      btn.textContent = 'LOGIN';
      btn.classList.remove('logged-in');
      btn.title = '网易云扫码登录';
    }
  } catch {
    /* 忽略 */
  }
}

function stopNcmPoll() {
  if (ncmPollTimer) {
    clearInterval(ncmPollTimer);
    ncmPollTimer = null;
  }
}

function setNcmModalOpen(open) {
  $('ncmLoginModal').hidden = !open;
  if (!open) stopNcmPoll();
}

async function startNcmQr() {
  stopNcmPoll();
  ncmLoginKey = '';
  $('ncmLoginQr').hidden = true;
  $('ncmLoginLoading').hidden = false;
  $('ncmLoginLoading').textContent = '正在连接本地 API…';
  $('ncmLoginStatus').textContent = '';
  try {
    const { key, qrimg } = await api.ncmLoginQrStart();
    ncmLoginKey = key;
    $('ncmLoginQr').src = qrimg;
    $('ncmLoginQr').hidden = false;
    $('ncmLoginLoading').hidden = true;
    $('ncmLoginStatus').textContent = '请使用网易云音乐 App 扫码';
    ncmPollTimer = setInterval(pollNcmQr, 3000);
    pollNcmQr();
  } catch (e) {
    $('ncmLoginLoading').textContent = e.message || '连接失败';
    $('ncmLoginStatus').textContent =
      '请先在终端运行：npx NeteaseCloudMusicApi';
  }
}

async function pollNcmQr() {
  if (!ncmLoginKey) return;
  try {
    const r = await api.ncmLoginQrCheck(ncmLoginKey);
    $('ncmLoginStatus').textContent = r.message || '';
    if (r.code === 800) {
      stopNcmPoll();
      return;
    }
    if (r.ok) {
      stopNcmPoll();
      await refreshNcmLoginBtn();
      sysMessage(`网易云登录成功${r.profile && r.profile.nickname ? '：' + r.profile.nickname : ''}`);
      setTimeout(() => setNcmModalOpen(false), 800);
    }
  } catch (e) {
    $('ncmLoginStatus').textContent = e.message || '轮询失败';
  }
}

$('loginBtn').onclick = () => {
  // 已登录态下不直接弹二维码，先确认是否要切换账号
  const btn = $('loginBtn');
  if (btn.classList.contains('logged-in')) {
    const name = btn.textContent.replace(/^♪\s*/, '').trim() || '当前用户';
    if (!window.confirm(`${name} 已登录。要重新扫码切换账号吗？`)) return;
  }
  setNcmModalOpen(true);
  startNcmQr();
};
$('ncmLoginClose').onclick = () => setNcmModalOpen(false);
$('ncmLoginRefresh').onclick = () => startNcmQr();
$('ncmLoginModal').addEventListener('click', (e) => {
  if (e.target === $('ncmLoginModal')) setNcmModalOpen(false);
});
refreshNcmLoginBtn();

/* ───────── 视图切换 ───────── */
$('tabs').addEventListener('click', (e) => {
  const v = e.target.dataset.view;
  if (!v) return;
  for (const b of $('tabs').children) b.classList.toggle('active', b.dataset.view === v);
  for (const s of document.querySelectorAll('.view')) {
    s.classList.toggle('active', s.id === `view-${v}`);
  }
  $('inputbar').style.display = v === 'player' ? 'flex' : 'none';
  if (v === 'profile') loadProfile();
  if (v === 'settings') {
    loadSettings();
    refreshNcmLoginBtn();
  }
});

/* ───────── 点阵时钟 ───────── */
const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '00000', '00100', '00000', '00100', '00000', '00000'],
};
const clockCanvas = $('clock');
const cctx = clockCanvas.getContext('2d');
let clockColors = null; // 缓存取色结果，主题切换时由 applyTheme 置空

function drawClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const text = `${hh}:${mm}:${ss}`;

  const dpr = window.devicePixelRatio || 1;
  const cssW = clockCanvas.clientWidth || 320;
  const cssH = clockCanvas.clientHeight || 84;
  // 仅在尺寸真正变化时重设位图（重设会清空并重新分配）
  if (clockCanvas.width !== cssW * dpr || clockCanvas.height !== cssH * dpr) {
    clockCanvas.width = cssW * dpr;
    clockCanvas.height = cssH * dpr;
  }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, cssW, cssH);

  const cols = text.length * 5 + (text.length - 1); // 字形间 1 列空隙
  const rows = 7;
  const cell = Math.min(cssW / (cols + 2), cssH / (rows + 2));
  const r = cell * 0.4;
  const ox = (cssW - cols * cell) / 2 + cell / 2;
  const oy = (cssH - rows * cell) / 2 + cell / 2;

  if (!clockColors) {
    const css = getComputedStyle(document.documentElement);
    clockColors = {
      lit: css.getPropertyValue('--accent').trim() || '#8b7bf0',
      dim: css.getPropertyValue('--line').trim() || 'rgba(140,140,200,.22)',
    };
  }
  const { lit, dim } = clockColors;

  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]] || FONT['0'];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 5; col++) {
        const on = glyph[row][col] === '1';
        const x = ox + (i * 6 + col) * cell;
        const y = oy + row * cell;
        cctx.beginPath();
        cctx.arc(x, y, r, 0, Math.PI * 2);
        if (on) {
          cctx.fillStyle = lit;
          cctx.shadowColor = lit;
          cctx.shadowBlur = cell * 0.6;
        } else {
          cctx.fillStyle = dim;
          cctx.shadowBlur = 0;
        }
        cctx.fill();
      }
    }
  }
  cctx.shadowBlur = 0;

  const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MO = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  $('clockDay').textContent = WD[now.getDay()];
  $('clockDate').textContent =
    `${String(now.getDate()).padStart(2, '0')}·${MO[now.getMonth()]}·${now.getFullYear()}`;
}
setInterval(drawClock, 1000);
drawClock();
window.addEventListener('resize', drawClock);

/* ───────── 播放控制器 ───────── */
const audio = $('audio');
let mode = 'idle'; // idle | speaking | music
let currentTrack = null; // 最新的 now 曲目（含 url）
let nextTrack = null; // 供 prefetch
let warmed = null; // 已预热的 url

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function setNowState(txt) {
  $('nowState').textContent = txt;
}
function setEq(on) {
  $('eq').classList.toggle('playing', on);
}

/* 播放/暂停键图标随播放状态切换 */
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2 19 12 8 18.8z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5h3.2v14H8.5z"/><path d="M12.3 5h3.2v14h-3.2z"/></svg>';
function setPlayIcon(playing) {
  $('btnPlay').innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

// 台词打断当前音乐时，暂存进度——台词播完后从断点接着，不要从头放。
let savedMusicTime = 0;
let savedMusicTrack = null;
function playSpeak(url) {
  if (!url) return false;
  if (mode === 'music' && currentTrack && currentTrack.url && !audio.paused) {
    savedMusicTrack = currentTrack;
    savedMusicTime = audio.currentTime || 0;
  }
  mode = 'speaking';
  setNowState('SPEAKING');
  setEq(false);
  audio.src = url;
  audio.play().catch(() => {});
  return true;
}
// 从指定位置接着播某曲（台词结束后恢复用）
function resumeMusic(track, atTime) {
  if (!track || !track.url) return;
  currentTrack = track;
  mode = 'music';
  warmed = null;
  $('nowTitle').textContent = `${track.name}${
    track.artist ? ' · ' + track.artist : ''
  }`;
  audio.src = track.url;
  const onMeta = () => {
    try {
      audio.currentTime = atTime;
    } catch (e) {
      /* 某些占位音 / 流可能 seek 不了，忽略 */
    }
    audio.play().catch(() => {});
    audio.removeEventListener('loadedmetadata', onMeta);
  };
  audio.addEventListener('loadedmetadata', onMeta);
}
function playMusic(track) {
  currentTrack = track || currentTrack;
  if (!currentTrack || !currentTrack.url) {
    mode = 'idle';
    setNowState('IDLE');
    setEq(false);
    return;
  }
  mode = 'music';
  warmed = null;
  $('nowTitle').textContent = `${currentTrack.name}${
    currentTrack.artist ? ' · ' + currentTrack.artist : ''
  }`;
  audio.src = currentTrack.url;
  audio.play().catch(() => {});
}

// Set 内 pre/post-speak 播放——和 playSpeak（聊天/调度触发的台词打断）区分
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
  // 无音频但有字幕——直接贴到聊天流（字幕电台模式）
  if (speech.text) {
    sysMessage(`(DJ) ${speech.text}`);
  }
  return false;
}

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

audio.addEventListener('play', () => {
  setPlayIcon(true);
  if (mode === 'music') {
    setNowState('PLAYING');
    setEq(true);
  }
});
audio.addEventListener('pause', () => {
  setPlayIcon(false);
  if (mode === 'music') {
    setNowState('PAUSED');
    setEq(false);
  }
});
audio.addEventListener('ended', async () => {
  if (mode === 'speaking') {
    // 旧路径：聊天/调度触发的台词打断了当前音乐 → 恢复进度
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
    // post-speak 完 → 推进队列
    setNowState('NEXT…');
    setEq(false);
    const snap = await api.next();
    applySnapshot(snap);
    if (snap.track) startTrackPipeline(snap.track);
    return;
  }
  if (mode === 'music') {
    // 当前曲目播完——若有 after_speak（outro）先播，否则直接 next
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
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  const c = audio.currentTime || 0;
  $('curTime').textContent = fmtTime(c);
  $('durTime').textContent = fmtTime(d);
  $('barFill').style.width = d ? `${(c / d) * 100}%` : '0%';
  // prefetch：剩余 10s 时预热下一首
  if (mode === 'music' && d && d - c < 10 && nextTrack && nextTrack.url && warmed !== nextTrack.url) {
    warmed = nextTrack.url;
    const warm = new Audio();
    warm.preload = 'auto';
    warm.src = nextTrack.url;
  }
});
audio.addEventListener('error', () => {
  if (mode === 'music') setNowState('音频不可用');
});

$('bar').addEventListener('click', (e) => {
  const d = audio.duration;
  if (!d) return;
  const rect = $('bar').getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * d;
});

/* 走带控制 */
$('btnPlay').onclick = () => {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
};
$('btnNext').onclick = async () => {
  const snap = await api.next();
  applySnapshot(snap);
  playMusic(snap.track);
};
$('btnPrev').onclick = async () => {
  const snap = await api.prev();
  applySnapshot(snap);
  playMusic(snap.track);
};
$('btnStop').onclick = () => {
  audio.pause();
  audio.currentTime = 0;
  mode = 'idle';
  setNowState('STOPPED');
  setEq(false);
};
$('btnFav').onclick = () => $('btnFav').classList.toggle('on');
$('btnFavTag').onclick = () => $('btnFavTag').classList.toggle('on');
$('btnHide').onclick = () => {
  const np = document.querySelector('.nowbar .progress');
  np.style.display = np.style.display === 'none' ? 'flex' : 'none';
};

/* 音量 */
async function initVolume() {
  const raw = await api.getPref('volume');
  const v = Number(raw);
  const vol = raw != null && Number.isFinite(v) && v >= 0 && v <= 100 ? v : 80;
  $('vol').value = vol;
  audio.volume = vol / 100;
}
$('vol').addEventListener('input', () => {
  audio.volume = $('vol').value / 100;
  api.setPref('volume', $('vol').value);
});

/* ───────── 队列 / now ───────── */
function applySnapshot(snap) {
  if (!snap) return;
  if (snap.track) currentTrack = snap.track;
  nextTrack = snap.next || null;
  const list = $('queueList');
  list.innerHTML = '';
  const q = snap.queue || [];
  $('queueCount').textContent = `${q.length} TRACK${q.length === 1 ? '' : 'S'}`;
  if (q.length === 0) {
    list.innerHTML = '<li class="empty">队列为空 —— 和 Claudio 说点什么</li>';
    return;
  }
  q.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = i === snap.index ? 'current' : '';
    li.innerHTML = `<span class="idx">${String(i + 1).padStart(2, '0')}</span>
      <span>${esc(t.name)}${t.artist ? ' · ' + esc(t.artist) : ''}</span>`;
    list.appendChild(li);
  });
  if (snap.track && mode === 'idle') {
    $('nowTitle').textContent = `${snap.track.name}${
      snap.track.artist ? ' · ' + snap.track.artist : ''
    }`;
  }
}

/* ───────── 聊天 / 消息 ───────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
function timeLabel(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addMessage({ role, content, meta, ts }) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const who = role === 'user' ? 'YOU' : role === 'claudio' ? 'CLAUDIO' : 'SYSTEM';
  let foot = `<span>${timeLabel(ts)}</span>`;
  if (meta && meta.audio) {
    foot += `<button class="replay" data-audio="${esc(meta.audio)}">▶ REPLAY</button>`;
  }
  if (meta && meta.source) {
    const label = { deepseek: 'DEEPSEEK', claude: 'CLAUDE', mock: 'MOCK', ncm: 'NCM' }[
      meta.source
    ] || meta.source;
    foot += `<span class="badge">${label}</span>`;
  }
  let tracks = '';
  if (meta && meta.tracks && meta.tracks.length) {
    tracks =
      '<div class="tracks">♪ ' +
      meta.tracks.map((t) => esc(t.name) + (t.artist ? ' · ' + esc(t.artist) : '')).join('　') +
      '</div>';
  }
  wrap.innerHTML = `
    <div class="who">${who}</div>
    <div class="bubble">${esc(content)}</div>
    ${tracks}
    <div class="foot">${foot}</div>`;
  $('messages').appendChild(wrap);
  $('messages').scrollIntoView(false);
  const replay = wrap.querySelector('.replay');
  if (replay) replay.onclick = () => playSpeak(replay.dataset.audio);
  return wrap;
}
function sysMessage(text) {
  addMessage({ role: 'system', content: text, ts: Date.now() });
}

/* DJ 结果统一处理：渲染气泡 + 先播台词后播音乐 */
function handleDjResult(res) {
  if (!res) return;
  if (res.kind === 'command') {
    applyCommand(res);
    return;
  }
  applySnapshot(res.snapshot);
  addMessage({
    role: 'claudio',
    content: res.say,
    ts: Date.now(),
    meta: {
      audio: res.audio,
      source: res.source,
      tracks: res.tracks,
    },
  });
  const startTrack = (res.snapshot && res.snapshot.track) || currentTrack;
  currentTrack = startTrack;
  // 若返回了带 before_speak 的 set track（intro 挂在第一首）→ 走 set pipeline
  if (startTrack && startTrack.before_speak) {
    startTrackPipeline(startTrack);
  } else if (res.audio) {
    // 老路径：聊天台词单独播（闲聊响应或调度回复）
    playSpeak(res.audio);
  } else if (startTrack) {
    playMusic(startTrack);
  }
}

function applyCommand(res) {
  const a = res.command && res.command.action;
  if (a === 'pause') audio.pause();
  else if (a === 'play') audio.play().catch(() => {});
  else if (a === 'volume' && res.command.value != null) {
    $('vol').value = res.command.value;
    audio.volume = res.command.value / 100;
    api.setPref('volume', res.command.value);
  } else if (a === 'next' || a === 'prev' || a === 'stop') {
    applySnapshot(res.snapshot);
    if (a === 'stop') {
      audio.pause();
      mode = 'idle';
      setNowState('STOPPED');
      setEq(false);
    } else {
      playMusic(res.snapshot && res.snapshot.track);
    }
  }
  sysMessage(`已执行：${a}`);
}

async function sendChat(text) {
  text = text.trim();
  if (!text) return;
  addMessage({ role: 'user', content: text, ts: Date.now() });
  $('chatInput').value = '';
  const sending = addMessage({ role: 'system', content: 'Claudio 正在编排…', ts: Date.now() });
  try {
    const res = await api.chat(text);
    sending.remove();
    handleDjResult(res);
  } catch (e) {
    sending.remove();
    sysMessage('编排出错：' + e.message);
  }
}
$('sendBtn').onclick = () => sendChat($('chatInput').value);
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat($('chatInput').value);
});

/* ───────── 麦克风（尽力而为）───────── */
(function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('micBtn');
  if (!SR) {
    btn.disabled = true;
    btn.title = '当前环境不支持语音输入';
    btn.style.opacity = 0.4;
    return;
  }
  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.interimResults = false;
  let on = false;
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    $('chatInput').value = text;
    sendChat(text);
  };
  rec.onend = () => {
    on = false;
    btn.classList.remove('rec');
  };
  rec.onerror = () => {
    on = false;
    btn.classList.remove('rec');
  };
  btn.onclick = () => {
    if (on) {
      rec.stop();
      return;
    }
    try {
      rec.start();
      on = true;
      btn.classList.add('rec');
    } catch {
      /* 已在运行 */
    }
  };
})();

/* ───────── stream 订阅 ───────── */
api.onStream((p) => {
  setConnected();
  if (p.type === 'now' || p.type === 'queue') {
    applySnapshot(p);
  } else if (p.type === 'dj') {
    // 调度（07:00/09:00/整点/日历）发起的播报
    handleDjResult(p);
  } else if (p.type === 'scheduler') {
    const names = {
      'scheduler:plan': '07:00 今日规划',
      'scheduler:morning': '09:00 早间播报',
      'scheduler:mood': '整点情绪检查',
      'scheduler:calendar': '日历日程提醒',
    };
    sysMessage(`⏱ ${names[p.trigger] || p.trigger} 触发`);
  }
});

function setConnected() {
  $('connLine').textContent = 'Connected to Claudio server';
  $('statusRight').textContent = 'CONNECTED';
  $('feedState').textContent = 'LIVE';
}

/* ───────── Profile ───────── */
async function loadProfile() {
  const body = $('profileBody');
  body.textContent = '读取中…';
  try {
    const t = await api.taste();
    setConnected();
    const arts = t.topArtists.length
      ? t.topArtists
          .map((a) => `<span class="tag">${esc(a.artist)}<b>${a.n}</b></span>`)
          .join('')
      : '<span class="tag">暂无播放数据</span>';
    const plays = t.recentPlays.length
      ? t.recentPlays
          .slice(0, 12)
          .map(
            (p) =>
              `<div class="play-row"><span>${esc(p.name)} · ${esc(
                p.artist || ''
              )}</span><span>${timeLabel(p.played_at)}</span></div>`
          )
          .join('')
      : '<div class="play-row"><span>还没有播放记录</span></div>';

    const hours = new Array(24).fill(0);
    for (const h of t.playHours || []) hours[h.hour] = h.n;
    const max = Math.max(1, ...hours);
    const bars = hours
      .map((n) => `<div class="col"><div class="v" style="height:${(n / max) * 100}%"></div></div>`)
      .join('');

    body.innerHTML = `
      <div class="card"><h3>高频歌手</h3><div class="tags">${arts}</div></div>
      <div class="card"><h3>活跃时段（0–23 时）</h3>
        <div class="bars">${bars}</div>
        <div class="bars-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
      </div>
      <div class="card"><h3>最近播放</h3>${plays}</div>`;
  } catch (e) {
    body.textContent = '读取失败：' + e.message;
  }
}

/* ───────── Settings ───────── */
async function loadSettings() {
  const box = $('integrations');
  box.textContent = '读取中…';
  try {
    const t = await api.taste();
    setConnected();
    box.innerHTML = (t.integrations || [])
      .map(
        (it) => `
        <div class="integ">
          <span class="light ${it.ok ? 'ok' : 'off'}"></span>
          <div class="meta"><div class="n">${esc(it.name)}</div>
          <div class="d">${esc(it.detail || (it.ok ? '正常' : '不可用，已降级'))}</div></div>
        </div>`
      )
      .join('');
  } catch (e) {
    box.textContent = '读取失败：' + e.message;
  }
  try {
    const plan = await api.planToday();
    $('planBox').innerHTML = plan
      ? `<div class="card"><h3>开场台词</h3><div style="user-select:text">${esc(
          plan.say || ''
        )}</div></div>`
      : '今日尚无规划（07:00 节律调度会生成）';
  } catch {
    $('planBox').textContent = '读取失败';
  }
}

/* ───────── 启动 ───────── */
(async function boot() {
  await initTheme();
  await initVolume();
  try {
    const msgs = await api.messages();
    setConnected();
    for (const m of msgs) addMessage(m);
    const snap = await api.now();
    applySnapshot(snap);
    if (snap.track) currentTrack = snap.track;
    if (msgs.length === 0) {
      sysMessage('Claudio 已就绪。和你的 DJ 说点什么，或等待节律调度自动播报。');
    }
  } catch (e) {
    $('connLine').textContent = '连接失败：' + e.message;
  }
})();
