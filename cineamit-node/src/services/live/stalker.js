'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Config = require('../../core/config');
const Security = require('../../security');
const Database = require('../../db');
const TMDB = require('../tmdb');
const { ssrfBlockedHost, ssrfSafeHttpGet } = require('../../security/ssrf');

// Stalker portal support: allowlist cache, handshake, channel fetch, play-url resolve.
const MAG_UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';

function cineStalkerNormalizedBase(portal) {
  let parts;
  try { parts = new URL(String(portal).trim()); } catch { return null; }
  const https = parts.protocol === 'https:';
  const http = parts.protocol === 'http:';
  if ((!https && !http) || !parts.hostname || parts.username || parts.search || parts.hash) return null;
  const host = parts.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (ssrfBlockedHost(host)) return null;
  const port = Number(parts.port || (https ? 443 : 80));
  if (port < 1 || port > 65535) return null;
  let pth = (parts.pathname || '').replace(/\/+$/, '');
  pth = pth.replace(/\/(c|portal\.php|index\.html)$/i, '');
  let authority = host.includes(':') ? '[' + host + ']' : host;
  const defaultPort = https ? 443 : 80;
  if (port !== defaultPort) authority += ':' + port;
  return (https ? 'https://' : 'http://') + authority + pth;
}

function stalkerRequireHttps(base) {
  return String(base || '').startsWith('https://');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let stalkerPortalsCache = null;
async function cineStalkerConfiguredPortals() {
  if (stalkerPortalsCache) return stalkerPortalsCache;
  let sources = [];
  try {
    const setting = await Database.fetchOne("SELECT setting_value FROM site_setting WHERE setting_key = 'M3U_PLAYLISTS'");
    const raw = String((setting && setting.setting_value) || '').trim();
    if (raw) sources = sources.concat(raw.split(',').map((s) => s.trim()).filter(Boolean));
  } catch {}
  if (Array.isArray(Config.M3U_PLAYLIST_LIST) && Config.M3U_PLAYLIST_LIST.length) {
    sources = sources.concat(Config.M3U_PLAYLIST_LIST);
  }
  const fallback = defaultStalkerSource();
  if (fallback) sources.push(fallback);
  if (Config.STALKER_PORTAL_URL) {
    sources.push(String(Config.STALKER_PORTAL_URL).trim() + '|' + String(Config.STALKER_MAC || '').trim());
  }
  const allowed = {};
  for (let source of sources) {
    source = Security.decodeHtmlEntities(String(source)).trim();
    if (!source) continue;
    const isStalkerSource = source.toUpperCase().startsWith('STALKER:');
    source = source.replace(/STALKER:/i, '');
    const match = source.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/i);
    if (!isStalkerSource && !match) continue;
    let configuredMac = match ? match[0] : (Config.STALKER_MAC || '00:1A:79:00:00:01');
    if (match) source = source.replace(match[0], '');
    const portal = source.replace(/^[ |,\t\n\r]+|[ |,\t\n\r]+$/g, '');
    if (!portal || !/^https?:\/\//i.test(portal)) continue;
    const base = cineStalkerNormalizedBase(portal);
    if (!base) continue;
    const normalizedMac = String(configuredMac).toLowerCase().replace(/:/g, '-');
    if (!/^(?:[0-9a-f]{2}-){5}[0-9a-f]{2}$/i.test(normalizedMac)) continue;
    if (!allowed[base.toLowerCase()]) allowed[base.toLowerCase()] = [];
    allowed[base.toLowerCase()].push(normalizedMac);
  }
  stalkerPortalsCache = allowed;
  return allowed;
}

function cineStalkerAllowedPortalSync(portal, mac) {
  if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(mac).trim())) return null;
  const base = cineStalkerNormalizedBase(portal);
  if (!base) return null;
  const configured = (stalkerPortalsCache && stalkerPortalsCache[base.toLowerCase()]) || [];
  const normalizedMac = String(mac).toLowerCase().replace(/:/g, '-');
  for (const allowedMac of configured) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(allowedMac), Buffer.from(normalizedMac))) return base;
    } catch {}
  }
  if (!stalkerPortalsCache) return null;
  return null;
}
function stripStalkerCmd(command) {
  let raw = String(command || '').trim();
  raw = raw.replace(/^(?:ffmpeg|auto|copy)\s+/i, '').trim();
  const m = raw.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) raw = m[0].replace(/[),;]+$/g, '');
  return raw;
}

function rewriteStalkerMediaUrl(raw, portalBase) {
  raw = stripStalkerCmd(raw);
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  let portal;
  try { portal = new URL(portalBase); } catch { return null; }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
    u.protocol = portal.protocol;
    u.hostname = portal.hostname;
    if (portal.port) u.port = portal.port;
    else u.port = '';
  }
  const out = u.toString();
  return streamProxyUrlOk(out, []) ? out : null;
}

