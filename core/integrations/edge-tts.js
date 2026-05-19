'use strict';
// Edge TTS —— 免费调用微软 Edge「大声朗读」神经语音，无需 API key。
// 基于 msedge-tts（处理微软 Sec-MS-GEC 鉴权）。返回 mp3 Buffer，失败返回 null。
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const config = require('../config');
const { warn, log } = require('../util');

// 合成语音，返回 mp3 Buffer；失败返回 null（由 tts.js 走文本降级）。
function synthesize(text) {
  return new Promise((resolve) => {
    const clean = (text || '').trim();
    if (!clean) return resolve(null);

    let tts = null;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (tts) tts.close();
      } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => {
      warn('edge-tts', '合成超时');
      finish(null);
    }, 25000);

    (async () => {
      try {
        tts = new MsEdgeTTS();
        await tts.setMetadata(
          config.edge.voice,
          OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
        );
        const { audioStream } = tts.toStream(clean);
        const chunks = [];
        audioStream.on('data', (c) => chunks.push(c));
        audioStream.on('end', () => {
          const buf = chunks.length ? Buffer.concat(chunks) : null;
          if (buf && buf.length) log('edge-tts', `合成完成 ${buf.length} bytes`);
          finish(buf && buf.length ? buf : null);
        });
        audioStream.on('error', (e) => {
          warn('edge-tts', '合成失败：', e.message);
          finish(null);
        });
      } catch (e) {
        warn('edge-tts', '合成异常：', e.message);
        finish(null);
      }
    })();
  });
}

async function status() {
  return {
    name: 'Edge TTS（免费语音）',
    ok: true,
    detail: `语音 ${config.edge.voice} · 免费无需 key（联网可用）`,
  };
}

module.exports = { synthesize, status };
