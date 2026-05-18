'use strict';
// 事件总线 —— 替代 WS。编排/调度/播放器在此 emit('stream', payload)，
// electron/ipc.js 订阅后经 webContents.send 转发给渲染层。
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

// 便捷推送：统一 stream 事件。
bus.push = (type, data = {}) => bus.emit('stream', { type, ...data, at: Date.now() });

module.exports = bus;
