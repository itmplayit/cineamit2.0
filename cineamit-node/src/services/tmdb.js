'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const Config = require('../core/config');
const {AsyncLocalStorage}=require('async_hooks');
const requestState=new AsyncLocalStorage();
const outsideState={lastTotalPages:0,lastTotalResults:0,lastError:''};

const TMDB = {
  lastTotalPages: 0,
  lastTotalResults: 0,
  lastError: '',
  _blacklistMemo: null,
  _shardMem: {},
  _cacheDir: null,
};

function mt(t) {
  t = String(t || '').toLowerCase();
  if (t === 'tv' || t === 'anime' || t === 'show' || t === 'series') return 'tv';
  return 'movie';
}

TMDB.withRequestContext=(fn,options={})=>{
  const state=options.inherit ? {...(requestState.getStore() || outsideState)} : {lastTotalPages:0,lastTotalResults:0,lastError:''};
  // A guest HTML-cache revision and its rendered body must use one snapshot.
  if (Array.isArray(options.blacklist)) state.blacklistPromise=Promise.resolve([...options.blacklist]);
  return requestState.run(state,fn);
};
for (const key of ['lastTotalPages','lastTotalResults','lastError']) Object.defineProperty(TMDB,key,{enumerable:true,configurable:true,get(){return (requestState.getStore() || outsideState)[key];},set(v){(requestState.getStore() || outsideState)[key]=v;}});
TMDB.mt_safe = mt;
TMDB.lastErrorFn = () => TMDB.lastError;

TMDB.cacheDir = function cacheDir() {
  if (TMDB._cacheDir) return TMDB._cacheDir;
  const baseDir = path.resolve(__dirname, '../..');
  const cacheSuffix = crypto.createHash('sha256').update(baseDir).digest('hex').slice(0, 12);
  const tmpDir = path.join(os.tmpdir(), 'cineamit_tmdb_v3_' + cacheSuffix);
  try {
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(tmpDir, 0o700);
    if (fs.statSync(tmpDir).isDirectory()) {
      TMDB._cacheDir = tmpDir;
      return tmpDir;
    }
  } catch { /* fall through */ }
  const privateDir = path.join(path.dirname(baseDir), 'cineamit_private_cache_' + cacheSuffix);
  try {
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(privateDir, 0o700);
    TMDB._cacheDir = privateDir;
  } catch {
    console.error('[TMDB] no private writable cache directory; disk caching disabled');
    TMDB._cacheDir = privateDir;
  }
  return TMDB._cacheDir;
};

TMDB.pruneLegacyCache = function pruneLegacyCache() {
  const legacyDir = path.join(path.resolve(__dirname, '../..'), 'cache', 'tmdb_api_v2');
  if (!fs.existsSync(legacyDir)) return;
  try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch { /* ignore */ }
};

function shardRead(hash, ttl = 21600) {
  const shard = hash[0];
  const file = path.join(TMDB.cacheDir(), 'shard_v4_' + shard + '.json');
  if (!TMDB._shardMem[shard]) {
    try {
      TMDB._shardMem[shard] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      TMDB._shardMem[shard] = {};
    }
  }
  const entry = TMDB._shardMem[shard][hash];
  if (entry && typeof entry === 'object' && (Date.now() / 1000 - Number(entry.t)) < ttl && entry.d && typeof entry.d === 'object') {
    return entry.d;
  }
  return null;
}

