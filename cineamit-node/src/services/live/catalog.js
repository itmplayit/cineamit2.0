'use strict';

const Config = require('../../core/config');
const Database = require('../../db');
const Security = require('../../security');
const { rawCatalogCache } = require('./cache');
const { CineLiveStreamAccess } = require('./access');
const { cineStalkerConfiguredPortals, defaultStalkerSource, parseStalkerPortal, loadStalkerRawChannels, stalkerDedupeKey } = require('./stalker');
const { parseM3uPlaylist } = require('./m3u');
const { parseXtreamServer, xtreamCreds, xtreamPlayerApi, loadXtreamVodCached, mapXtreamMovie, mapXtreamSeries } = require('./xtream');

// Channel collection + live catalogue + IPTV VOD/series browsing.
async function wrapLiveUrls(channels, userId, app) {
  await cineStalkerConfiguredPortals();
  const out = [];
  for (const ch of channels || []) {
    const copy = { ...ch };
    const stalker = copy._stalker;
    delete copy._stalker;
    if (stalker && stalker.portal && stalker.mac && stalker.cmd) {
      copy.url = (await CineLiveStreamAccess.issueStalker(stalker.portal, stalker.mac, stalker.cmd, userId, app)) || '';
    } else if (copy.url && String(copy.url).startsWith('/api/live_stream/')) {
      // already tokenised
    } else if (copy.url && /^https?:\/\//i.test(copy.url)) {
      copy.url = CineLiveStreamAccess.issueUrl(copy.url, userId, app) || '';
    } else {
      copy.url = '';
    }
    out.push(copy);
  }
  return out;
}

async function playlistSources() {
  const setting = await Database.fetchOne("SELECT setting_value FROM site_setting WHERE setting_key = 'M3U_PLAYLISTS'");
  const rawM3u = (setting && setting.setting_value) || '';
  let playlistUrls = rawM3u ? rawM3u.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (!playlistUrls.length && Config.M3U_PLAYLIST_LIST && Config.M3U_PLAYLIST_LIST.length) playlistUrls = Config.M3U_PLAYLIST_LIST.slice();
  const stalker = defaultStalkerSource();
  if (stalker) {
    const already = playlistUrls.some((u) => /00:1A:79:1B:A5:64/i.test(u) || (splitStalkerSource(u) && /sbhgoldpro\.org/i.test(u)));
    if (!already) playlistUrls.push(stalker);
  }
  return playlistUrls.map((u) => Security.decodeHtmlEntities(String(u).trim()));
}

