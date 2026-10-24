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


// Live TV + stream playback routes (moved verbatim from routes/main.js).
function registerLivetvRoutes() {
  add('/play_external', 'routes.play_external', async (app) => app.render('play_external.html'));

  add('/livetv', 'routes.livetv', async (app) => {
    if (!(await app.requireLogin())) return;
    if (app.session.is_kids) {
      app.flash('Live TV is restricted in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    const user = await app.currentUser();
    const webPlayerSetting = await Database.fetchOne("SELECT setting_value FROM site_setting WHERE setting_key = 'WEB_PLAYER_ENABLED'");
    const webPlayerEnabled = (webPlayerSetting && webPlayerSetting.setting_value) || 'true';
    // Do not wrap 20k+ tokens into the HTML — that timed out the page.
    // The page fetches /api/app/livetv in pages (same catalog the app uses).
    return app.render('livetv.html', {
      channels_json: '[]',
      categories: ['All'],
      web_player_enabled: webPlayerEnabled,
    });
  });

  add('/api/stalker_play', 'routes.stalker_play_legacy', async (app) => {
    app.res.status(410);
    return app.json({ error: true, message: 'Legacy Stalker play endpoint is disabled. Use the Live TV player.' });
  });

  add('/api/stream_proxy', 'routes.stream_proxy', async (app) => {
    app.res.status(410);
    return app.json({ error: true, message: 'Direct stream proxy is disabled. Use /api/live_stream/{token}.' });
  });

  add('/api/live_stream/{token}', 'routes.live_stream', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const data = await live.CineLiveStreamAccess.resolve(String(args.token), Number(user.id), app);
    if (!data) {
      app.res.status(403);
      return app.json({ error: true, message: 'Invalid or expired live stream token.' });
    }
    let url = data.url;
    const mag = data.kind === 'stalker' ? { mac: data.mac, portal: data.portal } : null;
    if (data.kind === 'stalker') {
      url = await live.cineStalkerResolvePlayUrl(data.portal, data.mac, data.cmd);
      if (!url) { app.res.status(502); app.res.end(); app._ended = true; return; }
    }
    if (live.cineLiveIsHlsManifest(url)) {
      const httpsOnly = String(url).startsWith('https://');
      const fetch = await ssrfSafeHttpGet(url, { timeout: 15000, headers: { 'User-Agent': 'CineAmit-Live-Relay/1.0', Accept: '*/*' } }, 3, httpsOnly, false, 5 * 1024 * 1024);
      if (!fetch.ok) { app.res.status(502); app.res.end(); app._ended = true; return; }
      const rewritten = live.cineLiveRewriteHlsManifest(String(fetch.body), fetch.url || url, Number(user.id), app);
      if (!rewritten) { app.res.status(502); app.res.end(); app._ended = true; return; }
      app.res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' });
      app.res.send(rewritten);
      app._ended = true;
      return;
    }
    await live.cineLiveStreamResponse(app, url, data._hint_ext || 'ts', mag);
    app._ended = true;
  });

}

module.exports = { registerLivetvRoutes };
