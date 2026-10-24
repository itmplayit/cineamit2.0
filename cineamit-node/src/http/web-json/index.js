'use strict';

const crypto = require('crypto');
const Config = require('../../core/config');
const Economy = require('../../services/economy');
const AdsOps = require('../../services/ads-ops');
const { verifyUnityCallback, UnityVerificationError } = require('../../services/unity-s2s');
const { add, routes } = require('../../core/router');
const { requireAppUser } = require('./guards');
const { app_login, app_logout, app_register, app_dlpin_otp, app_dlpin_verify, app_totp_setup, app_totp_verify, app_totp_disable } = require('./app-auth');
const { app_bootstrap, app_update, app_home, app_title_logo, app_search, app_details, app_person_credits, app_watch, app_episodes, app_studios, app_studio, app_providers, app_provider, app_iptv, app_iptv_series, app_livetv, app_catalog, app_filter } = require('./app-catalog');
const { app_download_list, app_wallet_sync, app_wallet_ticket, app_wallet_earn, app_wallet_redeem, app_wallet_trial, app_wallet_cancel, app_profiles, app_profile_select, app_profile_add, app_profile_delete, app_set_pin, app_playback, app_trailer, app_add_review, app_submit_request, app_info, app_watchlist, app_watchlist_toggle } = require('./app-account');
const { app_ga } = require('./app-ga');
const { handleAppPage } = require('./app-pages');

// JSON wrapper: website routes → JSON when Accept: application/json, plus /api/app/* aliases.
function wantsJson(app) {
  return !!(app && typeof app.wantsJson === 'function' && app.wantsJson());
}

function wrap(endpoint, jsonHandler) {
  const seen = new Set();
  for (const method of Object.keys(routes)) {
    for (const compiled of (routes[method] || [])) {
      if (compiled.endpoint !== endpoint) continue;
      if (seen.has(compiled) || compiled._jsonWrapped) continue;
      seen.add(compiled);
      compiled._jsonWrapped = true;
      const orig = compiled.handler;
      compiled.handler = async (app, args) => {
        if (wantsJson(app)) return jsonHandler(app, args);
        return orig(app, args);
      };
    }
  }
}

