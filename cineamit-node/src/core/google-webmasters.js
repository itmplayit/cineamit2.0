'use strict';
// Google Search Console (Webmasters v3) sitemap submission via service account.
//
// Opt-in: GOOGLE_SITEMAP_AUTO=true with GOOGLE_SA_JSON_FILE (service-account JSON)
// and GOOGLE_SITEMAPS_SITE (the exact Search Console property: URL-prefix with
// trailing slash, or sc-domain:example.com). The service account email must be
// added as a property owner in Search Console. Submission only registers the
// sitemap feed — indexing/ranking is never guaranteed.
//
// OAuth2 JWT-bearer flow is implemented with node:crypto (RS256) — no npm deps.
// Test/proxy overrides: GOOGLE_OAUTH_TOKEN_URL, GOOGLE_WEBMASTERS_BASE.
const fs = require('node:fs');
const crypto = require('node:crypto');
const Config = require('./config');
const Seo = require('../seo');

const LOG = '[google-sitemap]';
const SCOPE = 'https://www.googleapis.com/auth/webmasters';
const tokenCache = { token: '', exp: 0 };

function loadServiceAccount() {
  const file = String(Config.GOOGLE_SA_JSON_FILE || '');
  if (!file) throw new Error('GOOGLE_SA_JSON_FILE is not configured.');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.client_email || !raw.private_key) throw new Error('Service-account JSON must contain client_email and private_key.');
  return raw;
}

function signJwt(claims, privateKey) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64(claims);
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  return unsigned + '.' + sig.toString('base64url');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const tokenUrl = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
  const assertion = signJwt({
    iss: sa.client_email,
    scope: SCOPE,
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  }, sa.private_key);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Token exchange failed: HTTP ' + res.status + (data.error_description ? ' ' + data.error_description : ''));
  tokenCache.token = String(data.access_token);
  tokenCache.exp = now + Number(data.expires_in || 3600);
  return tokenCache.token;
}

function feedUrls() {
  const site = String(Config.GOOGLE_SITEMAPS_SITE || '');
  const feeds = String(Config.GOOGLE_SITEMAPS_FEEDS || 'sitemap.xml').split(',').map((s) => s.trim()).filter(Boolean);
  for (const f of feeds) if (!/^[A-Za-z0-9._-]+$/.test(f)) throw new Error('Invalid GOOGLE_SITEMAPS_FEEDS entry: ' + f);
  let base;
  if (site.startsWith('sc-domain:')) {
    const root = Seo.origin(Config.SEO_PUBLIC_ORIGIN || Config.APP_PUBLIC_ORIGIN);
    if (!root) throw new Error('sc-domain properties need SEO_PUBLIC_ORIGIN to build feed URLs.');
    base = root.replace(/\/$/, '');
  } else {
    base = site.replace(/\/$/, '');
  }
  return { site, urls: feeds.map((f) => base + '/' + f) };
}

async function runOnce() {
  try {
    const site = String(Config.GOOGLE_SITEMAPS_SITE || '');
    if (!site) { console.warn(LOG + ' skipped: GOOGLE_SITEMAPS_SITE is not configured.'); return; }
    const { urls } = feedUrls();
    const sa = loadServiceAccount();
    const token = await getAccessToken(sa);
    const base = (process.env.GOOGLE_WEBMASTERS_BASE || 'https://www.googleapis.com/webmasters/v3').replace(/\/$/, '');
    const statuses = [];
    for (const feed of urls) {
      const endpoint = base + '/sites/' + encodeURIComponent(site) + '/sitemaps/' + encodeURIComponent(feed);
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      statuses.push(res.status);
      if (![200, 204].includes(res.status)) {
        const body = await res.text().catch(() => '');
        console.error(LOG + ' submit failed for ' + feed + ': HTTP ' + res.status + ' ' + body.slice(0, 200));
      }
    }
    console.log(LOG + ' submitted ' + urls.length + ' feed(s) for ' + site + ': HTTP ' + statuses.join(', ') + ' (indexing/ranking is NOT guaranteed)');
  } catch (e) {
    console.error(LOG + ' run failed: ' + e.message);
  }
}

module.exports = { runOnce, getAccessToken, feedUrls, signJwt };
