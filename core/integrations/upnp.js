'use strict';
// UPnP / Naim 客厅功放 —— SSDP 发现 MediaRenderer，SOAP 推送播放。
// 全部用 Node 内置 dgram + http，无第三方依赖。未发现设备则仅记录日志。
const dgram = require('dgram');
const { URL } = require('url');
const config = require('../config');
const { fetchWithTimeout, log, warn } = require('../util');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const ST = 'urn:schemas-upnp-org:service:AVTransport:1';

let _device = null; // { location, controlUrl }
let _discoverAt = 0; // 上次发现尝试时刻
const DISCOVER_TTL = 5 * 60 * 1000; // 未发现设备时，该间隔内不重试

// SSDP M-SEARCH 发现 AVTransport 设备。
function ssdpDiscover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = [];
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 2\r\n' +
        `ST: ${ST}\r\n\r\n`
    );
    sock.on('message', (buf) => {
      const m = /LOCATION:\s*(.+)/i.exec(buf.toString());
      if (m) found.push(m[1].trim());
    });
    sock.on('error', () => {});
    try {
      sock.bind(() => {
        try {
          sock.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDR);
        } catch {
          /* 多播发送失败 */
        }
      });
    } catch {
      /* bind 失败 */
    }
    setTimeout(() => {
      try {
        sock.close();
      } catch {}
      resolve([...new Set(found)]);
    }, timeoutMs);
  });
}

// 从设备描述 XML 里抽出 AVTransport 的 controlURL（正则即可，避免引 XML 库）。
async function resolveControlUrl(location) {
  const res = await fetchWithTimeout(location, {}, 6000);
  const xml = await res.text();
  // 找到含 AVTransport 的 <service> 块
  const block = new RegExp(
    `<service>([\\s\\S]*?AVTransport[\\s\\S]*?)</service>`,
    'i'
  ).exec(xml);
  if (!block) return null;
  const ctl = /<controlURL>(.*?)<\/controlURL>/i.exec(block[1]);
  if (!ctl) return null;
  return new URL(ctl[1], location).toString();
}

async function discover() {
  if (!config.upnp.enabled) return null;
  // 显式指定了设备地址
  if (config.upnp.deviceLocation) {
    try {
      const controlUrl = await resolveControlUrl(config.upnp.deviceLocation);
      if (controlUrl) {
        _device = { location: config.upnp.deviceLocation, controlUrl };
        return _device;
      }
    } catch (e) {
      warn('upnp', '指定设备解析失败：', e.message);
    }
  }
  const locations = await ssdpDiscover();
  for (const loc of locations) {
    try {
      const controlUrl = await resolveControlUrl(loc);
      if (controlUrl) {
        _device = { location: loc, controlUrl };
        log('upnp', '发现设备：', loc);
        return _device;
      }
    } catch {
      /* 跳过无法解析的设备 */
    }
  }
  return null;
}

function soapEnvelope(action, args) {
  const body = Object.entries(args)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${ST}">${body}</u:${action}>` +
    '</s:Body></s:Envelope>'
  );
}

async function soapCall(controlUrl, action, args) {
  const res = await fetchWithTimeout(
    controlUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${ST}#${action}"`,
      },
      body: soapEnvelope(action, args),
    },
    6000
  );
  if (!res.ok) throw new Error(`SOAP ${action} HTTP ${res.status}`);
  return res.text();
}

// 取设备：已发现直接返回；未发现则在 TTL 外才重试 SSDP。
async function ensureDevice() {
  if (_device) return _device;
  if (Date.now() - _discoverAt < DISCOVER_TTL) return null;
  _discoverAt = Date.now();
  return discover();
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

// 把一个 URL 推送到功放并播放。返回是否成功。
async function play(url, title = 'Claudio') {
  if (!config.upnp.enabled) return false;
  try {
    if (!(await ensureDevice())) {
      log('upnp', `未发现 Naim 功放，跳过推送：${title}`);
      return false;
    }
    const meta =
      '&lt;DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"&gt;' +
      `&lt;item&gt;&lt;dc:title&gt;${escapeXml(title)}&lt;/dc:title&gt;` +
      '&lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;' +
      '&lt;/item&gt;&lt;/DIDL-Lite&gt;';
    await soapCall(_device.controlUrl, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: escapeXml(url),
      CurrentURIMetaData: meta,
    });
    await soapCall(_device.controlUrl, 'Play', { InstanceID: 0, Speed: 1 });
    log('upnp', `已推送到功放：${title}`);
    return true;
  } catch (e) {
    warn('upnp', '推送失败：', e.message);
    return false;
  }
}

async function status() {
  if (!config.upnp.enabled) {
    return { name: 'UPnP / Naim', ok: false, detail: '已关闭（UPNP_ENABLED=0）' };
  }
  const device = await ensureDevice();
  return {
    name: 'UPnP / Naim',
    ok: !!device,
    detail: device ? `已连接 ${device.location}` : '未发现功放设备',
  };
}

module.exports = { discover, play, status };
