'use strict';

const crypto = require('crypto');
const Database = require('../../db');
const TMDB = require('../../services/tmdb');
const { cineamitKidsContentAllowed } = require('../../services/kids');
const { CinePlayerAccess, CineDownloadAccess } = require('../../services/player-access');
const WatchLimit = require('../../services/watch-limit');
const Profiles = require('../../services/profiles');
const MediaLibrary = require('../../services/media-library');
const { add } = require('../../core/router');

function tmdbIdFromSlug(slug) {
  const parts = String(slug).split('-');
  return Number(parts[parts.length - 1] || slug) || 0;
}

module.exports = function registerPlayer() {
  add('/watch/{media_type}/{slug}', 'player.watch', async (app, args) => {
    CineDownloadAccess.noStore(app.res);
    const mediaType = TMDB.mt_safe(String(args.media_type));
    const slug = String(args.slug || '');
    if (!slug || slug.includes('{') || slug === 'watch' || slug === 'slug') {
      app.res.status(404);
      return app.renderNotFound();
    }
    const tmdbId = tmdbIdFromSlug(slug);
    const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
    if (!tmdbId || !details.id) {
      app.res.status(404);
      return app.renderNotFound();
    }
    if (await app.isBlacklisted(tmdbId)) {
      app.res.status(404);
      app.res.type('text').send('This content is not available.');
      app._ended = true;
      return;
    }
    // Preserve the existing conservative session Kids check before profile hydration.
    if (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType)) {
      app.flash('This content is restricted in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    const title = details.title || details.name || 'Unknown';
    const imdbId = details.imdb_id || (details.external_ids && details.external_ids.imdb_id) || '';
    const user = await app.currentUser();
    let viewer;
    try {
      if (user) await Profiles.ensureActive(app, user);
      viewer = await WatchLimit.viewerContext(app, user);
    } catch { app.res.status(503); return app.json({ok:false,error:'profile_unavailable'}); }
    const profileId = app.session.active_profile_id || 0;
    const activeProfile = viewer.profile;
    if (viewer.isKids && !cineamitKidsContentAllowed(details, mediaType)) {
      app.flash('This content is restricted in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    const autoplayEnabled = !!(activeProfile ? activeProfile.autoplay_next ?? 1 : 1);
    const defaultServerName = String((activeProfile && activeProfile.default_server) || 'auto').toLowerCase();
    try { WatchLimit.titleKey(tmdbId,mediaType,app.req.query.s ?? 1,app.req.query.e ?? 1); }
    catch { app.res.status(400); return app.json({ok:false,error:'invalid_episode'}); }
    const s = mediaType === 'tv' ? Number(app.req.query.s ?? 1) : 1;
    const e = mediaType === 'tv' ? Number(app.req.query.e ?? 1) : 1;
    let roomId = String(app.req.query.room || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    if (!roomId) roomId = crypto.randomBytes(16).toString('hex');
    const scheme = app.isSecure() ? 'https' : 'http';
    const partyLink = `${scheme}://${app.safeHost()}${app.req.path}?room=${roomId}&s=${s}&e=${e}`;
    let watchQuota = { enabled: false, blocked: false };
    try {
      watchQuota = await WatchLimit.inspect(app, {
        tmdbId,
        mediaType,
        s,
        e,
        user,
        isKids: viewer.isKids,
      });
    } catch { watchQuota = WatchLimit.unavailable(); app.res.status(503); }
    const downloads = [];
    let dbServers = [];
    try { dbServers = await Database.fetchAll('SELECT * FROM server_model ORDER BY sort_order ASC, id ASC'); }
    catch {
      try { dbServers = await Database.fetchAll('SELECT * FROM server_model ORDER BY created_at ASC'); } catch { dbServers = []; }
    }
    const servers = [];
    if (!watchQuota.blocked) {
      for (const ds of dbServers) {
        if (ds.is_active != null && Number(ds.is_active) === 0) continue;
        const mUrl = String(ds.movie_pattern).replace(/\{tmdb_id\}/g, String(tmdbId)).replace(/\{imdb_id\}/g, imdbId);
        const tUrl = String(ds.tv_pattern).replace(/\{tmdb_id\}/g, String(tmdbId)).replace(/\{imdb_id\}/g, imdbId).replace(/\{s\}/g, String(s)).replace(/\{e\}/g, String(e));
        const rawUrl = mediaType === 'movie' ? mUrl : tUrl;
        const playerToken = CinePlayerAccess.issue(app.session, rawUrl, { tmdbId, mediaType, s, e, profileId: Number(profileId) });
        const serverData = { name: ds.name, token: playerToken !== '' ? playerToken : 'none' };
        if (defaultServerName !== 'auto' && String(ds.name).toLowerCase().includes(defaultServerName)) servers.unshift(serverData);
        else servers.push(serverData);
      }
    }
    if (!servers.length) servers.push({ name: watchQuota.blocked ? 'Limit' : 'No Servers Added', url: 'about:blank', token: 'none' });
    return app.render('watch.html', {
      title, tmdb_id: tmdbId, imdb_id: imdbId, details, servers, media_type: mediaType,
      s, e, room_id: roomId, party_link: partyLink, downloads,
      autoplay_enabled: autoplayEnabled, can_track_history: !!user,
      watch_quota: watchQuota,
    });
  });

  add('/api/watch/quota', 'player.watch_quota', async app => {
    CineDownloadAccess.noStore(app.res);
    app.res.set('Vary', 'Cookie');
    const q = app.req.query;
    try { WatchLimit.titleKey(q.tmdb_id, q.media_type, q.s ?? 1, q.e ?? 1); }
    catch { app.res.status(400); return app.json({ok:false,error:'invalid_content'}); }
    try {
      const rate = await Database.consumeRate(app.throttleStorageKey('watch_quota:'+app.req.sessionID),120,60);
      if (!rate.allowed) { app.res.status(429); app.res.set('Retry-After','60'); return app.json({ok:false,error:'slow_down'}); }
      const user = await app.currentUser();
      const viewer = await WatchLimit.viewerContext(app,user);
      const quota = await WatchLimit.inspect(app,{...viewer,tmdbId:q.tmdb_id,mediaType:q.media_type,s:q.s ?? 1,e:q.e ?? 1});
      return app.json({ok:true,quota});
    } catch {
      app.res.status(503); return app.json({ok:false,error:'quota_unavailable'});
    }
  });

  add('/api/watch/confirm', 'player.watch_confirm', async (app) => {
    app.res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Vary: 'Cookie' });
    if (!(await app.requireLogin())) return;
    const payload = app.req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid_json' });
    }
    const mediaType = String(payload.media_type || '').toLowerCase().trim();
    const tmdbId = Number(payload.tmdb_id);
    if (!['movie', 'tv'].includes(mediaType) || !Number.isInteger(tmdbId) || tmdbId < 1) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid_title' });
    }
    const user = await app.currentUser();
    const userId = Number((user && user.id) || 0);
    if (userId <= 0 || !(await app.throttle('watch_confirm_' + userId, 20, 3600))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'slow_down' });
    }
    const profile = await Profiles.ensureActive(app, user);
    if (!profile) { app.res.status(403); return app.json({ok: false, error: 'profile_required'}); }
    const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
    if (!details.id || await app.isBlacklisted(tmdbId)) {
      app.res.status(404);
      return app.json({ ok: false, error: 'title_unavailable' });
    }
    if (profile.is_kids && !cineamitKidsContentAllowed(details, mediaType)) {
      app.res.status(403);
      return app.json({ ok: false, error: 'kids_restricted' });
    }
    const title = String(details.title || details.name || 'Untitled');
    try { await MediaLibrary.recordStart(app, user, details, mediaType); }
    catch (error) {
      console.error('[watch-confirm] history update failed:', error.message);
      app.res.status(503); return app.json({ok: false, error: 'save_failed'});
    }
    return app.json({ ok: true, title });
  }, ['POST']);

  add('/download/{token}', 'player.download', async (app, args) => {
    CineDownloadAccess.noStore(app.res);
    app.res.set({ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
    const nonce = crypto.randomBytes(18).toString('base64');
    app.res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src 'self' https:; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; object-src 'none'`);
    const item = await CineDownloadAccess.resolve(app.session, String(args.token));
    if (!item) app.res.status(410);
    const TwigEnv = require('../../core/twig-env');
    let html;
    try {
      html = TwigEnv.render('download.html', {
        valid: item !== null,
        nonce,
        title: (item && item.title) || 'Download link unavailable',
        provider: (item && item.provider) || '',
        back_url: (item && item.back) || '/',
        frame_url: item ? '/download-frame/' + args.token : '',
        iframe_sandbox: CineDownloadAccess.iframeSandbox((item && item.url) || ''),
        expires: (item && item.expires) || 0,
      }, app);
    } catch (e) {
      html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Download</title><p>Download page unavailable.</p></html>';
    }
    if (app._ended) return;
    app._ended = true;
    app.res.type('html').send(html);
  });

  add('/download-frame/{token}', 'player.download_frame', async (app, args) => {
    CineDownloadAccess.noStore(app.res);
    app.res.set({ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' });
    const item = await CineDownloadAccess.resolve(app.session, String(args.token));
    if (!item) {
      app.res.status(410);
      app.res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
      app.res.type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Link unavailable</title><h1>Download link expired or unavailable</h1><p>Use Back to watch, refresh the watch page and select Download Options again.</p></html>');
      app._ended = true;
      return;
    }
    return app.redirect(item.url);
  });
};
