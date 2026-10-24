'use strict';
const Seo = require('../../seo');
const Config = require('../../core/config');
const Database = require('../../db');
const TMDB = require('../../services/tmdb');
const CHILDREN = ['/sitemap-core.xml','/sitemap-titles.xml','/sitemap-posts.xml'];
function send(app, text, type='application/xml') {
  app.res.type(type).set('Cache-Control','public, max-age=300');app._ended=true;return app.res.send(text);
}
function unavailable(app) {
  app.res.status(503).set({'Cache-Control':'no-store','Retry-After':'60'});app._ended=true;return app.res.type('text/plain').send('Sitemap temporarily unavailable. Retry shortly.');
}
function robots(app) {
  const root=Seo.publicOrigin(app);
  // Keep HTML search/filter pages crawlable to expose their noindex directive. Block action/API spaces.
  const lines=['User-agent: *','Allow: /','Disallow: /api/','Disallow: /auth/','Disallow: /cineamit-admin','Disallow: /admin','Disallow: /setup','Disallow: /watch/','Disallow: /download/','Disallow: /play_external','Disallow: /profile','Disallow: /history','Disallow: /watchlist','Disallow: /playlists','Disallow: /playlist/','Disallow: /notifications','Disallow: /cine-wrapped','Disallow: /cine-match','', 'Sitemap: '+root+'/sitemap.xml',''];
  return send(app,lines.join('\n'),'text/plain');
}
function index(app) {
  const root=Seo.publicOrigin(app);
  return send(app,'<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+CHILDREN.map(x=>'<sitemap><loc>'+Seo.xml(root+x)+'</loc></sitemap>').join('')+'</sitemapindex>');
}
function core(app) {
  const root=Seo.publicOrigin(app);const paths=['/','/home','/movies','/series','/anime','/actors','/albums','/studios','/providers','/app','/premium','/about','/faq','/help','/contact','/privacy','/terms','/dmca','/legal'];
  return send(app,Seo.sitemap(paths.map(x=>({loc:root+x}))));
}
async function titles(app) {
  try {
    // Bounded, current catalogue sample. Existing internal pagination remains the deeper discovery path.
    // Do not generate millions of unverified title IDs, watch URLs, or session-signed provider tokens.
    const blocked=new Set(await TMDB.blacklistSet());
    const lists=[];
    for (const [type,load] of [['movie',()=>TMDB.getMoviesByCategory('popular',1)],['tv',()=>TMDB.getTvShowsByCategory('popular',1)],['tv',()=>TMDB.getAnime(1)]]) {
      const items=await load();if (TMDB.lastError) return unavailable(app);
      lists.push(...(items||[]).slice(0,20).filter(x=>x&&Number.isSafeInteger(Number(x.id))&&Number(x.id)>0&&!blocked.has(Number(x.id))&&!blocked.has(String(x.id))).map(x=>({loc:Seo.publicOrigin(app)+app.urlFor('routes.details',{media_type:type,tmdb_id:x.id,title:x.title||x.name||''})})));
    }
    return send(app,Seo.sitemap(lists));
  } catch { return unavailable(app); }
}
async function posts(app) {
  try {
    const rows=await Database.fetchAll('SELECT slug, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 1000');
    const urls=(rows||[]).filter(x=>typeof x.slug==='string'&&/^[A-Za-z0-9_-]{1,255}$/.test(x.slug)).map(x=>{
      const entry={loc:Seo.publicOrigin(app)+'/blog/'+encodeURIComponent(x.slug)};
      const date=new Date(x.created_at);if (x.created_at&&!Number.isNaN(date.valueOf())) entry.lastmod=date.toISOString();
      return entry;
    });return send(app,Seo.sitemap(urls));
  } catch { return unavailable(app); }
}
function key(app) {
  app._ended=true;app.res.type('text/plain');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(String(Config.INDEXNOW_KEY||''))) return app.res.status(404).set('Cache-Control','no-store').send('Not configured');
  return app.res.set('Cache-Control','public, max-age=300').send(Config.INDEXNOW_KEY);
}
module.exports={robots,index,core,titles,posts,key,CHILDREN};
