'use strict';
// Electron 主进程 —— 建窗口、注册 media:// 协议、装配后端、启动节律调度。
const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// media:// 必须在 app ready 前声明为特权协议，<audio> 才能正常 seek。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
]);

let mainWindow = null;
const getWindow = () => mainWindow;

function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 880,
    minWidth: 380,
    minHeight: 620,
    backgroundColor: '#07070f',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (config.app.devtools) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // 先确保可写目录就位（state.js 依赖）
  const { ensureDirs } = require('../core/paths');
  ensureDirs();

  const config = require('../core/config');
  const tts = require('../core/tts');
  const ipc = require('./ipc');
  const scheduler = require('../core/scheduler');

  // media://tts/<hash>.mp3 → 读取 cache/tts 下的合成语音
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host === 'tts') {
        const hash = url.pathname.replace(/^\//, '').replace(/\.mp3$/i, '');
        const file = tts.fileForHash(hash);
        if (file) {
          return new Response(fs.readFileSync(file), {
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
      }
    } catch {
      /* 落到 404 */
    }
    return new Response('not found', { status: 404 });
  });

  ipc.register(getWindow);
  scheduler.start();
  createWindow(config);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
