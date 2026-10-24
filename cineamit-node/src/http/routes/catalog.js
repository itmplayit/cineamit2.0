'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Config = require('../../core/config');
const Database = require('../../db');
const SiteStatus = require('../../services/site-status');
const Security = require('../../security');
const TMDB = require('../../services/tmdb');
const { add } = require('../../core/router');
const { cineamitKidsContentAllowed } = require('../../services/kids');
const { ssrfSafeHttpGet, ssrfBlockedHostAsync, ssrfResolveRedirectUrl } = require('../../security/ssrf');
const live = require('../../services/live');
const { CinePlayerAccess, CineDownloadAccess } = require('../../services/player-access');
const { getAllProductionStudios, getAllCuratedAlbums, loadStudioCatalog, formatStudio } = require('../../services/studios');
const Economy = require('../../services/economy');
const AdsOps = require('../../services/ads-ops');
const AndroidApp = require('../../android-app');
const WatchLimit = require('../../services/watch-limit');
const App = require('../../core/app');
const Profiles = require('../../services/profiles');
const Playlists = require('../../services/playlists');
const MediaLibrary = require('../../services/media-library');
const { tmdbIdFromSlug, activePid, dedupeMediaRows, writePid, requireProfileManagement,
  mediaScopeForUser, userMediaScope, profilePageExtras, cineWrapStats, csvSafe, csvStamp, sendCsv,
  tmdbTemporarilyUnavailable, pageNum, requireStaff, validateServerPattern, validateDownloadPattern,
  shuffleInPlace, warmKeyMatches, rowMissing, homeBundleCoreReady, homeBundleRowsReady, hydrateHomeRows,
  loadHomeBundle, parseM3uLines, parseM3uPlaylist, parseXtreamServer, xtreamClearCache, wrapLiveUrls } = require('./home-bundle');


