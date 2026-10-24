'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const mysql = require('mysql2/promise');

const ROOT = __dirname;

let settings;
try {
  settings = require('./src/core/env-loader').loadSettings({rootDir: ROOT});
} catch (e) {
  process.stderr.write('\nConfiguration error: ' + e.message + '\nExisting config: node tools/migrate-env.js\nNew installation: cp .env.example .env\n');
  process.exit(1);
}

const Config = require('./src/core/config');
try {
  Config.load(settings);
} catch (e) {
  process.stderr.write('\n⚙️  Configuration error\n\n' + e.message + '\n');
  process.exit(1);
}

const Database = require('./src/db');
const TMDB = require('./src/services/tmdb');
const App = require('./src/core/app');
const { add, match } = require('./src/core/router');

require('./src/http/routes/auth')();
require('./src/http/routes/player')();
require('./src/http/routes/party')();
require('./src/http/routes/main')();
require('./src/http/web-json').attach();

if (Config.SETUP_ENABLED) {
  const setupHeaders = (app) => app.res.set({
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });

  // GET only shows an isolated form: no database setup and no ad/analytics JS
  // can run on a page where the operator enters the application secret.
  add('/setup', 'routes.setup_form', async (app) => {
    setupHeaders(app);
    const html = require('./src/core/twig-env').render('setup.html', {
      schema_version: Database.SCHEMA_VERSION,
      csrf_token: String(app.session.csrf_token || ''),
    }, app);
    app.res.type('html').send(html);
    app._ended = true;
  });

  add('/setup', 'routes.setup', async (app) => {
    setupHeaders(app);
    const key = String(app.req.body.key || '');
    if (!(await app.throttle('setup_run', 5, 600))) {
      app.res.status(429);
      app.res.type('text').send('Too many setup attempts. Try again later.');
      app._ended = true;
      return;
    }
    try {
      if (!crypto.timingSafeEqual(Buffer.from(String(Config.SECRET_KEY)), Buffer.from(key.padEnd(Config.SECRET_KEY.length).slice(0, Config.SECRET_KEY.length))) || key.length !== Config.SECRET_KEY.length) {
        await app.securityLog('setup_failed', null, 'via=POST');
        app.res.status(403);
        app.res.type('text').send('403 - Invalid setup key. Submit a POST field named key with your SECRET_KEY.');
        app._ended = true;
        return;
      }
    } catch {
      app.res.status(403);
      app.res.type('text').send('403 - Invalid setup key.');
      app._ended = true;
      return;
    }
    try {
      await Database.createAll();
      await app.securityLog('setup_run', null, 'via=POST');
      app.res.type('text').send('✅ Database tables created/upgraded successfully! (Schema v' + Database.SCHEMA_VERSION + ')');
      app._ended = true;
    } catch (e) {
      console.error('[setup] createAll failed: ' + e.message);
      app.res.status(500);
      app.res.type('text').send('❌ Database startup failure.' + (Config.APP_DEBUG ? ' ' + e.message : ''));
      app._ended = true;
    }
  }, ['POST']);
}

const MySQLStore = require('./src/core/session-store')(session);
// Supply a real mysql2 pool: express-mysql-session's option allowlist omits ssl.
const sessionPool = mysql.createPool(require('./src/core/db-options')());
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 60 * 60 * 24 * 30 * 1000,
  createDatabaseTable: true,
  schema: { tableName: 'express_sessions' },
}, sessionPool);
const sessionReady = sessionStore.onReady();
// Initialization can fail while schema setup is still pending. Handle that rejection
// immediately, then await the original promise before opening the HTTP listener.
sessionReady.catch(() => {});

const appExpress = express();
appExpress.disable('x-powered-by');
appExpress.set('trust proxy', Config.TRUST_PROXY_REAL_IP ? Config.TRUSTED_PROXIES : false);
appExpress.use(require('./src/seo').robotsHeader);
appExpress.use(cookieParser());
appExpress.use(express.urlencoded({ extended: true, limit: '2mb' }));
appExpress.use(express.json({ limit: '1mb' }));

appExpress.use('/static', express.static(path.join(ROOT, 'static'), {
  maxAge: '7d',
  immutable: true,
  setHeaders(res) {
    res.set('X-Content-Type-Options', 'nosniff');
  },
}));

