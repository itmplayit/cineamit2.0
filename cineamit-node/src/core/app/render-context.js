'use strict';

const TwigEnv = require('../twig-env');
const Config = require('../config');
const Database = require('../../db');
const Security = require('../../security');
const OAuth = require('../../integrations/oauth');
const Seo = require('../../seo');
const TMDB = require('../../services/tmdb');
const { parseSiteDomains, renderTwig, isCacheableGuestPath } = require('./helpers');

// render()/renderNotFound()/renderMaintenance() methods (moved verbatim from core/app.js;
// mixed into App.prototype). Only change: App.isCacheableGuestPath -> imported isCacheableGuestPath.
module.exports = {
  async render(template, context = {}) {
    const user = await this.currentUser();
    if (user) {
      try {
        if (!(await require('../../services/profiles').ensureActive(this,user))) throw new Error('Profile unavailable');
      } catch {
        this.res.status(503).set('Cache-Control','no-store').type('text').send('Profile status is temporarily unavailable. Please retry.');
        this._ended=true;return;
      }
    }
    let userPlaylists = [];
    let unreadNotifs = 0;
    let v2Link = '';
    let siteDomains = [];
    let webPlayerEnabled = 'true';
    const siteSet = await this.cachedSiteSettings();
    let siteAdsOn = Config.ADS_ENABLED;
    const siteAdsRaw = String(siteSet.SITE_ADS_ENABLED || '').trim().toLowerCase();
    if (siteAdsRaw === '0' || siteAdsRaw === 'false' || siteAdsRaw === 'off') siteAdsOn = false;
    else if (siteAdsRaw === '1' || siteAdsRaw === 'true' || siteAdsRaw === 'on') siteAdsOn = true;
    let adsEnabled = siteAdsOn && !this.session.is_kids;
    const validateVastUrl = (raw) => {
      let url = String(raw || '').trim();
      if (url.startsWith('//')) url = 'https:' + url;
      if (!url || url.length > 2048 || url.includes('<') || /\.js(\?|$)/i.test(url)) return '';
      try {
        const parts = new URL(url);
        if (parts.protocol !== 'https:' || !parts.hostname || parts.username || parts.password) return '';
        return url;
      } catch { return ''; }
    };
    const hilltopAdsVastUrl = validateVastUrl(Config.HILLTOPADS_VAST_URL);
    const vastFallbackUrl = validateVastUrl(Config.VAST_FALLBACK_URL);
    let activeProfileId = Number(this.session.active_profile_id || 0);
    let themeColor = 'red';
    let profileAvatar = null;
    let bingeStreak = 0;
    let announcement = null;
    if (!this.res.headersSent) {
      this.res.set('Vary', 'Cookie');
      if (user) this.res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    }
    try {
      if (user) {
        const uid = Number(user.id);
        const scope=await require('../../services/playlists').scope(this,user);
        userPlaylists = await Database.fetchAll('SELECT * FROM playlist WHERE '+scope.clause,scope.params);
        const row = await Database.fetchOne('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [uid]);
        unreadNotifs = Number((row && row.c) || 0);
        let prof = null;
        if (activeProfileId > 0) {
          prof = await Database.fetchOne(
            'SELECT id, user_id, name, avatar_color, is_kids, theme_color, avatar_image, binge_streak FROM user_profiles WHERE id = ? AND user_id = ?',
            [activeProfileId, uid]
          );
        }
        if (!prof) {
          prof = await Database.fetchOne(
            'SELECT id, user_id, name, avatar_color, is_kids, theme_color, avatar_image, binge_streak FROM user_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1',
            [uid]
          );
        }
        if (prof) {
          activeProfileId = Number(prof.id);
          let profName = String(prof.name || '').trim();
          if (profName === '' || (profName.toLowerCase() === 'itmplayit' && String(user.username).toLowerCase() !== 'itmplayit')) {
            profName = String(user.username);
          }
          this.session.active_profile_id = activeProfileId;
          this.session.active_profile_name = profName;
          this.session.active_profile_color = String(prof.avatar_color || 'bg-red-600');
          this.session.active_profile_uid = uid;
          this.session.is_kids = !!prof.is_kids;
          adsEnabled = siteAdsOn && !this.session.is_kids;
          themeColor = prof.theme_color || 'red';
          profileAvatar = prof.avatar_image;
          bingeStreak = Number(prof.binge_streak);
        } else {
          this.session.active_profile_id = 0;
          this.session.active_profile_name = String(user.username);
          this.session.active_profile_color = 'bg-red-600';
          this.session.active_profile_uid = uid;
          this.session.is_kids = false;
          adsEnabled = siteAdsOn;
        }
        const ann = await Database.fetchOne(
          `SELECT a.* FROM announcements a
           WHERE a.is_active = 1
             AND (a.start_at IS NULL OR a.start_at <= NOW())
             AND (a.end_at IS NULL OR a.end_at > NOW())
           ORDER BY a.id DESC LIMIT 1`
        );
        if (ann) {
          const read = await Database.fetchOne('SELECT 1 AS r FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [ann.id, user.id]);
          if (!read) {
            ann.title = Security.markdownToPlain(String(ann.title || ''), 150);
            ann.message = Security.markdownToPlain(String(ann.message || ''), 2000);
            announcement = ann;
          }
        }
      }
      const sMap = await this.cachedSiteSettings();
      if (sMap.WEB_PLAYER_ENABLED != null) webPlayerEnabled = sMap.WEB_PLAYER_ENABLED;
      siteDomains = parseSiteDomains(sMap.SITE_DOMAINS || '', this.safeHost().split(':')[0]);
    } catch {}
    {
      context={...context};
      const keys=['items','results','data','trending','movies','shows','anime','recommended','continue_watching','indian_movies','south_movies','netflix','prime','apple','top_10_india','user_watchlist','recommended_for_you','top_10_bollywood','top_10_hollywood','top_10_cartoons','popular_cartoons','top_10_korean','history','watchlist','credits','matched_movies'];
      for (const key of keys) if (Array.isArray(context[key])) context[key]=await this.filterBlacklisted(context[key],['shows','anime','netflix','prime','apple','top_10_cartoons','popular_cartoons'].includes(key)?'tv':context.media_type || 'movie');
      if (context.last_watched && !(await this.filterBlacklisted([context.last_watched])).length) context.last_watched=null;
      if (context.details && context.details.similar) context.details={...context.details,similar:{...context.details.similar,results:await this.filterBlacklisted(context.details.similar.results || [],context.media_type)}};
      if (this.session.is_kids) for (const key of ['trending_actors','superhero_albums','epic_albums']) if (Array.isArray(context[key])) context[key]=[];
    }
    const adsterraBannerAvailable = [Config.ADSTERRA_BANNER_728, Config.ADSTERRA_BANNER_300, Config.ADSTERRA_BANNER_320, Config.ADSTERRA_BANNER_468, Config.ADSTERRA_BANNER_160].some((v) => String(v || '').trim() !== '');
    const cu = {
      is_authenticated: user !== null,
      id: user ? user.id : null,
      username: user ? user.username : '',
      email: user ? user.email : '',
      role: user ? user.role : 'user',
      match_code: user ? user.match_code : '',
      created_at: user ? user.created_at : null,
      totp_enabled: !!(user && user.totp_enabled),
    };
    const scheme = this.isSecure() ? 'https' : 'http';
    const host = this.safeHost();
    let canonicalBase = '';
    const configuredBase = String(Config.OAUTH_BASE_URL || '').trim();
    if (configuredBase) {
      try {
        const canonicalParts = new URL(configuredBase.includes('://') ? configuredBase : 'https://' + configuredBase);
        if (['http:', 'https:'].includes(canonicalParts.protocol) && canonicalParts.hostname && !canonicalParts.username && !canonicalParts.search && !canonicalParts.hash) {
          if (/^[A-Za-z0-9.\-]+$/.test(canonicalParts.hostname)) {
            canonicalBase = canonicalParts.protocol + '//' + canonicalParts.hostname + (canonicalParts.port ? ':' + canonicalParts.port : '') + (canonicalParts.pathname || '').replace(/\/+$/, '');
          }
        }
      } catch {}
    }
    const requestBase = canonicalBase !== '' ? canonicalBase : (scheme + '://' + host);
    const requestPath = this.req.originalUrl || this.req.url || this.req.path || '/';
    const requestObj = {
      host_url: requestBase.replace(/\/+$/, '') + '/',
      url_root: requestBase.replace(/\/+$/, '') + '/',
      path: this.req.path || '/',
      url: requestBase.replace(/\/+$/, '') + requestPath,
    };
    const catUrl = String(context.category_url || '');
    const pgBase = catUrl !== '' ? (catUrl + (catUrl.includes('?') ? '&' : '?')) : '?';
    const sessionProxy = TwigEnv.wrapSession(this.session);
    if (['category.html','view_all.html'].includes(template) && Array.isArray(context.items) && context.items.length===0 && TMDB.lastError) {
      this.res.status(503).set({'Retry-After':'60','Cache-Control':'no-store'});
    }
    const seo = Seo.page(this, template, context);
    if (!this.res.headersSent) this.res.set('X-Robots-Tag', seo.robots);
    const globals = {
      seo,
      csrf_token: this.session.csrf_token || '',
      splash_enabled: Config.SPLASH_ENABLED,
      cursor_enabled: Config.CURSOR_ENABLED,
      current_user: cu,
      session: sessionProxy,
      request: requestObj,
      cur_path: this.req.path || '/',
      canonical_base_url: seo.origin,
      image_base_url: Config.TMDB_IMAGE_BASE_URL,
      image_base: Config.TMDB_IMAGE_BASE,
      user_playlists: userPlaylists,
      unread_notifs: unreadNotifs,
      v2_link: v2Link,
      site_domains: siteDomains,
      pg_base: pgBase,
      web_player_enabled: webPlayerEnabled,
      ads_enabled: adsEnabled,
      hilltopads_vast_url: hilltopAdsVastUrl,
      vast_fallback_url: vastFallbackUrl,
      ga_measurement_id: Config.GA_MEASUREMENT_ID,
      adsterra_social_bar: Config.ADSTERRA_SOCIAL_BAR,
      adsterra_popunder: Config.ADSTERRA_POPUNDER,
      adsterra_banner_728: Config.ADSTERRA_BANNER_728,
      adsterra_banner_300: Config.ADSTERRA_BANNER_300,
      adsterra_banner_320: Config.ADSTERRA_BANNER_320,
      adsterra_banner_468: Config.ADSTERRA_BANNER_468,
      adsterra_banner_160: Config.ADSTERRA_BANNER_160,
      adsterra_native_banner: Config.ADSTERRA_NATIVE_BANNER,
      adsterra_smartlink_url: Config.ADSTERRA_SMARTLINK_URL,
      adsterra_banner_available: adsterraBannerAvailable,
      theme_color: themeColor,
      profile_avatar: profileAvatar,
      binge_streak: bingeStreak,
      announcement,
      google_login_enabled: OAuth.enabled('google'),
      github_login_enabled: OAuth.enabled('github'),
      get_flashed_messages: () => (this.suppressFlashes ? [] : this.getFlashedMessages()),
    };
    if (Number(this.res.statusCode || 200) === 200 && isCacheableGuestPath(this.req.path || '')) this.res.set('Cache-Control',user ? 'private, no-store':'public, no-cache, must-revalidate');
    const html = await renderTwig(template, { ...globals, ...context }, this);
    if (this._ended) return html;
    this._ended = true;
    if (!this.res.headersSent) this.res.set('Content-Type', 'text/html; charset=UTF-8');
    this.res.send(html);
    return html;
  },

  async renderNotFound() {
    this.res.status(404);
    if (this.wantsJson()) {
      return this.json({ ok: false, error: 'not_found' });
    }
    try {
      await this.render('404.html');
    } catch {
      this.res.type('html').send("<div style='height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f1014; color: white; font-family: sans-serif; flex-direction: column;'><h1 style='font-size: 60px; color: #dc2626; margin: 0;'>404</h1><p>Page not found.</p><a href='/' style='color: #dc2626; margin-top: 10px;'>Go Home</a></div>");
      this._ended = true;
    }
  },

  async renderMaintenance() {
    this.res.status(503);
    this.res.set('Cache-Control', 'no-store');
    try {
      await this.render('maintenance.html');
    } catch {
      this.res.type('html').send("<!doctype html><html><head><meta charset='utf-8'><title>CINEAMIT — Maintenance</title></head><body style='margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#fff;font-family:sans-serif;flex-direction:column;'><div style='font-size:56px;'>🛠️</div><h1 style='font-size:32px;margin:12px 0 6px;'>CINEAMIT</h1><p style='color:#9ca3af;margin:0;'>Under maintenance — we'll be back shortly.</p></body></html>");
      this._ended = true;
    }
  },
};
