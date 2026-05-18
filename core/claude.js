'use strict';
// CLAUDE.JS —— 可选：Claude Code CLI 大脑（当前电台默认用 deepseek.js）。
const { spawn, spawnSync } = require('child_process');
const config = require('./config');
const { extractDjJson, normalize, mockResponse } = require('./dj-util');
const { log, warn } = require('./util');

let _available = null;

function available() {
  if (_available !== null) return _available;
  try {
    const r = spawnSync(config.claude.bin, ['--version'], {
      shell: process.platform === 'win32',
      timeout: 8000,
      stdio: 'ignore',
    });
    _available = r.status === 0;
  } catch {
    _available = false;
  }
  log('claude', _available ? 'CLI 可用' : 'CLI 不可用');
  return _available;
}

function runCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.claude.bin,
      ['-p', '--output-format', 'json', '--max-turns', '1'],
      { shell: process.platform === 'win32' }
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude CLI 超时'));
    }, config.claude.timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude 退出码 ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function orchestrate(ctx, opts = {}) {
  if (!available()) return mockResponse(opts);
  try {
    const raw = await runCli(ctx.full);
    let modelText = raw;
    try {
      const envelope = JSON.parse(raw);
      modelText = envelope.result || envelope.text || raw;
    } catch {
      /* 已经是裸文本 */
    }
    const dj = extractDjJson(modelText);
    if (!dj) {
      warn('claude', '未能从输出解析 DJ JSON，降级模拟');
      return mockResponse(opts);
    }
    return normalize(dj, 'claude');
  } catch (e) {
    warn('claude', '编排失败，降级模拟：', e.message);
    return mockResponse(opts);
  }
}

async function status() {
  return {
    name: 'Claude Code CLI（未启用）',
    ok: available(),
    detail: available() ? `bin: ${config.claude.bin}` : '电台已改用 DeepSeek API',
  };
}

module.exports = { orchestrate, available, status, mockResponse };
