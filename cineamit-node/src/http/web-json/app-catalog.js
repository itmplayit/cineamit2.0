'use strict';

const Config = require('../../core/config');
const Database = require('../../db');
const TMDB = require('../../services/tmdb');
const Economy = require('../../services/economy');
const Profiles = require('../../services/profiles');
const MediaLibrary = require('../../services/media-library');
const AndroidApp = require('../../android-app');
const live = require('../../services/live');
const { cineamitKidsContentAllowed } = require('../../services/kids');
const { imageBase, slim, slimList, logoFor, sessionUser, dedupeMediaRows, histItemFilled, sleep, embedServers, downloadOptions } = require('./serializers');

// App catalog: bootstrap, home, search, details, watch, episodes, studios, providers, IPTV, filters.
async function app_bootstrap(app) {
    const user = await app.currentUser();
    const eco = await Economy.payload(app);
    let update = null;
    try { update = await AndroidApp.updateMeta(); } catch { update = null; }
    return app.json({
      ok: true,
      site: 'CineAmit',
      image_base: imageBase(),
      user: await sessionUser(app, user),
      economy: eco.economy,
      wallet: eco.wallet,
      update,
      ga: { enabled: !!(Config.GA_MEASUREMENT_ID && Config.GA_API_SECRET) },
      ga_enabled: !!(Config.GA_MEASUREMENT_ID && Config.GA_API_SECRET),
    });
  }

async function app_update(app) {
    try {
      const meta = await AndroidApp.updateMeta();
      return app.json(Object.assign({ ok: true }, meta));
    } catch {
      app.res.status(500);
      return app.json({ ok: false, error: 'update' });
    }
  }