function attach() {
  wrap('routes.index', app_bootstrap);
  wrap('routes.home', app_home);
  wrap('routes.search', app_search);
  wrap('routes.details', async (app, args) => {
    args = args || {};
    args.type = args.media_type || args.type;
    args.id = String(args.slug || args.id || '').split('-').pop();
    return app_details(app, args);
  });
  wrap('player.watch', async (app, args) => {
    args = args || {};
    args.type = args.media_type || args.type;
    args.id = String(args.slug || args.id || '').split('-').pop();
    return app_watch(app, args);
  });
  wrap('routes.all_studios', app_studios);
  wrap('routes.studio', app_studio);
  wrap('routes.all_providers', app_providers);
  wrap('routes.provider', async (app, args) => {
    args = args || {};
    args.id = args.provider_id || args.id;
    return app_provider(app, args);
  });
  wrap('routes.livetv', async (app, args) => {
    const q = app.req.query || {};
    if (q.series) {
      app.req.query = Object.assign({}, q, { id: q.series });
      return app_iptv_series(app, args);
    }
    if (q.kind && q.kind !== 'live') return app_iptv(app, args);
    return app_livetv(app, args);
  });
  wrap('auth.login', app_login);
  wrap('auth.logout', app_logout);
  wrap('auth.register', app_register);
  wrap('routes.select_profile', app_profiles);
  wrap('routes.set_active_profile', async (app, args) => {
    args = args || {};
    app.req.body = app.req.body || {};
    if (args.profile_id && !app.req.body.id) app.req.body.id = args.profile_id;
    return app_profile_select(app, args);
  });
  wrap('routes.add_profile', app_profile_add);
  wrap('routes.delete_profile', app_profile_delete);
  wrap('routes.update_profile_pin', app_set_pin);
  wrap('routes.update_playback_settings', app_playback);
  wrap('routes.get_trailer', async (app, args) => {
    args = args || {};
    args.type = args.media_type || args.type;
    args.id = args.tmdb_id || args.id;
    return app_trailer(app, args);
  });
  wrap('routes.add_review', app_add_review);
  wrap('routes.submit_request', app_submit_request);
  wrap('routes.totp_setup', app_totp_setup);
  wrap('routes.totp_verify', app_totp_verify);
  wrap('routes.totp_disable', app_totp_disable);
  wrap('routes.movies', (app) => app_catalog(app, { kind: 'movie' }));
  wrap('routes.series', (app) => app_catalog(app, { kind: 'tv' }));
  wrap('routes.anime', (app) => app_catalog(app, { kind: 'anime' }));
  wrap('routes.movies_category', (app, args) => {
    const cat = String((args && args.category) || 'popular').replace(/-/g, '_');
    const map = { top_10_india: 'indian', popular: 'popular' };
    app.req.query = Object.assign({}, app.req.query, { category: map[cat] || cat });
    return app_catalog(app, { kind: 'movie' });
  });
  wrap('routes.shows_category', (app, args) => {
    const cat = String((args && args.category) || 'popular').replace(/-/g, '_');
    const kind = cat === 'anime' ? 'anime' : 'tv';
    const map = { top: 'popular' };
    app.req.query = Object.assign({}, app.req.query, { category: map[cat] || cat });
    return app_catalog(app, { kind });
  });
  wrap('routes.filter_page', (app) => {
    const q = app.req.query || {};
    const cat = String(q.category || '');
    const hasFilter = !!(q.type || q.media_type || q.genre || q.provider_id || q.q || q.network || q.country);
    if (!hasFilter || cat === 'cartoons' || cat === 'cartoons_top') {
      app.req.query = Object.assign({}, q, { category: 'cartoons' });
      return app_catalog(app, { kind: 'tv' });
    }
    return app_filter(app);
  });
  wrap('routes.watchlist', app_watchlist);
  wrap('routes.add_to_watchlist', async (app, args) => {
    args = args || {};
    app.req.body = app.req.body || {};
    app.req.body.type = args.media_type || app.req.body.type;
    const slug = String(args.slug || '');
    const id = slug.split('-').pop();
    if (id) app.req.body.id = id;
    return app_watchlist_toggle(app, args);
  });
  wrap('routes.about', (app) => {
    const kind = String((app.req.query && app.req.query.kind) || 'about');
    return handleAppPage(app, kind, '');
  });
  wrap('routes.privacy', (app) => handleAppPage(app, 'privacy', ''));
  wrap('routes.terms', (app) => handleAppPage(app, 'terms', ''));
  wrap('routes.dmca', (app) => handleAppPage(app, 'dmca', ''));
  wrap('routes.legal', (app) => handleAppPage(app, 'legal', ''));
  wrap('routes.faq', (app) => handleAppPage(app, 'faq', ''));
  wrap('routes.help', (app) => handleAppPage(app, 'help', ''));
  wrap('routes.help_article', (app, args) => handleAppPage(app, 'help', String((args && args.slug) || '')));
  wrap('routes.contact', (app) => handleAppPage(app, 'contact', ''));
  wrap('routes.actors_list', (app) => handleAppPage(app, 'actors', ''));
  wrap('routes.albums', (app) => handleAppPage(app, 'albums', ''));
  wrap('routes.album_view', (app, args) => handleAppPage(app, 'album', String((args && args.id) || '')));
  wrap('routes.history', (app) => handleAppPage(app, 'history', ''));
  wrap('routes.clear_history', (app) => handleAppPage(app, 'history', ''));
  wrap('routes.notifications', (app) => handleAppPage(app, 'notifications', ''));
  wrap('routes.clear_notifications', (app) => handleAppPage(app, 'notifications', ''));
  wrap('routes.my_playlists', (app) => handleAppPage(app, 'playlists', ''));
  wrap('routes.view_playlist', (app, args) => handleAppPage(app, 'playlist', String((args && args.share_code) || ''), true));
  wrap('routes.cine_match_home', (app) => handleAppPage(app, 'cine_match', ''));
  wrap('routes.cine_match_compare', (app) => handleAppPage(app, 'cine_match', ''));
  wrap('routes.cine_wrapped', (app) => handleAppPage(app, 'wrapped', ''));
  wrap('routes.blog_list', (app) => handleAppPage(app, 'blog', ''));
  wrap('routes.blog_single', (app, args) => handleAppPage(app, 'blog', String((args && args.slug) || '')));
  wrap('routes.reels', (app) => handleAppPage(app, 'reels', ''));
  wrap('routes.surprise', (app) => handleAppPage(app, 'surprise', ''));
  wrap('routes.forgot_password', (app) => handleAppPage(app, 'forgot', ''));
  wrap('routes.verify_otp', (app) => handleAppPage(app, 'forgot_verify', ''));
  wrap('routes.reset_password', (app) => handleAppPage(app, 'forgot_reset', ''));
  aliases();
}

