'use strict';
// 天气 —— open-meteo 免 key 接口。网络失败时返回 {ok:false}，由 context 省略天气片。
const config = require('../config');
const { fetchJson, warn } = require('../util');

// WMO weather code → 中文描述
const WMO = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '强阵雨', 82: '暴雨',
  85: '阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹',
};

let _cache = { at: 0, data: null };
const TTL = 10 * 60 * 1000;

async function current() {
  if (_cache.data && Date.now() - _cache.at < TTL) return _cache.data;
  const { lat, lon, city } = config.weather;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m`;
  try {
    const j = await fetchJson(url, {}, 7000);
    const c = j.current || {};
    const data = {
      ok: true,
      city,
      temperature: Math.round(c.temperature_2m),
      description: WMO[c.weather_code] || '未知',
      windSpeed: c.wind_speed_10m,
      humidity: c.relative_humidity_2m,
    };
    _cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    warn('weather', '获取失败：', e.message);
    return { ok: false, city };
  }
}

// 给提示词用的一句话天气
async function summary() {
  const w = await current();
  if (!w.ok) return '';
  return `${w.city} ${w.description} ${w.temperature}°C，湿度 ${w.humidity}%`;
}

async function status() {
  const w = await current();
  return { name: '天气 (open-meteo)', ok: w.ok, detail: w.ok ? await summary() : '' };
}

module.exports = { current, summary, status };
