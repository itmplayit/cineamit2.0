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


// Admin user management + CSV exports (moved verbatim from routes/admin.js).
function registerAdminUsers() {
  add('/admin/export_users_csv', 'routes.admin_export_users_csv', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    const rows = await Database.fetchAll('SELECT id, username, email, role, totp_enabled, created_at FROM users ORDER BY id ASC');
    await app.securityLog('admin_users_exported', await app.currentUser(), rows.length + ' rows');
    sendCsv(app, 'cineamit-users-' + csvStamp() + '.csv',
      ['id', 'username', 'email', 'role', 'two_factor_enabled', 'created_at'],
      rows.map((r) => [Number(r.id), r.username, r.email, r.role, Number(r.totp_enabled || 0), r.created_at || '']));
  });

  add('/admin/export_requests_csv', 'routes.admin_export_requests_csv', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    const rows = await Database.fetchAll(
      `SELECT ur.id, ur.user_id, ur.request_type, ur.title, ur.message, ur.created_at, u.username
       FROM user_requests ur LEFT JOIN users u ON u.id = ur.user_id
       ORDER BY ur.id DESC LIMIT 5000`
    );
    await app.securityLog('admin_requests_exported', await app.currentUser(), rows.length + ' rows');
    sendCsv(app, 'cineamit-requests-' + csvStamp() + '.csv',
      ['id', 'user_id', 'username', 'type', 'title', 'message', 'created_at'],
      rows.map((r) => [Number(r.id), Number(r.user_id), r.username || 'Guest', r.request_type, r.title, r.message, r.created_at || '']));
  });

  add('/admin/export_security_csv', 'routes.admin_export_security_csv', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    const rows = await Database.fetchAll(
      `SELECT sl.id, sl.created_at, sl.event, sl.user_id, sl.ip, sl.details, u.username AS s_username
       FROM security_log sl LEFT JOIN users u ON u.id = sl.user_id
       ORDER BY sl.id DESC LIMIT 5000`
    );
    await app.securityLog('admin_security_log_exported', await app.currentUser(), rows.length + ' rows');
    sendCsv(app, 'cineamit-security-' + csvStamp() + '.csv',
      ['id', 'created_at', 'event', 'user_id', 'username', 'ip', 'details'],
      rows.map((r) => {
        const details = String(r.details || '').replace(/[\r\n]/g, ' ');
        return [Number(r.id), r.created_at || '', r.event, Number(r.user_id || 0), r.s_username || '-', r.ip || '-', details];
      }));
  });

  add('/admin/toggle_suspend/{id}', 'routes.admin_toggle_suspend', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    const id = Number(args.id);
    if (id === 1) { app.flash('Cannot suspend the primary owner.', 'error'); return app.redirect(app.urlFor('routes.admin_dashboard')); }
    await Database.execute('UPDATE users SET is_active = 1 - is_active WHERE id = ?', [id]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/kill_sessions/{id}', 'routes.admin_kill_sessions', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    await Database.execute('DELETE FROM active_sessions WHERE user_id = ?', [Number(args.id)]);
    app.flash('Sessions ended.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/bulk_users', 'routes.admin_bulk_users', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    let ids = app.req.body.user_ids || [];
    if (!Array.isArray(ids)) ids = [ids];
    ids = ids.map(Number).filter((n) => n > 1);
    const action = String(app.req.body.action || '');
    if (action === 'suspend') for (const id of ids) await Database.execute('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    if (action === 'delete') for (const id of ids) await Database.deleteUserCascade(id);
    app.flash('Bulk action applied.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/update_role/{user_id}', 'routes.admin_update_role', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    const role = String(app.req.body.role || 'user');
    if (['user', 'editor', 'super_admin', 'owner'].includes(role) && Number(args.user_id) !== 1) {
      await Database.execute('UPDATE users SET role = ? WHERE id = ?', [role, Number(args.user_id)]);
    }
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_request/{req_id}', 'routes.admin_delete_request', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM user_requests WHERE id = ?', [Number(args.req_id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_user/{user_id}', 'routes.admin_delete_user', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    const id = Number(args.user_id);
    if (id !== 1) await Database.deleteUserCascade(id);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

}

module.exports = { registerAdminUsers };
