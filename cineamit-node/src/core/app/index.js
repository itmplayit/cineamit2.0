'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TwigEnv = require('../twig-env');
const Config = require('../config');
const Database = require('../../db');
const SiteStatus = require('../../services/site-status');
const TMDB = require('../../services/tmdb');
const Security = require('../../security');
const OAuth = require('../../integrations/oauth');
const Seo = require('../../seo');
const { slugify, parseSiteDomains, jsonStr, isCacheableGuestPath, isBadBot, jsonClient, acceptsJson,
  csrfExemptPath, SESSION_ABSOLUTE_MAX, LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW, BAD_BOTS } = require('./helpers');

// App class (core request/response object). Throttle + render methods are mixed in from
// ./throttles.js and ./render-context.js at the bottom of this file.
class App {
  constructor(rootDir, req, res) {
    this.rootDir = rootDir;
    this.req = req;
    this.res = res;
    this.currentUserCache = undefined;
    this.userLoaded = false;
    this.suppressFlashes = false;
    this._ended = false;
    this._siteSettings = null;
  }

  get session() {
    if (!this.req.session) this.req.session = {};
    return this.req.session;
  }

  isSecure() {
    return !!this.req.secure;
  }

  clientIp() {
    const remote = String(this.req.ip || this.req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    // Express resolves req.ip only through the configured trusted proxy CIDRs.
    return remote || '0.0.0.0';
  }


  async securityLog(event, user = null, details = '') {
    try {
      let ip = this.clientIp();
      if (ip.length > 45) ip = ip.slice(0, 45);
      details = Security.stripAllHtml(String(details)).slice(0, 450);
      const userId = user ? Number(user.id) : null;
      await Database.execute('INSERT INTO security_log (event, user_id, ip, details) VALUES (?, ?, ?, ?)', [event, userId, ip, details]);
      const gcGuard = path.join(os.tmpdir(), 'cineamit_loggc_' + crypto.createHash('md5').update(__dirname).digest('hex').slice(0, 8));
      let gcLast = 0;
      try { gcLast = fs.statSync(gcGuard).mtimeMs / 1000; } catch {}
      if (gcLast === 0 || (Date.now() / 1000 - gcLast) >= 3600) {
        try { fs.writeFileSync(gcGuard, '1'); } catch {}
        await Database.execute('DELETE FROM security_log WHERE created_at < (NOW() - INTERVAL 30 DAY)');
      }
    } catch (e) {
      console.error('[security_log] ' + event + ': ' + e.message);
    }
  }

  urlFor(endpoint, params = {}) {
    if (endpoint === 'static') {
      const file = params.filename || '';
      return '/static/' + String(file).replace(/^\/+/, '');
    }
    const p = { ...params };
    const isPlaceholder = (v) => typeof v === 'string' && /^\{[a-zA-Z0-9_]+\}$/.test(v);
    for (const k of Object.keys(p)) {
      if (isPlaceholder(p[k])) delete p[k];
    }
    const slugEndpoints = ['routes.details', 'player.watch', 'routes.add_to_watchlist', 'routes.remove_from_watchlist', 'routes.remove_from_history'];
    if (slugEndpoints.includes(endpoint) && p.tmdb_id != null && p.tmdb_id !== '') {
      const title = p.title || '';
      const cleanTitle = slugify(title);
      p.slug = title !== '' ? cleanTitle + '-' + p.tmdb_id : String(p.tmdb_id);
      delete p.tmdb_id;
      delete p.title;
    } else if (endpoint === 'routes.actor' && p.person_id != null) {
      const name = p.name || '';
      const cleanName = slugify(name);
      p.slug = name !== '' ? cleanName + '-' + p.person_id : p.person_id;
      delete p.person_id;
      delete p.name;
    }
    let pattern = App.endpoints[endpoint];
    if (!pattern) return '#';
    let url = pattern;
    let external = false;
    if (p._external) { external = !!p._external; delete p._external; }
    for (const k of Object.keys(p)) {
      const re = new RegExp('\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(:[a-z]+)?\\}');
      if (re.test(url)) {
        const val = p[k];
        if (val == null || val === '' || isPlaceholder(val)) { delete p[k]; continue; }
        url = url.replace(re, encodeURIComponent(String(val)));
        delete p[k];
      }
    }
    url = url.replace(/\{[a-zA-Z0-9_]+(:[a-z]+)?\}/g, '');
    url = url.replace(/\/{2,}/g, '/');
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (new RegExp('\\{' + k + '(:[a-z]+)?\\}').test(pattern)) continue;
      qs.set(k, v);
    }
    const qstr = qs.toString();
    if (qstr) url += '?' + qstr;
    if (external) {
      const scheme = this.isSecure() ? 'https' : 'http';
      url = scheme + '://' + this.safeHost() + url;
    }
    return url;
  }

