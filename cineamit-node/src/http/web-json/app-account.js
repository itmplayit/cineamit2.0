'use strict';

const crypto = require('crypto');
const Database = require('../../db');
const TMDB = require('../../services/tmdb');
const Security = require('../../security');
const Economy = require('../../services/economy');
const Profiles = require('../../services/profiles');
const MediaLibrary = require('../../services/media-library');
const { cineamitKidsContentAllowed } = require('../../services/kids');
const { requireAppUser } = require('./guards');
const { PAGE_TEXT } = require('./page-text');
const { sessionUser, downloadOptions, slim, imageBase, dedupeMediaRows, histItem } = require('./serializers');

// App account: wallets, downloads, profiles, playback prefs, reviews, requests, watchlist.
async function app_download_list(app, args) {
  const mediaType = TMDB.mt_safe(String(args.type || 'movie'));
  const tmdbId = Number(args.id);
  const s = Math.max(1, parseInt(app.req.query.s, 10) || 1);
  const e = Math.max(1, parseInt(app.req.query.e, 10) || 1);
  if (!tmdbId) { app.res.status(400); return app.json({ ok: false, error: 'invalid_title' }); }
  if (await app.isBlacklisted(tmdbId)) { app.res.status(404); return app.json({ ok: false, error: 'title_unavailable' }); }
  const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
  if (!details.id) { app.res.status(404); return app.json({ ok: false, error: 'title_unavailable' }); }
  if (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType)) {
    app.res.status(403);
    return app.json({ ok: false, error: 'kids_restricted' });
  }
  const title = String(details.title || details.name || '');
  const downloads = await downloadOptions(app, mediaType, tmdbId, title, s, e);
  return app.json({
    ok: true,
    title,
    kids_safe: cineamitKidsContentAllowed(details,mediaType),
    poster_path: String(details.poster_path || ''),
    backdrop_path: String(details.backdrop_path || ''),
    media_type: mediaType,
    s,
    e,
    downloads,
  });
}

async function app_wallet_sync(app) {
    const user = await requireAppUser(app);
    if (!user) return;
    const b = app.req.body || {};
    const out = await Economy.syncFromClient(user.id, b.points, b.plan, b.until);
    return app.json(out);
  }

async function app_wallet_ticket(app) {
    const user = await requireAppUser(app);
    if (!user) return;
    if (!(await app.throttle('wallet_ticket_' + user.id, 40, 3600))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'slow_down' });
    }
    try {
      const result = await Economy.issueTicket(user.id, String((app.req.body || {}).ad_unit || ''));
      if (!result.ok) app.res.status(['daily_limit', 'reward_cooldown', 'pending_limit', 'wallet_limit'].includes(result.error) ? 429 : 503);
      // Wallet balances are not needed by the admission endpoint.
      const {wallet, ...response} = result;
      return app.json(response);
    } catch (error) {
      console.error('[Rewards] Ticket admission unavailable: ' + error.message);
      app.res.status(503);
      return app.json({ok: false, error: 'reward_unavailable', message: 'Reward service is temporarily unavailable. Please try again later.'});
    }
  }

async function app_wallet_earn(app) {
    const user = await requireAppUser(app);
    if (!user) return;
    if (!(await app.throttle('wallet_earn_' + user.id, 30, 3600))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'slow_down', ...(await Economy.payload(app)) });
    }
    const ticket = String((app.req.body && (app.req.body.ticket || app.req.body.t)) || '');
    return app.json(await Economy.earnAd(user.id, ticket));
  }

async function app_wallet_redeem(app) {
    const user = await requireAppUser(app);
    if (!user) return;
    const type = String((app.req.body && app.req.body.type) || '');
    try {
      return app.json(type === 'trial' ? await Economy.startTrial(user.id) : await Economy.redeem(user.id, type));
    } catch (error) {
      console.error('[Economy] Redemption unavailable: ' + error.message);
      app.res.status(503); return app.json({ok: false, error: 'economy_unavailable', message: 'Plan settings are temporarily unavailable. No redemption was confirmed; refresh your wallet before retrying.'});
    }
  }

async function app_wallet_trial(app) {
    const user = await requireAppUser(app);
    if (!user) return;
    if (!(await app.throttle('wallet_trial_' + user.id, 8, 3600))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'slow_down', ...(await Economy.payload(app)) });
    }
    try { return app.json(await Economy.startTrial(user.id)); }
    catch (error) {
      console.error('[Economy] Trial unavailable: ' + error.message);
      app.res.status(503); return app.json({ok: false, error: 'economy_unavailable', message: 'Trial settings are temporarily unavailable. Please refresh and try again later.'});
    }
  }

async function app_wallet_cancel(app) {
    const user = await requireAppUser(app);
    if (!user) return;
    return app.json(await Economy.cancelPlan(user.id));
  }