function aliases() {
  add('/api/rewards/unity', 'app.reward_unity', async app => {
    app.res.set('Cache-Control', 'no-store');
    app.res.type('text/plain');
    try {
      const proof = verifyUnityCallback(app.req.originalUrl || app.req.url, {
        enabled: Config.UNITY_S2S_ENABLED, secret: Config.UNITY_S2S_SECRET,
        gameId: Config.UNITY_GAME_ID, placement: Config.UNITY_REWARDED_PLACEMENT,
      });
      const result = await Economy.creditVerifiedReward(proof.userId, proof.ticket, proof.eventId, proof.adUnit);
      try { await AdsOps.noteVerifiedCallback(result.ok ? (result.already_credited ? 'already_credited' : 'credited') : result.error); }
      catch (error) { console.error('[Rewards] Callback health write unavailable: ' + error.message); }
      if (!result.ok) return app.res.status(403).send('reward_rejected');
      return app.res.status(200).send('1');
    } catch (error) {
      return app.res.status(error instanceof UnityVerificationError ? error.status : 503)
        .send(error instanceof UnityVerificationError ? error.code : 'verification_unavailable');
    }
  }, ['GET']);
  add('/api/app/wallet/reward-status', 'app.wallet_reward_status', async app => {
    app.res.set('Cache-Control', 'no-store');
    const user = await requireAppUser(app); if (!user) return;
    if (!(await app.throttle('reward_status_' + user.id, 300, 3600))) {
      app.res.status(429); return app.json({ok: false, error: 'slow_down'});
    }
    return app.json(await Economy.rewardStatus(user.id, String((app.req.body || {}).ticket || '')));
  }, ['POST']);
  add('/api/app/ads/diagnostics', 'app.ads_diagnostics', async app => {
    app.res.set('Cache-Control', 'no-store');
    const user = await requireAppUser(app); if (!user) return;
    if (app.session.is_kids || !(await Database.consumeRate('ad_diag_user_' + user.id, 180, 3600)).allowed || !(await app.throttle('ad_diag_ip', 300, 3600))) {
      app.res.status(429); return app.json({ok: false, error: 'diagnostics_limited'});
    }
    let events;
    try { events = AdsOps.validateEvents(app.req.body); }
    catch { app.res.status(400); return app.json({ok: false, error: 'invalid_diagnostics'}); }
    try {
      const config = await Economy.publicConfig(true);
      if (!config.ads_enabled || !config.ads_diagnostics) return app.json({ok: true, accepted: 0, disabled: true});
      return app.json({ok: true, accepted: await AdsOps.storeEvents(Number(user.id), events)});
    } catch (error) {
      console.error('[AdsOps] Diagnostics unavailable: ' + error.message);
      app.res.status(503); return app.json({ok: false, error: 'diagnostics_unavailable'});
    }
  }, ['POST']);
  add('/api/app/bootstrap', 'app.bootstrap', app_bootstrap);
  add('/api/app/ga', 'app.ga', app_ga, ['POST']);
  add('/api/app/update', 'app.update', app_update);
  add('/api/app/home', 'app.home', app_home);
  add('/api/app/title_logo/{type}/{id}', 'app.title_logo', app_title_logo);
  add('/api/app/search', 'app.search', app_search);
  add('/api/app/details/{type}/{id}', 'app.details', app_details);
  add('/api/app/person/{id}/credits', 'app.person_credits', app_person_credits);
  add('/api/app/watch/{type}/{id}', 'app.watch', app_watch);
  add('/api/app/downloads/{type}/{id}', 'app.downloads', app_download_list);
  add('/api/app/episodes/{id}/{season}', 'app.episodes', app_episodes);
  add('/api/app/studios', 'app.studios', app_studios);
  add('/api/app/studio/{id}', 'app.studio', app_studio);
  add('/api/app/providers', 'app.providers', app_providers);
  add('/api/app/provider/{id}', 'app.provider', app_provider);
  add('/api/app/iptv', 'app.iptv', app_iptv);
  add('/api/app/iptv/series', 'app.iptv_series', app_iptv_series);
  add('/api/app/livetv', 'app.livetv', app_livetv);
  add('/api/app/login', 'app.login', app_login, ['POST']);
  add('/api/app/logout', 'app.logout', app_logout, ['POST']);
  add('/api/app/dlpin/otp', 'app.dlpin_otp', app_dlpin_otp, ['POST']);
  add('/api/app/dlpin/verify', 'app.dlpin_verify', app_dlpin_verify, ['POST']);
  add('/api/app/profiles', 'app.profiles', app_profiles);
  add('/api/app/profile/select', 'app.profile_select', app_profile_select, ['POST']);
  add('/api/app/profile/add', 'app.profile_add', app_profile_add, ['POST']);
  add('/api/app/profile/delete', 'app.profile_delete', app_profile_delete, ['POST']);
  add('/api/app/profile/delete/{profile_id}', 'app.profile_delete_id', app_profile_delete, ['POST']);
  add('/api/app/profile/pin', 'app.profile_pin', app_set_pin, ['POST']);
  add('/api/app/profile/playback', 'app.profile_playback', app_playback, ['POST']);
  add('/api/app/trailer/{type}/{id}', 'app.trailer', app_trailer);
  add('/api/app/review', 'app.review', app_add_review, ['POST']);
  add('/api/app/request', 'app.request', app_submit_request, ['POST']);
  add('/api/app/totp/setup', 'app.totp_setup', app_totp_setup, ['POST']);
  add('/api/app/totp/verify', 'app.totp_verify', app_totp_verify, ['POST']);
  add('/api/app/totp/disable', 'app.totp_disable', app_totp_disable, ['POST']);
  add('/api/app/catalog/{kind}', 'app.catalog', app_catalog);
  add('/api/app/filter', 'app.filter', app_filter);
  add('/api/app/watchlist', 'app.watchlist', app_watchlist);
  add('/api/app/watchlist/toggle', 'app.watchlist_toggle', app_watchlist_toggle, ['POST']);
  add('/api/app/register', 'app.register', app_register, ['POST']);
  add('/api/app/info', 'app.info', app_info);
  add('/api/app/page/{kind}', 'app.page', async (app, args) => handleAppPage(app, String(args.kind || ''), ''), ['GET', 'POST']);
  add('/api/app/page/{kind}/{id}', 'app.page_id', async (app, args) => handleAppPage(app, String(args.kind || ''), String(args.id || '')), ['GET', 'POST']);
  add('/api/app/wallet/sync', 'app.wallet_sync', app_wallet_sync, ['POST']);
  add('/api/app/wallet/ticket', 'app.wallet_ticket', app_wallet_ticket, ['POST']);
  add('/api/app/wallet/earn', 'app.wallet_earn', app_wallet_earn, ['POST']);
  add('/api/app/wallet/redeem', 'app.wallet_redeem', app_wallet_redeem, ['POST']);
  add('/api/app/wallet/trial', 'app.wallet_trial', app_wallet_trial, ['POST']);
  add('/api/app/wallet/cancel', 'app.wallet_cancel', app_wallet_cancel, ['POST']);
}

module.exports = { attach, wantsJson };

module.exports = { attach, wantsJson };
