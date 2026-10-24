'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Config = require('../../core/config');
const Database = require('../../db');
const SiteStatus = require('../../services/site-status');
const Security = require('../../security');
const TMDB = require('../../services/tmdb');
const { add } = require('../../core/router');
const { cineamitKidsContentAllowed } = require('../../services/kids');
const { ssrfSafeHttpGet, ssrfBlockedHostAsync, ssrfResolveRedirectUrl } = require('../../security/ssrf');
const live = require('../../services/live');
const { CinePlayerAccess, CineDownloadAccess } = require('../../services/player-access');
const { getAllProductionStudios, getAllCuratedAlbums, loadStudioCatalog, formatStudio } = require('../../services/studios');
const Economy = require('../../services/economy');
const AdsOps = require('../../services/ads-ops');
const AndroidApp = require('../../android-app');
const WatchLimit = require('../../services/watch-limit');
const App = require('../../core/app');
const Profiles = require('../../services/profiles');
const Playlists = require('../../services/playlists');
const MediaLibrary = require('../../services/media-library');
const { tmdbIdFromSlug, activePid, dedupeMediaRows, writePid, requireProfileManagement,
  mediaScopeForUser, userMediaScope, profilePageExtras, cineWrapStats, csvSafe, csvStamp, sendCsv,
  tmdbTemporarilyUnavailable, pageNum, requireStaff, validateServerPattern, validateDownloadPattern,
  shuffleInPlace, warmKeyMatches, rowMissing, homeBundleCoreReady, homeBundleRowsReady, hydrateHomeRows,
  loadHomeBundle, parseM3uLines, parseM3uPlaylist, parseXtreamServer, xtreamClearCache, wrapLiveUrls } = require('./home-bundle');