async function app_profiles(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    let rows = [];
    try {
      rows = await Database.fetchAll(
        'SELECT id, name, avatar_color, is_kids, pin FROM user_profiles WHERE user_id = ? ORDER BY id ASC',
        [Number(user.id)]
      );
    } catch { rows = []; }
    const profiles = rows.map((p) => ({
      id: Number(p.id),
      name: String(p.name || user.username || 'Profile'),
      color: String(p.avatar_color || ''),
      is_kids: !!p.is_kids,
      has_pin: !!(p.pin && String(p.pin).length > 0),
    }));
    return app.json({
      ok: true,
      user: await sessionUser(app, user),
      profiles,
    });
  }

async function app_profile_select(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const pid = Number(app.req.body.id || app.req.body.profile_id || 0);
    const prof = pid ? await Database.fetchOne('SELECT * FROM user_profiles WHERE id = ? AND user_id = ?', [pid, Number(user.id)]) : null;
    if (!prof) {
      app.res.status(404);
      return app.json({ ok: false, error: 'not_found' });
    }
    const result = await Profiles.select(app, user, prof, app.req.body.pin);
    if (!result.ok) {
      app.res.status(result.error === 'locked' ? 423 : 403);
      return app.json(result);
    }
    return app.json({ ok: true, user: await sessionUser(app, user) });
  }

async function app_profile_add(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const permission = await Profiles.authorizeManagement(app, user);
    if (!permission.ok) { app.res.status(403); return app.json(permission); }

    const name = String(app.req.body.name || app.req.body.profile_name || '').trim().slice(0, 50);
    const kidsRaw = app.req.body.is_kids;
    const isKids = kidsRaw === true || kidsRaw === 1 || kidsRaw === '1' || kidsRaw === 'on' || kidsRaw === 'true';
    let color = String(app.req.body.avatar_color || app.req.body.color || 'bg-red-600');
    const allowed = ['bg-red-600', 'bg-blue-600', 'bg-green-600', 'bg-purple-600'];
    if (!allowed.includes(color)) color = 'bg-red-600';
    if (!name) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid' });
    }
    const result = await Profiles.add(user, name, isKids, color);
    if (!result.ok) { app.res.status(400); return app.json(result); }
    return app_profiles(app);
  }

async function app_profile_delete(app, args) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const permission = await Profiles.authorizeManagement(app, user);
    if (!permission.ok) { app.res.status(403); return app.json(permission); }

    const pid = Number((args && args.profile_id) || app.req.body.id || app.req.body.profile_id || 0);
    if (!pid) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid' });
    }
    const result = await Profiles.remove(app, user, pid);
    if (!result.ok) { app.res.status(400); return app.json(result); }
    return app_profiles(app);
  }

async function app_set_pin(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const permission = await Profiles.authorizeManagement(app, user);
    if (!permission.ok) { app.res.status(403); return app.json(permission); }

    const pid = Number(app.req.body.profile_id || app.req.body.id || app.session.active_profile_id || 0);
    const pin = String(app.req.body.pin || '').trim();
    if (!pid) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid' });
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'bad_pin' });
    }
    const hashed = pin ? await Security.generatePasswordHash(pin) : null;
    try {
      await Database.execute('UPDATE user_profiles SET pin = ? WHERE id = ? AND user_id = ?', [hashed, pid, Number(user.id)]);
    } catch (e) {
      app.res.status(500);
      return app.json({ ok: false, error: 'db' });
    }
    return app_profiles(app);
  }

async function app_playback(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const pid = Number(app.session.active_profile_id || 0);
    const raw = app.req.body.autoplay_next;
    const autoplay = raw === true || raw === 1 || raw === '1' || raw === 'on' || raw === 'true';
    const server = String(app.req.body.default_server || 'auto').slice(0, 50);
    if (pid) {
      try {
        await Database.execute(
          'UPDATE user_profiles SET autoplay_next = ?, default_server = ? WHERE id = ? AND user_id = ?',
          [autoplay ? 1 : 0, server, pid, Number(user.id)]
        );
      } catch (e) {
        app.res.status(500);
        return app.json({ ok: false, error: 'db' });
      }
    }
    app.session.autoplay_next = autoplay;
    return app.json({ ok: true, user: await sessionUser(app, user) });
  }

async function app_trailer(app, args) {
    args = args || {};
    const mediaType = TMDB.mt_safe(String(args.type || args.media_type || 'movie'));
    const tmdbId = Number(args.id || args.tmdb_id || 0);
    if (!tmdbId) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid' });
    }
    if (await app.isBlacklisted(tmdbId) || (app.session.is_kids && !(await app.filterBlacklisted([{id:tmdbId,media_type:mediaType}],mediaType)).length)) {app.res.status(403);return app.json({ok:false,key:'',error:'title_unavailable'});}
    let key = '';
    try { key = String((await TMDB.getTrailer(mediaType, tmdbId)) || ''); } catch { key = ''; }
    if (!key && !app.session.is_kids && mediaType !== 'tv') {
      try { key = String((await TMDB.getTrailer('tv', tmdbId)) || ''); } catch { key = ''; }
    }
    if (!key && !app.session.is_kids && mediaType !== 'movie') {
      try { key = String((await TMDB.getTrailer('movie', tmdbId)) || ''); } catch { key = ''; }
    }
    return app.json({ ok: true, key });
  }