// Legacy-URL aliases (Phase 4 static grouping): /static/<file> and /static/assets/<img> keep
// serving after loose files moved into js/ css/ img/ — no template/URL changes needed.
for (const legacyDir of ['css', 'js', 'img']) {
  appExpress.use('/static', express.static(path.join(ROOT, 'static', legacyDir), {
    maxAge: '7d',
    immutable: true,
    setHeaders(res) {
      res.set('X-Content-Type-Options', 'nosniff');
    },
  }));
}
appExpress.use('/static/assets', express.static(path.join(ROOT, 'static', 'img'), {
  maxAge: '7d',
  immutable: true,
  setHeaders(res) {
    res.set('X-Content-Type-Options', 'nosniff');
  },
}));

const STATELESS = new Set(['/sw.php', '/manifest.php', '/robots.txt', '/sitemap.xml', '/sitemap-core.xml', '/sitemap-titles.xml', '/sitemap-posts.xml', '/indexnow-key.txt', '/ads.txt', '/api/search']);
function isStatelessPublic(p) {
  if (STATELESS.has(p)) return true;
  return ['/api/episodes/', '/api/trailer/', '/api/video_preview/', '/api/studio_thumb/', '/api/vast_proxy', '/api/warm'].some((pre) => p.startsWith(pre));
}

appExpress.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  const host = String(req.headers.host || '').toLowerCase();
  if (!host.endsWith('.e2b.app')) res.set('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (!req.path.startsWith('/download')) {
    const ancestors = host.endsWith('.e2b.app') ? '' : "; frame-ancestors 'self'";
    // docs/06 M2: with ads disabled, do not allow arbitrary https: script hosts.
    // Analytics (GA4) + Tailwind CDN fallback stay whitelisted; inline scripts kept for existing templates.
    const scriptSrc = Config.ADS_ENABLED
      ? "script-src 'self' https: 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://www.googletagmanager.com";
    res.set('Content-Security-Policy',
      "default-src 'self' https: data: blob:; " + scriptSrc + "; style-src 'self' https: 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'" + ancestors);
  }
  next();
});

appExpress.use((req, res, next) => {
  if (Config.BLOCK_BAD_BOTS && App.isBadBot(String(req.headers['user-agent'] || ''))) {
    res.status(403).type('text').set('Cache-Control', 'no-store').send('Blocked: automated crawler');
    return;
  }
  next();
});

const sessionMiddleware = session({
  name: 'cineamit_session',
  secret: Config.SECRET_KEY,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 60 * 60 * 24 * 30 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    path: '/',
  },
});

appExpress.use((req, res, next) => {
  const p = req.path || '/';
  const hasCookie = !!(req.cookies && req.cookies.cineamit_session);
  const isCacheableGuest = !hasCookie && req.method === 'GET' && Config.PAGE_CACHE_TTL > 0
    && Object.keys(req.query).length === 0 && App.isCacheableGuestPath(p);
  if (isStatelessPublic(p) && !hasCookie) return next();
  if (isCacheableGuest) return next();
  sessionMiddleware(req, res, next);
});

function sameOriginOk(req) {
  const secSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (secSite === 'cross-site') return false;

  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  if (origin.toLowerCase() === 'null') return false;

  try {
    // Read the merged dotenv/host configuration (host variables take priority).
    // Internal proxy
    // HTTP is not the public HTTPS origin; do not trust arbitrary headers.
    const publicOrigin = String(
      settings.APP_PUBLIC_ORIGIN || ''
    ).trim();
    const expected = new URL(publicOrigin ||
      (req.secure ? 'https://' : 'http://') + req.headers.host);

    if (!['http:', 'https:'].includes(expected.protocol)) return false;
    if (expected.username || expected.password || expected.search || expected.hash || expected.pathname !== '/') return false;

    const received = new URL(origin);
    if (received.username || received.password || received.search || received.hash || received.pathname !== '/') return false;

    const requestHost = new URL(expected.protocol + '//' + req.headers.host);
    if (requestHost.username || requestHost.password || requestHost.search || requestHost.hash || requestHost.pathname !== '/') return false;

    return received.origin === expected.origin && requestHost.host === expected.host;
  } catch {
    return false;
  }
}

function csrfTokensEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length || !ba.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function csrfOk(req) {
  const sent = String((req.body && req.body.csrf_token) || req.headers['x-csrf-token'] || '');
  const known = String((req.session && req.session.csrf_token) || '');
  const issuedAt = Number((req.session && req.session.csrf_token_issued_at) || 0);
  const isFresh = issuedAt > 0 && (Date.now() / 1000 - issuedAt) <= 43200;
  if (isFresh && /^[a-f0-9]{64}$/.test(known) && sent && csrfTokensEqual(known, sent)) return true;
  return false;
}