function shardWrite(hash, data) {
  const shard = hash[0];
  const file = path.join(TMDB.cacheDir(), 'shard_v4_' + shard + '.json');
  const now = Math.floor(Date.now() / 1000);
  let bucket = {};
  try { bucket = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { bucket = {}; }
  for (const k of Object.keys(bucket)) {
    if (!bucket[k] || (now - Number(bucket[k].t || 0)) > 21600) delete bucket[k];
  }
  const keys = Object.keys(bucket);
  if (keys.length >= 45) {
    const keep = keys.slice(-35);
    const next = {};
    for (const k of keep) next[k] = bucket[k];
    bucket = next;
  }
  bucket[hash] = { t: now, d: data };
  try {
    fs.writeFileSync(file, JSON.stringify(bucket), { mode: 0o664 });
  } catch { /* ignore */ }
  TMDB._shardMem[shard] = bucket;
}

function circuitFile() {
  return path.join(TMDB.cacheDir(), 'tmdb_circuit_v1.json');
}
function circuitOpen() {
  try {
    const t = parseInt(fs.readFileSync(circuitFile(), 'utf8'), 10);
    return t > 0 && (Math.floor(Date.now() / 1000) - t) < 60;
  } catch { return false; }
}
function circuitTrip() {
  try { fs.writeFileSync(circuitFile(), String(Math.floor(Date.now() / 1000))); } catch { /* ignore */ }
}
function circuitReset() {
  try { fs.unlinkSync(circuitFile()); } catch { /* ignore */ }
}

function decodeHttpBody(buf, encoding) {
  const enc = String(encoding || '').toLowerCase();
  const tryDecoders = [];
  if (enc.includes('br')) tryDecoders.push((b) => zlib.brotliDecompressSync(b));
  if (enc.includes('gzip')) tryDecoders.push((b) => zlib.gunzipSync(b));
  if (enc.includes('deflate')) {
    tryDecoders.push((b) => zlib.inflateSync(b));
    tryDecoders.push((b) => zlib.inflateRawSync(b));
  }
  if (!tryDecoders.length && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    tryDecoders.push((b) => zlib.gunzipSync(b));
  }
  for (const dec of tryDecoders) {
    try { return dec(buf).toString('utf8'); } catch { /* next */ }
  }
  return buf.toString('utf8');
}

function httpGet(url, { timeout = 10000, insecure = false, redirects = 0 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch {
      resolve({ code: 0, body: '', error: 'bad url' });
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      resolve({ code: 0, body: '', error: 'bad protocol' });
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'CineAmit-Node/1.0',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate, identity',
      },
      timeout,
      rejectUnauthorized: !insecure,
    }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects < 4) {
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch {
          res.resume();
          resolve({ code, body: '', error: 'bad redirect' });
          return;
        }
        res.resume();
        resolve(httpGet(next, { timeout, insecure, redirects: redirects + 1 }));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ code, body: decodeHttpBody(buf, res.headers['content-encoding']) });
      });
    });
    req.on('error', (err) => {
      const msg = String((err && err.message) || 'unknown');
      // Certificate failures fail closed unless the owner explicitly opted in.
      // Never turn a DNS/timeout/other network failure into an insecure retry.
      if (!insecure && Config.TMDB_INSECURE_TLS_RETRY && /cert|UNABLE_TO_VERIFY|self[- ]signed|unable to verify|EPROTO/i.test(msg)) {
        console.error('[TMDB] TLS verify failed — explicit INSECURE retry (TMDB_INSECURE_TLS_RETRY=true).');
        resolve(httpGet(url, { timeout, insecure: true, redirects }));
        return;
      }
      resolve({ code: 0, body: '', error: msg });
    });
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: '', error: 'timeout' }); });
    req.end();
  });
}

async function fetchData(endpoint, params = {}) {
  if (circuitOpen()) {
    TMDB.lastError = 'TMDB temporarily unavailable (recent failure — retrying soon)';
    return null;
  }
  params.api_key = Config.TMDB_API_KEY;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = Config.TMDB_BASE_URL + endpoint + '?' + qs.toString();
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const cached = shardRead(hash, 21600);
  if (cached) {
    if (cached.total_pages != null) TMDB.lastTotalPages = Number(cached.total_pages);
    if (cached.total_results != null) TMDB.lastTotalResults = Number(cached.total_results);
    return applyBlacklist(cached);
  }
  // httpGet owns the single, certificate-error-only opt-in insecure retry.
  let result = await httpGet(url, { timeout: 10000 });
  if (result.code === 429) {
    await new Promise((r) => setTimeout(r, 400));
    // An HTTP rate-limit response is not a reason to disable TLS verification.
    result = await httpGet(url, { timeout: 10000 });
  }
  if (result.code === 0 || result.code >= 400) {
    if (result.code === 0 || result.code === 401 || result.code >= 500) circuitTrip();
    TMDB.lastError = result.code === 0
      ? ('network error: ' + (result.error || 'unknown'))
      : ('HTTP ' + result.code + ' — ' + (result.code === 401 ? 'invalid TMDB_API_KEY' : (result.code === 429 ? 'rate limited' : 'TMDB error')));
    console.error('TMDB API Error: HTTP ' + result.code + ' ' + (result.error || '') + ' (' + endpoint + ')');
    return null;
  }
  let data;
  try { data = JSON.parse(result.body); } catch {
    TMDB.lastError = 'TMDB returned invalid JSON';
    console.error('[TMDB] JSON parse failed (' + endpoint + ') http=' + result.code + ' body=' + String(result.body || '').slice(0, 120));
    return null;
  }
  if (data && typeof data === 'object') {
    circuitReset();
    if (data.total_pages != null) TMDB.lastTotalPages = Number(data.total_pages);
    if (data.total_results != null) TMDB.lastTotalResults = Number(data.total_results);
    if (!('results' in data) || (data.results && data.results.length)) shardWrite(hash, data);
    return applyBlacklist(data);
  }
  return null;
}

