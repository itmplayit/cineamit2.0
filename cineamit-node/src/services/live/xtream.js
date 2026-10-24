'use strict';

const fs = require('fs');
const path = require('path');
const Security = require('../../security');
const TMDB = require('../tmdb');
const { ssrfBlockedHostAsync, ssrfSafeHttpGet } = require('../../security/ssrf');
const { rawCatalogCache } = require('./cache');

// Xtream Codes: live/VOD API, AES-GCM credential use, disk caches, row mappers.
async function parseXtreamLiveFromApi(id, base, username, password) {
  const creds = { base, username, password, id };
  let catRows = [];
  try { catRows = await xtreamPlayerApi(creds, 'get_live_categories'); } catch { catRows = []; }
  const catMap = {};
  if (Array.isArray(catRows)) {
    for (const c of catRows) {
      const cid = String((c && (c.category_id || c.id)) || '');
      const name = String((c && (c.category_name || c.name)) || '').trim();
      if (cid && name) catMap[cid] = name;
    }
  }
  let streams = [];
  try { streams = await xtreamPlayerApi(creds, 'get_live_streams'); } catch { streams = []; }
  if (!Array.isArray(streams) || !streams.length) return [[], ['All']];
  const channels = [];
  const categories = { All: true };
  for (const row of streams) {
    if (!row) continue;
    const streamId = row.stream_id || row.id;
    if (!streamId) continue;
    const name = String(row.name || row.title || '').trim();
    if (!name || /^#{3,}.*#{3,}$/.test(name)) continue;
    const cat = catMap[String(row.category_id || '')] || String(row.category_name || 'Live TV') || 'Live TV';
    categories[cat] = true;
    const ext = String(row.container_extension || 'ts').replace(/[^a-z0-9]/gi, '') || 'ts';
    channels.push({
      name,
      logo: String(row.stream_icon || row.epg_channel_logo || ''),
      url: base + '/live/' + username + '/' + password + '/' + streamId + '.' + ext,
      category: cat,
      tvg_id: String(row.epg_channel_id || row.epg_id || ''),
    });
  }
  return [channels, Object.keys(categories).sort()];
}

async function parseXtreamServer(id, host, username, password) {
  username = Security.decryptXtreamCredential(username, 'username') || '';
  password = Security.decryptXtreamCredential(password, 'password') || '';
  if (!username || !password) {
    return [[{ name: `⚠ XTREAM #${id} credentials unavailable`, logo: '', url: '', category: 'All', tvg_id: '' }], ['All']];
  }
  let base = String(host).trim();
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  base = base.replace(/\/+$/, '');
  let scheme = '', hostOnly = '';
  try { const u = new URL(base); scheme = u.protocol.replace(':', ''); hostOnly = u.hostname; } catch {}
  if ((scheme !== 'https' && scheme !== 'http') || !hostOnly || await ssrfBlockedHostAsync(hostOnly)) {
    return [[{ name: `⚠ XTREAM #${id} BLOCKED (invalid host)`, logo: '', url: '', category: 'All', tvg_id: '' }], ['All']];
  }
  const cacheFile = path.join(TMDB.cacheDir(), 'xtream_' + id + '.json');
  try {
    const ttl = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const age = Date.now() / 1000 - Number(ttl.ts || 0);
    const cached = ttl.channels || [];
    if (age < (ttl.error ? 300 : 21600) && (ttl.error || cached.length)) return [cached, ttl.cats || ['All']];
  } catch {}
  let payload;
  try {
    const m3uUrl = base + '/get.php?' + new URLSearchParams({ username, password, type: 'm3u_plus', output: 'ts' }).toString();
    const fetch = await ssrfSafeHttpGet(m3uUrl, {
      timeout: 25000,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
    }, 3, true, true, 20 * 1024 * 1024);
    let channels = [];
    let cats = ['All'];
    const body = fetch && fetch.ok ? String(fetch.body || '') : '';
    if (body.includes('#EXTM3U')) {
      const parsed = parseM3uLines(body.split(/\r\n|\n|\r/), base);
      channels = parsed[0] || [];
      cats = parsed[1] || ['All'];
    }
    if (!channels.length) {
      const api = await parseXtreamLiveFromApi(id, base, username, password);
      if (api[0] && api[0].length) {
        channels = api[0];
        cats = api[1] || ['All'];
      }
    }
    if (!channels.length) throw new Error('Empty Xtream live list');
    payload = { ts: Math.floor(Date.now() / 1000), error: false, channels, cats };
  } catch (e) {
    console.error('[livetv] Xtream source #' + id + ' failed (details suppressed).');
    payload = { ts: Math.floor(Date.now() / 1000), error: true, channels: [{ name: '⚠ XTREAM #' + id + ' source unavailable or unsupported', logo: '', url: '', category: 'All', tvg_id: '' }], cats: ['All'] };
  }
  try { fs.writeFileSync(cacheFile, JSON.stringify(payload)); } catch {}
  return [payload.channels, payload.cats];
}

function xtreamClearCache(id = 0) {
  for (const k of Object.keys(rawCatalogCache)) delete rawCatalogCache[k];
  const dir = TMDB.cacheDir();
  try {
    if (id > 0) fs.unlinkSync(path.join(dir, 'xtream_' + id + '.json'));
    else {
      for (const f of fs.readdirSync(dir)) {
        if ((f.startsWith('xtream_') || f.startsWith('xtreamvod_') || f.startsWith('stalker_')) && f.endsWith('.json')) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    }
  } catch {}
}
async function xtreamCreds(xs) {
  const username = Security.decryptXtreamCredential(xs.username, 'username') || '';
  const password = Security.decryptXtreamCredential(xs.password, 'password') || '';
  let base = String(xs.host || '').trim();
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  base = base.replace(/\/+$/, '');
  let hostOnly = '';
  try { hostOnly = new URL(base).hostname; } catch {}
  if (!username || !password || !hostOnly || await ssrfBlockedHostAsync(hostOnly) || !base.startsWith('https://')) return null;
  return { base, username, password, id: xs.id };
}

async function xtreamPlayerApi(creds, action, extra = {}) {
  const params = Object.assign({ username: creds.username, password: creds.password, action }, extra);
  const url = creds.base + '/player_api.php?' + new URLSearchParams(params).toString();
  const fetch = await ssrfSafeHttpGet(url, {
    timeout: 25000,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  }, 2, true, true, 8 * 1024 * 1024);
  if (!fetch.ok) throw new Error('xtream api');
  const data = JSON.parse(String(fetch.body || 'null'));
  return data;
}

async function loadXtreamVodCached(xs) {
  const cacheFile = path.join(TMDB.cacheDir(), 'xtreamvod_' + xs.id + '.json');
  try {
    const ttl = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const age = Date.now() / 1000 - Number(ttl.ts || 0);
    if (age < (ttl.error ? 300 : 21600)) return ttl;
  } catch {}
  const creds = await xtreamCreds(xs);
  let payload = { ts: Math.floor(Date.now() / 1000), error: true, movies: [], series: [] };
  if (!creds) {
    try { fs.writeFileSync(cacheFile, JSON.stringify(payload)); } catch {}
    return payload;
  }
  try {
    const [movies, series] = await Promise.all([
      xtreamPlayerApi(creds, 'get_vod_streams').catch(() => []),
      xtreamPlayerApi(creds, 'get_series').catch(() => []),
    ]);
    payload = {
      ts: Math.floor(Date.now() / 1000),
      error: false,
      movies: Array.isArray(movies) ? movies : [],
      series: Array.isArray(series) ? series : [],
    };
  } catch (e) {
    console.error('[iptv] Xtream VOD #' + xs.id + ' failed (details suppressed).');
  }
  try { fs.writeFileSync(cacheFile, JSON.stringify(payload)); } catch {}
  return payload;
}

function mapXtreamMovie(app, userId, xs, row, creds, issuePlay) {
  const streamId = row.stream_id || row.id;
  const ext = String(row.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const raw = creds.base + '/movie/' + creds.username + '/' + creds.password + '/' + streamId + '.' + ext;
  const cat = String(row.category_name || row.category_id || 'Movies');
  const name = String(row.name || row.title || 'Movie');
  const kind = isAnimeBlob(name, cat) ? 'anime' : 'movie';
  return {
    id: 'xt:' + xs.id + ':vod:' + streamId,
    name,
    logo: String(row.stream_icon || row.cover || ''),
    category: cat,
    year: String(row.year || row.releaseDate || '').slice(0, 4),
    kind,
    source: 'xtream',
    language: guessLang(name),
    has_episodes: false,
    play: issuePlay ? vodPlay(app, userId, raw) : '',
    _raw: issuePlay ? undefined : raw,
  };
}

function mapXtreamSeries(xs, row) {
  const seriesId = row.series_id || row.id;
  const cat = String(row.category_name || row.category_id || 'Series');
  const name = String(row.name || row.title || 'Series');
  const kind = isAnimeBlob(name, cat) ? 'anime' : 'series';
  return {
    id: 'xt:' + xs.id + ':series:' + seriesId,
    name,
    logo: String(row.cover || row.stream_icon || ''),
    category: cat,
    year: String(row.year || row.releaseDate || '').slice(0, 4),
    kind,
    source: 'xtream',
    language: guessLang(name),
    has_episodes: true,
    play: '',
  };
}

module.exports = {
  parseXtreamLiveFromApi,
  parseXtreamServer,
  xtreamClearCache,
  xtreamCreds,
  xtreamPlayerApi,
  loadXtreamVodCached,
  mapXtreamMovie,
  mapXtreamSeries,
};