async function app_home(app) {
    const isKids = !!app.session.is_kids;
    let bundle = await require('../routes/main').loadHomeBundle(isKids);
    {
      bundle={...bundle};
      for (const key of ['trending','movies','shows','recommended','indian_movies','top_10_india','top_10_bollywood','top_10_hollywood','top_10_korean','south_movies','top_10_cartoons','popular_cartoons','netflix','prime','apple']) bundle[key]=await app.filterBlacklisted(bundle[key] || [],['shows','top_10_cartoons','popular_cartoons','netflix','prime','apple'].includes(key)?'tv':'movie');
      if (isKids) bundle.trending_actors=[];
    }
    const mk = (id, title, items, type, browse) => {
      const list = slimList(items, type).slice(0, 12);
      if (!list.length) return null;
      return { id, title, items: list, browse: browse || '' };
    };
    const rows = [];
    const addRow = (row) => { if (row) rows.push(row); };
    if (await app.isAuthenticated()) {
      try {
        const u = await app.currentUser();
        const library = await MediaLibrary.scope(app, u);
        const hist = await app.filterBlacklisted(dedupeMediaRows(await Database.fetchAll('SELECT tmdb_id, media_type, title, poster_path FROM watch_history WHERE ' + library.clause + ' ORDER BY watch_time DESC LIMIT 30', library.params)).slice(0, 15));
        const continueItems = [];
        for (const r of hist || []) {
          const it = await histItemFilled(r);
          if (it) continueItems.push(it);
        }
        if (continueItems.length) addRow({ id: 'continue', title: 'Continue Watching', items: continueItems, browse: '' });
        const wl = dedupeMediaRows(await Database.fetchAll('SELECT tmdb_id, media_type, title, poster_path FROM watchlist WHERE ' + library.clause + ' ORDER BY added_at DESC LIMIT 30', library.params)).slice(0, 15);
        const wlItems = (wl || []).map(histItem).filter(Boolean);
        if (wlItems.length) addRow({ id: 'watchlist', title: 'My Watchlist', items: wlItems, browse: '' });
        if (hist && hist[0]) {
          const rec = await TMDB.getRecommendations(hist[0].media_type, hist[0].tmdb_id).catch(() => []);
          addRow(mk('because', 'Because you watched "' + String(hist[0].title || '') + '"', rec, hist[0].media_type, TMDB.mt_safe(hist[0].media_type)));
        }
      } catch { /* guest-like */ }
    }
    addRow(mk('actors', 'Trending Actors', bundle.trending_actors, 'person', 'actors'));
    addRow(mk('india', 'Top 10 in India Today', (bundle.top_10_india || []).slice(0, 10), 'movie', 'movie'));
    addRow(mk('cartoons_top', 'Top 10 Cartoons', (bundle.top_10_cartoons || []).slice(0, 10), 'tv', 'tv'));
    addRow(mk('bollywood', 'Top 10 Bollywood Movies', bundle.top_10_bollywood, 'movie', 'movie'));
    addRow(mk('hollywood', 'Top 10 Hollywood Movies', bundle.top_10_hollywood, 'movie', 'movie'));
    addRow(mk('korean', 'Top 10 Korean Hits', bundle.top_10_korean, 'movie', 'movie'));
    addRow(mk('indian', 'Made in India', bundle.indian_movies, 'movie', 'movie'));
    addRow(mk('movies', 'Popular Movies', bundle.movies, 'movie', 'movie'));
    addRow(mk('south', 'Blockbuster South Movies', bundle.south_movies, 'movie', 'movie'));
    addRow(mk('netflix', 'Netflix Originals', bundle.netflix, 'tv', 'tv'));
    addRow(mk('prime', 'Amazon Prime Shows', bundle.prime, 'tv', 'tv'));
    addRow(mk('apple', 'Apple TV+ Exclusives', bundle.apple, 'tv', 'tv'));
    addRow(mk('tv', 'Top TV Shows', bundle.shows, 'tv', 'tv'));
    addRow(mk('cartoons', isKids ? 'Kids Shows' : 'Popular Cartoons', bundle.popular_cartoons, 'tv', 'tv'));
    if (!isKids) addRow(mk('anime', 'Popular Anime', bundle.anime, 'anime', 'anime'));
    const albumRow = (id, title, list) => {
      const items = (list || []).map((c) => {
        if (!c || !c.id) return null;
        return {
          id: Number(c.id),
          media_type: 'collection',
          title: String(c.name || c.title || ''),
          poster_path: String(c.poster_path || ''),
          backdrop_path: String(c.backdrop_path || ''),
          vote_average: 0, year: '', overview: '', runtime: 0, tagline: '', logo_path: '', genres: [],
        };
      }).filter(Boolean).slice(0, 12);
      if (items.length) addRow({ id, title, items, browse: 'albums' });
    };
    if (!isKids) {
      albumRow('superhero', 'Superhero Universes', bundle.superhero_albums);
      albumRow('epic', 'Epic Movie Franchises', bundle.epic_albums);
    }
    const studios = (bundle.top_studios || []).slice(0, 15).map((s) => ({
      id: Number(s.id || 0),
      name: String(s.name || ''),
      thumbnail_url: Number(s.id) ? '/api/studio_thumb/' + Number(s.id) : '',
    })).filter((s) => s.id);
    const providers = (bundle.top_providers || []).slice(0, 15).map((p) => ({
      provider_id: Number(p.provider_id || 0),
      provider_name: String(p.provider_name || ''),
      logo_path: String(p.logo_path || ''),
    })).filter((p) => p.provider_id);
    const trending = (bundle.trending || []).filter((it) => {
      if (!it || !it.id) return false;
      const t = String(it.media_type || '');
      if (t === 'person') return false;
      return !!(it.backdrop_path || it.poster_path);
    }).slice(0, 10);
    const logoJobs = trending.map(async (item) => {
      if (item.logo_path) return;
      try {
        item.logo_path = await logoFor(TMDB.mt_safe(String(item.media_type || 'movie')), item.id);
      } catch { item.logo_path = item.logo_path || ''; }
    });
    await Promise.race([Promise.all(logoJobs), sleep(1800)]);
    for (const row of rows) row.items=await app.filterBlacklisted(row.items || [],'movie');
    const user = await app.currentUser();
    return app.json({
      ok: true,
      image_base: imageBase(),
      user: await sessionUser(app, user),
      hero: slimList(trending),
      rows: rows.filter(row=>row.items.length),
      studios,
      providers,
    });
  }