TMDB.blacklistSet = async function blacklistSet() {
  const state=requestState.getStore();
  if (state && state.blacklistPromise) return state.blacklistPromise;
  const read=async()=>{
    const rows=await require('../db').fetchAll('SELECT tmdb_id FROM content_blacklist',[]);
    const ids=rows.map(r=>Number(r.tmdb_id));
    if (state) state.blacklistIds=ids;
    return ids;
  };
  const promise=read();
  if (state) state.blacklistPromise=promise;
  return promise;
};
TMDB.reloadBlacklist = function reloadBlacklist() {
  const state=requestState.getStore();
  if (state) {delete state.blacklistPromise;delete state.blacklistIds;}
  TMDB._blacklistMemo=null; // Compatibility only; never an authorization cache.
  try {fs.unlinkSync(path.join(TMDB.cacheDir(),'blacklist_v1.json'));} catch {}
};
async function applyBlacklist(data) {
  if (!data || !Array.isArray(data.results)) return data;
  const blocked=new Set(await TMDB.blacklistSet());
  // Never destructively remove titles from the shared raw TMDB cache.
  return {...data,results:data.results.filter(it=>!it || it.id==null || !blocked.has(Number(it.id)))};
}

TMDB.getImages = (mediaType, tmdbId) => fetchData('/' + mt(mediaType) + '/' + tmdbId + '/images', { include_image_language: 'en,hi,null' });
TMDB.getImagesAll = (mediaType, tmdbId) => fetchData('/' + mt(mediaType) + '/' + tmdbId + '/images');
TMDB.getTrending = async (mediaType = 'all', timeWindow = 'day') => {
  const m = ['all', 'movie', 'tv', 'person'].includes(mediaType) ? mediaType : 'all';
  const tw = ['day', 'week'].includes(timeWindow) ? timeWindow : 'day';
  const data = await fetchData('/trending/' + m + '/' + tw);
  return (data && data.results) || [];
};
TMDB.getPopularPeople = async (page = 1) => {
  const data = await fetchData('/person/popular', { page: Math.max(1, Number(page) || 1) });
  const results = (data && data.results) || [];
  for (const p of results) if (p && !p.media_type) p.media_type = 'person';
  return results;
};
TMDB.getMoviesByCategory = async (category = 'popular', page = 1) => {
  const cat = String(category).replace(/[^a-z0-9_]/gi, '') || 'popular';
  const data = await fetchData('/movie/' + cat, { page });
  return ((data && data.results) || []).map(it=>({...it,media_type:'movie'}));
};
TMDB.getTvShowsByCategory = async (category = 'popular', page = 1) => {
  const cat = String(category).replace(/[^a-z0-9_]/gi, '') || 'popular';
  const data = await fetchData('/tv/' + cat, { page });
  return ((data && data.results) || []).map(it=>({...it,media_type:'tv'}));
};
TMDB.getAnime = async (page = 1, sortBy = 'popularity.desc') => {
  const sort = String(sortBy || 'popularity.desc');
  const data = await fetchData('/discover/tv', { with_genres: '16', with_original_language: 'ja', sort_by: sort, page });
  return ((data && data.results) || []).map(it=>({...it,media_type:'tv'}));
};
TMDB.getDetails = (mediaType, tmdbId) => {
  const type = mt(mediaType);
  const ratingsAppend = type === 'movie' ? 'release_dates' : 'content_ratings';
  return fetchData('/' + type + '/' + tmdbId, { append_to_response: 'videos,credits,similar,external_ids,' + ratingsAppend });
};
TMDB.search = async (query, page = 1, mediaType = 'multi') => {
  const endpoint = ['movie', 'tv'].includes(mediaType) ? '/search/' + mediaType : '/search/multi';
  const data = await fetchData(endpoint, { query, page });
  const results = (data && data.results) || [];
  if (['movie', 'tv'].includes(mediaType)) for (const item of results) item.media_type = mediaType;
  return results;
};

