'use strict';

const crypto = require('crypto');
const Database = require('../db');
const net = require('net');

const CinePlayerAccess = {
  TTL: 21600,
  KEY: 'cine_player_access_v1',
  MAX: 80,

  prune(session) {
    if (!session) return;
    let bag = session[this.KEY] || {};
    if (typeof bag !== 'object' || Array.isArray(bag)) bag = {};
    for (const k of Object.keys(bag)) {
      if (!bag[k] || (bag[k].expires || 0) <= Date.now() / 1000) delete bag[k];
    }
    session[this.KEY] = bag;
  },

  issue(session, url, meta) {
    if (!session || !this.urlLooksPublic(url)) return '';
    this.prune(session);
    const keys = Object.keys(session[this.KEY] || {});
    while (keys.length >= this.MAX) delete session[this.KEY][keys.shift()];
    const token = crypto.randomBytes(32).toString('hex');
    const bag = {
      url,
      expires: Math.floor(Date.now() / 1000) + this.TTL,
    };
    if (meta && typeof meta === 'object') {
      bag.tmdbId = Number(meta.tmdbId) || 0;
      bag.profileId = Number(meta.profileId || 0);
      bag.mediaType = String(meta.mediaType || '') === 'tv' ? 'tv' : 'movie';
      bag.s = Math.max(1, Number(meta.s) || 1);
      bag.e = Math.max(1, Number(meta.e) || 1);
    }
    session[this.KEY][token] = bag;
    return token;
  },

  resolve(session, token) {
    const item = this.resolveItem(session, token);
    return item ? String(item.url) : null;
  },

  resolveItem(session, token) {
    if (!session || !/^[a-f0-9]{64}$/.test(String(token))) return null;
    this.prune(session);
    const item = (session[this.KEY] || {})[token];
    if (!item || !item.tmdbId || !this.urlLooksPublic(String(item.url || ''))) return null;
    if (Number(item.profileId || 0) !== Number(session.active_profile_id || 0)) return null;
    return item;
  },

  urlLooksPublic(url) {
    if (/[\x00-\x20\x7f\\]/.test(url)) return false;
    let p;
    try { p = new URL(url); } catch { return false; }
    if (!['http:', 'https:'].includes(p.protocol)) return false;
    if (p.username || p.password) return false;
    const host = p.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (/^(localhost|0\.0\.0\.0)$/.test(host)) return false;
    if (/\.(localhost|local|internal|home|lan|intranet)$/i.test(host)) return false;
    if (net.isIP(host)) {
      let ip = host.startsWith('::ffff:') ? host.slice(7) : host;
      if (ip.startsWith('::1')) return false;
      if (/^(fc|fd|fe80|::)/i.test(ip)) return false;
      if (!ip.includes(':')) {
        const q = ip.split('.').map(Number);
        if (q.length === 4) {
          if (q[0] === 0 || q[0] === 10 || q[0] === 127) return false;
          if (q[0] === 169 && q[1] === 254) return false;
          if (q[0] === 172 && q[1] >= 16 && q[1] <= 31) return false;
          if (q[0] === 192 && q[1] === 168) return false;
          if (q[0] >= 224) return false;
        }
      }
    }
    return true;
  },
};

const CineDownloadAccess = {
  TTL: 21600,
  MAX_LINKS: 100,
  KEY: 'cine_download_access_v1',
  ORIGIN_COMPAT_HOSTS: ['nxsha.space'],

  iframeSandbox(url) {
    let flags = 'allow-scripts allow-forms allow-downloads';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch {}
    if (this.safeUrl(url) && this.ORIGIN_COMPAT_HOSTS.includes(host)) flags += ' allow-same-origin allow-popups';
    return flags;
  },

  noStore(res) {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
  },

  safeUrl(url) {
    if (/[\x00-\x20\x7f\\]/.test(url) || /%0[ad]/i.test(url)) return false;
    let p;
    try { p = new URL(url); } catch { return false; }
    if (p.protocol !== 'https:' && p.protocol !== 'http:') return false;
    if (p.username || p.password) return false;
    if (p.port && p.port !== '443' && p.port !== '80') return false;
    const host = p.hostname.replace(/\.+$/, '').toLowerCase();
    if (net.isIP(host.replace(/^\[|\]$/g, ''))) return false;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return false;
    if (/\.(?:localhost|local|internal|test|invalid)$/.test(host)) return false;
    return true;
  },

  prune(session) {
    let links = session[this.KEY] || {};
    if (typeof links !== 'object') links = {};
    for (const key of Object.keys(links)) {
      const item = links[key];
      if (!item || (item.expires || 0) <= Date.now() / 1000) delete links[key];
    }
    session[this.KEY] = links;
  },

  issue(session, setting, url, mediaType, title, back) {
    if (!session || !this.safeUrl(url)) return null;
    if (!setting.id || !['movie', 'tv'].includes(mediaType)) return null;
    if (setting.is_active != null && Number(setting.is_active) === 0) return null;
    const filter = setting.media_type_filter || 'all';
    if (filter !== 'all' && filter !== mediaType) return null;
    if (!back.startsWith('/watch/') || /[\r\n\\]/.test(back)) return null;
    this.prune(session);
    const keys = Object.keys(session[this.KEY] || {});
    while (keys.length >= this.MAX_LINKS) {
      delete session[this.KEY][keys.shift()];
    }
    const token = crypto.randomBytes(32).toString('hex');
    session[this.KEY][token] = {
      url,
      setting_id: Number(setting.id),
      pattern_hash: crypto.createHash('sha256').update(String(setting.pattern_url)).digest('hex'),
      media_type: mediaType,
      title,
      back,
      owner: String(session.user_id || ''),
      expires: Math.floor(Date.now() / 1000) + this.TTL,
    };
    return '/download/' + token;
  },

  async resolve(session, token) {
    if (!session || !/^[a-f0-9]{64}$/.test(token)) return null;
    this.prune(session);
    const item = (session[this.KEY] || {})[token];
    if (!item) return null;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(String(item.owner)), Buffer.from(String(session.user_id || '')))) return null;
    } catch { return null; }
    const setting = await Database.fetchOne('SELECT * FROM download_setting WHERE id = ?', [item.setting_id]);
    const filter = (setting && setting.media_type_filter) || 'all';
    const hash = setting ? crypto.createHash('sha256').update(String(setting.pattern_url)).digest('hex') : '';
    if (!setting || (setting.is_active != null && Number(setting.is_active) === 0)
      || (filter !== 'all' && filter !== item.media_type)
      || hash !== item.pattern_hash
      || !this.safeUrl(item.url)) {
      delete session[this.KEY][token];
      return null;
    }
    item.provider = setting.name || 'Download provider';
    return item;
  },
};

module.exports = { CinePlayerAccess, CineDownloadAccess };
