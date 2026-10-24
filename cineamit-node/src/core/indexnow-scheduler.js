'use strict';
// Daily IndexNow announcement of the published sitemap URLs (opt-in feature).
//
// Enable with INDEXNOW_AUTO=true. Requires INDEXNOW_KEY and a public
// SEO_PUBLIC_ORIGIN/APP_PUBLIC_ORIGIN. The proof file /indexnow-key.txt is
// already served by routes.indexnow_key. URLs are taken from the live sitemap
// children (/sitemap-core.xml, /sitemap-titles.xml, /sitemap-posts.xml), so the
// announcement always matches what search engines can read.
//
// Submission only ANNOUNCES URLs. Indexing and ranking are never guaranteed and
// no submission is made when the key/origin is missing or the proof fails.
const Config = require('./config');
const Seo = require('../seo');
const { buildPlan } = require('../../tools/indexnow');

const LOG = '[indexnow-auto]';
const API_DEFAULT = 'https://api.indexnow.org/indexnow';
const CHILDREN = ['/sitemap-core.xml', '/sitemap-titles.xml', '/sitemap-posts.xml'];
const BATCH_MAX = 10000; // IndexNow limit per request

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function collectSitemapUrls(selfBase) {
  const urls = [];
  const misses = [];
  for (const p of CHILDREN) {
    try {
      const res = await fetch(selfBase + p, {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'CineAmit-IndexNowScheduler/1.0', Accept: 'application/xml' },
      });
      if (!res.ok) { misses.push(p + ' -> HTTP ' + res.status); continue; }
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(unescapeXml(m[1].trim()));
    } catch (e) {
      misses.push(p + ' -> ' + e.message);
    }
  }
  return { urls: [...new Set(urls)], misses };
}

async function submitPlan(plan, apiEndpoint) {
  const proof = await fetch(plan.keyLocation, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (proof.status !== 200 || (await proof.text()).trim() !== plan.key) {
    throw new Error('Key proof mismatch at ' + plan.keyLocation);
  }
  const res = await fetch(apiEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(plan),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  return res.status;
}

async function runOnce(opts = {}) {
  if (Config.INDEXNOW_AUTO) await runIndexNow(opts);
  if (Config.GOOGLE_SITEMAP_AUTO) await require('./google-webmasters').runOnce();
}

async function runIndexNow(opts = {}) {
  const selfBase = opts.selfBase || ('http://127.0.0.1:' + String(process.env.PORT || 3000));
  const apiEndpoint = opts.apiEndpoint || process.env.INDEXNOW_API_ENDPOINT || API_DEFAULT;
  try {
    const root = Seo.origin(Config.SEO_PUBLIC_ORIGIN || Config.APP_PUBLIC_ORIGIN);
    if (!root) { console.warn(LOG + ' skipped: configure SEO_PUBLIC_ORIGIN (public HTTPS origin) first.'); return; }
    if (!String(Config.INDEXNOW_KEY || '')) { console.warn(LOG + ' skipped: INDEXNOW_KEY not configured.'); return; }
    const { urls, misses } = await collectSitemapUrls(selfBase);
    if (misses.length) console.warn(LOG + ' sitemap misses: ' + misses.join('; '));
    if (!urls.length) { console.warn(LOG + ' skipped: no sitemap URLs collected.'); return; }
    const statuses = [];
    for (let i = 0; i < urls.length; i += BATCH_MAX) {
      const plan = buildPlan(urls.slice(i, i + BATCH_MAX), Config);
      statuses.push(await submitPlan(plan, apiEndpoint));
    }
    console.log(LOG + ' announced ' + urls.length + ' sitemap URLs in ' + statuses.length + ' batch(es): HTTP ' + statuses.join(', ') + ' (indexing/ranking is NOT guaranteed)');
  } catch (e) {
    console.error(LOG + ' run failed: ' + e.message);
  }
}

function start(opts = {}) {
  const delayS = Number(process.env.INDEXNOW_AUTO_DELAY_S || 120);
  const intervalH = Number(Config.INDEXNOW_AUTO_INTERVAL_HOURS || 24);
  const first = setTimeout(() => { runOnce(opts); }, Math.max(1, delayS) * 1000);
  const every = setInterval(() => { runOnce(opts); }, intervalH * 3600 * 1000);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
  const jobs = [];
  if (Config.INDEXNOW_AUTO) jobs.push('indexnow');
  if (Config.GOOGLE_SITEMAP_AUTO) jobs.push('google-sitemap');
  console.log('[seo-daily] scheduled (' + jobs.join('+') + '): first run in ' + delayS + 's, then every ' + intervalH + 'h');
}

module.exports = { start, runOnce, collectSitemapUrls };
