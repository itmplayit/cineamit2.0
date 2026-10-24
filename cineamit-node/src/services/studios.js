'use strict';

const fs = require('fs');
const path = require('path');

function cineamitCleanStudioName(name) {
  let n = String(name).replace(/Entertainment|Pictures|Studios|Films|Motion Pictures|Productions|International/gi, '');
  n = n.replace(/\s+/g, ' ');
  return n.trim() || String(name || 'Studio');
}

/** Curated front-row studios (home strip). IDs are TMDB company ids. */
function getAllProductionStudios() {
  return CURATED_STUDIOS.map((s) => ({ id: s[0], name: s[1] }));
}

const CURATED_STUDIOS = [
  [420, 'Marvel Studios'], [9993, 'DC Entertainment'],
  [2, 'Walt Disney Pictures'], [174, 'Warner Bros. Pictures'],
  [33, 'Universal Pictures'], [4, 'Paramount'],
  [25, '20th Century Fox'], [5, 'Columbia Pictures'],
  [34, 'Sony Pictures'], [12, 'New Line Cinema'],
  [1632, 'Lionsgate'], [1, 'Lucasfilm'],
  [41077, 'A24'], [3172, 'Blumhouse Productions'],
  [923, 'Legendary Pictures'], [491, 'Bad Robot'],
  [3, 'Pixar'], [7, 'DreamWorks Animation'],
  [6704, 'Illumination'], [10342, 'Studio Ghibli'],
  [5542, 'Toei Animation'], [56302, 'MAPPA'],
  [2883, 'ufotable'], [11399, 'Madhouse'],
  [16185, 'Yash Raj Films'], [16016, 'Dharma Productions'],
  [15335, 'T-Series'], [12038, 'Red Chillies Ent.'],
  [134440, 'Jio Studios'], [67406, 'Zee Studios'],
  [4673, 'Eros International'], [8264, 'Balaji Motion Pictures'],
  [3522, 'Nadiadwala Grandson'], [52145, 'Viacom18 Studios'],
  [101416, 'Hombale Films'], [23955, 'Sun Pictures'],
  [83060, 'Geetha Arts'], [106114, 'Mythri Movie Makers'],
  [25881, 'Lyca Productions'], [11461, 'Netflix Studios'],
  [105156, 'Amazon Studios'], [120630, 'Apple Studios'],
  [21, 'Metro-Goldwyn-Mayer'], [14, 'Miramax'],
  [10163, 'Working Title Films'], [4414, 'Focus Features'],
  [127099, 'Searchlight Pictures'], [17, 'Warner Bros. Animation'],
  [521, 'DreamWorks Pictures'], [56, 'Amblin Entertainment'],
  [308, 'Village Roadshow Pictures'], [10246, 'Summit Entertainment'],
  [444, 'New Regency Productions'], [1885, 'Silver Pictures'],
  [23, 'Imagine Entertainment'], [10221, 'WingNut Films'],
  [127071, '20th Century Studios'], [3268, 'HBO'],
  [1778, 'Toho'], [11854, 'Shochiku'],
  [6125, 'Walt Disney Animation Studios'], [49, 'Miramax Films'],
];

function getAllCuratedAlbums() {
  return { superhero: [86311, 529892, 531241, 131292, 263], epic: [1241, 10, 119, 87096, 9485], action: [404609, 131635] };
}

