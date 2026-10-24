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


// Admin content: announcements/blog/help/downloads/APK (moved verbatim from routes/admin.js).
function registerAdminContent() {
  add('/admin/add_download', 'routes.admin_add_download', async (app) => {
    if (!(await requireStaff(app))) return;
    const url = validateDownloadPattern(app.req.body.pattern_url || app.req.body.dl_pattern || app.req.body.url);
    const name = String(app.req.body.name || app.req.body.dl_name || 'Download').slice(0, 100);
    if (url) await Database.execute('INSERT INTO download_setting (name, pattern_url, media_type_filter) VALUES (?, ?, ?)', [name, url, String(app.req.body.media_type_filter || 'all')]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_download/{id}', 'routes.admin_delete_download', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM download_setting WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/toggle_download/{id}', 'routes.admin_toggle_download', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('UPDATE download_setting SET is_active = 1 - is_active WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/send_notification', 'routes.admin_send_notif', async (app) => {
    if (!(await requireStaff(app))) return;
    const title = String(app.req.body.title || '').slice(0, 100);
    const message = String(app.req.body.message || '');
    const users = await Database.fetchAll('SELECT id FROM users');
    for (const u of users) await Database.execute('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)', [u.id, title, message]);
    app.flash('Notification sent.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/announcement/add', 'routes.admin_announcement_add', async (app) => {
    if (!(await requireStaff(app))) return;
    const user = await app.currentUser();
    await Database.execute('INSERT INTO announcements (title, message, display_type, is_active, created_by) VALUES (?, ?, ?, 1, ?)', [
      String(app.req.body.title || '').slice(0, 150), String(app.req.body.message || ''), String(app.req.body.display_type || 'banner'), user.id,
    ]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/announcement/toggle/{id}', 'routes.admin_announcement_toggle', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('UPDATE announcements SET is_active = 1 - is_active WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/announcement/delete/{id}', 'routes.admin_announcement_delete', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM announcements WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/add_blog', 'routes.admin_add_blog', async (app) => {
    if (!(await requireStaff(app))) return;
    const title = String(app.req.body.title || '').slice(0, 255);
    const slug = String(app.req.body.slug || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await Database.execute('INSERT INTO blog_posts (title, slug, image_url, content, meta_description) VALUES (?, ?, ?, ?, ?)', [
      title, slug, String(app.req.body.image_url || ''), String(app.req.body.content || ''), String(app.req.body.meta_description || ''),
    ]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_blog/{id}', 'routes.admin_delete_blog', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM blog_posts WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/add_help_article', 'routes.admin_add_help_article', async (app) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('INSERT INTO help_articles (topic, title, slug, content) VALUES (?, ?, ?, ?)', [
      String(app.req.body.topic || 'general').slice(0, 50), String(app.req.body.title || ''), String(app.req.body.slug || ''), String(app.req.body.content || ''),
    ]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/delete_help_article/{id}', 'routes.admin_delete_help_article', async (app, args) => {
    if (!(await requireStaff(app))) return;
    await Database.execute('DELETE FROM help_articles WHERE id = ?', [Number(args.id)]);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  postAdmin('/admin/update_app_download', 'routes.admin_update_app_download', async (app) => {
    const meta = await AndroidApp.saveSettings(app.req.body || {});
    await app.securityLog('app_download_saved', await app.currentUser(),
      'on=' + meta.enabled + ' v=' + meta.version + ' file=' + meta.has_file);
    app.flash('Android app download settings saved.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
  }, owners);

  add('/admin/upload_apk', 'routes.admin_upload_apk', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    try {
      const meta = await AndroidApp.saveUploadedApk(app.req);
      await app.securityLog('app_apk_uploaded', await app.currentUser(),
        'v=' + meta.version + ' size=' + meta.size);
      app.flash('APK uploaded (' + meta.size_label + '). Download is live at /app.', 'success');
    } catch (e) {
      const code = String(e && e.code || e && e.message || '');
      if (code === 'too_large') app.flash('APK must be under 90 MB.', 'error');
      else if (code === 'not_apk' || code === 'no_file') app.flash('Upload a valid .apk file only.', 'error');
      else app.flash('APK upload failed. Try the multipart form again.', 'error');
    }
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
  }, ['POST']);

}

module.exports = { registerAdminContent };