  flash(message, category = 'message') {
    if (!this.session._flashes) this.session._flashes = [];
    this.session._flashes.push({ category, message });
  }

  getFlashedMessages() {
    const msgs = this.session._flashes || [];
    this.session._flashes = [];
    return msgs;
  }

  async loginUser(user, remember = true) {
    if (Number(user.is_active ?? 1) === 0 && Number(user.id) !== 1) return false;
    this.req.session.regenerate && await new Promise((resolve) => this.req.session.regenerate(() => resolve()));
    this.session.csrf_token = crypto.randomBytes(32).toString('hex');
    this.session.csrf_token_issued_at = Math.floor(Date.now() / 1000);
    this.session.user_id = Number(user.id);
    this.session.login_at = Math.floor(Date.now() / 1000);
    delete this.session.active_profile_id;
    delete this.session.active_profile_name;
    delete this.session.active_profile_color;
    delete this.session.active_profile_uid;
    delete this.session.is_kids;
    await require('../../services/profiles').ensureActive(this, user);
    try {
      await Database.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [Number(user.id)]);
      const ip = this.clientIp();
      await Database.execute(
        'INSERT INTO active_sessions (user_id, session_id, ip) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), ip = VALUES(ip)',
        [Number(user.id), this.req.sessionID, ip.slice(0, 45)]
      );
    } catch (e) {
      console.error('[sessions] registry write failed: ' + e.message);
    }
    if (!remember && this.req.session.cookie) this.req.session.cookie.expires = false;
    this.userLoaded = false;
    this.currentUserCache = undefined;
    return true;
  }

  async logoutUser() {
    try { await Database.execute('DELETE FROM active_sessions WHERE session_id = ?', [this.req.sessionID]); } catch {}
    const keep = this.session._flashes;
    this.req.session.regenerate && await new Promise((resolve) => this.req.session.regenerate(() => resolve()));
    if (keep) this.session._flashes = keep;
    this.userLoaded = false;
    this.currentUserCache = null;
  }

  async currentUser() {
    if (this.userLoaded) return this.currentUserCache;
    this.userLoaded = true;
    const uid = this.session.user_id;
    if (!uid) { this.currentUserCache = null; return null; }
    try {
      let row = await Database.fetchOne('SELECT * FROM users WHERE id = ?', [uid]);
      if (row) {
        const loginAt = Number(this.session.login_at || 0);
        let killMsg = '';
        let killEvent = '';
        if (loginAt > 0 && (Date.now() / 1000 - loginAt) > SESSION_ABSOLUTE_MAX) {
          killMsg = 'Session expired (30 days of login). Please log in again.';
          killEvent = 'session_expired_absolute';
        } else if (loginAt > 0 && row.password_changed_at && Date.parse(row.password_changed_at) / 1000 > loginAt) {
          killMsg = 'Session ended: your password was changed. Please log in again.';
          killEvent = 'session_killed_pw_change';
        } else if (Number(row.is_active ?? 1) === 0 && Number(row.id) !== 1) {
          killMsg = 'Your account has been suspended by an administrator.';
          killEvent = 'login_suspended_killed';
        } else if (await this.sessionKilledByAdmin()) {
          killMsg = 'Your session was ended by an administrator.';
          killEvent = 'session_killed_admin';
        }
        if (killMsg) {
          try { await Database.execute('DELETE FROM active_sessions WHERE session_id = ?', [this.req.sessionID]); } catch {}
          delete this.session.user_id;
          delete this.session.login_at;
          delete this.session.active_profile_id;
          delete this.session.active_profile_name;
          delete this.session.active_profile_color;
          delete this.session.is_kids;
          this.flash(killMsg, 'message');
          await this.securityLog(killEvent, row, 'login_at=' + loginAt);
          row = null;
        }
      }
      this.currentUserCache = row;
    } catch {
      this.currentUserCache = null;
    }
    return this.currentUserCache;
  }

  async sessionKilledByAdmin() {
    if (!this.req.sessionID) return false;
    const checkedAt = Number(this.session._killed_check_at || 0);
    if (checkedAt > 0 && (Date.now() / 1000 - checkedAt) < 60) return !!this.session._killed_flag;
    try {
      const result = await this.sessionKilledByAdminUncached();
      this.session._killed_check_at = Math.floor(Date.now() / 1000);
      this.session._killed_flag = result ? 1 : 0;
      return result;
    } catch { return false; }
  }

  async sessionKilledByAdminUncached() {
    if (!this.req.sessionID) return false;
    try {
      const reg = await Database.fetchOne('SELECT id FROM active_sessions WHERE session_id = ?', [this.req.sessionID]);
      if (reg) return false;
      const mig = await Database.fetchOne("SELECT setting_value FROM site_setting WHERE setting_key = 'SESSIONS_MIGRATED_AT'");
      const migAt = Number((mig && mig.setting_value) || 0);
      const loginAt = Number(this.session.login_at || 0);
      return migAt > 0 && loginAt >= migAt;
    } catch { return false; }
  }

  async isAuthenticated() { return (await this.currentUser()) !== null; }

  async isBlacklisted(tmdbId) {
    const blocked = await this.blacklistedIds();
    return blocked.includes(Number(tmdbId));
  }

  async blacklistedIds() { return TMDB.blacklistSet(); }

  async filterBlacklisted(items) {
    if (!Array.isArray(items)) return [];
    const blocked = await this.blacklistedIds();
    const bset = new Set(blocked);
    const list=items.filter(it=>it && !bset.has(Number(it.tmdb_id || it.id)));
    if (!this.session.is_kids) return list;
    if (!this._kidsEligibility) this._kidsEligibility=new Map();
    return require('../../services/kids').filterMedia(list,arguments[1] || 'movie',this._kidsEligibility);
  }

  async cachedSiteSettings() {
    if (this._siteSettings) return this._siteSettings;
    const allowed = { V2_LINK: true, WEB_PLAYER_ENABLED: true, SITE_ADS_ENABLED: true, SITE_DOMAINS: true };
    const cacheFile = path.join(TMDB.cacheDir(), 'site_settings_v9.json');
    try {
      const st = fs.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < 60000) {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (data && typeof data === 'object') {
          this._siteSettings = {};
          for (const k of Object.keys(allowed)) if (k in data) this._siteSettings[k] = data[k];
          return this._siteSettings;
        }
      }
    } catch { /* miss */ }
    const memo = {};
    try {
      const rows = await Database.fetchAll("SELECT setting_key, setting_value FROM site_setting WHERE setting_key IN ('V2_LINK','WEB_PLAYER_ENABLED','SITE_ADS_ENABLED','SITE_DOMAINS')");
      for (const r of rows) memo[String(r.setting_key)] = String(r.setting_value);
      fs.writeFileSync(cacheFile, JSON.stringify(memo));
    } catch {}
    this._siteSettings = memo;
    return memo;
  }

  async maintenanceModeActive() {
    if (this._maintenanceState === undefined) {
      this._maintenanceState = await SiteStatus.readMaintenanceEnabled();
    }
    return this._maintenanceState;
  }

  safeHost() {
    const pattern = /^[A-Za-z0-9]([A-Za-z0-9.\-]{0,251})?(:\d{1,5})?$/;
    const configured = String(Config.OAUTH_BASE_URL || '').trim();
    if (configured) {
      try {
        const u = new URL(configured.includes('://') ? configured : 'https://' + configured);
        const cand = u.hostname + (u.port ? ':' + u.port : '');
        if (u.hostname && pattern.test(cand)) return cand;
      } catch {}
    }
    const raw = String(this.req.headers.host || '');
    if (pattern.test(raw)) return raw;
    return 'localhost';
  }

  redirect(url) {
    url = String(url);
    const hasUnsafe = url.includes('\\') || /[\x00-\x1F\x7F]/.test(url);
    const isPath = !hasUnsafe && url.startsWith('/') && !url.startsWith('//');
    const isAbsolute = !hasUnsafe && /^https?:\/\/[A-Za-z0-9.\-]+(?::\d+)?(?:\/|$)/.test(url);
    if (!isPath && !isAbsolute) url = '/';
    if (this._ended) return;
    this._ended = true;
    this.res.redirect(302, url);
  }

  json(data) {
    if (this._ended) return;
    this._ended = true;
    this.res.set('Content-Type', 'application/json');
    this.res.json(data);
  }

  ended() { return this._ended || this.res.headersSent; }

  wantsJson() {
    return App.acceptsJson(this.req);
  }

  async requireLogin() {
    if (!(await this.isAuthenticated())) {
      const pth = this.req.path || '/';
      if (pth.startsWith('/api/') || this.wantsJson()) {
        this.res.status(401);
        this.json({ ok: false, error: 'login_required', message: 'Login required.', logged_in: false });
        return false;
      }
      this.flash('Please log in to access this page.', 'error');
      this.redirect(this.urlFor('auth.login') + '?next=' + encodeURIComponent(this.req.originalUrl || '/'));
      return false;
    }
    return true;
  }

  async requireRole(roles) {
    const u = await this.currentUser();
    if (!u || !roles.includes(u.role || 'user')) {
      if (this.wantsJson()) {
        this.res.status(403);
        this.json({ ok: false, error: 'forbidden', message: 'Access denied.' });
        return false;
      }
      this.flash("Access Denied: You don't have permission to perform this action.", 'error');
      this.redirect('/');
      return false;
    }
    return true;
  }

  referrerOr(fallback) {
    const ref = String(this.req.get('referer') || '');
    if (!ref) return fallback;
    if (ref.startsWith('/') && !ref.startsWith('//')) {
      try { return new URL(ref, 'http://x').pathname || '/'; } catch { return fallback; }
    }
    try {
      const o = new URL(ref);
      const host = this.safeHost().split(':')[0].toLowerCase();
      if (o.hostname.toLowerCase() === host) return o.pathname || '/';
    } catch {}
    return fallback;
  }

  markCacheableGuestPage() {
    this.session.csrf_token = this.session.csrf_token; // no-op keep
    this.suppressFlashes = true;
  }

}

App.endpoints = {};
App.SESSION_ABSOLUTE_MAX = SESSION_ABSOLUTE_MAX;
App.LOGIN_FAIL_MAX = LOGIN_FAIL_MAX;
App.LOGIN_FAIL_WINDOW = LOGIN_FAIL_WINDOW;
App.BAD_BOTS = BAD_BOTS;
App.slugify = slugify;
App.parseSiteDomains = parseSiteDomains;
App.jsonStr = jsonStr;
App.isBadBot = isBadBot;
App.isCacheableGuestPath = isCacheableGuestPath;
App.jsonClient = jsonClient;

App.acceptsJson = acceptsJson;

App.csrfExemptPath = csrfExemptPath;
module.exports = App;

// Mixin extracted methods (verbatim moves; same this-binding as class methods).
Object.assign(App.prototype, require('./throttles'), require('./render-context'));