const SEARCH_QUERIES = [
  'Marvel', 'Disney', 'Warner', 'Universal', 'Paramount', 'Sony', 'Fox', 'Lionsgate',
  'Pixar', 'DreamWorks', 'A24', 'Netflix', 'Amazon', 'Apple', 'HBO', 'BBC',
  'Toho', 'Ghibli', 'Toei', 'MAPPA', 'Yash Raj', 'Dharma', 'T-Series', 'Eros',
  'Miramax', 'New Line', 'Focus', 'Searchlight', 'StudioCanal', 'Pathe',
  'Gaumont', 'Constantin', 'CJ Entertainment', 'Showbox', 'Shaw',
  'Amblin', 'Imagine', 'Legendary', 'Blumhouse',
  'Columbia', 'MGM', 'United Artists', 'Orion', 'TriStar',
  'Summit', 'Relativity', 'Weinstein', 'Dimension', 'New Regency',
  'Village Roadshow', 'Working Title', 'Film4', 'Channel 4', 'ITV',
  'Toei Animation', 'Madhouse', 'Bones', 'Sunrise', 'Kyoto Animation',
  'Wit Studio', 'CloverWorks', 'ufotable', 'Production I.G', 'Gainax',
  'Trigger', 'Shaft', 'A-1 Pictures', 'J.C.Staff', 'Studio Pierrot',
  'Red Chillies', 'Excel Entertainment', 'Maddock', 'RSVP', 'Viacom18',
  'Balaji', 'Nadiadwala', 'Hombale', 'KRG', 'DVV',
  'Geetha Arts', 'Mythri', 'Lyca', 'Sun Pictures', 'AGS',
  'Annapurna', 'Plan B', 'Participant', 'MRC', 'BRON',
  'Skydance', 'Bad Robot', 'Syncopy', 'Appian Way',
  'RatPac', 'Silver Pictures', 'Dark Castle', 'Platinum Dunes', 'Atomic Monster',
  'Monkeypaw', 'Gold Circle', 'Lakeshore', 'Millennium',
  'Nu Image', 'Cannon', 'Carolco', 'PolyGram',
  'Studio Ghibli', 'Nippon TV', 'TV Tokyo', 'Fuji TV', 'NHK',
  'Shochiku', 'Nikkatsu', 'Kadokawa', 'Aniplex', 'Bandai',
  'CJ ENM', 'Lotte', 'Next Entertainment', 'Finecut',
  'Zee', 'Jio', 'Hotstar', 'Star Studios', 'Pen India',
  'Cape of Good Films', 'Colour Yellow', 'Sikhya', 'Clean Slate', 'MacGuffin',
  'Lucasfilm', 'Illumination', 'Blue Sky', 'Cartoon Network', 'Nickelodeon',
  'Hasbro', 'Mattel', 'Sega', 'Nintendo', 'Square Enix',
  'Aamir Khan', 'Rajkumar Hirani', 'Phantom Films', 'Flying Unicorn',
  'Fox Star', 'UTV Motion', 'Tips Industries', 'Venus Records',
  'Anurag Kashyap', 'Sikhya Entertainment', 'Matchbox Pictures',
];

function uniqueStudios(list) {
  const byId = new Map();
  for (const s of list) {
    const id = Number(s && s.id);
    const name = String((s && s.name) || '').trim();
    if (id > 0 && name && !byId.has(id)) byId.set(id, { id, name });
  }
  return [...byId.values()];
}

function formatStudio(s) {
  return {
    id: Number(s.id),
    name: String(s.name),
    slug: cineamitCleanStudioName(s.name),
    display_name: cineamitCleanStudioName(s.name),
    thumbnail_url: '/api/studio_thumb/' + Number(s.id),
  };
}

let catalogMemory = null;
let catalogPending = null;

async function buildStudioCatalog(seed, cacheFile) {
  const TMDB = require('./tmdb');
  const byId = new Map(seed.map((s) => [s.id, s]));
  const queries = [...new Set(SEARCH_QUERIES)];
  const jobs = [];
  for (const q of queries) jobs.push({ q, page: 1 });
  for (const q of queries.slice(0, 24)) jobs.push({ q, page: 2 });
  const chunkSize = 8;
  for (let i = 0; i < jobs.length; i += chunkSize) {
    const chunk = jobs.slice(i, i + chunkSize);
    const pages = await Promise.all(chunk.map((j) => TMDB.searchCompany(j.q, j.page).catch(() => [])));
    for (const results of pages) {
      for (const c of results || []) {
        const id = Number(c.id);
        const name = String(c.name || '').trim();
        if (id > 0 && name && !byId.has(id)) byId.set(id, { id, name });
      }
    }
  }
  const rest = [...byId.values()]
    .filter((s) => !seed.some((c) => c.id === s.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const list = uniqueStudios(seed.concat(rest));
  catalogMemory = list.length ? list : seed;
  try { fs.writeFileSync(cacheFile, JSON.stringify(catalogMemory)); } catch { /* ignore */ }
  return catalogMemory;
}

async function loadStudioCatalog() {
  if (catalogMemory && catalogMemory.length) return catalogMemory;
  const TMDB = require('./tmdb');
  const cacheFile = path.join(TMDB.cacheDir(), 'studio_catalog_v1.json');
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < 7 * 86400 * 1000) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached) && cached.length >= 40) {
        catalogMemory = uniqueStudios(cached);
        return catalogMemory;
      }
    }
  } catch { /* miss */ }

  const seed = uniqueStudios(getAllProductionStudios());
  if (!catalogPending) {
    catalogPending = buildStudioCatalog(seed, cacheFile)
      .catch(() => { catalogMemory = catalogMemory || seed; return catalogMemory; })
      .finally(() => { catalogPending = null; });
  }
  return seed;
}

module.exports = {
  cineamitCleanStudioName,
  getAllProductionStudios,
  getAllCuratedAlbums,
  loadStudioCatalog,
  formatStudio,
};
