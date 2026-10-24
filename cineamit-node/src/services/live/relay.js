'use strict';

const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const Security = require('../../security');
const { ssrfResolvedIps, ssrfResolveRedirectUrl } = require('../../security/ssrf');
const { streamOk } = require('./common');
const { CineLiveStreamAccess } = require('./access');

// HLS manifest rewrite + relayed upstream streaming (session-bound token URLs only).
function cineLiveIsHlsManifest(url) {
  try {
    const parts = new URL(url);
    const ext = path.extname(parts.pathname).slice(1).toLowerCase();
    const query = (parts.search || '').toLowerCase();
    return ['m3u8', 'm3u'].includes(ext) || /(?:^|[?&;])(?:format|type|extension)=m3u8(?:$|[?&;])/i.test(query);
  } catch { return false; }
}

function cineLiveRewriteHlsManifest(manifest, baseUrl, userId, app) {
  if (manifest.length > 5242880 || !manifest.includes('#EXTM3U')) return null;
  let failed = false;
  const lines = manifest.split(/\r\n|\n|\r/);
  if (lines.length > 20000) return null;
  const out = [];
  const uriPattern = /\b[A-Z0-9-]*URI\s*=/i;
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(line); continue; }
    if (trimmed[0] === '#') {
      if (/^#EXT-X-(?:DEFINE|CONTENT-STEERING|PREFETCH)\b/i.test(trimmed)) { failed = true; out.push(line); continue; }
      if (!uriPattern.test(line)) {
        if (/https?:\/\//i.test(line)) failed = true;
        out.push(line);
        continue;
      }
      const uriCount = (line.match(/\b[A-Z0-9-]*URI\s*=/gi) || []).length;
      const quotedCount = (line.match(/\b[A-Z0-9-]*URI\s*=\s*"/gi) || []).length;
      if (uriCount !== quotedCount) { failed = true; out.push(line); continue; }
      line = line.replace(/(\b[A-Z0-9-]*URI\s*=\s*)"(.*?)"/gi, (m, p1, p2) => {
        const reference = Security.decodeHtmlEntities(p2.trim());
        if (/^(?:data|urn):/i.test(reference)) return m;
        if (!reference || /[\r\n\x00]/.test(reference) || reference.includes('{$')
          || (/^[a-z][a-z0-9+.-]*:/i.test(reference) && !/^https?:\/\//i.test(reference))) {
          failed = true;
          return m;
        }
        const resolved = ssrfResolveRedirectUrl(baseUrl, reference);
        const proxy = resolved ? CineLiveStreamAccess.issueUrl(resolved, userId, app) : null;
        if (!proxy) { failed = true; return m; }
        return p1 + '"' + proxy + '"';
      });
      if (/https?:\/\//i.test(line)) failed = true;
      out.push(line);
      continue;
    }
    if (trimmed.includes('{$') || (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed))) {
      failed = true;
      out.push(line);
      continue;
    }
    const resolved = ssrfResolveRedirectUrl(baseUrl, trimmed);
    const proxy = resolved ? CineLiveStreamAccess.issueUrl(resolved, userId, app) : null;
    if (!proxy) { failed = true; out.push(line); continue; }
    out.push(proxy);
  }
  if (failed) return null;
  return out.join('\n');
}

async function cineLiveStreamResponse(app, initialUrl, expectedExt = '', mag = null) {
  const req = app.req;
  const res = app.res;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').end();
    return;
  }
  const range = String(req.headers.range || '').trim();
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/i.test(range)) {
    res.status(416).end();
    return;
  }
  const magHeaders = {};
  if (mag && mag.mac) {
    magHeaders['User-Agent'] = MAG_UA;
    magHeaders['X-User-Agent'] = 'Model: MAG250; Link: Ethernet';
    magHeaders.Cookie = 'mac=' + encodeURIComponent(String(mag.mac)) + '; stb_lang=en; timezone=GMT';
  }
  let current = initialUrl;
  for (let hop = 0; hop <= 4; hop++) {
    if (!streamOk(current, app)) {
      console.error('[livetv] stream blocked url-host');
      if (!res.headersSent) res.status(502).end();
      return;
    }
    let parts;
    try { parts = new URL(current); } catch {
      if (!res.headersSent) res.status(502).end();
      return;
    }
    const host = parts.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const ips = await ssrfResolvedIps(host);
    if (!ips.length) {
      console.error('[livetv] stream host did not resolve publicly');
      if (!res.headersSent) res.status(502).end();
      return;
    }
    const pinIp = net.isIP(host) ? null : ips[0];
    const hopResult = await pipeLiveHop(app, current, pinIp, magHeaders, range, expectedExt);
    if (hopResult && hopResult.redirect) {
      const next = ssrfResolveRedirectUrl(current, hopResult.redirect);
      if (!next || !streamOk(next, app)) {
        if (!res.headersSent) res.status(502).end();
        return;
      }
      current = next;
      continue;
    }
    if (hopResult && hopResult.done) return;
    if (!res.headersSent) res.status(502).end();
    return;
  }
  if (!res.headersSent) res.status(502).end();
}

function liveMime(rawMime, url, expectedExt) {
  const raw = String(rawMime || '').toLowerCase().split(';')[0].trim();
  let ext = '';
  try { ext = path.extname(new URL(url).pathname).slice(1).toLowerCase(); } catch {}
  if (!ext && expectedExt) ext = String(expectedExt).toLowerCase();
  if (raw === 'text/html' || raw === 'application/json' || raw === 'text/json') return null;
  if (raw && raw !== 'application/octet-stream' && raw !== 'binary/octet-stream' && raw !== 'text/plain') return raw;
  return ({
    ts: 'video/mp2t', m2ts: 'video/mp2t', m3u8: 'application/vnd.apple.mpegurl',
    m3u: 'application/vnd.apple.mpegurl', mp4: 'video/mp4', m4s: 'video/mp4',
    flv: 'video/x-flv', aac: 'audio/aac', mp3: 'audio/mpeg',
  })[ext] || 'video/mp2t';
}

function pipeLiveHop(app, url, pinIp, magHeaders, range, expectedExt) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ error: 'bad url' }); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = Object.assign({
      Accept: '*/*',
      'User-Agent': magHeaders['User-Agent'] || 'CineAmit-Live-Relay/1.0',
    }, magHeaders);
    if (range) headers.Range = range;
    const opts = {
      hostname: pinIp || u.hostname,
      servername: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: Object.assign({ Host: u.host }, headers),
      timeout: 20000,
      rejectUnauthorized: true,
    };
    const upstream = lib.request(opts, (up) => {
      try { upstream.setTimeout(0); } catch {}
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
        up.resume();
        resolve({ redirect: up.headers.location, code: up.statusCode });
        return;
      }
      if (!(up.statusCode >= 200 && up.statusCode < 300)) {
        up.resume();
        resolve({ error: 'HTTP ' + up.statusCode, code: up.statusCode });
        return;
      }
      const mime = liveMime(up.headers['content-type'], url, expectedExt);
      if (!mime) {
        up.resume();
        resolve({ error: 'bad mime' });
        return;
      }
      const res = app.res;
      if (res.headersSent) {
        up.resume();
        resolve({ done: true });
        return;
      }
      res.status(up.statusCode || 200);
      res.set({
        'Content-Type': mime,
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
        'Accept-Ranges': up.headers['accept-ranges'] || 'bytes',
      });
      if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
      if (up.headers['content-range']) res.set('Content-Range', up.headers['content-range']);
      const abort = () => {
        try { upstream.destroy(); } catch {}
        try { up.destroy(); } catch {}
      };
      app.req.on('close', abort);
      up.on('error', () => { abort(); try { res.end(); } catch {} resolve({ done: true }); });
      res.on('close', abort);
      up.pipe(res);
      up.on('end', () => resolve({ done: true }));
    });
    upstream.on('timeout', () => { try { upstream.destroy(); } catch {} resolve({ error: 'timeout' }); });
    upstream.on('error', (e) => resolve({ error: e.message }));
    upstream.end();
  });
}

module.exports = {
  cineLiveIsHlsManifest,
  cineLiveRewriteHlsManifest,
  cineLiveStreamResponse,
};
