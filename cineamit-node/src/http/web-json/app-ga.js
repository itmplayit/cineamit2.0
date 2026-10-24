'use strict';

const Config = require('../../core/config');

// GA4 Measurement Protocol beacon (Android app analytics relay).
const GA_EVENT_OK = new Set([
  'screen_view', 'login', 'sign_up', 'search', 'select_content', 'app_open',
  'watch_start', 'live_tv', 'download',
]);

function gaClientId(raw) {
  const s = String(raw || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return s;
  if (/^\d+\.\d+$/.test(s) && s.length <= 40) return s;
  return '';
}

function gaCleanParams(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= 12) break;
    const key = String(k || '');
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (['email', 'password', 'token', 'otp', 'pin', 'secret'].includes(key)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) { out[key] = v; n += 1; continue; }
    if (typeof v === 'boolean') { out[key] = v; n += 1; continue; }
    if (typeof v === 'string') { out[key] = v.slice(0, 100); n += 1; }
  }
  if (out.engagement_time_msec == null) out.engagement_time_msec = 1;
  return out;
}

function gaMpCollect(payload) {
  return new Promise((resolve) => {
    const mid = Config.GA_MEASUREMENT_ID;
    const secret = Config.GA_API_SECRET;
    if (!mid || !secret) return resolve(false);
    const body = JSON.stringify(payload);
    const q = new URLSearchParams({ measurement_id: mid, api_secret: secret }).toString();
    const req = https.request({
      hostname: 'www.google-analytics.com',
      path: '/mp/collect?' + q,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(false); });
    req.end(body);
  });
}

async function app_ga(app) {
  if (!(Config.GA_MEASUREMENT_ID && Config.GA_API_SECRET)) {
    return app.json({ ok: true, skipped: true });
  }
  const ip = String(app.req.ip || app.req.socket && app.req.socket.remoteAddress || 'x');
  if (!(await app.throttle('ga_' + ip, 80, 3600))) {
    app.res.status(429);
    return app.json({ ok: false, error: 'slow_down' });
  }
  const body = app.req.body || {};
  const cid = gaClientId(body.client_id);
  if (!cid) { app.res.status(400); return app.json({ ok: false, error: 'bad_client' }); }
  const raw = Array.isArray(body.events) ? body.events : [];
  const events = [];
  for (const ev of raw.slice(0, 20)) {
    if (!ev || typeof ev !== 'object') continue;
    const name = String(ev.name || '');
    if (!GA_EVENT_OK.has(name)) continue;
    events.push({ name, params: gaCleanParams(ev.params) });
  }
  if (!events.length) return app.json({ ok: true, empty: true });
  const payload = { client_id: cid, events };
  try {
    const user = await app.currentUser();
    if (user && user.id && !(app.session && app.session.is_kids)) payload.user_id = String(user.id);
  } catch {}
  gaMpCollect(payload).catch(() => {});
  return app.json({ ok: true });
}


module.exports = { app_ga };
