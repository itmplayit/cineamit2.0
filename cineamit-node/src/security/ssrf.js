'use strict';

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

const dnsCache = {};

function ssrfIsPrivateIp(ip) {
  ip = String(ip).toLowerCase().replace(/^\[|\]$/g, '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIP(ip) === 0) return true;
  if (net.isIP(ip) === 4) {
    const q = ip.split('.').map(Number);
    if (q.length !== 4) return true;
    if (q[0] === 0 || q[0] === 10 || q[0] === 127) return true;
    if (q[0] === 169 && q[1] === 254) return true;
    if (q[0] === 172 && q[1] >= 16 && q[1] <= 31) return true;
    if (q[0] === 192 && q[1] === 168) return true;
    if (q[0] >= 224) return true;
    return false;
  }
  // IPv6
  if (ip === '::' || ip.startsWith('ff') || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

async function ssrfResolvedIps(host) {
  host = String(host).toLowerCase().replace(/^\[|\]$/g, '').trim();
  if (!host) return [];
  if (dnsCache[host] && dnsCache[host].expires >= Date.now() / 1000) return dnsCache[host].ips;
  if (net.isIP(host)) {
    const result = ssrfIsPrivateIp(host) ? [] : [host];
    dnsCache[host] = { ips: result, expires: Date.now() / 1000 + 30 };
    return result;
  }
  let ips = [];
  try {
    const recs = await dns.lookup(host, { all: true, verbatim: true });
    ips = recs.map((r) => r.address).filter((ip) => net.isIP(ip));
  } catch { ips = []; }
  ips = [...new Set(ips)];
  if (!ips.length) {
    dnsCache[host] = { ips: [], expires: Date.now() / 1000 + 30 };
    return [];
  }
  for (const ip of ips) {
    if (ssrfIsPrivateIp(ip)) {
      dnsCache[host] = { ips: [], expires: Date.now() / 1000 + 30 };
      return [];
    }
  }
  dnsCache[host] = { ips, expires: Date.now() / 1000 + 30 };
  return ips;
}

function ssrfBlockedHost(host) {
  host = String(host).toLowerCase().replace(/^\[|\]$|\.+$/g, '').trim();
  if (!host) return true;
  if (/^(localhost|0\.0\.0\.0|metadata|metadata\.google\.internal|localtest\.me)$/i.test(host)) return true;
  if (/\.(localhost|local|internal|home|lan|intranet|nip\.io|sslip\.io|xip\.io)$/i.test(host)) return true;
  return false;
}

async function ssrfBlockedHostAsync(host) {
  if (ssrfBlockedHost(host)) return true;
  const ips = await ssrfResolvedIps(host);
  return ips.length === 0;
}

function ssrfResolveRedirectUrl(baseUrl, location) {
  location = String(location).trim();
  if (!location || /[\r\n\x00]/.test(location)) return null;
  try {
    if (/^https?:\/\//i.test(location)) return location;
    const resolved = new URL(location, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function fetchOnce(url, {method = 'GET', headers = {}, timeout = 20000, maxBytes = 10485760, pinIp = null} = {}) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(url); } catch { resolve({ok: false, code: 0, error: 'Invalid URL'}); return; }
    if (!['http:', 'https:'].includes(u.protocol)) { resolve({ok: false, code: 0, error: 'Invalid protocol'}); return; }
    let settled = false, timer;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const req = (u.protocol === 'https:' ? https : http).request({
      hostname: pinIp || u.hostname.replace(/^\[|\]$/g, ''), servername: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
      method, headers: {Host: u.host, ...headers}, rejectUnauthorized: true,
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          finish({ok: false, code: res.statusCode || 0, error: 'Response exceeded size limit'});
          res.destroy(); req.destroy(); return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish({ok: res.statusCode >= 200 && res.statusCode < 300, code: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers, location: res.headers.location || '', contentType: res.headers['content-type'] || '', error: ''}));
      res.on('error', error => finish({ok: false, code: 0, error: error.message}));
      res.on('aborted', () => finish({ok: false, code: 0, error: 'Upstream aborted'}));
      res.on('close', () => { if (!res.complete) finish({ok: false, code: 0, error: 'Upstream closed prematurely'}); });
    });
    req.on('error', error => finish({ok: false, code: 0, error: error.message}));
    timer = setTimeout(() => { finish({ok: false, code: 0, error: 'timeout'}); req.destroy(); }, timeout);
    req.end();
  });
}

async function ssrfSafeHttpGet(url, options = {}, maxRedirects = 3, requireHttps = false, sameHostOnly = false, maxBytes = 10485760) {
  let current = url;
  let originHost = '';
  let originPort = 0;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parts;
    try { parts = new URL(current); } catch { return { ok: false, error: 'Invalid or credential-bearing redirect URL' }; }
    if (parts.username || parts.password) return { ok: false, error: 'Invalid or credential-bearing redirect URL' };
    const scheme = parts.protocol.replace(':', '');
    const host = parts.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const port = Number(parts.port || (scheme === 'https' ? 443 : 80));
    if (!['http', 'https'].includes(scheme) || (requireHttps && scheme !== 'https') || port < 1 || port > 65535 || await ssrfBlockedHostAsync(host)) {
      return { ok: false, error: 'Blocked or insecure redirect destination' };
    }
    const query = parts.search.slice(1);
    const hasAuthQuery = /(?:^|[&;])(?:user(?:name)?|pass(?:word)?|token|auth|api_key)=([^&;]+)/i.test(query);
    if (scheme !== 'https' && (hasAuthQuery || parts.username || parts.password)) {
      return { ok: false, error: 'Credentials over HTTP are blocked' };
    }
    if (!originHost) { originHost = host; originPort = port; }
    if (sameHostOnly && (host !== originHost || port !== originPort)) {
      return { ok: false, error: 'Credential-bearing redirect changed host or port' };
    }
    const ips = await ssrfResolvedIps(host);
    if (!ips.length) return { ok: false, error: 'Host did not resolve to a public IP' };
    const pinIp = net.isIP(host) ? null : ips[0];
    const headers = options.headers || {};
    const timeout = options.timeout || 20000;
    const result = await fetchOnce(current, { headers, timeout, maxBytes, pinIp });
    if (result.code >= 300 && result.code < 400 && result.location) {
      if (hop >= maxRedirects) return { ok: false, error: 'Redirect limit exceeded', code: result.code };
      const next = ssrfResolveRedirectUrl(current, result.location);
      if (!next) return { ok: false, error: 'Invalid redirect URL', code: result.code };
      current = next;
      continue;
    }
    if (!result.ok) return { ok: false, error: result.error || ('HTTP ' + result.code), code: result.code };
    return { ok: true, body: result.body.toString('utf8'), code: result.code, url: current, content_type: result.contentType, raw: result.body, headers: result.headers };
  }
  return { ok: false, error: 'Redirect limit exceeded' };
}

function streamProxyUrlOk(url, ownHosts = []) {
  if (url.length > 4096 || /[\r\n\x00]/.test(url)) return false;
  let p;
  try { p = new URL(url); } catch { return false; }
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return false;
  if (p.username || p.password) return false;
  const port = p.port ? Number(p.port) : 443;
  if (port < 1 || port > 65535) return false;
  const host = p.hostname.replace(/^\[|\]$|\.+$/g, '').toLowerCase();
  if (!host || ssrfBlockedHost(host)) return false;
  const cleanedOwn = ownHosts.map((h) => String(h).toLowerCase().replace(/\.+$/, '')).filter(Boolean);
  if (cleanedOwn.includes(host.replace(/\.+$/, ''))) return false;
  return true;
}

module.exports = {
  ssrfIsPrivateIp,
  ssrfResolvedIps,
  ssrfBlockedHost,
  ssrfBlockedHostAsync,
  ssrfResolveRedirectUrl,
  ssrfSafeHttpGet,
  streamProxyUrlOk,
  fetchOnce,
};