async function app_title_logo(app, args) {
    const mediaType = TMDB.mt_safe(String(args.type || 'movie'));
    const tmdbId = Number(args.id);
    if (!tmdbId || await app.isBlacklisted(tmdbId) || (app.session.is_kids && !(await app.filterBlacklisted([{id:tmdbId,media_type:mediaType}],mediaType)).length)) {app.res.status(403);return app.json({ok:false,logo_path:''});}
    const logo_path = await logoFor(mediaType, tmdbId);
    return app.json({ ok: true, logo_path });
  }

async function app_search(app) {
    const q = String(app.req.query.q || '').trim();
    if (q.length < 2) return app.json({ ok: true, items: [], results: [] });
    let data = await TMDB.search(q, 1, 'multi');
    const items = slimList(await app.filterBlacklisted(data || []));
    return app.json({ ok: true, image_base: imageBase(), items, results: items });
  }

async function app_details(app, args) {
    const rawType = String(args.type || '');
    const tmdbId = Number(args.id);
    if (!tmdbId) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
    if (rawType === 'person') {
      if (app.session.is_kids) {app.res.status(403);return app.json({ok:false,error:'kids_restricted'});}
      const actor = await TMDB.getActorDetails(tmdbId);
      const d = (actor && actor.details) || null;
      if (!d || !d.id) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
      const item = slim({
        id: d.id,
        media_type: 'person',
        name: d.name,
        profile_path: d.profile_path,
        backdrop_path: '',
        overview: d.biography,
        birthday: d.birthday,
      }, 'person');
      const credits = ((actor && actor.credits) || []).filter((c) => c && (c.media_type === 'movie' || c.media_type === 'tv') && c.id);
      const similar = slimList(await app.filterBlacklisted(credits.slice(0, 20)));
      return app.json({
        ok: true, image_base: imageBase(), item, similar, cast: [], seasons: [],
        credit_pages: Math.max(1, Math.ceil(credits.length / 20)),
      });
    }
    const mediaType = TMDB.mt_safe(rawType);
    if (await app.isBlacklisted(tmdbId)) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
    const details = await TMDB.getDetails(mediaType, tmdbId);
    if (!details) { app.res.status(404); return app.json({ ok: false, error: 'not_found' }); }
    if (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType)) {
      app.res.status(403);
      return app.json({ ok: false, error: 'kids_restricted' });
    }
    const item = slim(details, mediaType);
    try { item.logo_path = item.logo_path || await logoFor(mediaType, tmdbId); } catch { /* keep */ }
    const similar = slimList(await app.filterBlacklisted((details.similar && details.similar.results) || [],mediaType), mediaType);
    const cast = ((details.credits && details.credits.cast) || []).slice(0, 20).map((c) => ({
      id: Number(c.id),
      name: String(c.name || ''),
      character: String(c.character || ''),
      profile_path: String(c.profile_path || ''),
      media_type: 'person',
    }));
    const seasons = (details.seasons || []).filter((s) => Number(s.season_number) > 0).map((s) => ({
      season_number: Number(s.season_number),
      name: String(s.name || ('Season ' + s.season_number)),
      episode_count: Number(s.episode_count || 0),
      poster_path: String(s.poster_path || ''),
    }));
    let inWatchlist = false;
    if (await app.isAuthenticated()) {
      try {
        const user = await app.currentUser();
        const library = await MediaLibrary.scope(app, user);
        const row = await Database.fetchOne('SELECT id FROM watchlist WHERE ' + library.clause + ' AND tmdb_id = ? AND media_type = ?', [...library.params, tmdbId, mediaType]);
        inWatchlist = !!row;
      } catch { inWatchlist = false; }
    }
    return app.json({ ok: true, image_base: imageBase(), item, similar, cast, seasons, in_watchlist: inWatchlist });
  }

