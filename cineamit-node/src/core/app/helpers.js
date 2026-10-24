'use strict';

const TwigEnv = require('../twig-env');

// Shared module-level helpers + constants (moved verbatim from core/app.js).
const SESSION_ABSOLUTE_MAX = 60 * 60 * 24 * 30;
const LOGIN_FAIL_MAX = 5;
const LOGIN_FAIL_WINDOW = 900;
const BAD_BOTS = [
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'blexbot', 'dataforseobot', 'petalbot',
  'serpstatbot', 'seokicks', 'megaindex', 'linkdexbot', 'zoominfobot', 'screaming frog',
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'ccbot', 'claudebot', 'anthropic-ai',
  'bytespider', 'perplexitybot', 'imagesiftbot', 'diffbot', 'omgili', 'youbot',
  'seznam', 'barkrowler', 'panscient', 'vuhuv', 'timpibot', 'magpie-crawler',
];

function slugify(title) {
  let text = String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  text = text.replace(/[^\p{L}\d]+/gu, '-');
  text = text.replace(/[^\w-]+/g, '');
  text = text.replace(/^-+|-+$/g, '').replace(/-+/g, '-');
  return (text || 'n-a').toLowerCase();
}

function parseSiteDomains(raw, currentHost) {
  const here = String(currentHost || '').replace(/^www\./i, '').toLowerCase();
  const out = [];
  const seen = new Set();
  for (const line of String(raw || '').split(/[\n,]+/)) {
    let u = line.trim();
    if (!u || u.length > 255) continue;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    let parsed;
    try { parsed = new URL(u); } catch { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    if (parsed.username || parsed.password) continue;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host.endsWith('.local')) continue;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!loopback && (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.includes('..'))) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    const href = parsed.protocol + '//' + host + (parsed.port ? ':' + parsed.port : '');
    const label = host.replace(/^www\./, '');
    out.push({
      href,
      host,
      label,
      current: !!(here && (label === here || host === here || host === 'www.' + here)),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function jsonStr(value) {
  return TwigEnv.jsonStr(value);
}

function renderTwig(template, context, app) {
  return Promise.resolve(TwigEnv.render(template, context, app));
}

function isCacheableGuestPath(p) {
  const exact = ['/', '/home', '/movies', '/anime', '/studios', '/tv'];
  if (exact.includes(p)) return true;
  return ['/movies/', '/category/', '/studios/', '/anime/', '/tv/'].some((pre) => p.startsWith(pre));
}

function isBadBot(ua) {
  if (!ua) return false;
  const low = ua.toLowerCase();
  return BAD_BOTS.some((n) => low.includes(n));
}

function jsonClient(req) {
  if (!req) return false;
  const headers = req.headers || {};
  const accept = String(headers.accept || '').toLowerCase();
  if (accept.includes('application/json')) return true;
  const client = String(headers['x-cine-client'] || '').toLowerCase();
  return client === 'app' || client === 'cineamit';
}

function acceptsJson(req) {
  if (jsonClient(req)) return true;
  const q = (req && req.query) || {};
  return String(q.format || '').toLowerCase() === 'json';
}

function csrfExemptPath(p) {
  return /^\/api\/party\//.test(p) || /^\/api\/app\//.test(p) || p === '/setup' || p === '/api/ga_blocked';
}

module.exports = { slugify, parseSiteDomains, jsonStr, renderTwig, isCacheableGuestPath, isBadBot,
  jsonClient, acceptsJson, csrfExemptPath, SESSION_ABSOLUTE_MAX, LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW, BAD_BOTS };