const MULTI_ID_MAP = {
  8: '8|1796', 9: '9|119|10', 119: '119|9|10', 122: '2336|122|220', 220: '2336|220|122',
  2336: '2336|220|122', 283: '283|284', 284: '283|284', 350: '350|2', 384: '1899|384',
  1899: '1899|384', 386: '386|387', 531: '531|582|1770',
};
const INDIAN_FIRST = [119, 2336, 220, 122, 237, 232, 238, 100, 315, 319, 255, 158, 309, 132, 561, 619, 532];
let providerRegionsMap = null;

async function resolveProviderConfig(providerId, preferredRegion = 'US') {
  const providerQuery = MULTI_ID_MAP[providerId] || String(providerId);
  let regions = [];
  if (INDIAN_FIRST.includes(providerId)) regions = ['IN', 'US'];
  else if (preferredRegion) regions = [preferredRegion];
  if (!providerRegionsMap) {
    providerRegionsMap = {};
    for (const p of await TMDB.getAllProviders()) {
      const pid = Number(p.provider_id || 0);
      if (pid > 0 && p.display_priorities && typeof p.display_priorities === 'object') {
        const dp = p.display_priorities;
        const keys = Object.keys(dp).sort((a, b) => (dp[a] || 0) - (dp[b] || 0));
        providerRegionsMap[pid] = keys;
      }
    }
  }
  const validForProvider = providerRegionsMap[providerId] || [];
  if (validForProvider.length) {
    const ordered = [];
    if (INDIAN_FIRST.includes(providerId) && validForProvider.includes('IN')) ordered.push('IN');
    if (!ordered.includes(validForProvider[0])) ordered.push(validForProvider[0]);
    for (const maj of ['US', 'IN', 'GB', 'CA', 'AU']) {
      if (validForProvider.includes(maj) && !ordered.includes(maj)) ordered.push(maj);
    }
    for (const r of validForProvider.slice(0, 4)) if (!ordered.includes(r)) ordered.push(r);
    regions = ordered;
  } else {
    for (const fallbackReg of ['US', 'IN', 'GB']) if (!regions.includes(fallbackReg)) regions.push(fallbackReg);
  }
  return [providerQuery, [...new Set(regions)]];
}

async function fetchProviderContent(providerId, mediaType, page, region, sortBy, genre, year, network = '', country = '', rating = '') {
  const [providerQuery, candidateRegions] = await resolveProviderConfig(providerId, region);
  const m = mt(mediaType);
  const baseParams = { sort_by: sortBy || 'popularity.desc', page };
  if (genre) baseParams.with_genres = genre;
  if (year) {
    if (m === 'movie') baseParams.primary_release_year = year;
    else baseParams.first_air_date_year = year;
  }
  if (network) baseParams.with_networks = network;
  if (country) baseParams.with_origin_country = country;
  if (rating) { baseParams['vote_average.gte'] = rating; baseParams['vote_count.gte'] = 50; }
  baseParams.with_watch_providers = providerQuery;
  let results = [];
  for (const tryRegion of candidateRegions.slice(0, 3)) {
    const params = { ...baseParams, watch_region: tryRegion };
    const data = await fetchData('/discover/' + m, params);
    results = (data && data.results) || [];
    if (results.length) break;
  }
  for (const item of results) item.media_type = m;
  return results;
}

