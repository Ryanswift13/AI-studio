'use strict';
// Fish Audio TTS 客户端。缺 API key 时返回 null，由 tts.js 走文本降级。
const config = require('../config');
const { fetchWithTimeout, warn, log } = require('../util');

function configured() {
  return !!config.fish.apiKey;
}

// 合成语音，返回 mp3 Buffer；失败或未配置返回 null。
async function synthesize(text) {
  if (!configured()) return null;
  const { apiKey, voiceId, baseUrl } = config.fish;
  const body = {
    text,
    format: 'mp3',
    mp3_bitrate: 128,
    normalize: true,
    latency: 'normal',
  };
  if (voiceId) body.reference_id = voiceId;
  try {
    const res = await fetchWithTimeout(
      `${baseUrl.replace(/\/$/, '')}/v1/tts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          model: 's1',
        },
        body: JSON.stringify(body),
      },
      30000
    );
    if (!res.ok) {
      warn('fish', `合成失败 HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    log('fish', `合成完成 ${buf.length} bytes`);
    return buf;
  } catch (e) {
    warn('fish', '合成异常：', e.message);
    return null;
  }
}

async function status() {
  return {
    name: 'Fish Audio TTS',
    ok: configured(),
    detail: configured() ? '已配置 API key' : '未配置 FISH_API_KEY，台词仅显示文本',
  };
}

module.exports = { synthesize, configured, status };