// Home/catalog/browse routes (moved verbatim from routes/main.js).
function registerCatalogRoutes() {
  add('/', 'routes.index', async (app) => {
    if (await app.isAuthenticated()) return app.redirect(app.urlFor('routes.home'));
    app.markCacheableGuestPage();
    if (!app.res.headersSent) app.res.set('Cache-Control', 'public, max-age=3600');
    return app.render('index.html');
  });

  add('/home', 'routes.home', async (app) => {
    const isKids = !!app.session.is_kids;
    const warmKey = String(Config.WARM_KEY || '');
    const forceWarm = warmKey !== '' && app.req.query.warm != null && warmKeyMatches(app.req.query.key);
    const bundle = await loadHomeBundle(isKids, forceWarm);

    let continueWatching = [];
    let userWatchlist = [];
    let recommendedForYou = [];
    let lastWatched = null;
    const user = await app.currentUser();
    const profileId = Number(app.session.active_profile_id || 0);
    if (user) {
      try {
        const wlScope = await userMediaScope(app, user);
        const wlRecords = dedupeMediaRows(await Database.fetchAll(
          'SELECT tmdb_id, media_type, title, poster_path FROM watchlist WHERE ' + wlScope.clause + ' ORDER BY added_at DESC LIMIT 40',
          wlScope.params
        )).slice(0, 15);
        for (const r of wlRecords) {
          userWatchlist.push({
            id: r.tmdb_id,
            media_type: r.media_type,
            title: r.title,
            poster_path: r.poster_path,
          });
        }
      } catch { /* ignore */ }
      try {
        const histScope = await userMediaScope(app, user);
        const records = dedupeMediaRows(await Database.fetchAll(
          'SELECT * FROM watch_history WHERE ' + histScope.clause + ' ORDER BY watch_time DESC LIMIT 20',
          histScope.params
        )).slice(0, 10);
        for (const r of records) {
          continueWatching.push({
            tmdb_id: r.tmdb_id,
            media_type: r.media_type,
            title: r.title,
            poster_path: r.poster_path,
            watch_time: r.watch_time,
            progress: null,
          });
        }
      } catch { /* ignore */ }
      if (continueWatching.length) {
        lastWatched = continueWatching[0];
        try {
          recommendedForYou = await TMDB.getRecommendations(lastWatched.media_type, lastWatched.tmdb_id);
        } catch { recommendedForYou = []; }
      }
    }
    if (!user) {
      app.markCacheableGuestPage();
      if (!app.res.headersSent) app.res.set('Cache-Control', 'public, max-age=3600');
    } else if (!app.res.headersSent) {
      app.res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    const list = (v) => (Array.isArray(v) ? v : []);
    const movies = list(bundle.movies);
    const shows = list(bundle.shows);
    if (!isKids && (!movies.length || !shows.length || !list(bundle.indian_movies).length)) {
      console.error('[home] TMDB rows empty movies=' + movies.length + ' shows=' + shows.length + ' indian=' + list(bundle.indian_movies).length + ' lastError=' + (TMDB.lastError || ''));
    }
    return app.render('home.html', {
      all_providers: list(bundle.all_providers),
      top_providers: list(bundle.top_providers),
      indian_movies: list(bundle.indian_movies),
      trending: list(bundle.trending),
      movies,
      shows,
      anime: list(bundle.anime),
      recommended: list(bundle.recommended),
      continue_watching: continueWatching,
      south_movies: list(bundle.south_movies),
      netflix: list(bundle.netflix),
      prime: list(bundle.prime),
      apple: list(bundle.apple),
      top_10_india: list(bundle.top_10_india),
      user_watchlist: userWatchlist,
      recommended_for_you: recommendedForYou,
      last_watched: lastWatched,
      top_10_bollywood: list(bundle.top_10_bollywood),
      top_10_hollywood: list(bundle.top_10_hollywood),
      top_10_cartoons: list(bundle.top_10_cartoons),
      popular_cartoons: list(bundle.popular_cartoons),
      top_10_korean: list(bundle.top_10_korean),
      is_kids: isKids,
      trending_actors: list(bundle.trending_actors),
      superhero_albums: list(bundle.superhero_albums),
      epic_albums: list(bundle.epic_albums),
      top_studios: list(bundle.top_studios).length ? list(bundle.top_studios) : getAllProductionStudios().slice(0, 15),
    });
  });

  add('/search', 'routes.search', async (app) => {
    const query = String(app.req.query.q || app.req.query.query || '').trim().slice(0, 200);
    const page = pageNum(app.req.query.page);
    let results = [];
    if (query) results = await app.filterBlacklisted(await TMDB.search(query, page, 'multi'));
    return app.render('search.html', { query, results, current_page: page, total_pages: TMDB.lastTotalPages });
  });

  add('/details/{media_type}/{slug}', 'routes.details', async (app, args) => {
    if (String(args.media_type || '') === 'person') {
      return app.redirect('/actor/' + encodeURIComponent(String(args.slug || '')));
    }
    const mediaType = TMDB.mt_safe(String(args.media_type));
    const tmdbId = tmdbIdFromSlug(args.slug);
    if (!tmdbId || String(args.slug || '').includes('{')) { app.res.status(404); return app.renderNotFound(); }
    if (await app.isBlacklisted(tmdbId)) { app.res.status(404); return app.renderNotFound(); }
    const details = await TMDB.getDetails(mediaType, tmdbId);
    if (!details || !details.id) { if (tmdbTemporarilyUnavailable(app)) return; app.res.status(404); return app.renderNotFound(); }
    if (app.session.is_kids && !cineamitKidsContentAllowed(details, mediaType)) {
      app.flash('This content is restricted in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    let inWatchlist = false;
    const user = await app.currentUser();
    if (user) {
      const wlScope = await userMediaScope(app, user);
      const row = await Database.fetchOne('SELECT id FROM watchlist WHERE ' + wlScope.clause + ' AND tmdb_id = ? AND media_type = ?', [...wlScope.params, tmdbId, mediaType]);
      inWatchlist = !!row;
    }
    let reviews = [];
    try { reviews = await Database.fetchAll('SELECT r.*, u.username FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.tmdb_id = ? AND r.media_type = ? ORDER BY r.timestamp DESC LIMIT 50', [tmdbId, mediaType]); } catch {}
    const title = details.title || details.name || '';
    const watchUrl = app.urlFor('player.watch', { media_type: mediaType, tmdb_id: tmdbId, title });
    return app.render('details.html', {
      details,
      data: details,
      media_type: mediaType,
      tmdb_id: tmdbId,
      in_watchlist: inWatchlist,
      reviews,
      watch_url: watchUrl,
    });
  });

  add('/movies', 'routes.movies', async (app) => {
    const page = pageNum(app.req.query.page);
    const isKids = !!app.session.is_kids;
    const data = await app.filterBlacklisted(await TMDB.getMoviesByCategory('popular', page));
    return app.render('view_all.html', {
      title: isKids ? 'Kids Movies' : 'Popular Movies', items: data, media_type: 'movie',
      icon: 'fa-film', content_type: 'movies', current_page: page, total_pages: TMDB.lastTotalPages, pagination_qs: '',
    });
  });

  add('/series', 'routes.series', async (app) => {
    const page = pageNum(app.req.query.page);
    const isKids = !!app.session.is_kids;
    const data = await app.filterBlacklisted(await TMDB.getTvShowsByCategory('popular', page),'tv');
    return app.render('view_all.html', {
      title: isKids ? 'Kids TV Shows' : 'TV Series', items: data, media_type: 'tv',
      icon: 'fa-tv', content_type: 'series', current_page: page, total_pages: TMDB.lastTotalPages, pagination_qs: '',
    });
  });

  add('/anime', 'routes.anime', async (app) => {
    const page = pageNum(app.req.query.page);
    const data = await app.filterBlacklisted(await TMDB.getAnime(page),'tv');
    return app.render('view_all.html', {
      title: 'Anime Collection', items: data, media_type: 'tv', icon: 'fa-d-and-d',
      content_type: 'anime', current_page: page, total_pages: TMDB.lastTotalPages, pagination_qs: '',
    });
  });

  add('/filter', 'routes.filter_page', async (app) => {
    let mediaType = String(app.req.query.type || app.req.query.media_type || '');
    let genre = String(app.req.query.genre || '');
    const year = String(app.req.query.year || '');
    const sortBy = String(app.req.query.sort || 'popularity.desc');
    let query = String(app.req.query.q || '');
    const providerId = String(app.req.query.provider_id || '');
    const network = String(app.req.query.network || '');
    const country = String(app.req.query.country || '');
    const rating = String(app.req.query.rating || '');
    const page = pageNum(app.req.query.page);
    const isKids = !!app.session.is_kids;
    if (isKids) {
      genre = mediaType === 'tv' ? '10762' : '10751';
      query = '';
    }
    let data;
    let contentTypeVal = 'filter_page';
    if (query) {
      data = await TMDB.search(query, page, mediaType || 'multi');
      contentTypeVal = 'search';
    } else if (providerId) {
      const pidInt = Number(providerId);
      const indianProvIds = [119, 2336, 220, 122, 237, 232, 238, 100, 315, 319, 255, 158, 309, 132, 561, 619, 532];
      const provReg = indianProvIds.includes(pidInt) ? 'IN' : 'US';
      data = await TMDB.getByProvider(pidInt, mediaType || 'all', page, provReg, sortBy, genre, year, network, country, rating);
      contentTypeVal = 'provider';
    } else {
      data = await TMDB.getFilteredContent(mediaType || 'movie', page, genre, year, sortBy, network, country, rating);
    }
    data = await app.filterBlacklisted(data || [],mediaType);
    const filterQs = new URLSearchParams();
    const qs = { type: mediaType, genre, year, sort: sortBy, q: query, provider_id: providerId, network, country, rating };
    for (const [k, v] of Object.entries(qs)) {
      if (v !== '' && v != null) filterQs.set(k, v);
    }
    return app.render('category.html', {
      title: providerId ? 'Provider Filters Applied' : 'Filtered Results',
      items: data,
      media_type: mediaType || 'movie',
      icon: 'fa-sliders',
      content_type: contentTypeVal,
      provider_id: providerId,
      genre, year, sort: sortBy, query, network, country, rating,
      current_page: page, total_pages: TMDB.lastTotalPages, pagination_qs: filterQs.toString(),
    });
  });

  add('/movies/{category}', 'routes.movies_category', async (app, args) => {
    const page = pageNum(app.req.query.page);
    const category = String(args.category || '').toLowerCase();
    if (app.session.is_kids) {
      const items = await app.filterBlacklisted(await TMDB.getFilteredContent('movie', page, '10751', '', 'popularity.desc'));
      return app.render('view_all.html', {
        items, title: 'Kids Collection', media_type: 'movie', current_page: page,
        total_pages: TMDB.lastTotalPages, category_url: '/movies/' + category,
      });
    }
    let items = [];
    let title = 'Movies';
    switch (category) {
      case 'bollywood': items = await TMDB.getBollywoodMovies(page); title = 'Top Bollywood Movies'; break;
      case 'hollywood': items = await TMDB.getMoviesByCountry('US', page); title = 'Hollywood Blockbusters'; break;
      case 'south': items = await TMDB.getSouthIndianMovies(page); title = 'Blockbuster South Movies'; break;
      case 'popular': items = await TMDB.getMoviesByCategory('popular', page); title = 'Popular Movies'; break;
      case 'indian': items = await TMDB.getIndianMovies(page); title = 'Made in India'; break;
      case 'top-10-india': items = await TMDB.getIndianMovies(page); title = 'Top 10 in India Today'; break;
      default:
        app.res.status(404);
        return app.renderNotFound();
    }
    items = await app.filterBlacklisted(items);
    return app.render('view_all.html', {
      items, title, media_type: 'movie', current_page: page,
      total_pages: TMDB.lastTotalPages, category_url: '/movies/' + category,
    });
  });

  add('/shows/{category}', 'routes.shows_category', async (app, args) => {
    const page = pageNum(app.req.query.page);
    const category = String(args.category || '').toLowerCase();
    if (app.session.is_kids) {
      const items = await app.filterBlacklisted(await TMDB.getFilteredContent('tv', page, '10762', '', 'popularity.desc'),'tv');
      return app.render('view_all.html', {
        items, title: 'Kids Shows', media_type: 'tv', current_page: page,
        total_pages: TMDB.lastTotalPages, category_url: '/shows/' + category,
      });
    }
    let items = [];
    let title = 'TV Shows';
    switch (category) {
      case 'netflix': items = await TMDB.getByProvider(8, 'tv', page); title = 'Netflix Originals'; break;
      case 'prime': items = await TMDB.getByProvider(119, 'tv', page); title = 'Amazon Prime Shows'; break;
      case 'apple': items = await TMDB.getByProvider(350, 'tv', page); title = 'Apple TV+ Exclusives'; break;
      case 'top': items = await TMDB.getTvShowsByCategory('popular', page); title = 'Top TV Shows'; break;
      case 'anime': items = await TMDB.getAnime(page); title = 'Popular Anime'; break;
      case 'korean': items = await TMDB.getFilteredContent('tv',page,'','','popularity.desc','','KR'); title = 'Korean Hits'; break;
      default:
        app.res.status(404);
        return app.renderNotFound();
    }
    items = await app.filterBlacklisted(items,'tv');
    return app.render('view_all.html', {
      items, title, media_type: 'tv', current_page: page,
      total_pages: TMDB.lastTotalPages, category_url: '/shows/' + category,
    });
  });

}

module.exports = { registerCatalogRoutes };
