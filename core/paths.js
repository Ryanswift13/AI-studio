'use strict';
// 统一解析运行时路径。开发模式下一切相对项目根目录；
// 打包模式下可写数据（data/cache/user/.env）落到 userData。
const path = require('path');
const fs = require('fs');

let app = null;
try {
  app = require('electron').app;
} catch {
  // 在非 Electron 环境（如脱离 Electron 跑测试）下忽略。
}

const projectRoot = path.join(__dirname, '..');
const packaged = !!(app && app.isPackaged);
const writableRoot = packaged ? app.getPath('userData') : projectRoot;

const paths = {
  root: projectRoot,
  packaged,
  data: path.join(writableRoot, 'data'),
  cache: path.join(writableRoot, 'cache'),
  cacheTts: path.join(writableRoot, 'cache', 'tts'),
  user: path.join(writableRoot, 'user'),
  prompts: path.join(projectRoot, 'prompts'),
  renderer: path.join(projectRoot, 'renderer'),
  env: path.join(writableRoot, '.env'),
  stateFile: path.join(writableRoot, 'data', 'state.json'),
  memoryFile: path.join(writableRoot, 'data', 'memory.json'),
  ncmCookieFile: path.join(writableRoot, 'data', 'ncm-cookie.json'),
};

// 确保可写目录存在；首次运行时把内置 user/ 模板拷到可写区。
function ensureDirs() {
  for (const dir of [paths.data, paths.cache, paths.cacheTts, paths.user]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // 打包模式：用户语料目录为空时，从 resources 里的内置模板播种。
  if (packaged) {
    const seed = path.join(process.resourcesPath, 'user');
    try {
      if (fs.existsSync(seed) && fs.readdirSync(paths.user).length === 0) {
        for (const f of fs.readdirSync(seed)) {
          fs.copyFileSync(path.join(seed, f), path.join(paths.user, f));
        }
      }
    } catch {
      /* 播种失败不致命，模块各自有降级 */
    }
  }
}

module.exports = { paths, ensureDirs };
