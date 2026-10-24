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


// Admin dashboard, site settings, backups, maintenance (moved verbatim from routes/admin.js).
function registerAdminDashboard() {
  add('/cineamit-admin', 'routes.admin_dashboard', async (app) => {
    if (!(await requireStaff(app, staff))) return;
    const qAll = async (sql, params = []) => {
      try { return await Database.fetchAll(sql, params); } catch { return []; }
    };
    const qOne = async (sql, params = []) => {
      try { return await Database.fetchOne(sql, params); } catch { return null; }
    };
    const num = (row, key = 'c') => Number((row && row[key]) || 0);

    const roleFilter = String(app.req.query.role_filter || 'all');
    const reqSearch = String(app.req.query.req_search || '');
    const secSearch = String(app.req.query.sec_search || '');

    let users = await qAll(`SELECT u.id, u.username, u.email, u.role, u.is_active, u.last_login, u.created_at, u.totp_enabled,
      COALESCE(w.points, 0) AS points, COALESCE(w.plan, 'free') AS sub_plan, COALESCE(w.plan_until, 0) AS sub_until, COALESCE(w.trial_used, 0) AS trial_used
      FROM users u LEFT JOIN user_wallet w ON w.user_id = u.id
      ORDER BY u.id DESC LIMIT 500`);
    if (!users.length) users = await qAll('SELECT id, username, email, role, is_active, last_login, created_at, totp_enabled FROM users ORDER BY id DESC LIMIT 500');
    if (!users.length) users = await qAll('SELECT id, username, email, role, created_at FROM users ORDER BY id DESC LIMIT 500');
    const allUsers = users.slice();
    if (roleFilter !== 'all') users = users.filter((u) => String(u.role) === roleFilter);

    let requests = await qAll('SELECT r.*, u.username AS req_username FROM user_requests r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 200');
    if (reqSearch) {
      const needle = reqSearch.toLowerCase();
      requests = requests.filter((r) => [r.title, r.message, r.req_username, r.request_type].some((v) => String(v || '').toLowerCase().includes(needle)));
    }

    const servers = await qAll('SELECT * FROM server_model ORDER BY sort_order ASC, id ASC');
    const downloads = await qAll('SELECT * FROM download_setting ORDER BY id ASC');
    const xtreams = await qAll('SELECT id, name, host, is_active, sort_order FROM xtream_servers ORDER BY sort_order ASC, id ASC');
    const proxies = await qAll('SELECT * FROM proxies');
    const blacklist = await qAll('SELECT * FROM content_blacklist ORDER BY id DESC LIMIT 100');
    let logs = await qAll('SELECT s.*, u.username AS s_username FROM security_log s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 200');
    if (!logs.length) logs = await qAll('SELECT * FROM security_log ORDER BY id DESC LIMIT 200');
    if (secSearch) {
      const needle = secSearch.toLowerCase();
      logs = logs.filter((ev) => [ev.event, ev.ip, ev.s_username, ev.details, ev.user_id].some((v) => String(v || '').toLowerCase().includes(needle)));
    }
    const blogs = await qAll('SELECT id, title, slug, created_at FROM blog_posts ORDER BY id DESC LIMIT 50');
    const help = await qAll('SELECT id, topic, title, slug FROM help_articles ORDER BY id DESC');
    const announcements = await qAll('SELECT * FROM announcements ORDER BY id DESC LIMIT 20');

    let settings = {};
    let siteStatusAvailable = true;
    let registrationEnabled = null;
    let maintenanceMode = null;
    try {
      const rows = await Database.fetchAll('SELECT setting_key, setting_value FROM site_setting');
      for (const r of rows) settings[r.setting_key] = r.setting_value;
      registrationEnabled = SiteStatus.settingFlag(settings.REGISTRATION_ENABLED, true);
      maintenanceMode = SiteStatus.settingFlag(settings.MAINTENANCE_MODE, false);
    } catch (error) {
      siteStatusAvailable = false;
      registrationEnabled = null;
      maintenanceMode = null;
      console.error('[Admin:site-status] Could not read site status: ' + error.message);
    }

    const totalUsersCount = num(await qOne('SELECT COUNT(*) AS c FROM users')) || allUsers.length;
    const totpUsers = num(await qOne('SELECT COUNT(*) AS c FROM users WHERE totp_enabled = 1'));
    const totpPct = totalUsersCount ? Math.round((totpUsers * 100) / totalUsersCount) : 0;
    const newUsers7d = num(await qOne("SELECT COUNT(*) AS c FROM users WHERE created_at >= (NOW() - INTERVAL 7 DAY)"));
    const requests7d = num(await qOne("SELECT COUNT(*) AS c FROM user_requests WHERE created_at >= (NOW() - INTERVAL 7 DAY)"));
    const totalHistory = num(await qOne('SELECT COUNT(*) AS c FROM watch_history'));
    const activeServersCount = servers.filter((s) => s.is_active == null || Number(s.is_active) !== 0).length;
    const topContent = await qAll('SELECT title, COUNT(*) AS views FROM watch_history WHERE title IS NOT NULL AND title != "" GROUP BY tmdb_id, media_type, title ORDER BY views DESC LIMIT 5');

    const heatMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    let heatMax = 0;
    const heatPeak = { c: 0, dw: 0, hr: 0 };
    const heatRows = await qAll("SELECT ((DAYOFWEEK(watch_time) + 5) % 7) AS dw, HOUR(watch_time) AS hr, COUNT(*) AS c FROM watch_history WHERE watch_time >= (NOW() - INTERVAL 28 DAY) GROUP BY dw, hr");
    for (const r of heatRows) {
      const dw = Number(r.dw) || 0;
      const hr = Number(r.hr) || 0;
      const c = Number(r.c) || 0;
      if (dw >= 0 && dw < 7 && hr >= 0 && hr < 24) {
        heatMatrix[dw][hr] = c;
        if (c > heatMax) heatMax = c;
        if (c > heatPeak.c) { heatPeak.c = c; heatPeak.dw = dw; heatPeak.hr = hr; }
      }
    }

    const insightsProfiles = num(await qOne('SELECT COUNT(*) AS c FROM user_profiles'));
    const insightsKids = num(await qOne('SELECT COUNT(*) AS c FROM user_profiles WHERE is_kids = 1'));
    const insightsBingers = await qAll("SELECT u.username, COUNT(*) AS views FROM watch_history h JOIN users u ON u.id = h.user_id WHERE h.watch_time >= (NOW() - INTERVAL 30 DAY) GROUP BY h.user_id, u.username ORDER BY views DESC LIMIT 8");
    const insightsDormant = await qAll("SELECT username, last_login FROM users WHERE last_login IS NULL OR last_login < (NOW() - INTERVAL 30 DAY) ORDER BY last_login IS NULL DESC, last_login ASC LIMIT 12");

    const announcementsList = [];
    for (const a of announcements) {
      const reads = num(await qOne('SELECT COUNT(*) AS c FROM announcement_reads WHERE announcement_id = ?', [a.id]));
      announcementsList.push({ ...a, reads });
    }

    const user = await app.currentUser();
    const canManageSources = ['owner', 'super_admin'].includes(String((user && user.role) || ''));
    const currentM3u = String(settings.M3U_PLAYLISTS || Config.M3U_PLAYLIST_LIST && Config.M3U_PLAYLIST_LIST.join(',') || '');
    const currentStalkerPortal = String(settings.STALKER_PORTAL_URL || Config.STALKER_PORTAL_URL || '');
    const currentStalkerMac = String(settings.STALKER_MAC || Config.STALKER_MAC || '');

    let appEconomy = {
      ads_enabled: true, ads_banner: true, ads_interstitial: true, ads_rewarded: true,
      ad_points: 50, cost_monthly: 500, cost_yearly: 4500, settings_available: false,
    };
    try { appEconomy = await Economy.adminConfig(); } catch (error) { console.error('[AdsOps] Settings snapshot unavailable: ' + error.message); }
    const siteAdsRaw = String(settings.SITE_ADS_ENABLED || '').trim().toLowerCase();
    let siteAdsOn = !!Config.ADS_ENABLED;
    if (siteAdsRaw === '0' || siteAdsRaw === 'false' || siteAdsRaw === 'off') siteAdsOn = false;
    else if (siteAdsRaw === '1' || siteAdsRaw === 'true' || siteAdsRaw === 'on') siteAdsOn = true;

    const adSettings = {
      ads_enabled: siteAdsOn,
      hilltopads_vast_url: String(Config.HILLTOPADS_VAST_URL || ''),
      vast_fallback_url: String(Config.VAST_FALLBACK_URL || ''),
      adsterra: [
        { name: 'Social Bar', value: String(Config.ADSTERRA_SOCIAL_BAR || '') },
        { name: 'Popunder', value: String(Config.ADSTERRA_POPUNDER || '') },
        { name: 'Banner 728', value: String(Config.ADSTERRA_BANNER_728 || '') },
        { name: 'Banner 300', value: String(Config.ADSTERRA_BANNER_300 || '') },
        { name: 'Banner 320', value: String(Config.ADSTERRA_BANNER_320 || '') },
        { name: 'Native', value: String(Config.ADSTERRA_NATIVE_BANNER || '') },
      ].filter((p) => p.value),
    };

    return app.render('admin.html', {
      users,
      all_users: allUsers,
      requests,
      servers,
      database_servers: servers,
      downloads,
      download_links: downloads,
      xtreams,
      xtream_servers: xtreams,
      proxies,
      blacklist,
      logs,
      security_log: logs,
      blogs,
      help_articles: help,
      announcements,
      announcements_list: announcementsList,
      settings,
      site_status_available: siteStatusAvailable,
      registration_enabled: registrationEnabled,
      maintenance_mode: maintenanceMode,
      role_filter: roleFilter,
      req_search: reqSearch,
      sec_search: secSearch,
      total_users_count: totalUsersCount,
      total_users_for_ann: totalUsersCount,
      totp_users: totpUsers,
      totp_pct: totpPct,
      new_users_7d: newUsers7d,
      requests_7d: requests7d,
      total_history: totalHistory,
      active_servers_count: activeServersCount,
      top_content: topContent,
      heat_matrix: heatMatrix,
      heat_max: heatMax,
      heat_peak: heatPeak,
      insights_profiles: insightsProfiles,
      insights_kids: insightsKids,
      insights_dormant_count: insightsDormant.length,
      insights_bingers: insightsBingers,
      insights_dormant: insightsDormant,
      error_total: 0,
      error_max: 1,
      error_days: [],
      error_recent: [],
      ad_settings: adSettings,
      app_economy: appEconomy,
      ads_ops: canManageSources ? await AdsOps.dashboard(app.req.query).catch(error => {
        console.error('[AdsOps] Dashboard unavailable: ' + error.message);
        return {available: false, filter_error: error.code === 'ADS_FILTER'};
      }) : null,
      watch_limit: await WatchLimit.publicConfig().catch(() => ({available:false,enabled:true,revision:''})),
      android_app: await AndroidApp.publicMeta().catch(() => ({ enabled: true, ready: false, version: '1.0.66', notes: '', download_url: '', has_file: false, size_label: '', sha256: '' })),
      site_ads_enabled: siteAdsOn,
      can_manage_sources: canManageSources,
      current_m3u: currentM3u,
      current_stalker_portal: currentStalkerPortal,
      current_stalker_mac: currentStalkerMac,
      m3u_default_portal: String(Config.STALKER_PORTAL_URL || ''),
      m3u_default_mac: String(Config.STALKER_MAC || ''),
      v2_link: '',
      site_domains_text: String(settings.SITE_DOMAINS || ''),
    });
  });

  postAdmin('/admin/clear_security_log', 'routes.admin_clear_security_log', async (app) => {
    await Database.execute('DELETE FROM security_log');
    await app.securityLog('security_log_cleared', await app.currentUser());
    app.flash('Security log cleared.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, owners);

  add('/admin/update_maintenance', 'routes.admin_update_maintenance', async (app) => {
    return updateSiteStatus(app, 'MAINTENANCE_MODE', 'maintenance_mode', 'Maintenance mode');
  }, ['POST']);

  add('/admin/update_registration', 'routes.admin_update_registration', async (app) => {
    return updateSiteStatus(app, 'REGISTRATION_ENABLED', 'registration_enabled', 'New registration');
  }, ['POST']);

  add('/admin/update_v2_link', 'routes.update_v2_link', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
  }, ['POST']);

  add('/admin/update_domains', 'routes.update_domains', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    const list = App.parseSiteDomains(String(app.req.body.domains || '').slice(0, 4000));
    const stored = list.map((d) => d.href).join('\n');
    await Database.execute(
      "INSERT INTO site_setting (setting_key, setting_value) VALUES ('SITE_DOMAINS', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [stored]
    );
    app.flash(list.length ? (list.length + ' domain saved') : 'Domain list cleared', 'message');
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
  }, ['POST']);

  add('/admin/update_web_player', 'routes.admin_update_web_player', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    await Database.execute("INSERT INTO site_setting (setting_key, setting_value) VALUES ('WEB_PLAYER_ENABLED', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [app.req.body.enabled ? 'true' : 'false']);
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/clear_cache', 'routes.admin_clear_cache', async (app) => {
    if (!(await requireStaff(app))) return;
    try {
      const dir = TMDB.cacheDir();
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
    } catch {}
    app.flash('Cache cleared.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/backup', 'routes.admin_backup', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    app.flash('Use mysqldump on the server for a full backup. JSON export is under Export Backup.', 'message');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

  add('/admin/export_backup', 'routes.admin_export_backup', async (app) => {
    if (!(await requireStaff(app, owners))) return;
    const tables = ['users', 'server_model', 'download_setting', 'site_setting', 'xtream_servers', 'content_blacklist'];
    const dump = {};
    const userKeep = ['id', 'username', 'email', 'role', 'is_active', 'totp_enabled', 'created_at', 'last_login'];
    for (const t of tables) {
      try {
        let rows = await Database.fetchAll('SELECT * FROM ' + t);
        if (t === 'users') {
          rows = rows.map((r) => {
            const out = {};
            for (const k of userKeep) out[k] = r[k];
            return out;
          });
        } else if (t === 'xtream_servers') {
          rows = rows.map((r) => {
            const copy = { ...r };
            delete copy.username;
            delete copy.password;
            delete copy.user;
            delete copy.pass;
            return copy;
          });
        }
        dump[t] = rows;
      } catch { dump[t] = []; }
    }
    app.res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="cineamit-backup.json"' });
    app.res.send(JSON.stringify(dump, null, 2));
    app._ended = true;
  }, ['POST']);

  add('/api/admin/pulse', 'routes.api_admin_pulse', async (app) => {
    if (!(await requireStaff(app))) return;
    let online = 0;
    let people = [];
    try {
      const row = await Database.fetchOne("SELECT COUNT(*) AS c FROM live_presence WHERE last_seen > (NOW() - INTERVAL 2 MINUTE)");
      online = Number((row && row.c) || 0);
      people = await Database.fetchAll("SELECT username, profile_name, content_title, current_page, last_seen FROM live_presence WHERE last_seen > (NOW() - INTERVAL 2 MINUTE) ORDER BY last_seen DESC LIMIT 40");
    } catch {}
    return app.json({ ok: true, online, people });
  });

  add('/admin/sources/health-check', 'routes.admin_sources_health_check', async (app) => {
    if (!(await requireStaff(app))) return;
    app.flash('Health check complete.', 'success');
    return app.redirect(app.urlFor('routes.admin_dashboard'));
  }, ['POST']);

}

module.exports = { registerAdminDashboard };