function pageCacheFile(host, pth) {
  const dir = path.join(ROOT, 'cache', 'page');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, crypto.createHash('sha1').update(require('./package.json').version + '|' + String(host).toLowerCase() + '|' + pth + '|guest').digest('hex') + '.html');
}

appExpress.use(async (req, res, next) => {
  try {
    if (req.session) {
      const issuedAt = Number(req.session.csrf_token_issued_at || 0);
      const stored = String(req.session.csrf_token || '');
      if (!/^[a-f0-9]{64}$/.test(stored) || issuedAt <= 0 || (Date.now() / 1000 - issuedAt) > 43200) {
        req.session.csrf_token = crypto.randomBytes(32).toString('hex');
        req.session.csrf_token_issued_at = Math.floor(Date.now() / 1000);
      }
    }
    next();
  } catch (e) { next(e); }
});

appExpress.use((req, res, next) => {
  (async () => {
  const app = new App(ROOT, req, res);
  req.cineApp = app;
  let pth = req.path || '/';
  if (pth !== '/' && pth.endsWith('/')) pth = pth.replace(/\/+$/, '');

  const wantsJson = App.acceptsJson(req);

  if (req.method === 'POST') {
    if (!sameOriginOk(req)) {
      res.status(403).json({ error: true, message: 'Cross-origin request rejected.' });
      return;
    }
    if (!App.csrfExemptPath(pth) && !csrfOk(req)) {
      if (await app.throttle('csrf_log', 20, 600)) await app.securityLog('csrf_failed', null, 'path=' + pth.slice(0, 120));
      if (pth.startsWith('/api/')) {
        res.status(403).json({ error: true, message: 'Invalid or missing CSRF token.' });
        return;
      }
      app.flash('Your session expired. Please try again.', 'error');
      app.redirect(pth || '/');
      return;
    }
  }

  try {
    if (await app.maintenanceModeActive()) {
      let isPrivileged = false;
      try {
        const u = await app.currentUser();
        isPrivileged = u && ['owner', 'super_admin'].includes(u.role || '');
      } catch {}
      const alwaysOpen = ['/login', '/register', '/logout', '/forgot_password', '/verify_otp', '/reset_password', '/profile/totp_setup', '/profile/totp_verify', '/api/app/login', '/api/app/logout'].includes(pth)
        || pth.startsWith('/login') || pth.startsWith('/auth/');
      if (!isPrivileged && !alwaysOpen) {
        if (wantsJson) {
          res.status(503).json({ ok: false, error: 'maintenance', message: 'Site is under maintenance.' });
          return;
        }
        await app.renderMaintenance();
        return;
      }
    }
  } catch (error) {
    console.error('[maintenance] status unavailable');
    const recovery=['/login','/logout','/forgot_password','/verify_otp','/reset_password','/profile/totp_verify','/api/app/login','/api/app/logout'].includes(pth) || pth.startsWith('/auth/');
    if (!recovery) {
      res.set({'Cache-Control':'no-store','Retry-After':'60'});
      if (wantsJson) res.status(503).json({ok:false,error:'maintenance_unavailable',message:'Site status is temporarily unavailable. Please retry.'});
      else res.status(503).type('text').send('Site status is temporarily unavailable. Please retry shortly.');
      return;
    }
  }

  if (Config.PAGE_CACHE_TTL > 0 && req.method === 'GET' && !wantsJson && !req.cookies.cineamit_session && Object.keys(req.query).length === 0 && App.isCacheableGuestPath(pth)) {
    try {
      if (!(await app.maintenanceModeActive())) {
        const blocked=await TMDB.blacklistSet();
        app._requestBlacklist=blocked;
        const revision=crypto.createHash('sha256').update([...blocked].sort((a,b)=>a-b).join(',')).digest('hex');
        const file = pageCacheFile(app.safeHost(), pth+'#blacklist:'+revision);
        try {
          const st = fs.statSync(file);
          if ((Date.now() - st.mtimeMs) / 1000 <= Config.PAGE_CACHE_TTL) {
            res.set({ 'Content-Type': 'text/html; charset=UTF-8', 'X-Cine-Cache': 'HIT', 'Cache-Control': 'public, no-cache, must-revalidate' });
            res.sendFile(file);
            return;
          }
        } catch {}
        const origSend = res.send.bind(res);
        res.send = function sendCached(body) {
          try {
            if (res.statusCode === 200 && typeof body === 'string' && body.length > 512 && body.length < 1048576
              && body.trimStart().toLowerCase().startsWith('<!doctype') && body.trimEnd().toLowerCase().endsWith('</html>')
              && !body.includes('Invalid or missing CSRF')
              && !/method\s*=\s*['"]post['"]/i.test(body)
              && !((pth === '/home' || pth === '/') && !body.includes('<!-- cache-ok -->'))) {
              fs.writeFileSync(file, body);
            }
          } catch {}
          return origSend(body);
        };
      }
    } catch {}
  }

  const found = match(req.method, pth);
  if (!found) {
    await app.renderNotFound();
    return;
  }
  try {
    await found.handler(app, found.args);
    if (!app.ended() && !res.headersSent) res.status(204).end();
  } catch (e) {
    console.error('[route]', e);
    try {
      await Database.execute('INSERT INTO error_log (ip, url, http_code, message) VALUES (?, ?, 500, ?)', [
        String(req.ip || '').slice(0, 45), String(req.originalUrl || '').slice(0, 255), String(e.message || '').slice(0, 480),
      ]);
    } catch {}
    if (res.headersSent) return;
    res.status(500);
    const msg = Config.APP_DEBUG ? String(e.message) : 'Internal Server Error. Please try again later.';
    if (pth.startsWith('/api/')) res.json({ error: true, message: msg });
    else res.type('html').send("<div style='height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f1014; color: white; font-family: sans-serif; flex-direction: column;'><h1 style='font-size: 40px; color: #dc2626; margin: 0;'>⚠️ Server Error</h1><p style='font-family: monospace;'>" + msg.replace(/</g, '&lt;') + '</p></div>');
  }
  })().catch(next);
});

appExpress.use((error, req, res, next) => {
  console.error('[request]', error.message);
  if (res.headersSent) { res.destroy(); return; }
  const status = error.status === 413 ? 413 : (error instanceof SyntaxError && error.status === 400 ? 400 : 500);
  res.status(status).set('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/') || App.acceptsJson(req)) res.json({ok: false, error: status === 413 ? 'request_too_large' : status === 400 ? 'invalid_json' : 'internal_error'});
  else res.type('text').send(status === 413 ? 'Request too large.' : status === 400 ? 'Invalid request.' : 'Internal Server Error. Please try again.');
});