async function app_person_credits(app, args) {
  if (app.session.is_kids) {app.res.status(403);return app.json({ok:false,error:'kids_restricted'});}
  const tmdbId = Number(args.id);
  const q = (app.req && app.req.query) || {};
  const page = Math.max(1, parseInt(String(q.page || q.p || '1'), 10) || 1);
  const per = 20;
  if (!tmdbId) { app.res.status(400); return app.json({ ok: false, error: 'invalid_title' }); }
  const actor = await TMDB.getActorDetails(tmdbId);
  const credits = ((actor && actor.credits) || []).filter((c) => c && (c.media_type === 'movie' || c.media_type === 'tv') && c.id);
  const totalPages = Math.max(1, Math.ceil(credits.length / per));
  const slice = credits.slice((page - 1) * per, page * per);
  return app.json({
    ok: true, image_base: imageBase(),
    items: slimList(slice),
    page,
    total_pages: totalPages,
  });
}

async function app_watch(app, args) {
    const viewer = await app.currentUser();
    if (viewer) await Profiles.ensureActive(app, viewer);
    const mediaType = TMDB.mt_safe(String(args.type));
    const tmdbId = Number(args.id);
    const s = Math.max(1, parseInt(app.req.query.s, 10) || 1);
    const e = Math.max(1, parseInt(app.req.query.e, 10) || 1);
    if (!tmdbId) { app.res.status(400); return app.json({ ok: false, error: 'invalid_title' }); }
    if (await app.isBlacklisted(tmdbId)) { app.res.status(404); return app.json({ ok: false, error: 'title_unavailable' }); }
    const details = (await TMDB.getDetails(mediaType, tmdbId)) || {};
    if (!details.id || Number(details.id)!==tmdbId) { app.res.status(404); return app.json({ ok: false, error: 'title_unavailable' }); }
    if (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType)) {
      app.res.status(403);
      return app.json({ ok: false, error: 'kids_restricted' });
    }
    const title = String(details.title || details.name || '');
    const servers = await embedServers(app, mediaType, tmdbId, s, e);
    const downloads = await downloadOptions(app, mediaType, tmdbId, title, s, e);
    const seasons = mediaType === 'tv'
      ? (details.seasons || []).filter((x) => Number(x.season_number) > 0).map((x) => ({
          season_number: Number(x.season_number),
          name: String(x.name || ('Season ' + x.season_number)),
          episode_count: Number(x.episode_count || 0),
        }))
      : [];
    let inWatchlist = false;
    if (viewer) {
      const library = await MediaLibrary.scope(app, viewer);
      inWatchlist = !!(await Database.fetchOne('SELECT id FROM watchlist WHERE ' + library.clause + ' AND tmdb_id = ? AND media_type = ?', [...library.params, tmdbId, mediaType]));
    }
    return app.json({
      ok: true,
      title: details.title || details.name || '',
      backdrop_path: String(details.backdrop_path || ''),
      media_type: mediaType,
      s,
      e,
      servers,
      downloads,
      seasons,
      in_watchlist: inWatchlist,
      autoplay_next: app.session.autoplay_next !== false,
    });
  }

async function app_episodes(app, args) {
    const tmdbId = Number(args.id);
    const season = Number(args.season);
    if (await app.isBlacklisted(tmdbId) || (app.session.is_kids && !(await app.filterBlacklisted([{id:tmdbId,media_type:'tv'}],'tv')).length)) return app.json({ok:true,episodes:[]});
    const data = await TMDB.rawGet(Config.TMDB_BASE_URL + '/tv/' + tmdbId + '/season/' + season + '?api_key=' + encodeURIComponent(Config.TMDB_API_KEY));
    const episodes = ((data && data.episodes) || []).map((ep) => ({
      episode_number: Number(ep.episode_number || 0),
      name: String(ep.name || ''),
      overview: String(ep.overview || ''),
      still_path: String(ep.still_path || ''),
      runtime: Number(ep.runtime || 0),
    }));
    return app.json({ ok: true, episodes });
  }

async function app_studios(app) {
    let studios = [];
    try { studios = (await loadStudioCatalog()).map(formatStudio); } catch {
      studios = getAllProductionStudios();
    }
    return app.json({ ok: true, image_base: imageBase(), studios });
  }

async function app_studio(app, args) {
    const page = Math.max(1, parseInt(app.req.query.page, 10) || 1);
    const items = slimList(await app.filterBlacklisted(await TMDB.getByCompany(Number(args.id), page)), 'movie');
    return app.json({ ok: true, image_base: imageBase(), items, page, total_pages: TMDB.lastTotalPages || 1 });
  }

