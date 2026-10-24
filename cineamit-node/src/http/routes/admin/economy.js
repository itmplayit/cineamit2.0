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


// Admin economy: ads/watch-limit/wallet/app-economy (moved verbatim from routes/admin.js).
function registerAdminEconomy() {
  postAdmin('/admin/update_site_ads', 'routes.admin_update_site_ads', async (app) => {
    const on = !!app.req.body.site_ads_enabled;
    await Economy.setKey('SITE_ADS_ENABLED', on ? '1' : '0');
    bustSiteCache();
    await app.securityLog('site_ads_' + (on ? 'on' : 'off'), await app.currentUser());
    app.flash(on ? 'Website ads ON.' : 'Website ads OFF.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, owners);

  postAdmin('/admin/preview_app_economy', 'routes.admin_preview_app_economy', async app => {
    app.res.set('Cache-Control', 'no-store');
    if (!(await app.throttle('app_ads_preview', 120, 3600))) {
      app.res.status(429); return app.json({ok: false, error: 'preview_limited'});
    }
    try { return app.json({ok: true, preview: await Economy.previewAppSettings(app.req.body || {})}); }
    catch (error) {
      console.error('[AdsOps] Preview unavailable: ' + error.message);
      const conflict = error.code === 'APP_SETTINGS_CONFLICT';
      app.res.status(conflict ? 409 : 400); return app.json({ok: false, error: conflict ? 'settings_conflict' : 'preview_unavailable', message: conflict ? 'Settings changed. Reload the admin page and review current values. Nothing was saved.' : 'Check the proposed values and database availability. No settings were saved.'});
    }
  }, owners);

  add('/admin/app_ads/export/{kind}', 'routes.admin_app_ads_export', async (app, args) => {
    if (!(await requireStaff(app, owners))) return;
    app.res.set({'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff'});
    if (!['rewards', 'history'].includes(args.kind)) { app.res.status(404); return app.json({ok: false, error: 'unknown_export'}); }
    const user = await app.currentUser();
    try {
      if (!(await Database.consumeRate('app_ads_export_' + user.id, 20, 3600)).allowed) {
        app.res.status(429); return app.json({ok: false, error: 'export_limited'});
      }
    } catch (error) {
      console.error('[AdsOps] Export limiter unavailable: ' + error.message);
      app.res.status(503); return app.json({ok: false, error: 'export_unavailable'});
    }
    try { AdsOps.normalizeFilters(app.req.query); }
    catch { app.res.status(400); return app.json({ok: false, error: 'invalid_export_filters'}); }
    try {
      const file = await AdsOps.exportCsv(args.kind, app.req.query);
      app.res.set({'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + file.filename + '"',
        'X-Export-Source-Rows': String(file.source_rows), 'X-Export-Truncated': String(file.truncated)});
      return app.res.send(file.body);
    } catch (error) {
      console.error('[AdsOps] Export unavailable: ' + error.message);
      app.res.status(503); return app.json({ok: false, error: 'export_unavailable'});
    }
  });

  postAdmin('/admin/update_app_economy', 'routes.admin_update_app_economy', async (app) => {
    try {
      await Economy.saveAppSettings(app.req.body || {}, await app.currentUser());
      app.flash('App ads settings saved with change history. They apply on the next app bootstrap.', 'success');
    } catch (error) {
      console.error('[AdsOps] Settings save failed: ' + error.message);
      app.flash(error.code === 'APP_SETTINGS_CONFLICT' ? 'Settings changed in another tab or by another admin. Nothing was overwritten. Reload and review current values before saving again.' : 'Could not save app settings. Check values and database availability; no successful update was confirmed.', 'error');
    }
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
  }, owners);

  postAdmin('/admin/reset_app_economy', 'routes.admin_reset_app_economy', async (app) => {
    if (app.req.body.confirm_reset !== 'RESTORE') {
      app.flash('Restore cancelled: confirmation is required.', 'error');
      return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
    }
    try {
      await Economy.saveAppSettings(app.req.body || {}, await app.currentUser(), true);
      app.flash('Default app ads settings restored and recorded. Balances, website ads and server access are unchanged.', 'success');
    } catch (error) {
      console.error('[AdsOps] Restore failed: ' + error.message);
      app.flash(error.code === 'APP_SETTINGS_CONFLICT' ? 'Restore cancelled: settings changed in another tab or by another admin. Reload and review the current settings.' : 'Could not restore defaults. Please retry after checking database availability.', 'error');
    }
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
  }, owners);

  postAdmin('/admin/update_watch_limit', 'routes.admin_update_watch_limit', async (app) => {
    try {
      const cfg = await WatchLimit.saveSettings(app.req.body || {});
      await app.securityLog('watch_limit_saved', await app.currentUser(), 'model=daily_unlock_v2 on='+cfg.enabled+' daily='+cfg.daily_max+' guests='+cfg.guests);
      app.flash('Daily unlock settings saved. '+(cfg.enabled ? (cfg.daily_max ? cfg.daily_max+'/IST day. ' : 'Unlimited. ') : 'Limit OFF. ')+(cfg.guests ? 'Guest soft quota ON.' : 'Guests unlimited.'),'success');
    } catch (error) {
      app.flash(error.code==='WATCH_SETTINGS_CONFLICT' ? error.message : error.code==='WATCH_SETTINGS_INVALID' ? 'Invalid daily unlock settings. Check values; nothing was saved.' : 'Could not save watch settings. Check database availability and retry.','error');
    }
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
  }, owners);

  postAdmin('/admin/reset_watch_limit', 'routes.admin_reset_watch_limit', async (app) => {
    try {
      await WatchLimit.resetAll();
      await app.securityLog('watch_limit_reset', await app.currentUser());
      app.flash('Website unlock counters reset.','success');
    } catch { app.flash('Could not reset watch counters. Check database availability and retry.','error'); }
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
  }, owners);

  postAdmin('/admin/wallet_points', 'routes.admin_wallet_points', async (app) => {
    const uid = Number(app.req.body.user_id || 0);
    if (uid <= 0) { app.flash('User missing.', 'error'); return app.redirect(app.urlFor('routes.admin_dashboard')); }
    const mode = String(app.req.body.mode || 'grant');
    const amount = Number(app.req.body.amount || 0);
    if (!['set', 'grant'].includes(mode) || !Number.isSafeInteger(amount) || (mode === 'set' ? amount < 0 || amount > 10000000 : Math.abs(amount) > 1000000)) {
      app.flash('Invalid points adjustment. Use an integer: Set 0–10000000 or Grant -1000000–1000000.', 'error');
      return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
    }
    try {
      if (mode === 'set') await Economy.setPoints(uid, amount);
      else await Economy.grantPoints(uid, amount);
    } catch (error) {
      if (error.code !== 'WALLET_RANGE') throw error;
      app.flash('Points were not changed: the resulting balance must be between 0 and 10000000. Use an explicit Set value instead.', 'error');
      return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
    }
    await app.securityLog('wallet_points', await app.currentUser(), 'uid=' + uid + ' mode=' + mode + ' n=' + amount);
    app.flash('Points updated for user #' + uid + '.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
  }, owners);

  postAdmin('/admin/wallet_plan', 'routes.admin_wallet_plan', async (app) => {
    const uid = Number(app.req.body.user_id || 0);
    if (uid <= 0) { app.flash('User missing.', 'error'); return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy'); }
    const plan = String(app.req.body.plan || 'free');
    const days = Number(app.req.body.days || 0);
    if (plan === 'free') await Economy.cancelPlan(uid);
    else if (plan === 'reset_trial') await Economy.resetTrial(uid);
    else await Economy.grantPlan(uid, plan, days);
    await app.securityLog('wallet_plan', await app.currentUser(), 'uid=' + uid + ' plan=' + plan + ' d=' + days);
    app.flash('Plan updated for user #' + uid + '.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-economy');
  }, owners);

}

module.exports = { registerAdminEconomy };
