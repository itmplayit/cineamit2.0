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


// People/studios/albums/mood/provider routes (moved verbatim from routes/main.js).
function registerMediaRoutes() {
  add('/provider/{provider_id}/{media_type}', 'routes.provider', async (app, args) => {
    const providerId = Number(args.provider_id);
    const mediaType = String(args.media_type || 'movie');
    const indianProviders = [119, 2336, 220, 122, 237, 232, 238, 100, 315, 319, 255, 158, 309, 132, 561, 619, 532];
    const region = indianProviders.includes(providerId) ? 'IN' : 'US';
    const namedProviders = {
      8: { name: 'Netflix', icon: 'fa-brands fa-neos text-red-600' },
      119: { name: 'Amazon Prime Video', icon: 'fa-brands fa-amazon text-[#00A8E1]' },
      9: { name: 'Amazon Prime Video', icon: 'fa-brands fa-amazon text-[#00A8E1]' },
      337: { name: 'Disney+', icon: 'fa-solid fa-plus text-[#113CCF]' },
      2336: { name: 'JioHotstar', icon: 'fa-solid fa-star text-pink-500' },
      384: { name: 'Max', icon: 'fa-solid fa-m text-[#5719B2]' },
      1899: { name: 'Max', icon: 'fa-solid fa-m text-[#5719B2]' },
      15: { name: 'Hulu', icon: 'fa-solid fa-h text-[#1CE783]' },
      350: { name: 'Apple TV+', icon: 'fa-brands fa-apple text-gray-200' },
      531: { name: 'Paramount+', icon: 'fa-solid fa-mountain text-[#0064FF]' },
      386: { name: 'Peacock', icon: 'fa-solid fa-feather text-white' },
      283: { name: 'Crunchyroll', icon: 'fa-solid fa-hurricane text-[#F47521]' },
      284: { name: 'Crunchyroll', icon: 'fa-solid fa-hurricane text-[#F47521]' },
      220: { name: 'JioCinema', icon: 'fa-solid fa-play text-pink-500' },
      122: { name: 'Hotstar', icon: 'fa-solid fa-plus text-blue-500' },
      237: { name: 'SonyLIV', icon: 'fa-solid fa-tv text-orange-500' },
      232: { name: 'ZEE5', icon: 'fa-solid fa-z text-purple-500' },
      561: { name: 'Lionsgate Play', icon: 'fa-solid fa-film text-amber-500' },
      309: { name: 'Sun NXT', icon: 'fa-solid fa-sun text-yellow-500' },
      315: { name: 'Hoichoi', icon: 'fa-solid fa-clapperboard text-red-500' },
    };
    let providerName = String(app.req.query.name || 'Streaming Provider');
    let icon = 'fa-solid fa-play text-red-500';
    if (namedProviders[providerId]) {
      providerName = namedProviders[providerId].name;
      icon = namedProviders[providerId].icon;
    }
    const page = pageNum(app.req.query.page);
    const isKids = !!app.session.is_kids;
    let data;
    if (isKids) {
      const allowedGenres = mediaType === 'tv' ? '10762' : '10751';
      data = await TMDB.getFilteredContent(mediaType === 'all' ? 'movie' : mediaType, page, allowedGenres, '', 'popularity.desc');
    } else {
      data = await TMDB.getByProvider(providerId, mediaType, page, region);
    }
    data = await app.filterBlacklisted(data,mediaType);
    if ((!data || !data.length) && !isKids && page <= 1 && !TMDB.lastError) {
      app.res.status(404);
      return app.renderNotFound();
    }
    const nameQ = String(app.req.query.name || '').trim();
    const providerQs = nameQ ? ('name=' + encodeURIComponent(nameQ)) : '';
    return app.render('category.html', {
      title: 'Popular on ' + providerName,
      items: data,
      media_type: mediaType === 'all' ? 'movie' : mediaType,
      icon,
      content_type: 'provider',
      provider_id: providerId,
      current_page: page,
      total_pages: TMDB.lastTotalPages,
      pagination_qs: providerQs,
    });
  });

  add('/providers', 'routes.all_providers', async (app) => {
    let providers = await TMDB.getAllProviders().catch(() => []);
    if (!Array.isArray(providers) || !providers.length) {
      providers = [
        { provider_id: 8, provider_name: 'Netflix', logo_path: '' },
        { provider_id: 119, provider_name: 'Amazon Prime Video', logo_path: '' },
        { provider_id: 337, provider_name: 'Disney+', logo_path: '' },
        { provider_id: 2336, provider_name: 'JioHotstar', logo_path: '' },
        { provider_id: 350, provider_name: 'Apple TV+', logo_path: '' },
        { provider_id: 384, provider_name: 'Max', logo_path: '' },
        { provider_id: 15, provider_name: 'Hulu', logo_path: '' },
        { provider_id: 531, provider_name: 'Paramount+', logo_path: '' },
        { provider_id: 283, provider_name: 'Crunchyroll', logo_path: '' },
        { provider_id: 237, provider_name: 'SonyLIV', logo_path: '' },
        { provider_id: 232, provider_name: 'ZEE5', logo_path: '' },
        { provider_id: 561, provider_name: 'Lionsgate Play', logo_path: '' },
        { provider_id: 309, provider_name: 'Sun NXT', logo_path: '' },
        { provider_id: 315, provider_name: 'Hoichoi', logo_path: '' },
        { provider_id: 122, provider_name: 'Hotstar', logo_path: '' },
        { provider_id: 220, provider_name: 'JioCinema', logo_path: '' },
      ];
    }
    return app.render('providers.html', { providers });
  });

  add('/actor/{slug}', 'routes.actor', async (app, args) => {
    if (app.session.is_kids) {app.res.status(403);return app.json({ok:false,error:'kids_restricted'});}
    const personId = tmdbIdFromSlug(args.slug);
    const actorData = await TMDB.getActorDetails(personId);
    if (!actorData.details) { if (tmdbTemporarilyUnavailable(app)) return; app.res.status(404); return app.renderNotFound(); }
    return app.render('actor.html', { actor: actorData.details, credits: actorData.credits });
  });

  add('/actors', 'routes.actors_list', async (app) => {
    if (app.session.is_kids) {app.res.status(403);return app.json({ok:false,error:'kids_restricted'});}
    const page = pageNum(app.req.query.page);
    const data = await TMDB.getPopularPeople(page);
    return app.render('view_all.html', {
      title: 'Popular Actors', items: data, media_type: 'person', icon: 'fa-users',
      content_type: 'popular_actors', current_page: page, total_pages: TMDB.lastTotalPages, pagination_qs: '',
    });
  });

  add('/surprise', 'routes.surprise', async (app) => {
    const trending = await app.filterBlacklisted(await TMDB.getTrending('movie', 'week'));
    const pick = trending[Math.floor(Math.random() * Math.max(1, trending.length))] || null;
    if (!pick) return app.redirect(app.urlFor('routes.home'));
    return app.redirect(app.urlFor('routes.details', { media_type: 'movie', tmdb_id: pick.id, title: pick.title || '' }));
  });

  add('/albums', 'routes.albums', async (app) => {
    if (app.session.is_kids) {app.res.status(403);return app.renderNotFound();}
    const query = String(app.req.query.q || '').trim();
    let results = [];
    if (query) results = await TMDB.searchCollections(query, 1);
    return app.render('albums.html', { collections: results, query });
  });

  add('/album/{id}', 'routes.album_view', async (app, args) => {
    if (app.session.is_kids) {app.res.status(403);return app.renderNotFound();}
    const collection = await TMDB.getCollection(Number(args.id));
    if (!collection) { app.res.status(404); return app.renderNotFound(); }
    return app.render('collection_view.html', { collection, items: collection.parts || [] });
  });

  add('/studio/{id}', 'routes.studio', async (app, args) => {
    if (app.session.is_kids) {
      app.flash('Studios browse is restricted in Kids Mode.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    const page = pageNum(app.req.query.page);
    const id = Number(args.id);
    const items = await app.filterBlacklisted(await TMDB.getByCompany(id, page));
    const name = String(app.req.query.name || 'Production Studio');
    if ((!items || !items.length) && page <= 1 && !TMDB.lastError) {
      app.res.status(404);
      return app.renderNotFound();
    }
    return app.render('view_all.html', {
      items, title: name + ' Movies', media_type: 'movie', current_page: page,
      total_pages: TMDB.lastTotalPages, category_url: '/studio/' + id + '?name=' + encodeURIComponent(name),
    });
  });

  add('/studios', 'routes.all_studios', async (app) => {
    const studios = (await loadStudioCatalog()).map(formatStudio);
    return app.render('studios.html', { studios });
  });

  add('/mood/{mood_name}', 'routes.mood_filter', async (app, args) => {
    const isKids = !!app.session.is_kids;
    const moodName = String(args.mood_name || '');
    if (isKids && ['scary', 'thrill', 'romantic', 'mind_bending'].includes(moodName)) {
      app.flash('This mood is not available for Kids.', 'error');
      return app.redirect(app.urlFor('routes.home'));
    }
    const moods = {
      chill: { genre: '35', title: 'Had a bad day? Laugh it off!', icon: 'fa-face-laugh-squint text-yellow-500' },
      scary: { genre: '27', title: 'In the mood for Nightmares', icon: 'fa-ghost text-gray-400' },
      thrill: { genre: '28', title: 'Need an Adrenaline Rush', icon: 'fa-bolt text-blue-500' },
      mind_bending: { genre: '878', title: 'Mind-Bending & Sci-Fi', icon: 'fa-brain text-purple-500' },
      romantic: { genre: '10749', title: 'Romantic Night', icon: 'fa-heart text-pink-500' },
    };
    const mood = moods[moodName];
    if (!mood) { app.res.status(404); return app.renderNotFound(); }
    if (isKids && moodName === 'chill') mood.genre = '35,16';
    const page = pageNum(app.req.query.page);
    const items = await app.filterBlacklisted(await TMDB.getFilteredContent('movie', page, mood.genre, '', 'popularity.desc'));
    return app.render('category.html', {
      title: mood.title, items, media_type: 'movie', icon: mood.icon,
      content_type: 'filter_page', genre: mood.genre, current_page: page,
      total_pages: TMDB.lastTotalPages, pagination_qs: '',
    });
  });

}

module.exports = { registerMediaRoutes };
