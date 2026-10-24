'use strict';

const path = require('path');
const crypto = require('crypto');
const Config = require('../../core/config');
const Security = require('../../security');
const { sessionBinding, streamOk } = require('./common');
const { cineStalkerConfiguredPortals, cineStalkerAllowedPortalSync } = require('./stalker');

const TOKEN_TTL = 14400;
const TOKEN_PURPOSE = 'live-stream';

const CineLiveStreamAccess = {
  issueUrl(url, userId, app) {
    url = String(url).trim();
    if (userId < 1 || url.length > 4096 || !streamOk(url, app)) return null;
    let parts;
    try { parts = new URL(url); } catch { return null; }
    let extension = path.extname(parts.pathname).slice(1).toLowerCase();
    const query = (parts.search || '').toLowerCase();
    if (!extension) {
      const m = query.match(/(?:^|[?&;])(?:format|type|extension)=([a-z0-9]+)/);
      if (m) extension = m[1];
    }
    if (extension === 'mpd') return null;
    const suffix = ['m3u8', 'm3u', 'ts', 'm2ts', 'flv', 'mp4', 'm4s', 'aac', 'mp3', 'key', 'bin', 'jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)
      ? '.' + extension : '.ts';
    const binding = sessionBinding(app);
    if (!binding) return null;
    try {
      const payload = JSON.stringify({ kind: 'url', url, uid: userId, sid: binding, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL });
      const token = Security.encryptOpaqueToken(TOKEN_PURPOSE, payload);
      return '/api/live_stream/' + token + suffix;
    } catch (e) {
      console.error('[live-stream] Could not issue relay token: ' + e.message);
      return null;
    }
  },

  async issueStalker(portal, mac, command, userId, app) {
    await cineStalkerConfiguredPortals();
    portal = cineStalkerAllowedPortalSync(portal, mac);
    command = String(command).trim();
    const binding = sessionBinding(app);
    if (!portal || !binding || userId < 1 || !command || command.length > 2048 || /[\r\n\x00]/.test(command)) return null;
    try {
      const payload = JSON.stringify({
        kind: 'stalker', portal, mac, cmd: command, uid: userId, sid: binding, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL,
      });
      return '/api/live_stream/' + Security.encryptOpaqueToken(TOKEN_PURPOSE, payload) + '.ts';
    } catch (e) {
      console.error('[live-stream] Could not issue Stalker relay token: ' + e.message);
      return null;
    }
  },

  async resolve(routeToken, userId, app) {
    await cineStalkerConfiguredPortals();
    const token = String(routeToken).replace(/\.(?:m3u8|m3u|ts|m2ts|flv|mp4|m4s|aac|mp3|key|bin|jpg|jpeg|png|webp|gif)$/i, '');
    if (!token) return null;
    const binding = sessionBinding(app);
    if (!binding || userId < 1) return null;
    try {
      const plain = Security.decryptOpaqueToken(TOKEN_PURPOSE, token);
      if (!plain) return null;
      const data = JSON.parse(plain);
      if (!data || !['url', 'stalker'].includes(data.kind || '')
        || Number(data.uid || 0) !== userId || typeof data.exp !== 'number'
        || data.exp < Date.now() / 1000 || data.exp > Date.now() / 1000 + TOKEN_TTL + 60
        || typeof data.sid !== 'string' || !crypto.timingSafeEqual(Buffer.from(binding), Buffer.from(data.sid))) {
        return null;
      }
      if (data.kind === 'url') {
        if (typeof data.url !== 'string' || !streamOk(data.url, app)) return null;
      } else if (typeof data.portal !== 'string' || typeof data.mac !== 'string'
        || typeof data.cmd !== 'string' || data.cmd.length > 2048
        || !cineStalkerAllowedPortalSync(data.portal, data.mac)) {
        return null;
      }
      const hintExt = path.extname(routeToken).slice(1).toLowerCase();
      data._hint_ext = ['m3u8', 'm3u', 'ts', 'm2ts', 'flv', 'mp4', 'm4s', 'aac', 'mp3', 'key', 'bin', 'jpg', 'jpeg', 'png', 'webp', 'gif'].includes(hintExt) ? hintExt : '';
      return data;
    } catch {
      return null;
    }
  },
};

module.exports = { CineLiveStreamAccess };