TMDB.getByProvider = async function getByProvider(providerId, mediaType = 'all', page = 1, region = 'US', sortBy = 'popularity.desc', genre = '', year = '', network = '', country = '', rating = '') {
  if (mediaType === 'all') {
    const movies = await fetchProviderContent(providerId, 'movie', page, region, sortBy, genre, year, network, country, rating);
    const moviePages = TMDB.lastTotalPages;
    const movieResults = TMDB.lastTotalResults;
    const shows = await fetchProviderContent(providerId, 'tv', page, region, sortBy, genre, year, network, country, rating);
    TMDB.lastTotalPages = Math.max(moviePages, TMDB.lastTotalPages);
    TMDB.lastTotalResults = movieResults + TMDB.lastTotalResults;
    let results = movies.concat(shows);
    results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    // A provider-labelled response must never fall back to unfiltered content.
    return results;
  }
  // Preserve both provider and requested media-type constraints. Empty is honest;
  // unrelated movies/shows must not appear under a provider or category heading.
  return fetchProviderContent(providerId, mediaType, page, region, sortBy, genre, year, network, country, rating);
};

TMDB.getIndianMovies = async (page = 1) => {
  const data = await fetchData('/discover/movie', { with_origin_country: 'IN', sort_by: 'popularity.desc', page });
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = 'movie';
  return results;
};
TMDB.getMoviesByCountry = async (countryCode, page = 1) => {
  const data = await fetchData('/discover/movie', { with_origin_country: countryCode, sort_by: 'popularity.desc', page });
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = 'movie';
  return results;
};
TMDB.getBollywoodMovies = async (page = 1) => {
  const data = await fetchData('/discover/movie', { with_origin_country: 'IN', with_original_language: 'hi', sort_by: 'popularity.desc', page });
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = 'movie';
  return results;
};
TMDB.getSouthIndianMovies = async (page = 1) => {
  const data = await fetchData('/discover/movie', { with_original_language: 'te|ta|ml|kn', sort_by: 'popularity.desc', page });
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = 'movie';
  return results;
};
TMDB.getPerson = (personId) => fetchData('/person/' + personId);
TMDB.getFilteredContent = async (mediaType = 'movie', page = 1, genre = '', year = '', sortBy = 'popularity.desc', network = '', country = '', rating = '') => {
  const params = { page, sort_by: sortBy, watch_region: 'IN' };
  if (genre) params.with_genres = genre;
  if (year) {
    if (mediaType === 'movie') params.primary_release_year = year;
    else params.first_air_date_year = year;
  }
  if (network) params.with_networks = network;
  if (country) params.with_origin_country = country;
  if (rating) { params['vote_average.gte'] = rating; params['vote_count.gte'] = 50; }
  const data = await fetchData('/discover/' + mt(mediaType), params);
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = mt(mediaType);
  return results;
};
TMDB.getTrailer = async (mediaType, tmdbId) => {
  const data = await fetchData('/' + mt(mediaType) + '/' + tmdbId + '/videos');
  const results = (data && data.results) || [];
  const yt = results.filter((v) => (v.site || '') === 'YouTube' && v.key);
  const prefer = ['Trailer', 'Teaser', 'Opening Credits', 'Clip', 'Featurette'];
  for (const type of prefer) {
    const hit = yt.find((v) => (v.type || '') === type);
    if (hit) return hit.key;
  }
  return yt.length ? yt[0].key : null;
};
TMDB.getRecommendations = async (mediaType, tmdbId, page = 1) => {
  const data = await fetchData('/' + mt(mediaType) + '/' + tmdbId + '/recommendations', { page });
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = mediaType;
  return results;
};
TMDB.getActorDetails = async (personId) => {
  const details = await fetchData('/person/' + personId);
  const credits = await fetchData('/person/' + personId + '/combined_credits');
  const cast = (credits && credits.cast) || [];
  cast.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return { details, credits: cast };
};
TMDB.getAllProviders = async () => {
  const movieData = await fetchData('/watch/providers/movie', { language: 'en-US' });
  const tvData = await fetchData('/watch/providers/tv', { language: 'en-US' });
  const results = ((movieData && movieData.results) || []).concat((tvData && tvData.results) || []);
  const unique = {};
  for (const item of results) {
    const pid = Number(item.provider_id || 0);
    if (pid <= 0) continue;
    if (!unique[pid]) unique[pid] = item;
    else if (item.display_priorities && typeof item.display_priorities === 'object') {
      unique[pid].display_priorities = { ...(unique[pid].display_priorities || {}), ...item.display_priorities };
    }
  }
  const preferredOrder = [8, 119, 2336, 337, 350, 237, 232, 1899, 15, 283, 531, 386, 561, 309, 315, 11];
  const preferredFlip = {};
  preferredOrder.forEach((id, i) => { preferredFlip[id] = i; });
  const final = Object.values(unique);
  final.sort((a, b) => {
    const pa = preferredFlip[Number(a.provider_id || 0)];
    const pb = preferredFlip[Number(b.provider_id || 0)];
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return (a.display_priority || 999) - (b.display_priority || 999);
  });
  return final;
};