async function cineStalkerResolvePlayUrl(portal, mac, command) {
  const base = cineStalkerNormalizedBase(portal);
  if (!base || command.length > 2048 || /[\r\n\x00]/.test(command)) return null;
  const apiUrl = base.replace(/\/+$/, '') + '/server/load.php';
  const headers = {
    'User-Agent': MAG_UA,
    'X-User-Agent': 'Model: MAG250; Link: Ethernet',
    Cookie: 'mac=' + encodeURIComponent(mac) + '; stb_lang=en; timezone=GMT',
    Accept: 'application/json, */*',
  };
  const httpsOnly = stalkerRequireHttps(base);
  const handshakeUrl = apiUrl + '?' + new URLSearchParams({ type: 'stb', action: 'handshake', token: '', mac }).toString();
  const handshake = await stalkerHttpGet(handshakeUrl, headers, httpsOnly, 20000, 1048576);
  if (!handshake.ok || handshake.code < 200 || handshake.code >= 300) {
    console.error('[livetv] play handshake failed code=' + (handshake && handshake.code));
    return rewriteStalkerMediaUrl(command, base);
  }
  await delay(800);
  let handshakeData;
  try { handshakeData = JSON.parse(handshake.body); } catch { handshakeData = null; }
  const portalToken = handshakeData && handshakeData.js ? String(handshakeData.js.token || '') : '';
  if (portalToken) {
    if (portalToken.length > 4096 || /[\r\n\x00]/.test(portalToken)) return rewriteStalkerMediaUrl(command, base);
    headers.Authorization = 'Bearer ' + portalToken;
  }
  const createUrl = apiUrl + '?' + new URLSearchParams({ type: 'itv', action: 'create_link', cmd: command, mac }).toString();
  const response = await stalkerHttpGet(createUrl, headers, httpsOnly, 20000, 1048576);
  let realUrl = '';
  if (response && response.ok && response.code >= 200 && response.code < 300) {
    let linkData;
    try { linkData = JSON.parse(response.body); } catch { linkData = null; }
    realUrl = linkData && linkData.js ? String(linkData.js.cmd || '') : '';
  } else {
    console.error('[livetv] create_link failed code=' + (response && response.code));
  }
  if (/stream=&/i.test(realUrl)) {
    const streamMatch = String(command).match(/stream=([0-9]+)/i);
    if (streamMatch) realUrl = realUrl.replace(/stream=&/i, 'stream=' + streamMatch[1] + '&');
  }
  const fromLink = rewriteStalkerMediaUrl(realUrl, base);
  if (fromLink) return fromLink;
  const fromCmd = rewriteStalkerMediaUrl(command, base);
  if (fromCmd) return fromCmd;
  console.error('[livetv] play url rewrite failed');
  return null;
}
function defaultStalkerSource() {
  const portal = String((Config.STALKER_PORTAL_URL || 'http://sbhgoldpro.org/c')).trim();
  const mac = String((Config.STALKER_MAC || '00:1A:79:1B:A5:64')).trim();
  if (!portal || !mac) return '';
  return portal + '|' + mac;
}
function stalkerDedupeKey(portal, mac) {
  return String(portal || '').toLowerCase().replace(/\/+$/, '') + '|' + String(mac || '').toLowerCase().replace(/-/g, ':');
}

async function parseStalkerPortal(portal, mac) {
  const warn = [{
    name: '⚠ Live TV source temporarily unavailable — refresh in a moment',
    logo: '', url: '', category: 'Error', tvg_id: '', source: 'stalker',
  }];
  const cacheKey = crypto.createHash('sha256').update(String(portal).toLowerCase() + '|' + String(mac).toLowerCase()).digest('hex').slice(0, 20);
  const cacheFile = path.join(TMDB.cacheDir(), 'stalker_' + cacheKey + '.json');
  let list = null;
  try {
    const ttl = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const age = Date.now() / 1000 - Number(ttl.ts || 0);
    if (age < (ttl.error ? 120 : 21600) && Array.isArray(ttl.channels) && ttl.channels.length) list = ttl.channels;
  } catch {}
  if (!list) {
    try {
      list = await fetchStalkerItvList(portal, mac);
      try {
        fs.writeFileSync(cacheFile, JSON.stringify({
          ts: Math.floor(Date.now() / 1000),
          error: !list.length,
          channels: list,
        }));
      } catch {}
    } catch (e) {
      console.error('[livetv] Stalker portal failed (details suppressed).');
      list = [];
    }
  }
  if (!list.length) return [warn, ['All', 'Error']];
  const channels = [];
  const cats = { All: true };
  for (const ch of list) {
    if (ch.category) cats[ch.category] = true;
    channels.push({
      name: ch.name,
      logo: ch.logo || '',
      category: ch.category || 'Live TV',
      tvg_id: ch.tvg_id || '',
      url: '',
      source: 'stalker',
      _stalker: { portal, mac, cmd: ch.cmd },
    });
  }
  return [channels, Object.keys(cats).sort()];
}
function stalkerJsList(body) {
  let data;
  try { data = JSON.parse(String(body || '')); } catch { return []; }
  const js = data && data.js;
  if (!js) return [];
  if (Array.isArray(js)) return js;
  if (Array.isArray(js.data)) return js.data;
  if (js.data && typeof js.data === 'object') return Object.values(js.data);
  return [];
}

