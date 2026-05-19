'use strict';
// IPC handlers —— 渲染层调用入口 + bus → 渲染层的 stream 推送。
const { ipcMain } = require('electron');
const router = require('../core/router');
const player = require('../core/player');
const state = require('../core/state');
const bus = require('../core/bus');
const deepseek = require('../core/deepseek');
const ncm = require('../core/integrations/ncm');
const fish = require('../core/integrations/fish');
const edge = require('../core/integrations/edge-tts');
const weather = require('../core/integrations/weather');
const feishu = require('../core/integrations/feishu');
const upnp = require('../core/integrations/upnp');
const { todayStr } = require('../core/util');

// 品味画像 + 各集成可用状态
async function tasteProfile() {
  const settled = await Promise.allSettled([
    deepseek.status(),
    ncm.status(),
    fish.status(),
    edge.status(),
    weather.status(),
    feishu.status(),
    upnp.status(),
  ]);
  const integrations = settled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
  return {
    topArtists: state.topArtists(8),
    recentPlays: state.recentPlays(20),
    playHours: state.playHours(),
    integrations,
  };
}

function register(getWindow) {
  ipcMain.handle('chat', async (_e, text) => router.handle({ text, trigger: 'chat' }));
  ipcMain.handle('now', () => player.now());
  ipcMain.handle('next', () => player.next());
  ipcMain.handle('prev', () => player.prev());
  ipcMain.handle('taste', () => tasteProfile());
  ipcMain.handle('plan:today', () => state.getPlan(todayStr()));
  ipcMain.handle('messages', () => state.recentMessages(40));
  ipcMain.handle('pref:get', (_e, key) => state.getPref(key));
  ipcMain.handle('pref:set', (_e, { key, value }) => {
    state.setPref(key, value);
    return true;
  });

  ipcMain.handle('ncm:login:qr-start', () => ncm.loginQrStart());
  ipcMain.handle('ncm:login:qr-check', (_e, key) => ncm.loginQrCheck(key));
  ipcMain.handle('ncm:login:status', () => ncm.loginStatus());

  // 无边框窗口控制
  ipcMain.on('win:minimize', () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('win:close', () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.close();
  });

  // bus 'stream' 事件 → 当前窗口
  bus.on('stream', (payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('stream', payload);
    }
  });
}

module.exports = { register };