// Public JSON/XHR API routes (moved verbatim from routes/main.js).
function registerApiPublicRoutes() {
  add('/api/search', 'routes.api_search', async (app) => {
    app.res.set({ 'Cache-Control': 'private, no-store, max-age=0, must-revalidate', Vary: 'Cookie' });
    const query = String(app.req.query.q || '').trim().slice(0, 100);
    let filterType = String(app.req.query.type || 'multi');
    if (!['multi', 'movie', 'tv'].includes(filterType)) filterType = 'multi';
    if (!query || query.length < 2) return app.json([]);
    if (!(await app.throttle('api_search', 60, 60))) {
      app.res.status(429);
      app.res.set('Retry-After', '60');
      return app.json([]);
    }
    let data = await TMDB.search(query, 1, filterType);
    if (app.session.is_kids && Array.isArray(data) && data.length) {
      const kidsGenres = new Set([10751, 10762]);
      data = data.filter((item) => {
        if ((item.media_type || '') === 'person') return false;
        return Array.isArray(item.genre_ids) && item.genre_ids.some((id) => kidsGenres.has(Number(id)));
      });
    }
    data = await app.filterBlacklisted(data || [],filterType);
    const results = [];
    for (const item of data) {
      const cmt = item.media_type || (filterType !== 'multi' ? filterType : 'movie');
      const img = item.poster_path || item.profile_path || null;
      if (!img || !['movie', 'tv', 'person'].includes(cmt)) continue;
      const title = item.title || item.name || '';
      let detailsUrl;
      let year;
      if (cmt === 'person') {
        const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + item.id;
        detailsUrl = app.urlFor('routes.actor', { slug });
        year = 'Actor';
      } else {
        detailsUrl = app.urlFor('routes.details', { media_type: cmt, tmdb_id: item.id, title });
        const rawDate = item.release_date || item.first_air_date || '';
        year = rawDate ? String(rawDate).slice(0, 4) : 'N/A';
      }
      results.push({ title, poster_path: img, media_type: cmt, year, details_url: detailsUrl });
      if (results.length >= 6) break;
    }
    return app.json(results);
  });

  add('/api/episodes/{tmdb_id}/{season_number}', 'routes.get_season_episodes', async (app, args) => {
    app.res.set({ 'Cache-Control': 'private, no-store, max-age=0, must-revalidate', Vary: 'Cookie' });
    if (await app.isBlacklisted(Number(args.tmdb_id))) return app.json([]);
    if (app.session.is_kids) {
      const show = (await TMDB.getDetails('tv', Number(args.tmdb_id))) || {};
      if (!cineamitKidsContentAllowed(show, 'tv')) return app.json([]);
    }
    const data = await TMDB.rawGet(Config.TMDB_BASE_URL + '/tv/' + Number(args.tmdb_id) + '/season/' + Number(args.season_number) + '?api_key=' + encodeURIComponent(Config.TMDB_API_KEY));
    const episodes = (data && Array.isArray(data.episodes)) ? data.episodes : [];
    return app.json(episodes);
  });

  add('/api/trailer/{media_type}/{tmdb_id}', 'routes.get_trailer', async (app, args) => {
    const type=TMDB.mt_safe(args.media_type),id=Number(args.tmdb_id);
    if (await app.isBlacklisted(id) || (app.session.is_kids && !(await app.filterBlacklisted([{id,media_type:type}],type)).length)) {app.res.status(403);return app.json({key:'',error:'title_unavailable'});}
    const key = await TMDB.getTrailer(type,id);
    return app.json({ key });
  });

  add('/api/video_preview/{media_type}/{tmdb_id}', 'routes.video_preview', async (app, args) => {
    const type=TMDB.mt_safe(args.media_type),id=Number(args.tmdb_id);
    if (await app.isBlacklisted(id) || (app.session.is_kids && !(await app.filterBlacklisted([{id,media_type:type}],type)).length)) {app.res.status(403);return app.json({key:'',error:'title_unavailable'});}
    const key = await TMDB.getTrailer(type,id);
    return app.json({ key });
  });

  add('/api/studio_thumb/{id}', 'routes.studio_thumb', async (app, args) => {
    const url = await TMDB.companyLogoUrl(Number(args.id), 'w500');
    if (!url) { app.res.status(404).end(); app._ended = true; return; }
    const fetch = await ssrfSafeHttpGet(url, { timeout: 12000, headers: { 'User-Agent': 'CineAmit-Node/1.0' } }, 2, true, false, 2 * 1024 * 1024);
    if (!fetch.ok || !fetch.raw) { app.res.status(404).end(); app._ended = true; return; }
    const mime = String(fetch.content_type || '').split(';')[0].trim();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) { app.res.status(415).end(); app._ended = true; return; }
    app.res.set({ 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    app.res.end(fetch.raw);
    app._ended = true;
  });

  add('/api/warm', 'routes.api_warm', async (app) => {
    app.res.set('Cache-Control', 'no-store');
    if (!(await app.throttle('api_warm', 12, 3600))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'throttled' });
    }
    if (!Config.WARM_KEY) {
      app.res.status(503);
      return app.json({ ok: false, error: 'WARM_KEY is not set in .env' });
    }
    if (!warmKeyMatches(app.req.query.key)) {
      app.res.status(403);
      return app.json({ ok: false, error: 'bad key' });
    }
    const started = Date.now();
    try {
      await loadHomeBundle(false, true);
      await loadHomeBundle(true, true);
      await loadStudioCatalog();
      return app.json({
        ok: true,
        ms: Date.now() - started,
        note: 'Home bundle is fresh — users will not wait on a cold cache for the next 24 hours.',
      });
    } catch (e) {
      app.res.status(500);
      return app.json({ ok: false, error: e.message });
    }
  });

  add('/api/vast_proxy', 'routes.vast_proxy', async (app) => {
    const Vast = require('../../integrations/vast');
    app.res.set({'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'"});
    const url = String(app.req.query.url || '');
    if (!Vast.allowed(url)) { app.res.status(403); return app.json({ok: false, error: 'vast_host_blocked'}); }
    if (!(await app.throttle('vast_proxy', 30, 60))) { app.res.status(429); return app.json({ok: false, error: 'slow_down'}); }
    const fetch = await ssrfSafeHttpGet(url, {timeout: 6000, headers: {Accept: 'application/xml,text/xml'}}, 3, true, false, 1048576);
    if (!fetch.ok || !Vast.allowed(fetch.url || url) || !Vast.validXml(fetch.body)) {
      app.res.status(502); return app.json({ok: false, error: 'invalid_vast'});
    }
    app.res.type('application/xml').send(fetch.body);
    app._ended = true;
  });

  add('/api/secure_play', 'routes.secure_play', async (app) => {
    CineDownloadAccess.noStore(app.res);
    app.res.set({ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' });
    const deny = (status, error, quota) => {
      app.res.status(status);
      if (app.req.headers['sec-fetch-dest'] !== 'iframe') return app.json({ok:false,error,...(quota ? {quota} : {})});
      const title = status === 429 ? 'No new unlocks left today' : status === 503 ? 'Player access temporarily unavailable' : 'This player link is unavailable';
      const note = status === 429 ? 'New titles reset at 12 AM IST. Previously unlocked titles can be replayed today.' : 'Please retry shortly, or reopen the watch page if this link has expired.';
      // Fixed text only. No raw provider URL, token, settings or exception details.
      app.res.type('html').send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#eee;font:16px system-ui;text-align:center"><main style="max-width:480px;padding:24px"><h1 style="font-size:24px">'+title+'</h1><p>'+note+'</p><button onclick="location.reload()" style="padding:10px 18px;cursor:pointer">Retry this server</button></main></body></html>');
      app._ended = true;
    };
    const token = String(app.req.query.token || '');
    if (token === 'none') {
      app.res.status(200);
      app.res.type('html').send('<!doctype html><html lang="en"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0c;color:#9ca3af;font-family:sans-serif;"><p style="font-size:14px;">No active streaming servers. Please contact admin or try again later.</p></body></html>');
      app._ended = true;
      return;
    }
    const item = CinePlayerAccess.resolveItem(app.session, token);
    if (!item || !item.url) {
      return deny(404,'invalid_stream_token');
    }
    const user = await app.currentUser();
    let viewer;
    try { viewer = await WatchLimit.viewerContext(app,user); }
    catch { return deny(503,'profile_unavailable'); }
    const details = await TMDB.getDetails(item.mediaType, item.tmdbId);
    if (!details || !details.id || await app.isBlacklisted(item.tmdbId) || (viewer.isKids && !cineamitKidsContentAllowed(details, item.mediaType))) {
      return deny(403,'title_unavailable');
    }
    // VIP is free provider branding; no premium entitlement is required.
    let quota;
    try { quota = await WatchLimit.gate(app, {...viewer, tmdbId: item.tmdbId, mediaType: item.mediaType, s: item.s, e: item.e}); }
    catch { return deny(503,'quota_unavailable'); }
    if (quota.blocked) return deny(429,'watch_limit',quota);
    if (user) {
      try { await MediaLibrary.recordStart(app, user, details, item.mediaType); }
      catch (error) { console.error('[player-history]', error.message); }
    }
    return app.redirect(item.url);
  });

  add('/api/ping', 'routes.api_ping', async (app) => {
    if (!(await app.isAuthenticated())) return app.json({ ok: false });
    const user = await app.currentUser();
    try {
      await Database.execute(
        `INSERT INTO live_presence (user_id, username, profile_name, current_page, content_title, ip, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE username=VALUES(username), profile_name=VALUES(profile_name), current_page=VALUES(current_page), content_title=VALUES(content_title), ip=VALUES(ip), last_seen=NOW()`,
        [user.id, user.username, app.session.active_profile_name || '', String(app.req.body.page || '').slice(0, 255), String(app.req.body.title || '').slice(0, 255), app.clientIp().slice(0, 45)]
      );
    } catch {}
    return app.json({ ok: true });
  }, ['POST']);

  add('/api/ga_blocked', 'routes.api_ga_blocked', async (app) => app.json({ ok: true }), ['GET', 'POST']);

}

module.exports = { registerApiPublicRoutes };
