'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Config = require('../../../core/config');
const Database = require('../../../db');
const SiteStatus = require('../../../services/site-status');
const Security = require('../../../security');
const TMDB = require('../../../services/tmdb');
const { add } = require('../../../core/router');
const live = require('../../../services/live');
const Economy = require('../../../services/economy');
const AdsOps = require('../../../services/ads-ops');
const AndroidApp = require('../../../android-app');
const WatchLimit = require('../../../services/watch-limit');
const App = require('../../../core/app');
const Profiles = require('../../../services/profiles');
const Playlists = require('../../../services/playlists');
const MediaLibrary = require('../../../services/media-library');
const { csvSafe, csvStamp, sendCsv, requireStaff, validateServerPattern, validateDownloadPattern,
  parseXtreamServer, xtreamClearCache, tmdbIdFromSlug, dedupeMediaRows, pageNum } = require('../home-bundle');
const { staff, owners, postAdmin, updateSiteStatus, bustSiteCache } = require('./helpers');


// Admin live sources: servers/xtream/proxy/m3u/blacklist (moved verbatim from routes/admin.js).
function registerAdminSources() {
  add('/admin/add_server', 'routes.admin_add_server', async (app) => {
    if (!(await requireStaff(app))) return;
    const name = String(app.req.body.name || app.req.body.server_name || '').slice(0, 100);
    const movieP = validateServerPattern(app.req.body.movie_pattern);
    const tvP = validateServerPattern(app.req.body.tv_pattern);
    if (name && movieP && tvP) await Database.execute('INSERT INTO server_model (name, movie_pattern, tv_pattern) VALUES (?, ?, ?)', [name, movieP, tvP]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/edit_server/{id}', 'routes.admin_edit_server', async (app, args) => {
    if (!(await requireStaff(app))) return;
    const name = String(app.req.body.name || app.req.body.server_name || '').slice(0, 100);
    const movieP = validateServerPattern(app.req.body.movie_pattern);
    const tvP = validateServerPattern(app.req.body.tv_pattern);
    if (name && movieP && tvP) await Database.execute('UPDATE server_model SET name = ?, movie_pattern = ?, tv_pattern = ? WHERE id = ?', [name, movieP, tvP, Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_server/{id}', 'routes.admin_delete_server', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM server_model WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/toggle_server/{id}', 'routes.admin_toggle_server', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('UPDATE server_model SET is_active = 1 - is_active WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/reorder_server/{id}/{dir}', 'routes.admin_reorder_server', async (app, args) => {
    if (!(await requireStaff(app))) return;
    const delta = args.dir === 'up' ? -1 : 1;
    await Database.execute('UPDATE server_model SET sort_order = sort_order + ? WHERE id = ?', [delta, Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/test_server/{id}', 'routes.admin_test_server', async (app, args) => {
    if (!(await requireStaff(app))) return;
    const srv = await Database.fetchOne('SELECT * FROM server_model WHERE id = ?', [Number(args.id)]);
    app.flash(srv ? ('Server pattern: ' + srv.movie_pattern) : 'Not found', 'message');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/update_m3u', 'routes.admin_update_m3u', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    await Database.execute("INSERT INTO site_setting (setting_key, setting_value) VALUES ('M3U_PLAYLISTS', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [String(app.req.body.m3u || '')]);
    live.resetStalkerCache();
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/clear_livetv_cache', 'routes.admin_clear_livetv_cache', async (app) => {
    if (!(await requireStaff(app))) return;
    xtreamClearCache(0);
    app.flash('Live TV cache cleared.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/add_xtream', 'routes.admin_add_xtream', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    let host = String(app.req.body.host || '').trim();
    if (!/^https:\/\//i.test(host)) { app.flash('Xtream host must be HTTPS.', 'error'); return app.redirect(app.urlFor('routes.admin_dashboard')); }
    const name = String(app.req.body.name || 'Xtream').slice(0, 100);
    const username = Security.encryptXtreamCredential(String(app.req.body.username || ''), 'username');
    const password = Security.encryptXtreamCredential(String(app.req.body.password || app.req.body.confirm_password || ''), 'password');
    await Database.execute('INSERT INTO xtream_servers (name, host, username, password) VALUES (?, ?, ?, ?)', [name, host, username, password]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_xtream/{id}', 'routes.admin_delete_xtream', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    await Database.execute('DELETE FROM xtream_servers WHERE id = ?', [Number(args.id)]);
    xtreamClearCache(Number(args.id));
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/toggle_xtream/{id}', 'routes.admin_toggle_xtream', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('UPDATE xtream_servers SET is_active = 1 - is_active WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/reorder_xtream/{id}/{dir}', 'routes.admin_reorder_xtream', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('UPDATE xtream_servers SET sort_order = sort_order + ? WHERE id = ?', [args.dir === 'up' ? -1 : 1, Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/test_xtream/{id}', 'routes.admin_test_xtream', async (app, args) => {
    if (!(await requireStaff(app))) return;
    const xs = await Database.fetchOne('SELECT * FROM xtream_servers WHERE id = ?', [Number(args.id)]);
    if (!xs) { app.flash('Not found', 'error'); return app.redirect(app.urlFor('routes.admin_dashboard')); }
    const [chs] = await parseXtreamServer(xs.id, xs.host, xs.username, xs.password);
    app.flash('Xtream test: ' + chs.length + ' channels.', 'message');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/add_proxy', 'routes.add_proxy', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    const pUrl = String(app.req.body.url || '').trim();
    if (pUrl.startsWith('https://')) await Database.execute('INSERT INTO proxies (url) VALUES (?)', [pUrl.slice(0, 255)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_proxy/{id}', 'routes.delete_proxy', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    await Database.execute('DELETE FROM proxies WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/add_blacklist', 'routes.admin_add_blacklist', async (app) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('INSERT IGNORE INTO content_blacklist (tmdb_id, title, reason) VALUES (?, ?, ?)', [Number(app.req.body.tmdb_id), String(app.req.body.title || ''), String(app.req.body.reason || '')]);
    TMDB.reloadBlacklist();
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_blacklist/{id}', 'routes.admin_delete_blacklist', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM content_blacklist WHERE id = ?', [Number(args.id)]);
    TMDB.reloadBlacklist();
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

}

module.exports = { registerAdminSources };