async function app_add_review(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const rating = Number(app.req.body.rating);
    if (![1, 2, 3, 4, 5].includes(rating)) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid' });
    }
    try {
      await Database.execute(
        'INSERT INTO reviews (user_id, profile_id, tmdb_id, media_type, rating, review_text, has_spoilers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          Number(user.id),
          app.session.active_profile_id || 0,
          Number(app.req.body.tmdb_id || app.req.body.id || 0),
          TMDB.mt_safe(app.req.body.media_type || app.req.body.type || 'movie'),
          rating,
          String(app.req.body.review_text || app.req.body.text || '').slice(0, 5000),
          app.req.body.has_spoilers ? 1 : 0,
        ]
      );
    } catch (e) {
      app.res.status(500);
      return app.json({ ok: false, error: 'db' });
    }
    return app.json({ ok: true });
  }

async function app_submit_request(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    if (!(await app.throttle('content_request', 10, 86400))) {
      app.res.status(429);
      return app.json({ ok: false, error: 'throttled' });
    }
    const title = String(app.req.body.title || '').trim().slice(0, 255);
    if (!title) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid' });
    }
    try {
      await Database.execute(
        'INSERT INTO user_requests (user_id, request_type, title, message) VALUES (?, ?, ?, ?)',
        [
          Number(user.id),
          String(app.req.body.request_type || app.req.body.type || 'movie').slice(0, 50),
          title,
          String(app.req.body.message || ''),
        ]
      );
    } catch (e) {
      app.res.status(500);
      return app.json({ ok: false, error: 'db' });
    }
    return app.json({ ok: true });
  }

async function app_info(app) {
    return app.json({
      ok: true,
      about: PAGE_TEXT.about,
      privacy: PAGE_TEXT.privacy,
      terms: PAGE_TEXT.terms,
      dmca: PAGE_TEXT.dmca,
      legal: PAGE_TEXT.legal,
      faq: PAGE_TEXT.faq,
      download: PAGE_TEXT.download,
      totp: PAGE_TEXT.totp,
      version: '1.0.66'
    });
  }



async function app_watchlist(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const library = await MediaLibrary.scope(app, user);
    const rows = dedupeMediaRows(await Database.fetchAll('SELECT tmdb_id, media_type, title, poster_path FROM watchlist WHERE ' + library.clause + ' ORDER BY added_at DESC', library.params));
    const items = (await app.filterBlacklisted(rows)).map((r) => slim({
      id: r.tmdb_id,
      media_type: r.media_type,
      title: r.title,
      poster_path: r.poster_path,
    }, r.media_type)).filter(Boolean);
    return app.json({ ok: true, image_base: imageBase(), items });
  }

async function app_watchlist_toggle(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    const user = await app.currentUser();
    const mediaType = TMDB.mt_safe(String(app.req.body.type || app.req.body.media_type || 'movie'));
    const tmdbId = Number(app.req.body.id || 0);
    if (!tmdbId) { app.res.status(400); return app.json({ ok: false, error: 'invalid' }); }
    const profile = await Profiles.ensureActive(app, user);
    if (!profile) { app.res.status(403); return app.json({ok: false, error: 'profile_required'}); }
    const profileId = profile.id;
    const library = await MediaLibrary.scope(app, user);
    const params = [...library.params, tmdbId, mediaType];
    const where = library.clause + ' AND tmdb_id = ? AND media_type = ?';
    const existing = await Database.fetchOne('SELECT id FROM watchlist WHERE ' + where, params);
    if (existing) {
      await Database.execute('DELETE FROM watchlist WHERE ' + where, params);
      return app.json({ ok: true, in_watchlist: false });
    }
    const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
    if (!details.id || await app.isBlacklisted(tmdbId)) { app.res.status(404); return app.json({ok: false, error: 'title_unavailable'}); }
    if (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType)) { app.res.status(403); return app.json({ok: false, error: 'kids_restricted'}); }
    const title = details.title || details.name || 'Unknown';
    try {
      await Database.execute(
        'INSERT INTO watchlist (user_id, profile_id, tmdb_id, media_type, title, poster_path) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title)',
        [Number(user.id), profileId, tmdbId, mediaType, title, details.poster_path || null]
      );
    } catch (e) {
      app.res.status(500);
      return app.json({ ok: false, error: 'watchlist' });
    }
    return app.json({ ok: true, in_watchlist: true });
  }


module.exports = { app_download_list, app_wallet_sync, app_wallet_ticket, app_wallet_earn,
  app_wallet_redeem, app_wallet_trial, app_wallet_cancel, app_profiles, app_profile_select,
  app_profile_add, app_profile_delete, app_set_pin, app_playback, app_trailer, app_add_review,
  app_submit_request, app_info, app_watchlist, app_watchlist_toggle };