async function app_providers(app) {
    const providers = (await TMDB.getAllProviders().catch(() => [])).slice(0, 80).map((p) => ({
      provider_id: Number(p.provider_id),
      provider_name: String(p.provider_name || ''),
      logo_path: String(p.logo_path || ''),
    }));
    return app.json({ ok: true, image_base: imageBase(), providers });
  }

async function app_provider(app, args) {
    const page = Math.max(1, parseInt(app.req.query.page, 10) || 1);
    const indian = [119, 2336, 220, 122, 237, 232, 238, 100, 315, 319, 255, 158, 309, 132, 561, 619, 532];
    const pid = Number(args.id);
    const region = indian.includes(pid) ? 'IN' : 'US';
    const items = slimList(await app.filterBlacklisted(await TMDB.getByProvider(pid, 'all', page, region)), 'movie');
    return app.json({ ok: true, image_base: imageBase(), items, page, total_pages: TMDB.lastTotalPages || 1 });
  }

async function app_iptv(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    if (app.session.is_kids) {
      app.res.status(403);
      return app.json({ ok: false, error: 'kids_restricted' });
    }
    const user = await app.currentUser();
    const kind = String(app.req.query.kind || 'movie');
    const q = String(app.req.query.q || '');
    const page = parseInt(app.req.query.page, 10) || 1;
    const language = String(app.req.query.language || 'All');
    const packed = await live.loadIptvVod(app, Number(user.id), kind, q, page, language);
    return app.json({ ok: true, ...packed });
  }

async function app_iptv_series(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    if (app.session.is_kids) {
      app.res.status(403);
      return app.json({ ok: false, error: 'kids_restricted' });
    }
    const user = await app.currentUser();
    const data = await live.loadIptvSeries(app, Number(user.id), String(app.req.query.id || ''));
    if (!data) {
      app.res.status(404);
      return app.json({ ok: false, error: 'not_found' });
    }
    return app.json({ ok: true, ...data });
  }

async function app_livetv(app) {
    if (!(await app.isAuthenticated())) {
      app.res.status(401);
      return app.json({ ok: false, error: 'login_required' });
    }
    if (app.session.is_kids) {
      app.res.status(403);
      return app.json({ ok: false, error: 'kids_restricted' });
    }
    return app.json({
      ok: true,
      device_only: true,
      channels: [],
      categories: ['All'],
      sources: ['stalker'],
      page: 1,
      per: 80,
      total: 0,
      total_pages: 1,
      stats: { m3u: 0, xtream: 0, stalker: 0, playlists: 0 },
      message: 'Live TV catalog and playback run on the user device (Android VLC). Website does not load portal channels.',
    });
  }