async function stalkerHttpGet(url, headers, httpsOnly, timeout, maxBytes) {
  let last = { ok: false, code: 0, error: 'no attempt' };
  for (let i = 0; i < 4; i++) {
    if (i) {
      const wait = 2000 * Math.pow(2, i - 1);
      console.error('[livetv] Stalker HTTP ' + last.code + ' — retry in ' + wait + 'ms');
      await delay(wait);
    }
    last = await ssrfSafeHttpGet(url, { headers, timeout }, 2, httpsOnly, true, maxBytes);
    if (last && last.ok) return last;
    if (last && last.code !== 429 && last.code !== 503 && last.code !== 0) return last;
  }
  return last;
}

async function fetchStalkerItvList(portal, mac) {
  const base = cineStalkerNormalizedBase(portal);
  if (!base) return [];
  const apiUrl = base.replace(/\/+$/, '') + '/server/load.php';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'X-User-Agent': 'Model: MAG250; Link: Ethernet',
    Cookie: 'mac=' + encodeURIComponent(mac) + '; stb_lang=en; timezone=GMT',
    Accept: 'application/json, */*',
  };
  const httpsOnly = stalkerRequireHttps(base);
  const handshakeUrl = apiUrl + '?' + new URLSearchParams({ type: 'stb', action: 'handshake', token: '', mac }).toString();
  const handshake = await stalkerHttpGet(handshakeUrl, headers, httpsOnly, 20000, 1048576);
  if (!handshake.ok || handshake.code < 200 || handshake.code >= 300) {
    console.error('[livetv] Stalker handshake failed code=' + (handshake && handshake.code) + ' err=' + (handshake && handshake.error));
    return [];
  }
  let handshakeData;
  try { handshakeData = JSON.parse(handshake.body); } catch { handshakeData = null; }
  const portalToken = handshakeData && handshakeData.js ? String(handshakeData.js.token || '') : '';
  if (portalToken) {
    if (portalToken.length > 4096 || /[\r\n\x00]/.test(portalToken)) return [];
    headers.Authorization = 'Bearer ' + portalToken;
  }
  // Portal 429 if genres/list fire immediately after handshake. Wait, then channels first — skip genres (saves ~2s).
  await delay(2000);
  async function pull(action, extra) {
    const listUrl = apiUrl + '?' + new URLSearchParams(Object.assign({ type: 'itv', action, mac }, extra || {})).toString();
    const listRes = await stalkerHttpGet(listUrl, headers, httpsOnly, 60000, 48 * 1024 * 1024);
    if (!listRes || !listRes.ok) return [];
    return stalkerJsList(listRes.body);
  }
  let rows = await pull('get_all_channels');
  if (!rows.length) {
    await delay(2000);
    rows = await pull('get_ordered_list', { p: '0' });
  }
  const genreMap = {};
  const out = [];
  for (const row of rows) {
    const cmd = String(row.cmd || row.command || '').trim();
    const name = String(row.name || row.title || '').trim();
    if (!name || !cmd || cmd.length > 2048 || /[\r\n\x00]/.test(cmd)) continue;
    const gid = String(row.tv_genre_id || row.genre_id || row.category_id || '');
    out.push({
      name,
      logo: String(row.logo || row.logo_alt || ''),
      category: genreMap[gid] || String(row.genre_title || row.category || 'Live TV'),
      tvg_id: String(row.xmltv_id || row.id || ''),
      cmd,
    });
    if (out.length >= 25000) break;
  }
  console.error('[livetv] Stalker channels parsed: ' + out.length);
  return out;
}

async function loadStalkerRawChannels() {
  const allowed = await cineStalkerConfiguredPortals();
  const channels = [];
  const cats = { All: true };
  for (const portal of Object.keys(allowed || {})) {
    for (const macDash of allowed[portal] || []) {
      const mac = String(macDash).replace(/-/g, ':');
      const [chs, portalCats] = await parseStalkerPortal(portal, mac);
      for (const c of portalCats) cats[c] = true;
      for (const ch of chs) channels.push(ch);
    }
  }
  return { channels, cats: Object.keys(cats) };
}

function resetStalkerCache() { stalkerPortalsCache = null; }

module.exports = {
  cineStalkerNormalizedBase,
  cineStalkerConfiguredPortals,
  cineStalkerAllowedPortalSync,
  cineStalkerResolvePlayUrl,
  defaultStalkerSource,
  parseStalkerPortal,
  loadStalkerRawChannels,
  stalkerDedupeKey,
  resetStalkerCache,
};
