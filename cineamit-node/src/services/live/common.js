'use strict';

const crypto = require('crypto');
const Config = require('../../core/config');
const { streamProxyUrlOk } = require('../../security/ssrf');

// Shared stream-token helpers (session binding, own-host list, upstream URL gate).
function sessionBinding(app) {
  const req = app && app.req;
  const sessionId = (req && (req.sessionID || (req.session && req.session.id))) || '';
  if (!sessionId) return null;
  return crypto.createHmac('sha256', Config.SECRET_KEY).update(String(sessionId)).digest('hex');
}

function ownHosts(app) {
  const out = [];
  for (const candidate of [app.req.headers.host || '', Config.OAUTH_BASE_URL || '']) {
    if (!candidate) continue;
    try {
      const h = new URL(String(candidate).includes('://') ? candidate : 'https://' + candidate).hostname;
      if (h) out.push(h.toLowerCase().replace(/\.+$/, ''));
    } catch {}
  }
  return out;
}

function streamOk(url, app) {
  return streamProxyUrlOk(url, ownHosts(app));
}

module.exports = { sessionBinding, ownHosts, streamOk };