async function app_catalog(app, args) {
    const kind = String(args.kind || 'movie');
    const page = Math.max(1, parseInt(app.req.query.page, 10) || 1);
    const category = String(app.req.query.category || 'popular').replace(/[^a-z0-9_]/gi, '') || 'popular';
    let raw = [];
    let mediaType = 'movie';
    if (app.session.is_kids) {
      if (kind === 'tv' || kind === 'anime' || category === 'cartoons' || category === 'cartoons_top') {
        mediaType = 'tv';
        raw = await TMDB.getFilteredContent('tv', page, '10762', '', 'popularity.desc').catch(() => []);
      } else {
        mediaType = 'movie';
        raw = await TMDB.getFilteredContent('movie', page, '10751', '', 'popularity.desc').catch(() => []);
      }
    } else if (kind === 'tv') {
      mediaType = 'tv';
      if (category === 'netflix') raw = await TMDB.getByProvider(8, 'tv', page).catch(() => []);
      else if (category === 'prime') raw = await TMDB.getByProvider(119, 'tv', page).catch(() => []);
      else if (category === 'apple') raw = await TMDB.getByProvider(350, 'tv', page).catch(() => []);
      else if (category === 'cartoons') raw = await TMDB.getFilteredContent('tv', page, '16,10762', '', 'popularity.desc').catch(() => []);
      else if (category === 'korean') raw = await TMDB.getFilteredContent('tv', page, '', '', 'popularity.desc', '', 'KR').catch(() => []);
      else if (category === 'top_shows') raw = await TMDB.getTvShowsByCategory('top_rated', page).catch(() => []);
      else {
        const tvCat = category === 'now_playing' ? 'on_the_air' : (category === 'upcoming' ? 'on_the_air' : category);
        raw = await TMDB.getTvShowsByCategory(tvCat, page).catch(() => []);
      }
    } else if (kind === 'anime') {
      const sort = category === 'top_rated' ? 'vote_average.desc'
        : (category === 'now_playing' || category === 'upcoming' ? 'first_air_date.desc' : 'popularity.desc');
      raw = await TMDB.getAnime(page, sort).catch(() => []);
      mediaType = 'anime';
    } else if (category === 'indian' || category === 'india') {
      raw = await TMDB.getIndianMovies(page).catch(() => []);
    } else if (category === 'bollywood') {
      raw = await TMDB.getBollywoodMovies(page).catch(() => []);
    } else if (category === 'hollywood') {
      raw = await TMDB.getMoviesByCountry('US', page).catch(() => []);
    } else if (category === 'south') {
      raw = await TMDB.getSouthIndianMovies(page).catch(() => []);
    } else if (category === 'korean') {
      raw = await TMDB.getMoviesByCountry('KR', page).catch(() => []);
    } else {
      const movieCat = ['popular', 'top_rated', 'now_playing', 'upcoming'].includes(category) ? category : 'popular';
      raw = await TMDB.getMoviesByCategory(movieCat, page).catch(() => []);
    }
    const totalPages = Math.max(1, Number(TMDB.lastTotalPages) || 1);
    const items = slimList(await app.filterBlacklisted(raw || [],mediaType), mediaType);
    return app.json({
      ok: true,
      image_base: imageBase(),
      items,
      page,
      total_pages: totalPages,
    });
  }

async function app_filter(app) {
    const q = app.req.query || {};
    let mediaType = String(q.type || q.media_type || 'movie');
    if (mediaType !== 'tv' && mediaType !== 'all') mediaType = TMDB.mt_safe(mediaType);
    let genre = String(q.genre || '');
    const year = String(q.year || '');
    const sortBy = String(q.sort || 'popularity.desc');
    const query = String(q.q || '');
    const providerId = String(q.provider_id || '');
    const network = String(q.network || '');
    const country = String(q.country || '');
    const rating = String(q.rating || '');
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    if (app.session.is_kids) {
      genre = mediaType === 'tv' ? '10762' : '10751';
    }
    let raw = [];
    if (query) raw = await TMDB.search(query, page, mediaType === 'all' ? 'multi' : (mediaType || 'multi')).catch(() => []);
    else if (providerId) {
      const pidInt = Number(providerId);
      const indian = [119, 2336, 220, 122, 237, 232, 238, 100, 315, 319, 255, 158, 309, 132, 561, 619, 532];
      raw = await TMDB.getByProvider(pidInt, mediaType || 'all', page, indian.includes(pidInt) ? 'IN' : 'US', sortBy, genre, year, network, country, rating).catch(() => []);
    } else {
      raw = await TMDB.getFilteredContent(mediaType === 'tv' ? 'tv' : 'movie', page, genre, year, sortBy, network, country, rating).catch(() => []);
    }
    const slimType = mediaType === 'tv' ? 'tv' : 'movie';
    const items = slimList(await app.filterBlacklisted(raw || [],slimType), slimType);
    const totalPages = Math.max(1, Number(TMDB.lastTotalPages) || 1);
    return app.json({
      ok: true,
      image_base: imageBase(),
      items,
      page,
      total_pages: totalPages,
    });
  }


module.exports = { app_bootstrap, app_update, app_home, app_title_logo, app_search, app_details,
  app_person_credits, app_watch, app_episodes, app_studios, app_studio, app_providers, app_provider,
  app_iptv, app_iptv_series, app_livetv, app_catalog, app_filter };
