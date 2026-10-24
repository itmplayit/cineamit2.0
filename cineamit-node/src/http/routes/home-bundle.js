'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Config = require('../../core/config');
const Database = require('../../db');
const SiteStatus = require('../../services/site-status');
const Security = require('../../security');
const TMDB = require('../../services/tmdb');
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

// Shared route helpers + home-page bundle loader (moved verbatim from routes/main.js).
function tmdbIdFromSlug(slug) {
  const parts = String(slug).split('-');
  return Number(parts[parts.length - 1] || slug) || 0;
}
function activePid(app) {
  return Number(app.session.active_profile_id || 0);
}
function dedupeMediaRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const k = String(r.media_type || '') + ':' + String(r.tmdb_id || r.id || '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
async function writePid(app, user) {
  const profile = await Profiles.ensureActive(app, user);
  if (!profile) throw new Error('profile_required');
  return Number(profile.id);
}
async function requireProfileManagement(app, user) {
  const result = await Profiles.authorizeManagement(app, user);
  if (!result.ok) {
    app.flash(result.error === 'adult_required' ? 'Kids profiles cannot manage profiles or PINs.' : 'Enter your account password to manage profiles or PINs.', 'error');
    app.redirect('/profiles');
    return false;
  }
  return true;
}
async function mediaScopeForUser(uid, opts) {
  uid = Number(uid);
  const pid = Number((opts && opts.pid) || 0);
  if (opts && opts.isKids) {
    return { clause: 'user_id = ? AND profile_id IN (?, 0)', params: [uid, pid] };
  }
  let kids = [];
  try {
    const rows = await Database.fetchAll(
      'SELECT id FROM user_profiles WHERE user_id = ? AND (is_kids = 1 OR is_kids = \'1\')',
      [uid]
    );
    for (const r of rows || []) {
      const id = Number(r.id);
      if (Number.isFinite(id) && id > 0) kids.push(id);
    }
  } catch {}
  kids = [...new Set(kids)];
  if (!kids.length) {
    return { clause: 'user_id = ?', params: [uid] };
  }
  return {
    clause: 'user_id = ? AND (profile_id IS NULL OR profile_id NOT IN (' + kids.map(() => '?').join(', ') + '))',
    params: [uid, ...kids],
  };
}
async function userMediaScope(app, user) {
  return MediaLibrary.scope(app, user);
}
async function profilePageExtras(app, user) {
  const pid = activePid(app);
  let active_profile = null;
  try {
    if (pid > 0) {
      active_profile = await Database.fetchOne('SELECT * FROM user_profiles WHERE id = ? AND user_id = ?', [pid, user.id]);
    }
    if (!active_profile) {
      active_profile = await Database.fetchOne('SELECT * FROM user_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1', [user.id]);
    }
  } catch { active_profile = null; }
  if (active_profile) {
    active_profile = Object.assign({}, active_profile, { pin: active_profile.pin ? '1' : '' });
  } else {
    active_profile = { theme_color: 'red', avatar_image: '', autoplay_next: 1, default_server: 'auto', pin: '', binge_streak: 0 };
  }
  let hist = [];
  try {
    const histScope = await userMediaScope(app, user);
    hist = await Database.fetchAll(
      'SELECT tmdb_id, media_type, genres FROM watch_history WHERE ' + histScope.clause + ' ORDER BY watch_time DESC',
      histScope.params
    ) || [];
  } catch { hist = []; }
  hist = dedupeMediaRows(hist);
  let movies = 0;
  let tv = 0;
  const counts = {};
  for (const r of hist) {
    if (String(r.media_type || '').toLowerCase() === 'tv') tv += 1;
    else movies += 1;
    for (const g of String(r.genres || '').split(',')) {
      const name = g.trim();
      if (!name) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  const palette = {
    Action: 'bg-red-500', Comedy: 'bg-yellow-500', Drama: 'bg-blue-500', Horror: 'bg-purple-500',
    Romance: 'bg-pink-500', 'Science Fiction': 'bg-cyan-500', Thriller: 'bg-orange-500',
    Animation: 'bg-green-500', Adventure: 'bg-emerald-500', Crime: 'bg-slate-500',
  };
  const cycle = ['bg-red-500', 'bg-yellow-500', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-cyan-500'];
  const totalG = Object.values(counts).reduce((a, b) => a + b, 0);
  const watch_dna = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n], i) => ({
    name,
    percentage: totalG ? Math.max(1, Math.round((n * 100) / totalG)) : 0,
    color: palette[name] || cycle[i % cycle.length],
  }));
  if (watch_dna.length) {
    const sum = watch_dna.reduce((a, x) => a + x.percentage, 0);
    watch_dna[0].percentage = Math.max(1, watch_dna[0].percentage + (100 - sum));
  }
  let reviews = 0;
  try {
    const row = await Database.fetchOne('SELECT COUNT(*) AS c FROM reviews WHERE user_id = ?', [user.id]);
    reviews = Number((row && row.c) || 0);
  } catch { reviews = 0; }
  let friends = [];
  try {
    friends = await Database.fetchAll(
      `SELECT u.username, u.match_code,
              (SELECT p.avatar_image FROM user_profiles p WHERE p.user_id = u.id AND p.is_kids = 0 ORDER BY p.id ASC LIMIT 1) AS profile_image
         FROM users u
        WHERE u.id IN (
          SELECT friend_id FROM cine_match_friends WHERE user_id = ?
          UNION
          SELECT user_id FROM cine_match_friends WHERE friend_id = ?
        )
        LIMIT 20`,
      [user.id, user.id]
    ) || [];
  } catch { friends = []; }
  const badges = [];
  if (movies + tv > 0) badges.push({ icon: 'fa-play text-red-400', name: 'First Watch', desc: 'Started watching' });
  if (movies >= 10) badges.push({ icon: 'fa-film text-amber-400', name: 'Movie Buff', desc: movies + ' movies' });
  if (tv >= 10) badges.push({ icon: 'fa-tv text-blue-400', name: 'Series Binge', desc: tv + ' shows' });
  if (reviews >= 1) badges.push({ icon: 'fa-pen text-green-400', name: 'Critic', desc: reviews + ' reviews' });
  const streak = Number(active_profile.binge_streak || 0);
  if (streak >= 3) badges.push({ icon: 'fa-fire text-orange-400', name: 'On a Streak', desc: streak + ' days' });
  let is_premium = false;
  try {
    const w = await Economy.getWallet(user.id);
    is_premium = !!(w && (w.plan === 'monthly' || w.plan === 'yearly' || w.plan === 'trial'));
  } catch { is_premium = false; }
  return {
    active_profile,
    watch_dna,
    friends,
    stats: { movies, shows: tv, reviews },
    badges,
    is_premium,
  };
}
function cineWrapStats(hist) {
  const history = Array.isArray(hist) ? hist : [];
  let movies = 0;
  let tv = 0;
  const buckets = [];
  const idx = new Map();
  for (const row of history) {
    const mt = String(row.media_type || '').toLowerCase();
    if (mt === 'tv') tv += 1;
    else movies += 1;
    let d = row.watch_time;
    if (!(d instanceof Date)) d = d ? new Date(d) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const lab = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    if (!idx.has(lab)) {
      idx.set(lab, buckets.length);
      buckets.push({ lab, n: 0, key: d.toISOString().slice(0, 7) });
    }
    buckets[idx.get(lab)].n += 1;
  }
  buckets.sort((a, b) => a.key.localeCompare(b.key));
  const total = history.length;
  return {
    history,
    total,
    wrap_total: total,
    movies,
    tv,
    months_labels: JSON.stringify(buckets.map((b) => b.lab)),
    months_data: JSON.stringify(buckets.map((b) => b.n)),
  };
}
function csvSafe(v) {
  let s = String(v ?? '');
  if (s !== '' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function sendCsv(app, filename, header, rows) {
  const lines = [header.map(csvSafe).join(',')];
  for (const row of rows) lines.push(row.map(csvSafe).join(','));
  app.res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Cache-Control': 'private, no-store, max-age=0',
    Vary: 'Cookie',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  app.res.send('\uFEFF' + lines.join('\n'));
  app._ended = true;
}
function tmdbTemporarilyUnavailable(app) {
  if (!TMDB.lastError || /^HTTP 404(?:\s|$)/.test(TMDB.lastError)) return false;
  app.res.status(503).set({'Retry-After':'60','Cache-Control':'no-store'}).type('text/plain').send('Title information is temporarily unavailable. Please retry shortly.');
  app._ended=true;return true;
}

function pageNum(q) {
  return require('../../seo').pageNumber(q);
}
async function requireStaff(app, roles = ['owner', 'super_admin', 'editor']) {
  if (!(await app.requireLogin())) return false;
  return app.requireRole(roles);
}
function validateServerPattern(p) {
  p = String(p || '').trim();
  if (!p || p.length > 500) return '';
  if (!/^https:\/\//i.test(p)) return '';
  return p;
}
function validateDownloadPattern(p) {
  p = String(p || '').trim();
  if (!p || p.length > 500) return '';
  if (!/^https?:\/\//i.test(p)) return '';
  return p;
}


const CURATED_ACTOR_IDS = [
  35742, 113, 37818, 500, 111004, 287, 35748, 1245, 42286, 3223,
  1108120, 18918, 56712, 69597, 35776, 73968, 10859, 134794, 976, 137446, 8169,
];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function warmKeyMatches(provided) {
  const key = String(Config.WARM_KEY || '');
  const got = String(provided || '');
  if (!key || key.length !== got.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(got, 'utf8'));
  } catch {
    return false;
  }
}

function rowMissing(v) {
  return !Array.isArray(v) || !v.length;
}

function homeBundleCoreReady(bundle, isKids) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (rowMissing(bundle.trending) || rowMissing(bundle.movies)) return false;
  if (!isKids && rowMissing(bundle.shows)) return false;
  return true;
}

function homeBundleRowsReady(bundle, isKids) {
  if (!homeBundleCoreReady(bundle, isKids)) return false;
  if (rowMissing(bundle.top_studios)) return false;
  if (isKids) return !rowMissing(bundle.top_10_cartoons);
  const keys = [
    'indian_movies', 'south_movies', 'netflix', 'prime', 'apple', 'anime',
    'top_10_india', 'top_10_bollywood', 'top_10_hollywood', 'top_10_korean',
    'top_10_cartoons', 'popular_cartoons', 'trending_actors',
    'superhero_albums', 'epic_albums',
  ];
  return keys.every((k) => !rowMissing(bundle[k]));
}

async function hydrateHomeRows(bundle, isKids) {
  if (!bundle.top_studios || rowMissing(bundle.top_studios)) {
    bundle.top_studios = getAllProductionStudios().slice(0, 15);
  }
  const jobs = [];
  const fill = (key, promise, map) => {
    if (!rowMissing(bundle[key])) return;
    jobs.push(
      Promise.resolve()
        .then(() => promise())
        .then((r) => { bundle[key] = map ? map(r || []) : (r || []); })
        .catch(() => { if (rowMissing(bundle[key])) bundle[key] = []; })
    );
  };

  if (isKids) {
    if (rowMissing(bundle.top_10_cartoons) || rowMissing(bundle.popular_cartoons) || rowMissing(bundle.shows)) {
      jobs.push((async () => {
        const cartoonPack = await Promise.all([
          TMDB.getFilteredContent('tv', 1, '10762', '', 'popularity.desc').catch(() => []),
          TMDB.getFilteredContent('tv', 2, '10762', '', 'popularity.desc').catch(() => []),
        ]);
        if (rowMissing(bundle.top_10_cartoons)) bundle.top_10_cartoons = (cartoonPack[0] || []).slice(0, 10);
        if (rowMissing(bundle.popular_cartoons)) bundle.popular_cartoons = cartoonPack[1] || [];
        if (rowMissing(bundle.shows)) bundle.shows = cartoonPack[0] || [];
      })());
    }
    await Promise.all(jobs);
    return bundle;
  }

  fill('movies', () => TMDB.getMoviesByCategory('popular'));
  fill('shows', () => TMDB.getTvShowsByCategory('popular'));
  fill('anime', () => TMDB.getAnime());
  fill('indian_movies', () => TMDB.getIndianMovies(1));
  fill('south_movies', () => TMDB.getSouthIndianMovies(1));
  fill('netflix', () => TMDB.getByProvider(8, 'tv'));
  fill('prime', () => TMDB.getByProvider(119, 'tv'));
  fill('apple', () => TMDB.getByProvider(350, 'tv'));
  fill('top_10_bollywood', () => TMDB.getBollywoodMovies(1), (r) => r.slice(0, 10));
  fill('top_10_hollywood', () => TMDB.getMoviesByCountry('US', 1), (r) => r.slice(0, 10));
  fill('top_10_korean', () => TMDB.getMoviesByCountry('KR', 1), (r) => r.slice(0, 10));
  if (rowMissing(bundle.top_10_cartoons) || rowMissing(bundle.popular_cartoons)) {
    jobs.push((async () => {
      const cartoonPack = await Promise.all([
        TMDB.getFilteredContent('tv', 1, '10762', '', 'popularity.desc').catch(() => []),
        TMDB.getFilteredContent('tv', 2, '10762', '', 'popularity.desc').catch(() => []),
      ]);
      if (rowMissing(bundle.top_10_cartoons)) bundle.top_10_cartoons = (cartoonPack[0] || []).slice(0, 10);
      if (rowMissing(bundle.popular_cartoons)) bundle.popular_cartoons = cartoonPack[1] || [];
    })());
  }
  if (rowMissing(bundle.trending_actors)) {
    jobs.push((async () => {
      const people = await Promise.all(CURATED_ACTOR_IDS.map((id) => TMDB.getPerson(id).catch(() => null)));
      const curated = [];
      for (const person of people) {
        if (person && person.profile_path) {
          curated.push({
            id: person.id,
            name: person.name,
            profile_path: person.profile_path,
            media_type: 'person',
          });
        }
      }
      bundle.trending_actors = curated;
    })());
  }
  if (rowMissing(bundle.superhero_albums) || rowMissing(bundle.epic_albums)) {
    const allAlbums = getAllCuratedAlbums();
    jobs.push((async () => {
      const albumPack = await Promise.all([
        Promise.all((allAlbums.superhero || []).map((id) => TMDB.getCollection(id).catch(() => null))),
        Promise.all((allAlbums.epic || []).map((id) => TMDB.getCollection(id).catch(() => null))),
      ]);
      if (rowMissing(bundle.superhero_albums)) bundle.superhero_albums = (albumPack[0] || []).filter(Boolean);
      if (rowMissing(bundle.epic_albums)) bundle.epic_albums = (albumPack[1] || []).filter(Boolean);
    })());
  }
  await Promise.all(jobs);
  if (rowMissing(bundle.top_10_india)) bundle.top_10_india = (bundle.indian_movies || []).slice(0, 10);
  if (rowMissing(bundle.recommended)) bundle.recommended = bundle.movies || [];
  return bundle;
}

async function loadHomeBundle(isKids, forceWarm) {
  const bundleCacheFile = path.join(TMDB.cacheDir(), 'home_bundle_' + (isKids ? 'kids' : 'std') + '_v5.json');
  if (!forceWarm) {
    try {
      const st = fs.statSync(bundleCacheFile);
      if (Date.now() - st.mtimeMs < 86400 * 1000) {
        const decoded = JSON.parse(fs.readFileSync(bundleCacheFile, 'utf8'));
        if (homeBundleCoreReady(decoded, isKids)) {
          const bundle = Object.assign({}, decoded);
          await hydrateHomeRows(bundle, isKids);
          if (Array.isArray(bundle.trending_actors) && bundle.trending_actors.length > 1) {
            bundle.trending_actors = bundle.trending_actors.slice();
            shuffleInPlace(bundle.trending_actors);
          }
          if (homeBundleRowsReady(bundle, isKids) && !homeBundleRowsReady(decoded, isKids)) {
            try { fs.writeFileSync(bundleCacheFile, JSON.stringify(bundle)); } catch { /* ignore */ }
          }
          return bundle;
        }
      }
    } catch { /* miss */ }
  }

  let allProviders = [];
  let topProviders = [];
  let trending = [];
  let movies = [];
  let shows = [];
  let anime = [];
  let recommended = [];
  let indianMovies = [];
  let netflix = [];
  let prime = [];
  let apple = [];
  let southMovies = [];
  let top10India = [];
  let top10Bollywood = [];
  let top10Hollywood = [];
  let top10Korean = [];
  let curatedActors = [];
  let superheroAlbums = [];
  let epicAlbums = [];

  if (isKids) {
    const kidsPack = await Promise.all([
      TMDB.getAllProviders().catch(() => []),
      TMDB.getFilteredContent('movie', 1, '10751', '', 'popularity.desc').catch(() => []),
      TMDB.getFilteredContent('tv', 1, '10762', '', 'popularity.desc').catch(() => []),
      TMDB.getFilteredContent('movie', 1, '10751', '', 'vote_average.desc').catch(() => []),
    ]);
    allProviders = kidsPack[0] || [];
    topProviders = allProviders.slice(0, 15);
    trending = kidsPack[1] || [];
    movies = kidsPack[1] || [];
    shows = kidsPack[2] || [];
    anime = [];
    recommended = kidsPack[3] || [];
    indianMovies = kidsPack[1] || [];
  } else {
    const pack = await Promise.all([
      TMDB.getAllProviders().catch(() => []),
      TMDB.getTrending('all', 'day').catch(() => []),
      TMDB.getMoviesByCategory('popular').catch(() => []),
      TMDB.getTvShowsByCategory('popular').catch(() => []),
      TMDB.getAnime().catch(() => []),
      TMDB.getMoviesByCategory('top_rated', 1).catch(() => []),
      TMDB.getIndianMovies(1).catch(() => []),
      TMDB.getSouthIndianMovies(1).catch(() => []),
      TMDB.getByProvider(8, 'tv').catch(() => []),
      TMDB.getByProvider(119, 'tv').catch(() => []),
      TMDB.getByProvider(350, 'tv').catch(() => []),
      TMDB.getBollywoodMovies(1).catch(() => []),
      TMDB.getMoviesByCountry('US', 1).catch(() => []),
      TMDB.getMoviesByCountry('KR', 1).catch(() => []),
    ]);
    allProviders = pack[0] || [];
    topProviders = allProviders.slice(0, 15);
    trending = pack[1] || [];
    movies = pack[2] || [];
    shows = pack[3] || [];
    anime = pack[4] || [];
    recommended = pack[5] || [];
    indianMovies = pack[6] || [];
    southMovies = pack[7] || [];
    netflix = pack[8] || [];
    prime = pack[9] || [];
    apple = pack[10] || [];
    top10India = (indianMovies || []).slice(0, 10);
    top10Bollywood = (pack[11] || []).slice(0, 10);
    top10Hollywood = (pack[12] || []).slice(0, 10);
    top10Korean = (pack[13] || []).slice(0, 10);

    const actorCache = path.join(TMDB.cacheDir(), 'curated_actors.json');
    try {
      const st = fs.statSync(actorCache);
      if (Date.now() - st.mtimeMs < 86400 * 1000) {
        const cached = JSON.parse(fs.readFileSync(actorCache, 'utf8'));
        if (Array.isArray(cached) && cached.length) curatedActors = cached;
      }
    } catch { /* miss */ }
    if (!curatedActors.length) {
      const people = await Promise.all(CURATED_ACTOR_IDS.map((id) => TMDB.getPerson(id)));
      for (const person of people) {
        if (person && person.profile_path) {
          curatedActors.push({
            id: person.id,
            name: person.name,
            profile_path: person.profile_path,
            media_type: 'person',
          });
        }
      }
      if (curatedActors.length) {
        try { fs.writeFileSync(actorCache, JSON.stringify(curatedActors)); } catch { /* ignore */ }
      }
    }
    if (curatedActors.length > 1) shuffleInPlace(curatedActors);

    const allAlbums = getAllCuratedAlbums();
    const albumPack = await Promise.all([
      Promise.all((allAlbums.superhero || []).map((id) => TMDB.getCollection(id))),
      Promise.all((allAlbums.epic || []).map((id) => TMDB.getCollection(id))),
    ]);
    superheroAlbums = (albumPack[0] || []).filter(Boolean);
    epicAlbums = (albumPack[1] || []).filter(Boolean);
  }

  const topStudios = getAllProductionStudios().slice(0, 15);
  const cartoonPack = await Promise.all([
    TMDB.getFilteredContent('tv', 1, '10762', '', 'popularity.desc').catch(() => []),
    TMDB.getFilteredContent('tv', 2, '10762', '', 'popularity.desc').catch(() => []),
  ]);
  const top10Cartoons = (cartoonPack[0] || []).slice(0, 10);
  const popularCartoons = cartoonPack[1] || [];

  if (Array.isArray(trending) && trending.length) {
    const logoSlice = trending.slice(0, 10);
    const logos = await Promise.all(logoSlice.map(async (item) => {
      const mediaType = TMDB.mt_safe(String((item && item.media_type) || 'movie'));
      const tmdbId = Number(item && item.id);
      return TMDB.getImages(mediaType, tmdbId);
    }));
    for (let key = 0; key < logoSlice.length; key++) {
      const imagesData = logos[key];
      if (imagesData && Array.isArray(imagesData.logos) && imagesData.logos.length) {
        let best = imagesData.logos[0].file_path || null;
        for (const logo of imagesData.logos) {
          if (logo.iso_639_1 === 'en') { best = logo.file_path; break; }
        }
        trending[key].logo_path = best;
      } else {
        trending[key].logo_path = null;
      }
    }
  }

  const bundle = {
    all_providers: allProviders || [],
    top_providers: topProviders || [],
    indian_movies: indianMovies || [],
    trending: trending || [],
    movies: movies || [],
    shows: shows || [],
    anime: anime || [],
    recommended: recommended || [],
    south_movies: southMovies || [],
    netflix: netflix || [],
    prime: prime || [],
    apple: apple || [],
    top_10_india: top10India || [],
    top_10_bollywood: top10Bollywood || [],
    top_10_hollywood: top10Hollywood || [],
    top_10_cartoons: top10Cartoons || [],
    popular_cartoons: popularCartoons || [],
    top_10_korean: top10Korean || [],
    trending_actors: curatedActors || [],
    superhero_albums: superheroAlbums || [],
    epic_albums: epicAlbums || [],
    top_studios: topStudios || [],
  };
  await hydrateHomeRows(bundle, isKids);
  if (homeBundleCoreReady(bundle, isKids)) {
    try { fs.writeFileSync(bundleCacheFile, JSON.stringify(bundle)); } catch { /* ignore */ }
  }
  return bundle;
}

const parseM3uLines = (...a) => live.parseM3uLines(...a);
const parseM3uPlaylist = (...a) => live.parseM3uPlaylist(...a);
const parseXtreamServer = (...a) => live.parseXtreamServer(...a);
const xtreamClearCache = (...a) => live.xtreamClearCache(...a);
const wrapLiveUrls = (...a) => live.wrapLiveUrls(...a);

module.exports = { tmdbIdFromSlug, activePid, dedupeMediaRows, writePid, requireProfileManagement,
  mediaScopeForUser, userMediaScope, profilePageExtras, cineWrapStats, csvSafe, csvStamp, sendCsv,
  tmdbTemporarilyUnavailable, pageNum, requireStaff, validateServerPattern, validateDownloadPattern,
  shuffleInPlace, warmKeyMatches, rowMissing, homeBundleCoreReady, homeBundleRowsReady, hydrateHomeRows,
  loadHomeBundle, parseM3uLines, parseM3uPlaylist, parseXtreamServer, xtreamClearCache, wrapLiveUrls };
