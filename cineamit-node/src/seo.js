'use strict';

const Config = require('./core/config');
const BRAND = 'CINEAMIT';
const PUBLIC = new Set(['/', '/home', '/movies', '/series', '/anime', '/actors', '/albums', '/studios', '/providers', '/blog', '/app', '/premium', '/about', '/faq', '/help', '/contact', '/privacy', '/terms', '/dmca', '/legal']);
const PUBLIC_DETAIL = /^\/(?:details\/(?:movie|tv)\/[^/]+|actor\/[^/]+|blog\/[^/]+|help\/article\/[^/]+|album\/\d+|studio\/\d+|provider\/\d+\/(?:movie|tv)|movies\/(?:bollywood|hollywood|south|popular|indian|top-10-india)|shows\/(?:netflix|prime|apple|top|anime|korean))$/;
const SENSITIVE = /^(?:\/(?:api|auth|login|logout|register|forgot_password|verify_otp|reset_password|setup|profile|profiles|history|watchlist|playlists|playlist|notifications|cine-match|cine-wrapped|cineamit-admin|admin|watch|download|play_external|play_external_stream|surprise)(?:\/|$))/;
const FACETS = new Set(['q', 'query', 'type', 'genre', 'year', 'country', 'sort', 'sort_by', 'language', 'provider_id', 'media_type', 'with_genres', 'with_origin_country', 'with_original_language', 'network', 'rating', 'region']);
const LABELS = {'/':'Movies, TV Series & Anime', '/home':'Discover Movies, TV Series & Anime', '/movies':'Popular Movies', '/series':'TV Series', '/anime':'Anime Series', '/actors':'Actors & Filmographies', '/albums':'Movie Collections', '/studios':'Production Studios', '/providers':'Streaming Providers', '/blog':'CINEAMIT Blog', '/app':'CINEAMIT Android App', '/premium':'CINEAMIT Plans', '/about':'About CINEAMIT', '/faq':'CINEAMIT FAQ', '/help':'CINEAMIT Help', '/contact':'Contact CINEAMIT', '/privacy':'Privacy Policy', '/terms':'Terms of Service', '/dmca':'Copyright Requests', '/legal':'Legal Information'};
const INTROS = {
  '/movies':'Explore popular films with synopses, release years, genres and cast information. Open a title to find more details and trailers, or use the catalogue pages to discover more films. Playback options and availability depend on the selected provider.',
  '/series':'Discover TV series and compare their stories, cast and release information. Open a series for available season and episode details, trailers and related titles. Playback options and availability depend on the selected provider.',
  '/anime':'Explore anime series, read their synopses and compare cast and release information. Open a title for available seasons, episodes, trailers and related recommendations. Playback options and availability depend on the selected provider.',
};
function clean(value, max = 180) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function origin(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash ? u.origin : '';
  } catch { return ''; }
}
function publicOrigin(app) {
  for (const raw of [Config.SEO_PUBLIC_ORIGIN, Config.APP_PUBLIC_ORIGIN, Config.OAUTH_BASE_URL]) {
    const result = origin(raw); if (result) return result;
  }
  // Development fallback only. Production instructions require a configured HTTPS origin.
  const host = String(app.safeHost()).replace(/[^A-Za-z0-9.:\[\]-]/g, '');
  return (app.isSecure() ? 'https://' : 'http://') + host;
}
function publicPath(path) { return PUBLIC.has(path) || PUBLIC_DETAIL.test(path); }
function normalizedPath(raw) {
  const p = String(raw || '/');
  return p.startsWith('/') && !p.startsWith('//') && !/[\\\r\n]/.test(p) ? (p.replace(/\/+$/, '') || '/') : '/';
}
function pageNumber(value) {
  return /^\d+$/.test(String(value ?? '')) ? Math.max(1, Math.min(500, Number(value))) : 1;
}
function pages(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(500, Math.floor(n))) : 1; }
function xml(value) { return String(value).replace(/[<>&"']/g, x => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[x])); }
function noindexPath(path) { return !publicPath(normalizedPath(path)); }
function robotsHeader(req, res, next) {
  if (!String(req.path || '').startsWith('/static/') && noindexPath(req.path || '/')) res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
}
function canonicalParams(req, context) {
  const out = new URLSearchParams();
  // Preserve semantic filters for user pagination, but not credentials/tracking/cache keys.
  const sources = new URLSearchParams(String(context.pagination_qs || ''));
  for (const [k, v] of Object.entries(req.query || {})) if (typeof v === 'string' && FACETS.has(k)) sources.set(k, v);
  for (const key of [...FACETS].sort()) {
    const v = sources.get(key); if (v && v.length <= 200) out.set(key, v);
  }
  return out;
}
function textDescription(label) { return `Explore ${label.toLowerCase()} on CINEAMIT. Browse titles, read synopses and cast information, and open a title for more details. Provider availability may vary.`; }
function page(app, template, context = {}) {
  const req = app.req || {}, path = normalizedPath(req.path), root = publicOrigin(app);
  const current = pageNumber(context.current_page ?? (req.query || {}).page);
  const total = pages(context.total_pages);
  const paginated = context.current_page != null || context.total_pages != null;
  const params = canonicalParams(req, context);
  const hasFacets = params.size > 0;
  let canonicalPath = path;
  let label = clean(context.title || LABELS[path] || 'CINEAMIT', 110);
  let description = textDescription(label);
  const data = context.data || context.details;
  let entity = null;
  const crumbs = [{name: BRAND, url: root + '/'}];
  if (template === 'details.html' && data) {
    const name = clean(data.title || data.name, 130), year = String(data.release_date || data.first_air_date || '').slice(0, 4);
    const media = context.media_type === 'movie' ? 'movie' : 'tv';
    canonicalPath = app.urlFor('routes.details', {media_type:media, tmdb_id:context.tmdb_id || data.id, title:data.title || data.name || ''});
    label = name + (/^\d{4}$/.test(year) ? ` (${year})` : '') + ' — Cast & Details';
    description = clean(data.overview || `Explore ${name}: synopsis, cast, genres and available trailer information on CINEAMIT.`, 165);
    crumbs.push({name:media === 'movie' ? 'Movies' : 'TV Series', url:root + (media === 'movie' ? '/movies' : '/series')});
    entity = {'@type':media === 'movie' ? 'Movie' : 'TVSeries', name, description:clean(data.overview, 3000), url:root + canonicalPath};
    if (data.poster_path && /^\/[\w./-]+$/.test(data.poster_path)) entity.image = String(Config.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').replace(/\/+$/, '') + '/w500' + data.poster_path;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(data.release_date || data.first_air_date || ''))) entity.datePublished = data.release_date || data.first_air_date;
    if (Array.isArray(data.genres)) entity.genre = data.genres.map(g => clean(g.name,80)).filter(Boolean);
    if (Array.isArray(data.credits?.cast)) entity.actor = data.credits.cast.slice(0,12).map(p => ({'@type':'Person',name:clean(p.name,130)}));
    const directors = (data.credits?.crew || []).filter(p => p.job === 'Director').slice(0,5).map(p => ({'@type':'Person', name:clean(p.name,130)}));
    if (directors.length && media === 'movie') entity.director = directors;
    if (media === 'movie' && Number.isInteger(data.runtime) && data.runtime > 0) entity.duration = `PT${data.runtime}M`;
  } else if (template === 'blog_single.html' && context.post) {
    const post = context.post;
    if (post.slug) canonicalPath=app.urlFor('routes.blog_single',{slug:post.slug});
    label = clean(post.title, 140);description = clean(post.meta_description || post.content,165);
    crumbs.push({name:'Blog',url:root+'/blog'});
    entity = {'@type':'BlogPosting', headline:label, description, url:root+canonicalPath, publisher:{'@id':root+'/#organization'}};
    if (post.created_at) { const d = new Date(post.created_at);if (!Number.isNaN(d.valueOf())) entity.datePublished = d.toISOString(); }
    if (/^https:\/\//.test(String(post.image_url || ''))) entity.image = post.image_url;
    // No invented author, modified date, rating or video upload date.
  } else if (template === 'actor.html' && context.actor) {
    if (context.actor.id) canonicalPath=app.urlFor('routes.actor',{person_id:context.actor.id,name:context.actor.name});
    label = clean(context.actor.name,120) + ' — Movies & TV Shows';description = clean(context.actor.biography || textDescription(label),165);
    crumbs.push({name:'Actors',url:root+'/actors'});
  }
  if (path !== '/') crumbs.push({name:label, url:root+canonicalPath});
  const canonicalQuery = new URLSearchParams(params);
  if (paginated && current > 1) canonicalQuery.set('page',String(current));
  const canonical = root + canonicalPath + (canonicalQuery.size ? '?' + canonicalQuery.toString() : '');
  const items = context.items ?? context.posts;
  const empty = Array.isArray(items) && items.length === 0;
  const indexable = publicPath(path) && !hasFacets && !empty && (!paginated || current <= total)
    && !(app.session || {}).is_kids && Number(app.res.statusCode || 200) < 400;
  const robots = indexable ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : (SENSITIVE.test(path) ? 'noindex, nofollow, noarchive' : 'noindex, follow');
  const title = `${label}${current > 1 && paginated ? ' — Page '+current : ''} | ${BRAND}`;
  const graph = [
    {'@type':'WebSite','@id':root+'/#website',name:BRAND,alternateName:['CineAmit',new URL(root).hostname],url:root+'/',inLanguage:'en'},
    {'@type':'Organization','@id':root+'/#organization',name:BRAND,url:root+'/',logo:{'@type':'ImageObject',url:root+'/static/assets/logo-512.png'}},
    {'@type':items ? 'CollectionPage' : 'WebPage','@id':canonical+'#webpage',url:canonical,name:title,description,inLanguage:'en',isPartOf:{'@id':root+'/#website'}},
  ];
  if (crumbs.length > 1 && indexable && ['details.html','category.html','view_all.html','actor.html','blog_single.html'].includes(template)) graph.push({'@type':'BreadcrumbList',itemListElement:crumbs.map((c,i) => ({'@type':'ListItem',position:i+1,name:c.name,item:c.url}))});
  if (entity && indexable) graph.push(entity);
  const navigationParams=new URLSearchParams(params);
  const cosmeticName=(req.query || {}).name;
  if (typeof cosmeticName==='string' && cosmeticName.length<=200) navigationParams.set('name',cosmeticName);
  const paginationBase = path + (navigationParams.size ? '?' + navigationParams.toString() + '&' : '?');
  return {origin:root,canonical,title,description,robots,indexable,graph:{'@context':'https://schema.org','@graph':graph},breadcrumbs:crumbs,
    page:current,total_pages:total,pagination_base:paginationBase,prev:paginated && current>1 ? root+paginationBase+'page='+(current-1) : '',next:paginated && current<total ? root+paginationBase+'page='+(current+1) : '',
    intro:INTROS[path] || (items ? textDescription(label) : ''),google_verification:Config.GOOGLE_SITE_VERIFICATION || 'HSsggmQWOwl-K1mVgj_UxfOa_P7cfqSgFcp6cd4jq0k',bing_verification:Config.BING_SITE_VERIFICATION || '',
    image:entity?.image || root+'/static/assets/logo-512.png'};
}
function sitemap(urls) {
  const seen = new Set();
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.filter(x => {
    if (seen.has(x.loc)) return false;seen.add(x.loc);return true;
  }).map(x => '<url><loc>'+xml(x.loc)+'</loc>'+(x.lastmod ? '<lastmod>'+xml(x.lastmod)+'</lastmod>' : '')+'</url>').join('') + '</urlset>';
}
module.exports = {BRAND,PUBLIC,publicPath,origin,publicOrigin,normalizedPath,pageNumber,pages,noindexPath,robotsHeader,page,xml,sitemap};