const PORT = Number(settings.PORT || 3000);
const HOST = settings.HOST || '0.0.0.0';

(async () => {
  try {
    await Database.ensureSchema();
    await sessionReady;
    TMDB.pruneLegacyCache();
    try {
      const live = require('./src/services/live');
      await live.cineStalkerConfiguredPortals();
    } catch (e) {
      console.error('[startup] stalker allowlist: ' + e.message);
    }
  } catch (e) {
    console.error('[startup] database/session: ' + e.message);
    if (e.code === 'CINE_TICKET_MIGRATION' || /unsupported drop primary key.*clustered index/i.test(e.message)) {
      console.error('Startup stopped: reward-ticket schema migration needs attention; see TIDB-STARTUP-FIX.md. Keep existing data and migration records intact. This is not a DB password/SSL error.');
    } else if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'HANDSHAKE_SSL_ERROR'].includes(e.code) || /^(CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_)/.test(String(e.code || '')) || e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
      console.error('Startup stopped: database connection/authentication/TLS failed. Check DB_HOST / DB_PORT / DB_USER / DB_PASS / DB_NAME and DB_SSL / DB_SSL_CA_FILE in .env; do not disable TLS for TiDB Cloud.');
    } else {
      console.error('Startup stopped: database/session initialization or schema migration failed. Inspect the error above and DB permissions/compatibility; do not reset the database or skip migration versions.');
    }
    await Promise.allSettled([sessionStore.close(), sessionPool.end(), Database.close()]);
    process.exitCode = 1;
    return;
  }
  appExpress.listen(PORT, HOST, () => {
    console.log('CineAmit Node.js listening on http://' + HOST + ':' + PORT + ' (schema v' + Database.SCHEMA_VERSION + ')');
    if (Config.INDEXNOW_AUTO || Config.GOOGLE_SITEMAP_AUTO) {
      try {
        require('./src/core/indexnow-scheduler').start({ selfBase: 'http://127.0.0.1:' + PORT });
      } catch (e) {
        console.error('[seo-daily] scheduler not started: ' + e.message);
      }
    }
  });
})();
