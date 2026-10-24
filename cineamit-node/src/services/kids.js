'use strict';

function cineamitKidsContentAllowed(details, mediaType = '') {
  if (!details) return false;
  if (details.adult) return false;
  const genres = details.genres || [];
  if (!Array.isArray(genres)) return false;
  const genreIds = genres.map((g) => Number(g.id));
  if (!genreIds.some((id) => id === 10751 || id === 10762)) return false;
  const isTv = String(mediaType).toLowerCase() === 'tv' || details.content_ratings;
  const countries = isTv
    ? ((details.content_ratings && details.content_ratings.results) || [])
    : ((details.release_dates && details.release_dates.results) || []);
  if (!Array.isArray(countries)) return false;
  const ratingsByCountry = {};
  for (const country of countries) {
    if (!country || typeof country !== 'object') continue;
    const code = String(country.iso_3166_1 || '').toUpperCase();
    if (!['IN', 'US', 'GB'].includes(code)) continue;
    if (isTv) {
      const rating = String(country.rating || '').trim();
      if (rating) {
        if (!ratingsByCountry[code]) ratingsByCountry[code] = [];
        ratingsByCountry[code].push(rating);
      }
    } else {
      for (const release of (country.release_dates || [])) {
        const rating = String(release.certification || '').trim();
        if (rating) {
          if (!ratingsByCountry[code]) ratingsByCountry[code] = [];
          ratingsByCountry[code].push(rating);
        }
      }
    }
  }
  const allowedByCountry = {
    IN: ['U', 'U/A 7+', 'UA 7+', 'U/A7+', 'UA7+'],
    US: isTv ? ['TV-Y', 'TV-Y7', 'TV-G'] : ['G'],
    GB: ['U'],
  };
  for (const countryCode of ['IN', 'US', 'GB']) {
    if (!ratingsByCountry[countryCode] || !ratingsByCountry[countryCode].length) continue;
    const allowed = allowedByCountry[countryCode] || [];
    const normalizedAllowed = allowed.map((v) => v.toUpperCase().replace(/\s+/g, ''));
    for (const rating of ratingsByCountry[countryCode]) {
      const normalized = rating.toUpperCase().replace(/\s+/g, '');
      if (!normalizedAllowed.includes(normalized)) return false;
    }
    return true;
  }
  return false;
}

module.exports = { cineamitKidsContentAllowed };

// Summary genres are not a certification. Resolve full metadata conservatively,
// with bounded concurrency and a request-owned memo (never a global Kids flag).
async function filterMedia(items,fallbackType='movie',memo=new Map()) {
  if (!Array.isArray(items)) return [];
  const TMDB=require('./tmdb');
  const output=new Array(items.length);let next=0;
  async function worker() {
    while (next<items.length) {
      const i=next++,item=items[i];
      if (!item || item.adult || ['person','collection'].includes(item.media_type)) continue;
      const id=Number(item.tmdb_id || item.id);
      if (!Number.isSafeInteger(id) || id<1) continue;
      const type=TMDB.mt_safe(item.media_type || (item.first_air_date ? 'tv':fallbackType));
      const key=type+':'+id;
      if (!memo.has(key)) memo.set(key,Promise.resolve().then(()=>TMDB.withRequestContext(()=>TMDB.getDetails(type,id),{inherit:true})).then(d=>!!d && Number(d.id)===id && cineamitKidsContentAllowed(d,type)).catch(()=>false));
      if (await memo.get(key)) output[i]=item;
    }
  }
  await Promise.all(Array.from({length:Math.min(4,items.length)},worker));
  return output.filter(Boolean);
}
module.exports.filterMedia=filterMedia;
