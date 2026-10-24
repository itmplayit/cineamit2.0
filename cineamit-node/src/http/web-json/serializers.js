'use strict';

const crypto = require('crypto');
const Config = require('../../core/config');
const Database = require('../../db');
const TMDB = require('../../services/tmdb');

// Shared JSON serializers + small helpers (slim rows, logos, session user, download URLs).
function imageBase() {
  return String(Config.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').replace(/\/+$/, '');
}
function activePid(app) {
  return Number(app.session.active_profile_id || 0);
}
function dedupeMediaRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const k = String(r.media_type || '') + ':' + String(r.tmdb_id || r.id || '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function slim(it, fallbackType) {
  if (!it) return null;
  const id = Number(it.id || 0);
  if (!id) return null;
  const fb = String(fallbackType || '');
  const rawType = String(it.media_type || fallbackType || 'movie');
  const mediaType = rawType === 'person' ? 'person' : TMDB.mt_safe(rawType);
  const lang = String(it.original_language || '');
  let ids = Array.isArray(it.genre_ids) ? it.genre_ids.map(Number).filter((n) => n > 0) : [];
  if (!ids.length && Array.isArray(it.genres)) {
    ids = it.genres.map((g) => Number(g && g.id)).filter((n) => n > 0);
  }
  ids = ids.slice(0, 8);
  const isAnime = mediaType === 'tv' && (fb === 'anime' || rawType === 'anime' || (lang === 'ja' && ids.includes(16)));
  return {
    id,
    media_type: mediaType,
    title: String(it.title || it.name || ''),
    poster_path: String(it.poster_path || it.profile_path || '').replace(/^null$/i, ''),
    backdrop_path: String(it.backdrop_path || '').replace(/^null$/i, ''),
    vote_average: Number(it.vote_average || 0),
    year: String(it.release_date || it.first_air_date || '').slice(0, 4),
    overview: String(it.overview || ''),
    runtime: Number(it.runtime || it.episode_run_time && it.episode_run_time[0] || 0),
    tagline: String(it.tagline || ''),
    logo_path: String(it.logo_path || ''),
    genres: Array.isArray(it.genres) ? it.genres.map((g) => String(g.name || g)).filter(Boolean) : [],
    original_language: lang,
    genre_ids: ids,
    is_anime: isAnime,
  };
}

function slimList(arr, t) {
  return (arr || []).map((x) => slim(x, t)).filter(Boolean);
}

const logoMem = Object.create(null);
const logoMemKeys = [];

function logoCacheSet(key, val) {
  if (!Object.prototype.hasOwnProperty.call(logoMem, key)) {
    logoMemKeys.push(key);
    while (logoMemKeys.length > 400) {
      const old = logoMemKeys.shift();
      delete logoMem[old];
    }
  }
  logoMem[key] = val;
}

function pickTitleLogo(imagesData) {
  const logos = (imagesData && Array.isArray(imagesData.logos)) ? imagesData.logos : [];
  let best = '';
  let bestScore = -1;
  for (const logo of logos) {
    const file = String((logo && logo.file_path) || '');
    if (!file) continue;
    const lower = file.toLowerCase();
    let score = 1;
    if (lower.endsWith('.png')) score += 5;
    else if (lower.endsWith('.svg')) score -= 4;
    else if (lower.endsWith('.webp') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) score += 3;
    if (logo.iso_639_1 === 'en') score += 3;
    else if (logo.iso_639_1 === 'hi') score += 2;
    else if (!logo.iso_639_1) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }
  return best;
}

async function logoFor(mediaType, tmdbId) {
  const id = Number(tmdbId);
  if (!id) return '';
  const key = mediaType + ':' + id;
  if (Object.prototype.hasOwnProperty.call(logoMem, key)) return logoMem[key];
  let imagesData = await TMDB.getImages(mediaType, id);
  let logo = pickTitleLogo(imagesData);
  if (!logo) {
    imagesData = await TMDB.getImagesAll(mediaType, id);
    logo = pickTitleLogo(imagesData);
  }
  if (logo) logoCacheSet(key, logo);
  else if (imagesData) logoCacheSet(key, '');
  return logo || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskEmail(email) {
  const s = String(email || '').toLowerCase().trim();
  const at = s.indexOf('@');
  if (at < 1) return '***';
  const name = s.slice(0, at);
  const keep = name.slice(0, Math.min(2, name.length));
  return keep + '***' + s.slice(at);
}

async function sessionUser(app, user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    username: String(user.username || ''),
    role: String(user.role || 'user'),
    is_kids: !!app.session.is_kids,
    profile_id: Number(app.session.active_profile_id || 0),
    profile_name: String(app.session.active_profile_name || ''),
    autoplay_next: app.session.autoplay_next !== false,
    totp_enabled: !!user.totp_enabled,
    email_masked: maskEmail(user.email),
  };
}

async function embedServers(app, mediaType, tmdbId, s, e) {
  const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
  const imdbId = details.imdb_id || (details.external_ids && details.external_ids.imdb_id) || '';
  let dbServers = [];
  try { dbServers = await Database.fetchAll('SELECT * FROM server_model ORDER BY sort_order ASC, id ASC'); } catch {
    try { dbServers = await Database.fetchAll('SELECT * FROM server_model ORDER BY created_at ASC'); } catch { dbServers = []; }
  }
  const servers = [];
  for (const ds of dbServers) {
    if (ds.is_active != null && Number(ds.is_active) === 0) continue;
    const mUrl = String(ds.movie_pattern || '').replace(/\{tmdb_id\}/g, String(tmdbId)).replace(/\{imdb_id\}/g, imdbId);
    const tUrl = String(ds.tv_pattern || '').replace(/\{tmdb_id\}/g, String(tmdbId)).replace(/\{imdb_id\}/g, imdbId).replace(/\{s\}/g, String(s)).replace(/\{e\}/g, String(e));
    const rawUrl = mediaType === 'movie' ? mUrl : tUrl;
    const token = CinePlayerAccess.issue(app.session, rawUrl, {tmdbId, mediaType, s, e, profileId: Number(app.session.active_profile_id || 0)});
    if (!token) continue;
    const name = String(ds.name || 'Server');
    const vip = /\bvip\b/i.test(name) || /^vip/i.test(name) || /vip$/i.test(name);
    servers.push({ name, play: '/api/secure_play?token=' + token, vip });
  }
  return servers;
}

function fillDownloadUrl(pattern, mediaType, tmdbId, imdbId, s, e) {
  return String(pattern || '')
    .replace(/\{tmdb_id\}/g, String(tmdbId))
    .replace(/\{tmdb\}/g, String(tmdbId))
    .replace(/\{imdb_id\}/g, imdbId || '')
    .replace(/\{imdb\}/g, imdbId || '')
    .replace(/\{media_type\}/g, mediaType)
    .replace(/\{type\}/g, mediaType)
    .replace(/\{id\}/g, String(tmdbId))
    .replace(/\{season\}/g, String(s))
    .replace(/\{episode\}/g, String(e))
    .replace(/\{s\}/g, String(s))
    .replace(/\{e\}/g, String(e));
}

function isHttpUrl(url) {
  try {
    const p = new URL(url);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

async function downloadOptions(app, mediaType, tmdbId, title, s, e) {
  const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
  const imdbId = details.imdb_id || (details.external_ids && details.external_ids.imdb_id) || '';
  let dlSettings = [];
  try { dlSettings = await Database.fetchAll('SELECT * FROM download_setting ORDER BY id ASC'); } catch { dlSettings = []; }
  const slug = String(mediaType) + '-' + String(tmdbId);
  const back = '/watch/' + encodeURIComponent(mediaType) + '/' + encodeURIComponent(slug) + '?s=' + s + '&e=' + e;
  const out = [];
  const issueType = mediaType === 'movie' ? 'movie' : 'tv';
  const niceTitle = String(title || details.title || details.name || 'Title');
  for (const dl of dlSettings) {
    if (dl.is_active != null && Number(dl.is_active) === 0) continue;
    const filter = String(dl.media_type_filter || 'all').toLowerCase();
    if (filter !== 'all' && filter !== mediaType && filter !== issueType) continue;
    const url = fillDownloadUrl(String(dl.pattern_url || '').trim(), mediaType, tmdbId, imdbId, s, e);
    const access = CineDownloadAccess.issue(app.session, dl, url, issueType, niceTitle, back);
    const token = access ? String(access).split('/').pop() : '';
    const href = token ? '/download/' + token : url;
    if (!token && !/^https?:\/\//i.test(url)) continue;
    out.push({
      name: String(dl.name || 'Download'),
      token,
      href,
      play: token ? '/download-frame/' + token : url,
      url: url || href,
    });
  }
  return out;
}

function stripHtml(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function histItem(r) {
  return slim({
    id: r.tmdb_id || r.id,
    media_type: r.media_type,
    title: r.title || r.name,
    poster_path: r.poster_path,
  }, r.media_type);
}

async function histItemFilled(r) {
  const item = histItem(r);
  if (item && item.poster_path) return item;
  try {
    const d = await TMDB.getDetails(r.media_type || 'movie', r.tmdb_id || r.id);
    if (d && d.poster_path) {
      item.poster_path = String(d.poster_path);
      try {
        await Database.execute(
          'UPDATE watch_history SET poster_path = ? WHERE tmdb_id = ? AND media_type = ? AND (poster_path IS NULL OR poster_path = \"\")',
          [item.poster_path, Number(r.tmdb_id || r.id), String(r.media_type || 'movie')]
        );
      } catch { /* best-effort backfill */ }
    }
  } catch { /* keep empty; client shows placeholder */ }
  return item;
}

module.exports = {
  imageBase, activePid, dedupeMediaRows, slim, slimList, logoFor, sleep, maskEmail,
  sessionUser, embedServers, fillDownloadUrl, isHttpUrl, downloadOptions,
  stripHtml, histItem, histItemFilled,
};
