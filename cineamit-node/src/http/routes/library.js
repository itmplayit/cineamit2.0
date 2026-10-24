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


// History/watchlist/playlists/notifications/reels/cine-match routes (moved verbatim from routes/main.js).
function registerLibraryRoutes() {
  add('/history', 'routes.history', async (app) => {
    if (!(await app.requireLogin())) return;
    if (app.session.is_kids) {
      app.flash('History is not available in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    const user = await app.currentUser();
    const scope = await userMediaScope(app, user);
    const history = dedupeMediaRows(await Database.fetchAll(
      'SELECT * FROM watch_history WHERE ' + scope.clause + ' ORDER BY watch_time DESC LIMIT 200',
      scope.params
    ));
    return app.render('history.html', { history, items: history });
  });

  add('/clear_history', 'routes.clear_history', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const scope = await userMediaScope(app, user);
    await Database.execute('DELETE FROM watch_history WHERE ' + scope.clause, scope.params);
    app.flash('Watch history cleared.', 'success');
    return app.redirect(app.urlFor('routes.history'));
  }, ['POST']);

  add('/history/remove/{slug}', 'routes.remove_from_history', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const tmdbId = tmdbIdFromSlug(args.slug);
    const scope = await userMediaScope(app, user);
    await Database.execute('DELETE FROM watch_history WHERE ' + scope.clause + ' AND tmdb_id = ?' + (app.req.query.media_type ? ' AND media_type = ?' : ''), [...scope.params, tmdbId, ...(app.req.query.media_type ? [TMDB.mt_safe(app.req.query.media_type)] : [])]);
    return app.redirect(app.referrerOr(app.urlFor('routes.history')));
  }, ['POST']);

  add('/watchlist', 'routes.watchlist', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const scope = await userMediaScope(app, user);
    const watchlist = dedupeMediaRows(await Database.fetchAll(
      'SELECT * FROM watchlist WHERE ' + scope.clause + ' ORDER BY added_at DESC',
      scope.params
    ));
    return app.render('watchlist.html', { watchlist, items: watchlist });
  });

  add('/watchlist/add/{media_type}/{slug}', 'routes.add_to_watchlist', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const mediaType = TMDB.mt_safe(args.media_type);
    const tmdbId = tmdbIdFromSlug(args.slug);
    const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
    if (!details.id || await app.isBlacklisted(tmdbId) || (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType))) {
      app.flash('This title is unavailable for this profile.', 'error');
      return app.redirect('/watchlist');
    }
    const title = details.title || details.name || 'Unknown';
    try {
      const pid = await writePid(app, user);
      await Database.execute(
        'INSERT INTO watchlist (user_id, profile_id, tmdb_id, media_type, title, poster_path) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), poster_path = VALUES(poster_path)',
        [user.id, pid, tmdbId, mediaType, title, details.poster_path || null]
      );
      app.flash('Added to watchlist.', 'success');
    } catch (e) { app.flash('Could not add to watchlist.', 'error'); }
    return app.redirect(app.referrerOr('/'));
  }, ['POST']);

  add('/watchlist/remove/{slug}', 'routes.remove_from_watchlist', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const scope = await userMediaScope(app, user);
    await Database.execute('DELETE FROM watchlist WHERE ' + scope.clause + ' AND tmdb_id = ?' + (app.req.query.media_type ? ' AND media_type = ?' : ''), [...scope.params, tmdbIdFromSlug(args.slug), ...(app.req.query.media_type ? [TMDB.mt_safe(app.req.query.media_type)] : [])]);
    return app.redirect(app.referrerOr(app.urlFor('routes.watchlist')));
  }, ['POST']);

  add('/playlists', 'routes.my_playlists', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const scope = await Playlists.scope(app,user);
    const playlists = await Database.fetchAll('SELECT * FROM playlist WHERE '+scope.clause+' ORDER BY created_at DESC',scope.params);
    return app.render('playlists.html', { playlists });
  });

  add('/playlist/create', 'routes.create_playlist', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const name = String(app.req.body.name || '').trim().slice(0, 100);
    const scope=await Playlists.scope(app,user);
    if (name) await Database.execute('INSERT INTO playlist (user_id, profile_id, name, share_code) VALUES (?, ?, ?, ?)', [user.id, scope.profile.id, name, Database.shortCode()]);
    return app.redirect(app.urlFor('routes.my_playlists'));
  }, ['POST']);

  add('/playlist/delete/{playlist_id}', 'routes.delete_playlist', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    if (!(await Playlists.remove(app,user,Number(args.playlist_id)))) {app.res.status(404);return app.renderNotFound();}
    return app.redirect(app.urlFor('routes.my_playlists'));
  }, ['POST']);

  add('/playlist/add_item', 'routes.add_to_playlist_item', async (app) => {
    if (!(await app.requireLogin())) return;
    const user=await app.currentUser();
    const pid = Number(app.req.body.playlist_id);
    const tmdbId = Number(app.req.body.tmdb_id);
    const mediaType = TMDB.mt_safe(app.req.body.media_type || 'movie');
    const title = String(app.req.body.title || '').slice(0, 255);
    const poster = String(app.req.body.poster_path || '');
    const details=await TMDB.getDetails(mediaType,tmdbId);
    if (!Number.isSafeInteger(pid) || pid<1 || !details || !details.id || await app.isBlacklisted(tmdbId) || (app.session.is_kids && !cineamitKidsContentAllowed(details,mediaType))
      || !(await Playlists.addItem(app,user,pid,{id:tmdbId,type:mediaType,title:String(details.title || details.name || title).slice(0,255),poster:String(details.poster_path || poster)}))) {app.res.status(404);return app.renderNotFound();}
    return app.redirect(app.referrerOr(app.urlFor('routes.my_playlists')));
  }, ['POST']);

  add('/playlist/share/{share_code}', 'routes.view_playlist', async (app, args) => {
    const pl = await Playlists.lookup(app,args.share_code,true);
    if (!pl) { app.res.status(404); return app.renderNotFound(); }
    const items = await app.filterBlacklisted(await Database.fetchAll('SELECT * FROM playlist_movies WHERE playlist_id = ? ORDER BY added_at DESC', [pl.id]));
    return app.render('view_playlist.html', { playlist: pl, items });
  });

  add('/notifications', 'routes.notifications', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const items = await Database.fetchAll('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [user.id]);
    return app.render('notifications.html', { notifications: items });
  });

  add('/notifications/read/{notif_id}', 'routes.mark_notification_read', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    await Database.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [Number(args.notif_id), user.id]);
    return app.redirect(app.urlFor('routes.notifications'));
  }, ['POST']);

  add('/notifications/clear', 'routes.clear_notifications', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    await Database.execute('DELETE FROM notifications WHERE user_id = ?', [user.id]);
    return app.redirect(app.urlFor('routes.notifications'));
  }, ['POST']);

  add('/reels', 'routes.reels', async (app) => {
    const trending = await app.filterBlacklisted(await TMDB.getTrending('all', 'day'));
    const unique = [];
    const seen = new Set();
    for (const it of trending) {
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      unique.push(it);
    }
    return app.render('reels.html', { items: unique.slice(0, 30) });
  });

  add('/cine-match', 'routes.cine_match_home', async (app) => {
    if (!(await app.requireLogin())) return;
    return app.render('cine_match.html', { matched_movies: null, friend: null });
  });

  add('/cine-match/compare', 'routes.cine_match_compare', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const code = String(app.req.body.code || app.req.query.code || '').trim();
    if (app.req.method === 'GET') {
      let pending_friend = null;
      if (code) {
        pending_friend = await Database.fetchOne('SELECT id, username FROM users WHERE match_code = ? LIMIT 1', [code]);
        if (pending_friend && Number(pending_friend.id) === Number(user.id)) pending_friend = null;
      }
      return app.render('cine_match.html', {
        matched_movies: null,
        friend: null,
        pending_friend,
        friend_code: code,
        pending_code: code,
        consent: true,
      });
    }
    if (app.session.is_kids) {
      app.flash('Cine-Match is not available in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.cine_match_home'));
    }
    const friend = await Database.fetchOne('SELECT * FROM users WHERE match_code = ? LIMIT 1', [code]);
    if (!friend || Number(friend.id) === Number(user.id)) {
      app.flash('Invalid match code.', 'error');
      return app.redirect(app.urlFor('routes.cine_match_home'));
    }
    const myScope = await userMediaScope(app, user);
    const myHist = await Database.fetchAll(
      'SELECT tmdb_id, media_type, title, poster_path FROM watch_history WHERE ' + myScope.clause,
      myScope.params
    );
    const friendProf = await Database.fetchOne('SELECT id FROM user_profiles WHERE user_id = ? AND is_kids = 0 ORDER BY id ASC LIMIT 1', [friend.id]);
    const fScope = await mediaScopeForUser(friend.id, { isKids: false, pid: Number((friendProf && friendProf.id) || 0) });
    const fHist = await Database.fetchAll(
      'SELECT tmdb_id, media_type, title, poster_path FROM watch_history WHERE ' + fScope.clause,
      fScope.params
    );
    const mine = new Set(myHist.map((r) => r.media_type + ':' + r.tmdb_id));
    const seen = new Set();
    const matched = [];
    for (const r of fHist) {
      const k = r.media_type + ':' + r.tmdb_id;
      if (!mine.has(k) || seen.has(k)) continue;
      seen.add(k);
      matched.push(r);
    }
    try { await Database.execute('INSERT IGNORE INTO cine_match_friends (user_id, friend_id) VALUES (?, ?)', [user.id, friend.id]); } catch {}
    return app.render('cine_match.html', { matched_movies: matched, friend });
  }, ['GET', 'POST']);

  add('/cine-wrapped', 'routes.cine_wrapped', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const scope = await userMediaScope(app, user);
    let hist = await Database.fetchAll(
      'SELECT * FROM watch_history WHERE ' + scope.clause + ' ORDER BY watch_time DESC',
      scope.params
    );
    return app.render('wrapped.html', cineWrapStats(await app.filterBlacklisted(dedupeMediaRows(hist || []))));
  });

  add('/add_review', 'routes.add_review', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const rating = Number(app.req.body.rating);
    if (![1, 2, 3, 4, 5].includes(rating)) {
      app.flash('Invalid rating.', 'error');
      return app.redirect(app.referrerOr('/'));
    }
    await Database.execute(
      'INSERT INTO reviews (user_id, profile_id, tmdb_id, media_type, rating, review_text, has_spoilers) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user.id, app.session.active_profile_id || 0, Number(app.req.body.tmdb_id), TMDB.mt_safe(app.req.body.media_type || 'movie'), rating, String(app.req.body.review_text || '').slice(0, 5000), app.req.body.has_spoilers ? 1 : 0]
    );
    app.flash('Review posted.', 'success');
    return app.redirect(app.referrerOr('/'));
  }, ['POST']);

  // static legal / cms

  add('/announcements/dismiss/{id}', 'routes.announcement_dismiss', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    try { await Database.execute('INSERT IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)', [Number(args.id), user.id]); } catch {}
    return app.redirect(app.referrerOr('/'));
  }, ['POST']);

}

module.exports = { registerLibraryRoutes };
