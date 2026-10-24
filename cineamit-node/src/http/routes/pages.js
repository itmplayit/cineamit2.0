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


// Static/legal/blog/help/app pages + SEO endpoints (moved verbatim from routes/main.js).
function registerPagesRoutes() {
  add('/ads.txt', 'routes.ads_txt', async (app) => {
    const id = String(Config.ADSENSE_PUB_ID || '').trim();
    app.res.type('text/plain');
    app._ended = true;
    if (id) app.res.send('google.com, ' + id + ', DIRECT, f08c47fec0942fa0\n');
    else app.res.send('');
  });

  add('/robots.txt', 'routes.robots', async app => require('./seo-routes').robots(app));

  add('/sitemap.xml', 'routes.sitemap', async app => require('./seo-routes').index(app));

  add('/sitemap-core.xml', 'routes.sitemap_core', async app => require('./seo-routes').core(app));

  add('/sitemap-titles.xml', 'routes.sitemap_titles', async app => require('./seo-routes').titles(app));

  add('/sitemap-posts.xml', 'routes.sitemap_posts', async app => require('./seo-routes').posts(app));

  add('/indexnow-key.txt', 'routes.indexnow_key', async app => require('./seo-routes').key(app));

  add('/blog', 'routes.blog_list', async (app) => {
    const posts = await Database.fetchAll('SELECT id, title, slug, image_url, meta_description, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 50');
    return app.render('blog.html', { posts });
  });

  add('/blog/{slug}', 'routes.blog_single', async (app, args) => {
    const post = await Database.fetchOne('SELECT * FROM blog_posts WHERE slug = ?', [args.slug]);
    if (!post) { app.res.status(404); return app.renderNotFound(); }
    post.content = Security.contentCleanHtml(String(post.content || ''));
    return app.render('blog_single.html', { post });
  });

  add('/privacy', 'routes.privacy', async (app) => app.render('privacy.html'));

  add('/terms', 'routes.terms', async (app) => app.render('terms.html'));

  add('/dmca', 'routes.dmca', async (app) => app.render('dmca.html'));

  add('/faq', 'routes.faq', async (app) => app.render('faq.html'));

  add('/about', 'routes.about', async (app) => app.render('about.html'));

  add('/legal', 'routes.legal', async (app) => app.render('legal.html'));

  add('/app', 'routes.android_app', async (app) => {
    const android_app = await AndroidApp.publicMeta();
    return app.render('app.html', { android_app });
  });

  add('/premium', 'routes.premium', async (app) => {
    let eco = { ad_points: 50, cost_monthly: 500, cost_yearly: 4500 };
    try { eco = await Economy.publicConfig(); } catch {}
    const adPts = Math.max(1, Number(eco.ad_points) || 50);
    const monthly = Math.max(1, Number(eco.cost_monthly) || 500);
    const yearly = Math.max(1, Number(eco.cost_yearly) || 4500);
    const savePts = Math.max(0, monthly * 12 - yearly);
    return app.render('premium.html', {
      economy: eco,
      ads_monthly: Math.ceil(monthly / adPts),
      ads_yearly: Math.ceil(yearly / adPts),
      save_pts: savePts,
    });
  });

  add('/plans', 'routes.web_plans', async (app) => app.redirect(app.urlFor('routes.premium')));

  add('/app/cineamit.apk', 'routes.android_apk', async (app) => {
    const meta = await AndroidApp.publicMeta();
    if (meta.has_file) {
      AndroidApp.sendApk(app, meta);
      return;
    }
    if (!meta.enabled) {
      app.res.status(404);
      return app.renderNotFound();
    }
    if (meta.download_url && /^https?:\/\//i.test(meta.download_url)) {
      return app.redirect(meta.download_url);
    }
    app.flash('APK is not available yet. Try again shortly.', 'error');
    return app.redirect(app.urlFor('routes.android_app'));
  });

  add('/help', 'routes.help', async (app) => {
    const articles = await Database.fetchAll('SELECT topic, title, slug FROM help_articles ORDER BY topic, title');
    return app.render('help.html', { articles });
  });

  add('/help/article/{slug}', 'routes.help_article', async (app, args) => {
    const article = await Database.fetchOne('SELECT * FROM help_articles WHERE slug = ?', [args.slug]);
    if (!article) { app.res.status(404); return app.renderNotFound(); }
    try { await Database.execute('UPDATE help_articles SET views = views + 1 WHERE id = ?', [article.id]); } catch {}
    article.content = Security.contentCleanHtml(String(article.content || ''));
    return app.render('help_single.html', { article });
  });

  add('/contact', 'routes.contact', async (app) => {
    if (app.req.method === 'POST') {
      if (!(await app.throttle('contact', 5, 3600))) {
        app.flash('Too many messages. Try later.', 'error');
        return app.render('contact.html');
      }
      app.flash('Thanks — we received your message.', 'success');
      return app.redirect(app.urlFor('routes.contact'));
    }
    return app.render('contact.html');
  }, ['GET', 'POST']);

  add('/manifest.php', 'routes.manifest', async (app) => {
    app.res.type('application/manifest+json');
    app._ended = true;
    app.res.json({ name: 'CineAmit', short_name: 'CineAmit', start_url: '/', display: 'standalone', background_color: '#0f1014', theme_color: '#dc2626' });
  });

  add('/sw.php', 'routes.sw', async (app) => {
    app.res.type('application/javascript');
    app._ended = true;
    app.res.send("self.addEventListener('install', e => self.skipWaiting()); self.addEventListener('fetch', () => {});");
  });

}

module.exports = { registerPagesRoutes };
