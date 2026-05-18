'use strict';
// preload —— 经 contextBridge 暴露受限的 window.claudio API（contextIsolation 开启）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudio', {
  // 核心调用（对应架构图的 HTTP 线）
  chat: (text) => ipcRenderer.invoke('chat', text),
  now: () => ipcRenderer.invoke('now'),
  next: () => ipcRenderer.invoke('next'),
  prev: () => ipcRenderer.invoke('prev'),
  taste: () => ipcRenderer.invoke('taste'),
  planToday: () => ipcRenderer.invoke('plan:today'),

  // 辅助
  messages: () => ipcRenderer.invoke('messages'),
  getPref: (key) => ipcRenderer.invoke('pref:get', key),
  setPref: (key, value) => ipcRenderer.invoke('pref:set', { key, value }),

  ncmLoginQrStart: () => ipcRenderer.invoke('ncm:login:qr-start'),
  ncmLoginQrCheck: (key) => ipcRenderer.invoke('ncm:login:qr-check', key),
  ncmLoginStatus: () => ipcRenderer.invoke('ncm:login:status'),

  // 无边框窗口控制
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),

  // stream 推送通道（对应 WS /stream）：now-playing、DJ 播报、调度触发
  onStream: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('stream', handler);
    return () => ipcRenderer.removeListener('stream', handler);
  },
});
