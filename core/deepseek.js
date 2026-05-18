'use strict';
// DEEPSEEK.JS —— 电台大脑：直连 DeepSeek Chat Completions API。
const config = require('./config');
const { extractDjJson, normalize, mockResponse } = require('./dj-util');
const { fetchWithTimeout, log, warn } = require('./util');

function configured() {
  return !!config.deepseek.apiKey;
}

async function chat(ctx) {
  const base = config.deepseek.baseUrl.replace(/\/$/, '');
  const res = await fetchWithTimeout(
    `${base}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.deepseek.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [
          { role: 'system', content: ctx.system },
          { role: 'user', content: ctx.user },
        ],
        temperature: 0.7,
      }),
    },
    config.deepseek.timeoutMs
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`DeepSeek HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!text) throw new Error('DeepSeek 返回空内容');
  return text;
}

async function orchestrate(ctx, opts = {}) {
  if (!configured()) return mockResponse(opts);
  try {
    const raw = await chat(ctx);
    const dj = extractDjJson(raw);
    if (!dj) {
      warn('deepseek', '未能从输出解析 DJ JSON，降级模拟');
      return mockResponse(opts);
    }
    return normalize(dj, 'deepseek');
  } catch (e) {
    warn('deepseek', '编排失败，降级模拟：', e.message);
    return mockResponse(opts);
  }
}

async function status() {
  return {
    name: 'DeepSeek（电台大脑）',
    ok: configured(),
    detail: configured()
      ? `model: ${config.deepseek.model}`
      : '未配置 DEEPSEEK_API_KEY，使用模拟大脑',
  };
}

module.exports = { orchestrate, configured, status, mockResponse };
