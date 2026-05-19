'use strict';
// NCM-SERVER —— 子进程托管 NeteaseCloudMusicApi，随 Claudio 启动/退出。
// 免去用户每次手动 `npx NeteaseCloudMusicApi`。服务不可用时各处仍有降级。
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const { log, warn } = require('./util');

let child = null;

// 定位项目内安装的 NeteaseCloudMusicApi 入口（app.js）。
function entryPath() {
  try {
    const pkg = require.resolve('NeteaseCloudMusicApi/package.json');
    return path.join(path.dirname(pkg), 'app.js');
  } catch {
    return null;
  }
}

// 从 NCM_BASE_URL 取端口，与 ncm.js 客户端保持一致。
function port() {
  try {
    return new URL(config.ncm.baseUrl).port || '3000';
  } catch {
    return '3000';
  }
}

function start() {
  if (!config.ncm.autostart) {
    log('ncm-server', '已禁用自动启动（NCM_AUTOSTART=0）');
    return;
  }
  const entry = entryPath();
  if (!entry) {
    warn('ncm-server', '未找到 NeteaseCloudMusicApi 包，跳过自动启动；可手动运行 npx NeteaseCloudMusicApi');
    return;
  }
  // ELECTRON_RUN_AS_NODE：让 Electron 二进制以纯 Node 模式跑脚本，打包后也无需系统 Node。
  child = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: port() },
    stdio: 'ignore',
  });
  child.on('error', (e) => {
    warn('ncm-server', '启动失败：', e.message);
    child = null;
  });
  child.on('exit', (code) => {
    // 端口被占用（已有一个 NCM 在跑）等情况下退出，属正常
    log('ncm-server', `NeteaseCloudMusicApi 退出（code ${code}）`);
    child = null;
  });
  log('ncm-server', `已拉起 NeteaseCloudMusicApi（端口 ${port()}）`);
}

function stop() {
  if (child) {
    child.kill();
    child = null;
  }
}

module.exports = { start, stop };
