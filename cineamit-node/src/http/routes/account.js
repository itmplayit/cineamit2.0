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


// Profile/account/preferences routes (moved verbatim from routes/main.js).
function registerAccountRoutes() {
  add('/profile', 'routes.profile', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const profiles = await Database.fetchAll('SELECT * FROM user_profiles WHERE user_id = ? ORDER BY id ASC', [user.id]);
    const requests = await Database.fetchAll('SELECT * FROM user_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [user.id]);
    const extras = await profilePageExtras(app, user);
    return app.render('profile.html', { profiles, requests, ...extras });
  });

  add('/update_avatar', 'routes.update_avatar', async (app) => {
    if (!(await app.requireLogin())) return;
    const avatar = String(app.req.body.avatar || app.req.body.avatar_url || '').slice(0, 255);
    const user = await app.currentUser();
    const pid = await writePid(app, user);
    if (pid) await Database.execute('UPDATE user_profiles SET avatar_image = ? WHERE id = ? AND user_id = ?', [avatar, pid, user.id]);
    app.flash('Avatar updated.', 'success');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/update_theme', 'routes.update_theme', async (app) => {
    if (!(await app.requireLogin())) return;
    const color = ['red', 'blue', 'purple', 'green'].includes(app.req.body.theme_color) ? app.req.body.theme_color : 'red';
    const user = await app.currentUser();
    const pid = await writePid(app, user);
    if (pid) await Database.execute('UPDATE user_profiles SET theme_color = ? WHERE id = ? AND user_id = ?', [color, pid, user.id]);
    app.flash('Theme updated.', 'success');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/update_playback_settings', 'routes.update_playback_settings', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const pid = await writePid(app, user);
    const autoplay = app.req.body.autoplay_next ? 1 : 0;
    const server = String(app.req.body.default_server || 'auto').slice(0, 50);
    if (pid) await Database.execute('UPDATE user_profiles SET autoplay_next = ?, default_server = ? WHERE id = ? AND user_id = ?', [autoplay, server, pid, user.id]);
    app.flash('Playback settings saved.', 'success');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/update_profile_pin', 'routes.update_profile_pin', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    if (!(await requireProfileManagement(app, user))) return;
    const pid = Number(app.req.body.profile_id || 0) || await writePid(app, user);
    const pin = String(app.req.body.pin || '').trim();
    if (!/^\d{4}$/.test(pin)) {
      app.flash('PIN must be 4 digits. Empty save does not clear the PIN.', 'error');
      return app.redirect(app.urlFor('routes.profile'));
    }
    const hashed = await Security.generatePasswordHash(pin);
    if (pid) await Database.execute('UPDATE user_profiles SET pin = ? WHERE id = ? AND user_id = ?', [hashed, pid, user.id]);
    app.flash('PIN updated.', 'success');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/edit_profile', 'routes.edit_profile', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const username = String(app.req.body.username || '').trim();
    if (/^[A-Za-z0-9_.]{3,50}$/.test(username) && username !== user.username) {
      const exists = await Database.fetchOne('SELECT id FROM users WHERE username = ? AND id <> ?', [username, user.id]);
      if (!exists) await Database.execute('UPDATE users SET username = ? WHERE id = ?', [username, user.id]);
      else app.flash('Username is already taken.', 'error');
    }
    const current = String(app.req.body.current_password || '');
    const neu = String(app.req.body.new_password || app.req.body.password || '');
    if (neu) {
      if (!await Security.checkPasswordHash(user.password, current)) app.flash('Current password is incorrect.', 'error');
      else if (neu.length < 8 || !/[A-Za-z]/.test(neu) || !/\d/.test(neu)) app.flash('New password too weak.', 'error');
      else {
        await Database.execute('UPDATE users SET password = ?, password_changed_at = NOW() WHERE id = ?', [await Security.generatePasswordHash(neu), user.id]);
        app.flash('Password changed.', 'success');
      }
    }
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/submit_request', 'routes.submit_request', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    if (!(await app.throttle('content_request', 10, 86400))) {
      app.flash('Too many requests today.', 'error');
      return app.redirect(app.urlFor('routes.profile'));
    }
    await Database.execute('INSERT INTO user_requests (user_id, request_type, title, message) VALUES (?, ?, ?, ?)', [
      user.id, String(app.req.body.request_type || 'movie').slice(0, 50),
      String(app.req.body.title || '').slice(0, 255), String(app.req.body.message || ''),
    ]);
    app.flash('Request submitted.', 'success');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/update_preferences', 'routes.update_preferences', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const pid = await writePid(app, user);
    const body = app.req.body;
    const preferences = {language: ['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr'].includes(String(body.language)) ? String(body.language) : 'en'};
    await Database.execute('UPDATE user_profiles SET preferences = ? WHERE id = ? AND user_id = ?', [JSON.stringify(preferences), pid, user.id]);
    app.session.language = preferences.language;
    app.flash('Preferences saved.', 'success');
    return app.redirect(app.urlFor('routes.profile'));
  }, ['POST']);

  add('/delete_account', 'routes.delete_account', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    if (!await Security.checkPasswordHash(user.password, String(app.req.body.password || app.req.body.confirm_password || ''))) {
      app.flash('Password incorrect. Account was not deleted.', 'error');
      return app.redirect(app.urlFor('routes.profile'));
    }
    await Database.deleteUserCascade(Number(user.id));
    await app.logoutUser();
    app.flash('Your account has been deleted.', 'success');
    return app.redirect(app.urlFor('auth.login'));
  }, ['POST']);

  // ---- profiles / playlists / notifications / cine-match ----

  add('/profiles', 'routes.select_profile', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    await Profiles.ensureActive(app, user);
    const profiles = await Database.fetchAll('SELECT * FROM user_profiles WHERE user_id = ? ORDER BY id ASC', [user.id]);
    return app.render('profiles.html', { profiles, is_kids_mode: !!app.session.is_kids });
  });

  add('/profile/select/{profile_id}', 'routes.set_active_profile', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    const pid = Number(args.profile_id);
    const prof = await Database.fetchOne('SELECT * FROM user_profiles WHERE id = ? AND user_id = ?', [pid, user.id]);
    if (!prof) { app.flash('Profile not found.', 'error'); return app.redirect(app.urlFor('routes.select_profile')); }
    const result = await Profiles.select(app, user, prof, app.req.body.pin);
    if (!result.ok) {
      app.flash(result.error === 'adult_pin_required' ? 'Set an adult PIN before entering Kids Mode. Ask an adult to sign in again.' : 'Profile locked. Check the PIN or try again later.', 'error');
      return app.redirect('/profiles');
    }
    return app.redirect(app.urlFor('routes.home'));
  }, ['POST']);

  add('/profile/add', 'routes.add_profile', async (app) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    if (!(await requireProfileManagement(app, user))) return;
    const name = String(app.req.body.name || app.req.body.profile_name || '').trim().slice(0, 50);
    const isKids = app.req.body.is_kids ? 1 : 0;
    let color = String(app.req.body.avatar_color || 'bg-red-600');
    const allowed = ['bg-red-600', 'bg-blue-600', 'bg-green-600', 'bg-purple-600'];
    if (!allowed.includes(color)) color = 'bg-red-600';
    if (name) {
      const result = await Profiles.add(user, name, isKids, color);
      if (!result.ok) app.flash('A maximum of five profiles is allowed.', 'error');
    }
    return app.redirect(app.urlFor('routes.select_profile'));
  }, ['POST']);

  add('/profile/delete/{profile_id}', 'routes.delete_profile', async (app, args) => {
    if (!(await app.requireLogin())) return;
    const user = await app.currentUser();
    if (!(await requireProfileManagement(app, user))) return;
    const result = await Profiles.remove(app, user, Number(args.profile_id));
    if (!result.ok) app.flash('Profile could not be deleted. Keep at least one profile.', 'error');
    return app.redirect(app.urlFor('routes.select_profile'));
  }, ['POST']);

}

module.exports = { registerAccountRoutes };