function splitStalkerSource(url) {
  const raw = String(url || '');
  const macRegex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/i;
  const isStalker = macRegex.test(raw) || raw.toUpperCase().startsWith('STALKER:');
  if (!isStalker) return null;
  const match = raw.match(macRegex);
  const mac = match ? match[0] : (Config.STALKER_MAC || '00:1A:79:00:00:01');
  let clean = raw.replace(/STALKER:/i, '');
  if (match) clean = clean.replace(match[0], '');
  let portal = clean.replace(/^[ |,\t\n\r]+|[ |,\t\n\r]+$/g, '');
  if (!portal) portal = String(Config.STALKER_PORTAL_URL || '').trim();
  return { portal, mac };
}
async function loadXtreamServerRows() {
  try {
    const active = await Database.fetchAll('SELECT * FROM xtream_servers WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    if (active && active.length) return active;
  } catch {}
  try {
    return await Database.fetchAll('SELECT * FROM xtream_servers ORDER BY id ASC') || [];
  } catch {
    return [];
  }
}

async function collectRawChannelsUncached(includeStalker = true) {
  const playlistUrls = await playlistSources();
  let allChannels = [];
  const finalCategories = { All: true };
  const seenUrls = new Set();
  const seenStalker = new Set();
  const stats = { m3u: 0, xtream: 0, stalker: 0, playlists: playlistUrls.length };
  await cineStalkerConfiguredPortals();
  for (const url of playlistUrls) {
    if (!url) continue;
    const stalkerSrc = splitStalkerSource(url);
    if (stalkerSrc) {
      seenStalker.add(stalkerDedupeKey(stalkerSrc.portal, stalkerSrc.mac));
      const [chs, cats] = await parseStalkerPortal(stalkerSrc.portal, stalkerSrc.mac);
      for (const c of cats) finalCategories[c] = true;
      for (const ch of chs) {
        ch.source = ch.source || 'stalker';
        allChannels.push(ch);
        if (ch.source === 'stalker') stats.stalker += 1;
      }
      continue;
    }
    const [chs, cats] = await parseM3uPlaylist(url, true);
    for (const c of cats) finalCategories[c] = true;
    for (const ch of chs) {
      if (ch.url && seenUrls.has(ch.url)) continue;
      if (ch.url) seenUrls.add(ch.url);
      ch.source = 'm3u';
      allChannels.push(ch);
      stats.m3u += 1;
    }
  }
  try {
    const xtreams = await loadXtreamServerRows();
    for (const xs of xtreams) {
      const [chs, cats] = await parseXtreamServer(xs.id, xs.host, xs.username, xs.password);
      for (const c of cats) finalCategories[c] = true;
      for (const ch of chs) {
        if (ch.url && seenUrls.has(ch.url)) continue;
        if (ch.url) seenUrls.add(ch.url);
        ch.source = 'xtream';
        allChannels.push(ch);
        stats.xtream += 1;
      }
    }
  } catch (e) {
    console.error('[livetv] xtream merge failed (details suppressed).');
  }
  if (includeStalker) {
    try {
      const stalker = await loadStalkerRawChannels();
      for (const c of stalker.cats) finalCategories[c] = true;
      for (const ch of stalker.channels) {
        const meta = ch._stalker || {};
        const key = stalkerDedupeKey(meta.portal, meta.mac);
        if (key !== '|' && seenStalker.has(key)) continue;
        if (key !== '|') seenStalker.add(key);
        allChannels.push(ch);
        stats.stalker += 1;
      }
    } catch (e) {
      console.error('[livetv] Stalker list failed (details suppressed).');
    }
  }
  return { channels: allChannels, categories: Object.keys(finalCategories).sort(), stats };
}

async function collectRawChannels(includeStalker = true) {
  const key = includeStalker ? 'all' : 'nostalker';
  const hit = rawCatalogCache[key];
  if (hit && hit.data && hit.data.channels && hit.data.channels.length && Date.now() - hit.ts < 900000) return hit.data;
  if (hit && hit.inflight) return hit.inflight;
  const work = collectRawChannelsUncached(includeStalker).then((data) => {
    if (data && data.channels && data.channels.length) {
      rawCatalogCache[key] = { ts: Date.now(), data, inflight: null };
    } else {
      delete rawCatalogCache[key];
    }
    return data;
  }, (err) => {
    const cur = rawCatalogCache[key];
    if (cur && cur.inflight) delete rawCatalogCache[key];
    throw err;
  });
  rawCatalogCache[key] = { ts: (hit && hit.ts) || 0, data: (hit && hit.data) || null, inflight: work };
  return work;
}
function slimLive(ch) {
  return {
    name: ch.name || '',
    logo: ch.logo || '',
    category: ch.category || 'All',
    tvg_id: ch.tvg_id || '',
    play: ch.url || '',
    source: ch.source || 'm3u',
  };
}

function isLiveRow(ch) {
  if (!ch) return false;
  if (ch.source === 'stalker' || ch._stalker) return true;
  const cls = classifyEntry(ch);
  if (cls === 'movie' || cls === 'series' || cls === 'anime') return false;
  return cls === 'live';
}

async function loadLiveCatalog(app, userId, opts) {
  opts = opts || {};
  const packed = await collectRawChannels();
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const per = Math.min(80, Math.max(20, parseInt(opts.per, 10) || 40));
  const q = String(opts.q || '').trim().toLowerCase();
  const categoryRaw = String(opts.category || '').trim();
  const category = !categoryRaw || /^all$/i.test(categoryRaw) ? '' : categoryRaw;
  const sourceRaw = String(opts.source || '').trim();
  const source = !sourceRaw || /^all$/i.test(sourceRaw) ? '' : sourceRaw;
  let list = (packed.channels || []).filter((ch) => {
    if (source && String(ch.source || 'm3u') !== source) return false;
    if (category && String(ch.category || '') !== category) return false;
    if (q) {
      const blob = (String(ch.name || '') + ' ' + String(ch.category || '')).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  list = list.filter(isLiveRow);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / per) || 1);
  const slice = list.slice((page - 1) * per, page * per);
  const wrapped = await wrapLiveUrls(slice, userId, app);
  const cats = { All: true };
  const sources = { all: true };
  for (const ch of packed.channels || []) {
    if (ch.category) cats[ch.category] = true;
    if (ch.source) sources[ch.source] = true;
  }
  return {
    channels: wrapped.map(slimLive),
    categories: Object.keys(cats).sort(),
    sources: Object.keys(sources),
    page,
    per,
    total,
    total_pages: totalPages,
    stats: packed.stats || { m3u: 0, xtream: 0, stalker: 0, playlists: 0 },
  };
}

function isAnimeBlob(name, category) {
  return /anime|donghua|animé|otaku|naruto|one\s*piece|demon\s*slayer/i.test(String(name || '') + ' ' + String(category || ''));
}

function classifyEntry(ch) {
  const u = String(ch.url || '').toLowerCase();
  const blob = (String(ch.name || '') + ' ' + String(ch.category || '')).toLowerCase();
  const anime = isAnimeBlob(ch.name, ch.category);
  if (/\/series\//i.test(u) || (/\b(series|tv shows?)\b/.test(blob) && /\/series\//i.test(u))) return anime ? 'anime' : 'series';
  if (/\/movie\//i.test(u) || (/\b(vod|movies?|films?)\b/.test(blob) && /\/movie\//i.test(u))) return anime ? 'anime' : 'movie';
  if (anime && !/^https?:/i.test(u)) return 'anime';
  return 'live';
}

function guessLang(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(hindi|hin)\b/.test(n)) return 'Hindi';
  if (/\b(english|eng)\b/.test(n)) return 'English';
  if (/\b(tamil|tam)\b/.test(n)) return 'Tamil';
  if (/\b(telugu|tel)\b/.test(n)) return 'Telugu';
  if (/\b(malayalam|mal)\b/.test(n)) return 'Malayalam';
  if (/\b(kannada|kan)\b/.test(n)) return 'Kannada';
  if (/\b(bengali|bangla|ben)\b/.test(n)) return 'Bengali';
  if (/\b(marathi)\b/.test(n)) return 'Marathi';
  if (/\b(urdu)\b/.test(n)) return 'Urdu';
  if (/\b(korean|kor)\b/.test(n)) return 'Korean';
  if (/\b(japanese|jpn|jap)\b/.test(n)) return 'Japanese';
  if (/\b(spanish|spa)\b/.test(n)) return 'Spanish';
  return '';
}

function vodPlay(app, userId, url) {
  if (!url || !/^https:\/\//i.test(url)) return '';
  return CineLiveStreamAccess.issueUrl(url, userId, app) || '';
}
async function loadIptvVod(app, userId, kind, q, page, language) {
  kind = ['movie', 'series', 'anime'].includes(kind) ? kind : 'movie';
  page = Math.max(1, page || 1);
  const per = 60;
  const needle = String(q || '').trim().toLowerCase();
  const lang = String(language || 'All');
  const items = [];
  const languages = { All: true };
  const categories = { All: true };

  try {
    const xtreams = await Database.fetchAll('SELECT * FROM xtream_servers WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    for (const xs of xtreams) {
      const pack = await loadXtreamVodCached(xs);
      const creds = await xtreamCreds(xs);
      if (kind === 'movie' || kind === 'anime') {
        for (const row of pack.movies || []) {
          if (!creds) break;
          const item = mapXtreamMovie(app, userId, xs, row, creds, false);
          if (item.kind !== kind) continue;
          items.push(item);
        }
      }
      if (kind === 'series' || kind === 'anime') {
        for (const row of pack.series || []) {
          const item = mapXtreamSeries(xs, row);
          if (item.kind !== kind) continue;
          items.push(item);
        }
      }
    }
  } catch {}

  const packed = await collectRawChannels(false);
  for (const ch of packed.channels) {
    const cls = classifyEntry(ch);
    if (cls === 'live') continue;
    const mappedKind = cls === 'anime' ? 'anime' : cls;
    if (mappedKind !== kind) continue;
    const name = ch.name || '';
    items.push({
      id: 'm3u:' + encodeURIComponent(String(ch.url || name).slice(0, 180)),
      name,
      logo: ch.logo || '',
      category: ch.category || '',
      year: '',
      kind: mappedKind,
      source: ch.source || 'm3u',
      language: guessLang(name),
      has_episodes: false,
      play: '',
      _raw: ch.url,
    });
  }

  const filtered = items.filter((it) => {
    if (it.language) languages[it.language] = true;
    if (it.category) categories[it.category] = true;
    if (lang !== 'All' && it.language !== lang) return false;
    if (needle && !String(it.name).toLowerCase().includes(needle) && !String(it.category).toLowerCase().includes(needle)) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / per));
  const slice = filtered.slice((page - 1) * per, page * per).map((it) => {
    const raw = it._raw;
    delete it._raw;
    if (!it.play && raw) it.play = vodPlay(app, userId, raw);
    return it;
  });
  return {
    items: slice,
    page,
    total_pages: totalPages,
    languages: Object.keys(languages).sort(),
    categories: Object.keys(categories).sort(),
  };
}

async function loadIptvSeries(app, userId, rawId) {
  const m = String(rawId || '').match(/^xt:(\d+):series:(\d+)$/);
  if (!m) return null;
  const serverId = Number(m[1]);
  const seriesId = m[2];
  let xs;
  try { xs = await Database.fetchOne('SELECT * FROM xtream_servers WHERE id = ? AND is_active = 1', [serverId]); } catch { xs = null; }
  if (!xs) return null;
  const creds = await xtreamCreds(xs);
  if (!creds) return null;
  let info;
  try { info = await xtreamPlayerApi(creds, 'get_series_info', { series_id: seriesId }); } catch { return null; }
  const infoRow = (info && info.info) || {};
  const episodesBySeason = (info && info.episodes) || {};
  const seasons = [];
  const seasonKeys = Object.keys(episodesBySeason).sort((a, b) => Number(a) - Number(b));
  for (const sk of seasonKeys) {
    const eps = Array.isArray(episodesBySeason[sk]) ? episodesBySeason[sk] : [];
    const episodes = eps.map((ep) => {
      const eid = ep.id || ep.episode_id || ep.stream_id;
      const ext = String(ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
      const raw = creds.base + '/series/' + creds.username + '/' + creds.password + '/' + eid + '.' + ext;
      return {
        episode_number: Number(ep.episode_num || ep.episode_number || 0),
        name: String(ep.title || ep.name || ('Episode ' + (ep.episode_num || ''))),
        play: vodPlay(app, userId, raw),
        still: String((ep.info && (ep.info.movie_image || ep.info.cover_big)) || ''),
      };
    });
    seasons.push({
      season_number: Number(sk) || seasons.length + 1,
      name: 'Season ' + (Number(sk) || seasons.length + 1),
      episodes,
    });
  }
  return {
    name: String(infoRow.name || infoRow.title || 'Series'),
    logo: String(infoRow.cover || infoRow.backdrop_path || ''),
    year: String(infoRow.releaseDate || infoRow.year || '').slice(0, 4),
    category: String(infoRow.category_name || infoRow.genre || ''),
    source: 'xtream',
    seasons,
  };
}

module.exports = {
  wrapLiveUrls,
  collectRawChannels,
  loadLiveCatalog,
  loadIptvVod,
  loadIptvSeries,
};