TMDB.rawGet = async function rawGet(url) {
  if (!url.startsWith('https://api.themoviedb.org/3/')) return null;
  if (circuitOpen()) {
    TMDB.lastError = 'TMDB temporarily unavailable (recent failure — retrying soon)';
    return null;
  }
  const hash = crypto.createHash('md5').update('raw_v2:' + url).digest('hex');
  const cached = shardRead(hash, 21600);
  if (cached) {
    if (cached.total_pages != null) TMDB.lastTotalPages = Number(cached.total_pages);
    if (cached.total_results != null) TMDB.lastTotalResults = Number(cached.total_results);
    return applyBlacklist(cached);
  }
  const result = await httpGet(url, { timeout: 10000 });
  if (result.code === 0) {
    TMDB.lastError = 'network error: ' + (result.error || 'unknown');
    return null;
  }
  if (result.code < 200 || result.code >= 300) {
    if (result.code === 401 || result.code >= 500) circuitTrip();
    TMDB.lastError = 'HTTP ' + result.code + (result.code === 401 ? ' (invalid TMDB_API_KEY)' : (result.code === 429 ? ' (rate limited)' : ''));
    return null;
  }
  TMDB.lastError = '';
  let data;
  try { data = JSON.parse(result.body); } catch {
    console.error('[TMDB] JSON parse failed (raw) http=' + result.code + ' body=' + String(result.body || '').slice(0, 120));
    return null;
  }
  if (data && typeof data === 'object') {
    circuitReset();
    if (data.total_pages != null) TMDB.lastTotalPages = Number(data.total_pages);
    if (data.total_results != null) TMDB.lastTotalResults = Number(data.total_results);
    shardWrite(hash, data);
    return applyBlacklist(data);
  }
  return null;
};

TMDB.getCollection = (id) => fetchData('/collection/' + id);
TMDB.searchCollections = async (query, page = 1) => ((await fetchData('/search/collection', { query, page })) || {}).results || [];
TMDB.searchCompany = async (query, page = 1) => {
  const data = await fetchData('/search/company', { query, page });
  return (data && data.results) || [];
};
TMDB.getByCompany = async (companyId, page = 1) => {
  const data = await fetchData('/discover/movie', { with_companies: companyId, sort_by: 'popularity.desc', page });
  const results = (data && data.results) || [];
  for (const item of results) item.media_type = 'movie';
  return results;
};
TMDB.company = async (companyId) => {
  if (companyId <= 0) return null;
  const url = Config.TMDB_BASE_URL + '/company/' + companyId + '?api_key=' + encodeURIComponent(Config.TMDB_API_KEY);
  const data = await TMDB.rawGet(url);
  return data && typeof data === 'object' ? data : null;
};
TMDB.companyLogoUrl = async (companyId, size = 'w500') => {
  const data = await TMDB.company(companyId);
  const logo = String((data && data.logo_path) || '');
  if (!logo) return '';
  return String(Config.TMDB_IMAGE_BASE).replace(/\/+$/, '') + '/' + size + '/' + logo.replace(/^\/+/, '');
};

TMDB._httpGet = httpGet;
module.exports = TMDB;
